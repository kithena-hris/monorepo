import { describe, expect, it } from 'vitest';
import { createYoga } from 'graphql-yoga';
import { ok } from '@kithena/domain-kit';

import { inMemoryPeople, TENANT, versionOf } from '../application/person/in-memory.js';
import { personAccess } from '../application/person/person-access.js';
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
  const store = inMemoryPeople([versionOf(1, [])]);
  store.seed(MARCO, { account: MARCO_ACCOUNT });
  store.seed(ADA, { fields: { managerId: MARCO } });
  store.seed(NEW);
  const fresh = store.rows.get(NEW);
  if (fresh) fresh.snapshot = { ...fresh.snapshot, status: 'provisional', hireDate: null };
  configureGraphQL({
    service: {
      access: personAccess(store.deps),
      schemas: store.deps.schemas,
      inTenant: (_tenant, fn) => fn({ tx: {} as never }),
    },
    callerFrom: () =>
      ok({
        tenantId: TENANT,
        viewer: { accountId: account, roles: new Set(roles) },
        correlationId: '00000000-0000-4000-8000-0000000000c1',
      }),
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
      `mutation { startLeave(personId: "${ADA}") { status } }`,
      `mutation { endLeave(personId: "${ADA}") { status } }`,
      `mutation { giveNotice(personId: "${ADA}", lastWorkingDay: "2026-09-21", reason: dismissed) { status } }`,
      `mutation { terminatePerson(personId: "${ADA}", lastWorkingDay: "2026-09-21", reason: dismissed, note: "Gross misconduct", eligibleForRehire: false) { status } }`,
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
    const refused = await mutate(`mutation { endPersonAccess(personId: "${ADA}") { status } }`);
    expect(refused.errors?.[0]?.extensions['code']).toBe('FORBIDDEN');

    expect(store.events).toEqual([]);

    const hr = wire('00000000-0000-4000-8000-0000000000ff', ['hr']);
    const dismissed = await mutate(
      `mutation { terminatePerson(personId: "${ADA}", lastWorkingDay: "2026-09-22", reason: dismissed, endAccessNow: true) { status } }`,
    );
    expect(dismissed.errors).toBeUndefined();
    const again = await mutate(`mutation { endPersonAccess(personId: "${ADA}") { status } }`);
    expect(again.data?.['endPersonAccess']).toEqual({ status: 'terminated' });
    expect(hr.events.filter((e) => e.eventName === 'people.person.access_ended')).toHaveLength(1);
  });

  it('discards a provisional record', async () => {
    wire('00000000-0000-4000-8000-0000000000ff', ['hr']);
    const answer = await mutate(`mutation { discardPerson(personId: "${NEW}") { id status } }`);
    expect(answer.data?.['discardPerson']).toEqual({ id: NEW, status: 'discarded' });
  });

  it('refuses a manager with the domain code, and a last day that has not come', async () => {
    const store = wire(MARCO_ACCOUNT);
    const manager = await mutate(
      `mutation { terminatePerson(personId: "${ADA}", lastWorkingDay: "2026-09-21", reason: resigned) { status } }`,
    );
    expect(manager.errors?.[0]?.extensions['code']).toBe('FORBIDDEN');
    expect(store.events).toEqual([]);

    wire('00000000-0000-4000-8000-0000000000ff', ['hr']);
    const early = await mutate(
      `mutation { terminatePerson(personId: "${ADA}", lastWorkingDay: "2026-10-01", reason: resigned) { status } }`,
    );
    expect(early.errors?.[0]?.extensions['code']).toBe('LAST_DAY_NOT_REACHED');
  });

  it('validates arguments with the schema REST parses', async () => {
    wire('00000000-0000-4000-8000-0000000000ff', ['hr']);
    const answer = await mutate(
      `mutation { giveNotice(personId: "${ADA}", lastWorkingDay: "next friday") { status } }`,
    );
    expect(answer.errors?.[0]?.extensions['code']).toBe('BAD_INPUT');
  });
});
