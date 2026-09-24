import { describe, expect, it } from 'vitest';
import { createYoga } from 'graphql-yoga';
import { ok } from '@kithena/domain-kit';

import { define, inMemoryPeople, TENANT, versionOf } from '../application/person/in-memory.js';
import { personAccess } from '../application/person/person-access.js';
import type { PeopleService } from '../application/person/service.js';
import { configureGraphQL, schema } from '../graphql/schema.js';
import type { CallerFrom } from './caller.js';
import { inMemoryIdempotency } from './idempotency.js';
import { restHandler } from './rest.js';

/**
 * One authorization scenario, two transports, one answer.
 *
 * Both call the same application layer, so this should be true by
 * construction. The test is what keeps it true the day somebody adds a
 * convenience field to one transport and not the other.
 */

const ADA = '00000000-0000-4000-8000-0000000000a1';
const MARCO = '00000000-0000-4000-8000-0000000000a2';
const ADA_ACCOUNT = '00000000-0000-4000-8000-0000000000b1';
const MARCO_ACCOUNT = '00000000-0000-4000-8000-0000000000b2';
const HR_ACCOUNT = '00000000-0000-4000-8000-0000000000b3';

const definitions = [
  define({
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
  }),
  define({ key: 'job_title', visibility: ['self', 'manager', 'hr'] }),
  define({
    key: 'work_email',
    dataType: 'email',
    typeConfig: { kind: 'email' },
    visibility: ['directory'],
  }),
  define({
    key: 'ethnicity',
    visibility: [],
    ownership: ['employee'],
    classification: {
      classification: 'special-category',
      piiKind: 'health',
      exportable: true,
      aiEligible: false,
    },
  }),
];

function transports(account: string, roles: string[]) {
  const store = inMemoryPeople([versionOf(1, definitions)]);
  store.seed(MARCO, { account: MARCO_ACCOUNT });
  store.seed(ADA, {
    account: ADA_ACCOUNT,
    fields: { managerId: MARCO, workEmail: 'ada@example.com' },
    custom: {
      base_salary: { amountMinor: 5_500_000, currency: 'EUR' },
      job_title: 'Engineer',
      ethnicity: 'declined',
    },
  });

  const service: PeopleService = {
    access: personAccess(store.deps),
    schemas: store.deps.schemas,
    inTenant: (_tenant, fn) => fn({ tx: {} as never }),
  };
  const callerFrom: CallerFrom = () =>
    ok({
      tenantId: TENANT,
      viewer: { accountId: account, roles: new Set(roles) },
      correlationId: '00000000-0000-4000-8000-0000000000c1',
    });

  const rest = restHandler({ service, callerFrom, idempotency: inMemoryIdempotency() });
  configureGraphQL({ service, callerFrom, rest });
  const yoga = createYoga({ schema });

  return {
    viaGraphQL: async (): Promise<string[]> => {
      const response = await yoga.fetch('http://people.test/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: `query ($id: ID!) { person(id: $id) { attributes {
            ... on TextAttribute { key } ... on MoneyAttribute { key }
          } } }`,
          variables: { id: ADA },
        }),
      });
      const body = (await response.json()) as {
        data: { person: { attributes: { key: string }[] } };
      };
      return body.data.person.attributes.map((a) => a.key).toSorted();
    },
    viaRest: async (): Promise<string[]> => {
      const answer = await rest({ method: 'GET', url: `/v1/people/${ADA}`, headers: {}, body: '' });
      const body = answer?.body as { attributes: Record<string, unknown> };
      return Object.keys(body.attributes).toSorted();
    },
  };
}

describe.each([
  { who: 'her manager', account: MARCO_ACCOUNT, roles: [], sees: ['job_title', 'work_email'] },
  {
    who: 'herself',
    account: ADA_ACCOUNT,
    roles: [],
    sees: ['base_salary', 'job_title', 'work_email'],
  },
  {
    who: 'HR',
    account: HR_ACCOUNT,
    roles: ['hr'],
    sees: ['base_salary', 'job_title', 'work_email'],
  },
])('$who reading Ada', ({ account, roles, sees }) => {
  it('sees the same fields through GraphQL and REST', async () => {
    const { viaGraphQL, viaRest } = transports(account, roles);
    const [graph, rest] = [await viaGraphQL(), await viaRest()];
    expect(graph).toEqual(sees);
    expect(rest).toEqual(sees);
  });

  it('sees no special-category field through either, not even as a key', async () => {
    const { viaGraphQL, viaRest } = transports(account, roles);
    expect(await viaGraphQL()).not.toContain('ethnicity');
    expect(await viaRest()).not.toContain('ethnicity');
  });
});
