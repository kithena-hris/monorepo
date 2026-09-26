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
const PEER = '00000000-0000-4000-8000-0000000000a3';
const PEER_ACCOUNT = '00000000-0000-4000-8000-0000000000b4';
const GONE = '00000000-0000-4000-8000-0000000000a4';

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
    status: 'on_leave',
  });
  store.seed(PEER, { account: PEER_ACCOUNT });
  store.seed(GONE, { fields: { managerId: MARCO }, status: 'terminated' });

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
    statusViaGraphQL: async () => {
      const response = await yoga.fetch('http://people.test/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: `query ($id: ID!) { person(id: $id) { status } people { nodes { id status } } }`,
          variables: { id: ADA },
        }),
      });
      const body = (await response.json()) as {
        data: {
          person: { status: string | null };
          people: { nodes: { id: string; status: string | null }[] };
        };
      };
      return {
        one: body.data.person.status,
        listed: Object.fromEntries(body.data.people.nodes.map((n) => [n.id, n.status])),
      };
    },
    statusViaRest: async () => {
      const get = async (url: string) =>
        (await rest({ method: 'GET', url, headers: {}, body: '' }))?.body;
      const one = (await get(`/v1/people/${ADA}`)) as { status?: string };
      const page = (await get('/v1/people')) as { items: { id: string; status?: string }[] };
      return {
        one: one.status ?? null,
        listed: Object.fromEntries(page.items.map((i) => [i.id, i.status ?? null])),
      };
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

/**
 * Employment status is HR's, and the person's own (§6.3, §7): "on leave" told
 * to a manager or a peer is the disclosure a visibility rule is refused for.
 * Withheld means absent over REST and null over GraphQL, on the record and on
 * every row of a list; and a leaver is not listed to anybody but HR at all.
 */
describe.each([
  { who: 'HR', account: HR_ACCOUNT, roles: ['hr'], sees: 'on_leave', leavers: true },
  { who: 'Ada herself', account: ADA_ACCOUNT, roles: [], sees: 'on_leave', leavers: false },
  { who: 'her manager', account: MARCO_ACCOUNT, roles: [], sees: null, leavers: false },
  { who: 'a peer', account: PEER_ACCOUNT, roles: [], sees: null, leavers: false },
  { who: 'finance', account: PEER_ACCOUNT, roles: ['finance'], sees: null, leavers: false },
])('$who asking Ada’s status', ({ account, roles, sees, leavers }) => {
  it('gets the same answer through GraphQL and REST', async () => {
    const { statusViaGraphQL, statusViaRest } = transports(account, roles);
    for (const answer of [await statusViaGraphQL(), await statusViaRest()]) {
      expect(answer.one).toBe(sees);
      expect(answer.listed[ADA]).toBe(sees);
      expect(Object.hasOwn(answer.listed, GONE)).toBe(leavers);
      if (leavers) expect(answer.listed[GONE]).toBe('terminated');
      // Nobody else's status reaches a viewer who is not HR.
      if (!leavers) expect(answer.listed[MARCO]).toBe(account === MARCO_ACCOUNT ? 'active' : null);
    }
  });
});
