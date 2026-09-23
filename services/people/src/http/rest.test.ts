import { describe, expect, it } from 'vitest';
import { ok } from '@kithena/domain-kit';

import { define, inMemoryPeople, TENANT, versionOf } from '../application/person/in-memory.js';
import { personAccess } from '../application/person/person-access.js';
import { inMemoryIdempotency } from './idempotency.js';
import { openApiDocument } from './openapi.js';
import { restHandler, type RestRequest } from './rest.js';

const ADA = '00000000-0000-4000-8000-0000000000a1';
const BEA = '00000000-0000-4000-8000-0000000000a4';
const HR = '00000000-0000-4000-8000-0000000000b3';

const title = define({ key: 'job_title', visibility: ['hr'], effectiveDated: true });

function setup() {
  const store = inMemoryPeople([versionOf(1, [title])]);
  store.seed(ADA);
  store.seed(BEA);
  const rest = restHandler({
    service: {
      access: personAccess(store.deps),
      schemas: store.deps.schemas,
      inTenant: (_tenant, fn) => fn({ tx: {} as never }),
    },
    callerFrom: (request) =>
      ok({
        tenantId: TENANT,
        viewer: { accountId: String(request.headers['x-as'] ?? HR), roles: new Set(['hr']) },
        correlationId: '00000000-0000-4000-8000-0000000000c1',
      }),
    idempotency: inMemoryIdempotency(),
  });
  const call = async (over: Partial<RestRequest>) => {
    const answer = await rest({ method: 'GET', url: '/v1/people', headers: {}, body: '', ...over });
    if (!answer) throw new Error('not a REST route');
    return answer;
  };
  return { store, call };
}

const patch = (key: string, body: unknown, headers: Record<string, string> = {}) => ({
  method: 'PATCH',
  url: `/v1/people/${ADA}`,
  headers: { 'idempotency-key': key, ...headers },
  body: JSON.stringify(body),
});

describe('idempotency', () => {
  it('refuses a write without a key', async () => {
    const { call } = setup();
    const answer = await call({ ...patch('', { attributes: { job_title: 'x' } }), headers: {} });
    expect(answer.status).toBe(422);
    expect(answer.body).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED' } });
  });

  it('answers a retry without repeating the write', async () => {
    const { call, store } = setup();
    const first = await call(patch('k1', { attributes: { job_title: 'Engineer' } }));
    const again = await call(patch('k1', { attributes: { job_title: 'Engineer' } }));
    expect(first.status).toBe(200);
    expect(again).toEqual(first);
    expect(store.history).toHaveLength(1);
    expect(store.events).toHaveLength(1);
  });

  it('refuses the same key with a different body, or from somebody else', async () => {
    const { call } = setup();
    await call(patch('k1', { attributes: { job_title: 'Engineer' } }));
    const changed = await call(patch('k1', { attributes: { job_title: 'Manager' } }));
    expect(changed.body).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } });
    const other = await call(
      patch('k1', { attributes: { job_title: 'Engineer' } }, { 'x-as': BEA }),
    );
    expect(other.body).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } });
  });

  it('does not keep the key of a refused write, so a corrected retry goes through', async () => {
    const { call } = setup();
    const bad = await call(patch('k2', { attributes: { job_title: 'x' }, effectiveFrom: 'soon' }));
    expect(bad.status).toBe(422);
    const good = await call(patch('k3', { attributes: { job_title: 'x' } }));
    expect(good.status).toBe(200);
  });
});

describe('reading', () => {
  it('pages with an opaque cursor', async () => {
    const { call } = setup();
    const first = await call({ url: '/v1/people?limit=1' });
    const body = first.body as { items: { id: string }[]; nextCursor: string };
    expect(body.items.map((p) => p.id)).toEqual([ADA]);
    expect(body.nextCursor).not.toContain(ADA);

    const second = await call({ url: `/v1/people?limit=1&cursor=${body.nextCursor}` });
    expect((second.body as { items: { id: string }[] }).items.map((p) => p.id)).toEqual([BEA]);
  });

  it('refuses a malformed asOf rather than guessing', async () => {
    const { call } = setup();
    const answer = await call({ url: `/v1/people/${ADA}?asOf=March` });
    expect(answer.status).toBe(422);
  });

  it('maps not found, wrong method and unknown routes', async () => {
    const { call } = setup();
    expect((await call({ url: '/v1/people/00000000-0000-4000-8000-00000000dead' })).status).toBe(
      404,
    );
    expect((await call({ method: 'DELETE', url: `/v1/people/${ADA}` })).status).toBe(405);
    expect((await call({ url: '/v1/nothing' })).status).toBe(404);
  });
});

describe('the OpenAPI document', () => {
  it('is generated from the schemas the handler parses with', () => {
    const doc = openApiDocument() as {
      components: { schemas: Record<string, Record<string, unknown>> };
      paths: Record<string, unknown>;
    };
    const patchSchema = doc.components.schemas['PatchPerson'];
    // A strict object refuses unknown keys, and the document says so.
    expect(patchSchema).toMatchObject({
      additionalProperties: false,
      properties: { effectiveFrom: { format: 'date' } },
    });
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(['/v1/people', '/v1/people/{id}', '/v1/people/{id}/corrections']),
    );
  });
});
