import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createYoga } from 'graphql-yoga';
import { ok } from '@kithena/domain-kit';

import { define, inMemoryPeople, TENANT, versionOf } from '../application/person/in-memory.js';
import { personAccess } from '../application/person/person-access.js';
import type { PeopleService } from '../application/person/service.js';
import { inMemoryIdempotency } from '../http/idempotency.js';
import { restHandler } from '../http/rest.js';
import { configureGraphQL, schema } from './schema.js';

/**
 * PEO-108 over GraphQL: a mutation per move, the person after as the answer,
 * a refusal as the domain's code. The in-memory clock reads 22 September
 * 2026, UTC.
 */

const ADA = '00000000-0000-4000-8000-0000000000a1';
const NEW = '00000000-0000-4000-8000-0000000000a2';
const MARCO = '00000000-0000-4000-8000-0000000000a3';
const MARCO_ACCOUNT = '00000000-0000-4000-8000-0000000000b3';

function wire(account: string, roles: string[] = []) {
  const store = inMemoryPeople([
    versionOf(1, [define({ key: 'given_name', visibility: ['self', 'hr'] })]),
  ]);
  store.seed(MARCO, { account: MARCO_ACCOUNT });
  store.seed(ADA, { fields: { managerId: MARCO } });
  store.seed(NEW);
  const fresh = store.rows.get(NEW);
  if (fresh) fresh.snapshot = { ...fresh.snapshot, status: 'provisional', hireDate: null };
  const service = {
    access: personAccess(store.deps),
    schemas: store.deps.schemas,
    inTenant: (_tenant, fn) => fn({ tx: {} as never }),
  } satisfies PeopleService;
  const callerFrom = () =>
    ok({
      tenantId: TENANT,
      viewer: { accountId: account, roles: new Set(roles) },
      correlationId: '00000000-0000-4000-8000-0000000000c1',
    });
  configureGraphQL({
    service,
    callerFrom,
    rest: restHandler({ service, callerFrom, idempotency: inMemoryIdempotency() }),
  });
  return store;
}

const yoga = createYoga({ schema, maskedErrors: false });

interface Answer {
  data?: Record<string, { status: string } | null> | null;
  errors?: { message: string; extensions: Record<string, unknown> }[];
}

async function mutate(source: string, variables: Record<string, unknown> = {}): Promise<Answer> {
  const response = await yoga.fetch('http://people.test/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: source, variables }),
  });
  return (await response.json()) as Answer;
}

describe('the lifecycle mutations', () => {
  it('takes somebody on leave, back, onto notice and out, as HR', async () => {
    const store = wire('00000000-0000-4000-8000-0000000000ff', ['hr']);
    const steps = [
      `mutation { startLeave(personId: "${ADA}", idempotencyKey: "${randomUUID()}") { status } }`,
      `mutation { endLeave(personId: "${ADA}", idempotencyKey: "${randomUUID()}") { status } }`,
      `mutation { giveNotice(personId: "${ADA}", idempotencyKey: "${randomUUID()}", lastWorkingDay: "2026-09-21", reason: dismissed) { status } }`,
      `mutation { terminatePerson(personId: "${ADA}", idempotencyKey: "${randomUUID()}", lastWorkingDay: "2026-09-21", reason: dismissed, note: "Gross misconduct", eligibleForRehire: false) { status } }`,
    ];
    const seen: string[] = [];
    for (const step of steps) {
      const answer = await mutate(step);
      expect(answer.errors).toBeUndefined();
      seen.push(Object.values(answer.data ?? {})[0]?.status ?? 'none');
    }
    expect(seen).toEqual(['on_leave', 'active', 'notice', 'terminated']);
    expect(store.events.at(-1)).toMatchObject({
      eventName: 'people.person.terminated',
      payload: { reason: 'Gross misconduct', eligibleForRehire: false },
    });
  });

  it('ends a leaver’s access at once, as HR alone (PEO-109)', async () => {
    const store = wire(MARCO_ACCOUNT);
    const refused = await mutate(`mutation { endPersonAccess(personId: "${ADA}", idempotencyKey: "${randomUUID()}") { status } }`);
    expect(refused.errors?.[0]?.extensions['code']).toBe('FORBIDDEN');

    expect(store.events).toEqual([]);

    const hr = wire('00000000-0000-4000-8000-0000000000ff', ['hr']);
    const dismissed = await mutate(
      `mutation { terminatePerson(personId: "${ADA}", idempotencyKey: "${randomUUID()}", lastWorkingDay: "2026-09-22", reason: dismissed, endAccessNow: true) { status } }`,
    );
    expect(dismissed.errors).toBeUndefined();
    const again = await mutate(`mutation { endPersonAccess(personId: "${ADA}", idempotencyKey: "${randomUUID()}") { status } }`);
    expect(again.data?.['endPersonAccess']).toEqual({ status: 'terminated' });
    expect(hr.events.filter((e) => e.eventName === 'people.person.access_ended')).toHaveLength(1);
  });

  it('rehires a leaver and lists their employments (PEO-110)', async () => {
    const store = wire('00000000-0000-4000-8000-0000000000ff', ['hr']);
    const ada = store.rows.get(ADA);
    if (ada) {
      ada.fields = { ...ada.fields, givenName: 'Ada', familyName: 'Lovelace', workEmail: 'ada@acme.test' };
    }
    await mutate(
      `mutation { terminatePerson(personId: "${ADA}", idempotencyKey: "${randomUUID()}", lastWorkingDay: "2026-09-21", reason: resigned, eligibleForRehire: false) { status } }`,
    );
    const refused = await mutate(
      `mutation { rehirePerson(personId: "${ADA}", idempotencyKey: "${randomUUID()}", startDate: "2026-10-05") { status } }`,
    );
    expect(refused.errors?.[0]?.extensions['code']).toBe('NOT_ELIGIBLE_FOR_REHIRE');
    const back = await mutate(
      `mutation { rehirePerson(personId: "${ADA}", idempotencyKey: "${randomUUID()}", startDate: "2026-10-05", overrideReason: "Role reopened") { status } }`,
    );
    expect(back.data?.['rehirePerson']).toEqual({ status: 'pre_hire' });

    const response = await yoga.fetch('http://people.test/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `{ employmentPeriods(personId: "${ADA}") { period startedOn lastWorkingDay eligibleForRehire rehireOverrideReason } }`,
      }),
    });
    const periods = (await response.json()) as { data: { employmentPeriods: unknown[] } };
    expect(periods.data.employmentPeriods).toEqual([
      {
        period: 1,
        startedOn: '2026-01-01',
        lastWorkingDay: '2026-09-21',
        eligibleForRehire: false,
        rehireOverrideReason: null,
      },
      {
        period: 2,
        startedOn: '2026-10-05',
        lastWorkingDay: null,
        eligibleForRehire: null,
        rehireOverrideReason: 'Role reopened',
      },
    ]);
  });

  it('withdraws notice, as HR (PEO-111)', async () => {
    wire('00000000-0000-4000-8000-0000000000ff', ['hr']);
    await mutate(
      `mutation { giveNotice(personId: "${ADA}", idempotencyKey: "${randomUUID()}", lastWorkingDay: "2026-09-30") { status } }`,
    );
    const back = await mutate(`mutation { withdrawNotice(personId: "${ADA}", idempotencyKey: "${randomUUID()}") { status } }`);
    expect(back.data?.['withdrawNotice']).toEqual({ status: 'active' });
  });

  it('adds one person by hand, as HR alone', async () => {
    const add = `mutation { createPerson(idempotencyKey: "${randomUUID()}", attributes: [{ key: "given_name", text: "Lena" }]) { status } }`;
    const store = wire(MARCO_ACCOUNT);
    const refused = await mutate(add);
    expect(refused.errors?.[0]?.extensions['code']).toBe('FORBIDDEN');
    expect(store.rows.size).toBe(3);

    const hr = wire('00000000-0000-4000-8000-0000000000ff', ['hr']);
    const answer = await mutate(add);
    expect(answer.errors).toBeUndefined();
    expect(answer.data?.['createPerson']).toEqual({ status: 'provisional' });
    expect(hr.rows.size).toBe(4);
  });

  it('discards a provisional record', async () => {
    wire('00000000-0000-4000-8000-0000000000ff', ['hr']);
    const answer = await mutate(`mutation { discardPerson(personId: "${NEW}", idempotencyKey: "${randomUUID()}") { id status } }`);
    expect(answer.data?.['discardPerson']).toEqual({ id: NEW, status: 'discarded' });
  });

  it('refuses a manager with the domain code, and a last day that has not come', async () => {
    const store = wire(MARCO_ACCOUNT);
    const manager = await mutate(
      `mutation { terminatePerson(personId: "${ADA}", idempotencyKey: "${randomUUID()}", lastWorkingDay: "2026-09-21", reason: resigned) { status } }`,
    );
    expect(manager.errors?.[0]?.extensions['code']).toBe('FORBIDDEN');
    expect(store.events).toEqual([]);

    wire('00000000-0000-4000-8000-0000000000ff', ['hr']);
    const early = await mutate(
      `mutation { terminatePerson(personId: "${ADA}", idempotencyKey: "${randomUUID()}", lastWorkingDay: "2026-10-01", reason: resigned) { status } }`,
    );
    expect(early.errors?.[0]?.extensions['code']).toBe('LAST_DAY_NOT_REACHED');
  });

  it('validates arguments with the schema REST parses', async () => {
    wire('00000000-0000-4000-8000-0000000000ff', ['hr']);
    const answer = await mutate(
      `mutation { giveNotice(personId: "${ADA}", idempotencyKey: "${randomUUID()}", lastWorkingDay: "next friday") { status } }`,
    );
    expect(answer.errors?.[0]?.extensions['code']).toBe('BAD_REQUEST');
  });
});
