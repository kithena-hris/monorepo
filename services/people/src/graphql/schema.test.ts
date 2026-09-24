import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createYoga } from 'graphql-yoga';
import { err, failure, fixedClock, ok } from '@kithena/domain-kit';

import { inMemoryOrg } from '../application/org/in-memory.js';
import { orgAdmin } from '../application/org/org.js';
import { define, inMemoryPeople, TENANT, versionOf } from '../application/person/in-memory.js';
import { personAccess } from '../application/person/person-access.js';
import type { PeopleService } from '../application/person/service.js';
import type { CallerFrom } from '../http/caller.js';
import { inMemoryIdempotency } from '../http/idempotency.js';
import { restHandler } from '../http/rest.js';
import { configureGraphQL, schema, valueOf } from './schema.js';

/**
 * The subgraph over the application layer, with an in-memory store.
 *
 * The rule under test is the one GraphQL makes easy to break: a field that is
 * asked for is always answered. So a withheld attribute must not be a field at
 * all — it has to be absent from a list, and this asserts the list.
 */

const ADA = '00000000-0000-4000-8000-0000000000a1';
const MARCO = '00000000-0000-4000-8000-0000000000a2';
const MARCO_ACCOUNT = '00000000-0000-4000-8000-0000000000b2';
const HR_ACCOUNT = '00000000-0000-4000-8000-0000000000b3';

const salary = define({
  key: 'base_salary',
  dataType: 'money',
  typeConfig: { kind: 'money' },
  visibility: ['self', 'hr'],
  classification: {
    classification: 'confidential',
    piiKind: 'none',
    exportable: true,
    aiEligible: false,
  },
});
const title = define({ key: 'job_title', visibility: ['manager', 'hr'] });

function wire(account: string, roles: string[] = []) {
  const store = inMemoryPeople([versionOf(1, [salary, title])]);
  store.seed(MARCO, { account: MARCO_ACCOUNT });
  store.seed(ADA, {
    fields: { managerId: MARCO },
    custom: { base_salary: { amountMinor: 5_500_000, currency: 'EUR' }, job_title: 'Engineer' },
  });
  const service = {
    access: personAccess(store.deps),
    schemas: store.deps.schemas,
    inTenant: (_tenant, fn) => fn({ tx: {} as never }),
  } satisfies PeopleService;
  const callerFrom: CallerFrom = (request) =>
    request.headers['x-test'] === 'anonymous'
      ? err(failure('UNAUTHENTICATED', 'nobody'))
      : ok({
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

const PERSON = `
  query ($id: ID!) {
    person(id: $id) {
      id
      attributes {
        __typename
        ... on TextAttribute { key value }
        ... on MoneyAttribute { key amountMinor currency }
      }
    }
  }`;

/*
 * Through Yoga, as production serves it, rather than `graphql()` imported
 * here: the test's `graphql` and Pothos's can resolve to different builds of
 * the package, and `instanceof` then refuses the schema.
 */
const yoga = createYoga({ schema, maskedErrors: false });

interface Answer {
  data?: Record<string, unknown> | null;
  errors?: { message: string; extensions: Record<string, unknown> }[];
}

async function query(
  source: string,
  variables: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<Answer> {
  const response = await yoga.fetch('http://people.test/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ query: source, variables }),
  });
  return (await response.json()) as Answer;
}

describe('a manager querying a report', () => {
  it('gets a result without the salary attribute — no key, no null', async () => {
    wire(MARCO_ACCOUNT);
    const result = await query(PERSON, { id: ADA });
    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({
      person: {
        id: ADA,
        attributes: [{ __typename: 'TextAttribute', key: 'job_title', value: 'Engineer' }],
      },
    });
    expect(JSON.stringify(result.data)).not.toContain('base_salary');
  });

  it('while HR gets the salary, typed as money from the published version', async () => {
    wire(HR_ACCOUNT, ['hr']);
    const result = await query(PERSON, { id: ADA });
    expect(result.data?.['person']).toMatchObject({
      attributes: expect.arrayContaining([
        {
          __typename: 'MoneyAttribute',
          key: 'base_salary',
          amountMinor: '5500000',
          currency: 'EUR',
        },
      ]) as unknown,
    });
  });
});

describe('failures', () => {
  it('maps a refused write to a GraphQL error with the domain code', async () => {
    wire(MARCO_ACCOUNT);
    const result = await query(
      `mutation ($id: ID!) {
         updatePerson(id: $id, changes: [{ key: "base_salary", money: { amountMinor: "1", currency: "EUR" } }], idempotencyKey: "k-1") { id }
       }`,
      { id: ADA },
    );
    expect(result.errors?.[0]?.extensions['code']).toBe('FIELD_NOT_WRITABLE');
  });

  it('refuses a caller the principal source refuses', async () => {
    wire(MARCO_ACCOUNT);
    const result = await query(PERSON, { id: ADA }, { 'x-test': 'anonymous' });
    expect(result.errors?.[0]?.extensions['code']).toBe('UNAUTHENTICATED');
  });
});

describe('every mutation (PEO-113)', () => {
  it('takes a required idempotencyKey, but the three that only compute or read', () => {
    const unkeyed = Object.values(schema.getMutationType()?.getFields() ?? {})
      .filter((field) => {
        const key = field.args.find((a) => a.name === 'idempotencyKey');
        return key?.type.toString() !== 'String!';
      })
      .map((field) => field.name);
    // revealIdentifier is an audited read (PEO-125): it changes nothing a retry could repeat.
    expect(unkeyed.toSorted()).toEqual(['dryRunImport', 'proposeImport', 'revealIdentifier']);
  });

  it('never models a record as a field per attribute: its values are a keyed list', () => {
    const profile = schema.getType('PeopleProfile');
    const fields = profile !== undefined && 'getFields' in profile ? profile.getFields() : {};
    // `calendar`, `employment` and `placement` are HR's (PEO-119, PEO-120, PEO-123), and
    // `reviews` the doubted identifiers still open (PEO-125): none is an attribute.
    expect(Object.keys(fields).toSorted()).toEqual([
      'calendar',
      'employment',
      'person',
      'placement',
      'reviews',
      'sections',
      'values',
    ]);
    expect(String(fields['values']?.type)).toMatch(/^\[FormEntry!\]/);
  });
});

describe('an attribute value input', () => {
  it('takes exactly one slot', () => {
    expect(valueOf({ text: 'a', number: 1 }).ok).toBe(false);
    expect(valueOf({}).ok).toBe(false);
    expect(valueOf({ clear: true })).toEqual(ok(null));
  });

  it('keeps money as whole minor units', () => {
    expect(valueOf({ money: { amountMinor: '5500000', currency: 'EUR' } })).toEqual(
      ok({ amountMinor: 5_500_000, currency: 'EUR' }),
    );
    expect(valueOf({ money: { amountMinor: '55.5', currency: 'EUR' } }).ok).toBe(false);
  });
});

describe('legal entities over GraphQL', () => {
  function wireOrg(roles: string[]) {
    const store = inMemoryPeople([versionOf(1, [title])]);
    let n = 0;
    const service = {
      access: personAccess(store.deps),
      schemas: store.deps.schemas,
      inTenant: (_tenant, fn) => fn({ tx: {} as never }),
      org: orgAdmin({
        store: inMemoryOrg().store,
        clock: fixedClock('2026-03-10T12:00:00.000Z'),
        newId: () => `01900000-0000-7000-8000-${String((n += 1)).padStart(12, '0')}`,
      }),
    } satisfies PeopleService;
    const callerFrom = () =>
      ok({
        tenantId: TENANT,
        viewer: { accountId: HR_ACCOUNT, roles: new Set(roles) },
        correlationId: '00000000-0000-4000-8000-0000000000c1',
      });
    configureGraphQL({
      service,
      callerFrom,
      rest: restHandler({ service, callerFrom, idempotency: inMemoryIdempotency() }),
    });
  }

  const CREATE = `
    mutation ($name: String!, $country: String!, $timeZone: String!) {
      createLegalEntity(name: $name, country: $country, timeZone: $timeZone, idempotencyKey: "${randomUUID()}") { name country timeZone }
    }`;
  const madrid = { name: 'Acme SL', country: 'ES', timeZone: 'Europe/Madrid' };

  it('creates one for a People administrator and lists it', async () => {
    wireOrg(['people_admin']);
    expect((await query(CREATE, madrid)).data).toEqual({ createLegalEntity: madrid });
    const listed = await query('{ legalEntities { name archived } peopleSettings { cohortMinimum } }', {});
    expect(listed.data).toEqual({
      legalEntities: [{ name: 'Acme SL', archived: false }],
      peopleSettings: { cohortMinimum: 10 },
    });
  });

  it('refuses anybody else with the same code REST gives', async () => {
    wireOrg(['hr']);
    const refused = await query(CREATE, madrid);
    expect(refused.errors?.[0]?.extensions).toMatchObject({ code: 'FORBIDDEN' });
  });
});
