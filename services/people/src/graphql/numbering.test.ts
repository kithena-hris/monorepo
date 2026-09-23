import { describe, expect, it } from 'vitest';
import { createYoga } from 'graphql-yoga';
import { fixedClock, ok } from '@kithena/domain-kit';

import { inMemoryNumbers, inMemoryOrg } from '../application/org/in-memory.js';
import { orgAdmin } from '../application/org/org.js';
import { inMemoryPeople, TENANT, versionOf } from '../application/person/in-memory.js';
import { personAccess } from '../application/person/person-access.js';
import { configureGraphQL, schema } from './schema.js';

/** PEO-101's numbering scheme over GraphQL (PEO-108), beside REST's `/numbering`. */

let roles = ['people_admin'];
function wire() {
  const store = inMemoryPeople([versionOf(1, [])]);
  let n = 0;
  configureGraphQL({
    service: {
      access: personAccess(store.deps),
      schemas: store.deps.schemas,
      inTenant: (_tenant, fn) => fn({ tx: {} as never }),
      org: orgAdmin({
        store: inMemoryOrg().store,
        numbers: inMemoryNumbers(),
        clock: fixedClock('2026-09-22T09:00:00.000Z'),
        newId: () => `01900000-0000-7000-8000-${String((n += 1)).padStart(12, '0')}`,
      }),
    },
    callerFrom: () =>
      ok({
        tenantId: TENANT,
        viewer: { accountId: '00000000-0000-4000-8000-0000000000b3', roles: new Set(roles) },
        correlationId: '00000000-0000-4000-8000-0000000000c1',
      }),
  });
}

const yoga = createYoga({ schema, maskedErrors: false });

interface Answer {
  data?: Record<string, Record<string, unknown> | null> | null;
  errors?: { message: string; extensions: Record<string, unknown> }[];
}

async function send(source: string, variables: Record<string, unknown> = {}): Promise<Answer> {
  const response = await yoga.fetch('http://people.test/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: source, variables }),
  });
  return (await response.json()) as Answer;
}

const READ = `query ($id: ID!) { employeeNumbering(legalEntityId: $id) { legalEntityId prefix digits nextValue } }`;
const SET = `mutation ($id: ID!, $start: Float!) {
  setEmployeeNumbering(legalEntityId: $id, prefix: "ES-", digits: 12, start: $start) { prefix digits nextValue }
}`;

describe('employee numbering over GraphQL', () => {
  it('is null until set, then serves the scheme, a twelve-digit start included', async () => {
    roles = ['people_admin'];
    wire();
    const made = await send(
      `mutation { createLegalEntity(name: "Acme Spain", country: "ES", timeZone: "Europe/Madrid") { id } }`,
    );
    const id = made.data?.['createLegalEntity']?.['id'];

    expect((await send(READ, { id })).data).toEqual({ employeeNumbering: null });

    const set = await send(SET, { id, start: 100_000_000_000 });
    expect(set.errors).toBeUndefined();
    expect(set.data?.['setEmployeeNumbering']).toEqual({
      prefix: 'ES-',
      digits: 12,
      nextValue: 100_000_000_000,
    });
    expect((await send(READ, { id })).data?.['employeeNumbering']).toMatchObject({
      legalEntityId: id,
      nextValue: 100_000_000_000,
    });
  });

  it('refuses HR, and a start that is not a whole number', async () => {
    roles = ['people_admin'];
    wire();
    const made = await send(
      `mutation { createLegalEntity(name: "Acme Spain", country: "ES", timeZone: "Europe/Madrid") { id } }`,
    );
    const id = made.data?.['createLegalEntity']?.['id'];
    expect((await send(SET, { id, start: 1.5 })).errors?.[0]?.extensions['code']).toBe(
      'NUMBERING_INVALID',
    );
    roles = ['hr'];
    expect((await send(SET, { id, start: 1 })).errors?.[0]?.extensions['code']).toBe('FORBIDDEN');
  });
});
