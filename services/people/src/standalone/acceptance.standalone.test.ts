import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createYoga } from 'graphql-yoga';
import { ok } from '@kithena/domain-kit';

import { define, inMemoryPeople, TENANT, versionOf } from '../application/person/in-memory.js';
import { personAccess } from '../application/person/person-access.js';
import { proposeMapping } from '../application/import/mapping.js';
import { parseUpload } from '../application/import/parse.js';
import { configureGraphQL, schema } from '../graphql/schema.js';
import { inMemoryIdempotency } from '../http/idempotency.js';
import { restHandler, type RestRequest } from '../http/rest.js';
import { typesafeAttributeAdvisorFromEnv } from '../infrastructure/typesafe-attribute-advisor.js';

/**
 * PEO-060: the module's acceptance suite, with no sibling, no Postgres, no
 * Kafka and no network — the in-memory ports behind the real REST handler and
 * the real subgraph. The registry answers, a person is created, a required
 * field that is missing is reported, a malformed value is refused, the write
 * lands in the outbox, and both transports read it back.
 *
 * `TYPESAFE_API_KEY` decides one thing: whether the column-mapping advisor
 * exists. CI runs this file twice, once with the variable unset and once set
 * to a dummy, and in neither run may the real API be called — `fetch` is
 * replaced for the whole file, and only the mocked TypeSafe endpoint answers.
 */

const HR = '00000000-0000-4000-8000-0000000000b3';
const ADA = '00000000-0000-4000-8000-0000000000a1';
const TYPESAFE = 'https://api.typesafe.ai/v1/systemone';

const jobTitle = define({ key: 'job_title', requiredness: { mode: 'always' } });
const costCentre = define({ key: 'cost_centre' });

function boot() {
  const store = inMemoryPeople([versionOf(1, [jobTitle, costCentre])]);
  const service = {
    access: personAccess(store.deps),
    schemas: store.deps.schemas,
    inTenant: <T>(_tenant: string, fn: (s: { tx: never }) => Promise<T>) =>
      fn({ tx: {} as never }),
  };
  const callerFrom = () =>
    ok({
      tenantId: TENANT,
      viewer: { accountId: HR, roles: new Set(['hr']) },
      correlationId: '00000000-0000-4000-8000-0000000000c1',
    });
  const rest = restHandler({ service, callerFrom, idempotency: inMemoryIdempotency() });
  configureGraphQL({ service, callerFrom, rest });
  const yoga = createYoga({ schema });

  const call = async (over: Partial<RestRequest>) => {
    const answer = await rest({ method: 'GET', url: '/v1/schema', headers: {}, body: '', ...over });
    if (!answer) throw new Error(`${over.url ?? ''} is not a REST route`);
    return answer;
  };
  const create = (attributes: Record<string, unknown>, key: string) =>
    call({
      method: 'POST',
      url: '/v1/people',
      headers: { 'idempotency-key': key },
      body: JSON.stringify({ attributes }),
    });
  const graphql = async (query: string, variables: Record<string, unknown> = {}) => {
    const response = await yoga.fetch('http://people.standalone/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    return (await response.json()) as { data?: unknown; errors?: unknown };
  };
  return { store, call, create, graphql };
}

/** Whatever `fetch` is asked for, recorded; only the mocked TypeSafe endpoint answers. */
const asked: string[] = [];
beforeEach(() => {
  asked.length = 0;
  vi.stubGlobal('fetch', (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    asked.push(url);
    if (url !== TYPESAFE) {
      return Promise.reject(new Error(`the standalone suite reached for the network: ${url}`));
    }
    return Promise.resolve(
      Response.json({
        answers: { column_0: { type: 'choice', choice: 'job_title', confidence: 0.97 } },
      }),
    );
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the registry', () => {
  it('answers the published schema over REST', async () => {
    const { call } = boot();
    const answer = await call({ url: '/v1/schema' });
    expect(answer.status).toBe(200);
    const body = answer.body as { version: number; attributes: { key: string }[] };
    expect(body.version).toBe(1);
    expect(body.attributes.map((a) => a.key)).toEqual(['job_title', 'cost_centre']);
  });
});

describe('a person', () => {
  it('is created over REST, with the event in the outbox', async () => {
    const { call, create, store } = boot();
    const made = await create({ job_title: 'Engineer' }, 'k1');
    expect(made.status).toBe(201);
    const id = (made.body as { id: string }).id;
    // A record HR creates starts provisional; what it carries is a profile change.
    expect(store.events.map((e) => e.eventName)).toEqual(['people.person.profile_updated']);
    expect(store.events.every((e) => e.tenantId === TENANT)).toBe(true);

    const read = await call({ url: `/v1/people/${id}` });
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ attributes: { job_title: 'Engineer' } });
  });

  it('missing a required field is incomplete, naming it, until it is filled', async () => {
    const { call, store } = boot();
    // Completeness is judged on an active person; a provisional one is not yet due.
    store.seed(ADA, { custom: { cost_centre: 'CC-1' } });
    const before = await call({ url: `/v1/people/${ADA}/completeness` });
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ state: 'incomplete', missing: [{ key: 'job_title' }] });

    const filled = await call({
      method: 'PATCH',
      url: `/v1/people/${ADA}`,
      headers: { 'idempotency-key': 'k2' },
      body: JSON.stringify({ attributes: { job_title: 'Engineer' } }),
    });
    expect(filled.status).toBe(200);
    const after = await call({ url: `/v1/people/${ADA}/completeness` });
    expect(after.body).toMatchObject({ state: 'complete', missing: [] });
  });

  it('with a value of the wrong shape is refused, and nothing reaches the outbox', async () => {
    const { create, store } = boot();
    const refused = await create({ job_title: 42 }, 'k3');
    expect(refused.status).toBe(422);
    // In memory there is no rollback to undo the provisional row; the outbox,
    // which in Postgres shares that transaction, is what must stay empty.
    expect(store.events).toHaveLength(0);
  });

  it('is read back over GraphQL', async () => {
    const { create, graphql } = boot();
    const made = await create({ job_title: 'Engineer' }, 'k4');
    const id = (made.body as { id: string }).id;
    const answer = await graphql(
      `query ($id: ID!) { person(id: $id) { id attributes { ... on TextAttribute { key } } } }`,
      { id },
    );
    expect(answer.errors).toBeUndefined();
    expect(answer.data).toMatchObject({ person: { id } });
    expect(JSON.stringify(answer.data)).toContain('job_title');
  });
});

describe('column mapping, with and without TYPESAFE_API_KEY', () => {
  const HR_RELATIONS = {
    isSelf: false,
    isManager: false,
    isInManagerChain: false,
    isHr: true,
    isFinance: false,
    isAdmin: false,
  };

  it('maps what it can, and asks TypeSafe only when a key is configured', async () => {
    const advisor = typesafeAttributeAdvisorFromEnv(process.env);
    const keyed = (process.env['TYPESAFE_API_KEY'] ?? '').trim() !== '';
    expect(advisor !== null).toBe(keyed);

    const file = await parseUpload(new TextEncoder().encode('Role name,cost_centre\nEngineer,CC-1\n'));
    if (!file.ok) throw new Error(file.error.message);
    const version = versionOf(1, [jobTitle, costCentre]);
    const mapping = await proposeMapping({ file: file.value, version, relations: HR_RELATIONS, advisor });

    // The exact key maps either way; the unfamiliar header only through the advisor.
    expect(mapping[1]).toMatchObject({ status: 'mapped', key: 'cost_centre' });
    if (keyed) {
      expect(mapping[0]).toMatchObject({ status: 'mapped', key: 'job_title' });
      expect(asked).toEqual([TYPESAFE]);
    } else {
      expect(mapping[0]?.status).not.toBe('mapped');
      expect(asked).toEqual([]);
    }
  });
});
