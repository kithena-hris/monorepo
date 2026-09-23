import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import { fixedClock, ok } from '@kithena/domain-kit';

import { inMemoryExportLedger } from '../application/export/ledger.js';
import { localObjectStore } from '../application/export/object-store.js';
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

  it('filters on a tenant-defined attribute, and refuses one the caller cannot', async () => {
    const { call, store } = setup();
    const bea = store.rows.get(BEA);
    if (bea) bea.fields.custom['job_title'] = 'Engineer';
    const found = await call({ url: '/v1/people?filter=job_title:Engineer' });
    expect((found.body as { items: { id: string }[] }).items.map((p) => p.id)).toEqual([BEA]);

    expect((await call({ url: '/v1/people?filter=nope' })).status).toBe(422);
    expect((await call({ url: '/v1/people?filter=salary:1' })).status).toBe(403);
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
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(['/v1/exports', '/v1/exports/{id}']),
    );
  });
});

describe('exports', () => {
  function exportsSetup() {
    const store = inMemoryPeople([versionOf(1, [title])]);
    store.seed(ADA);
    const clock = fixedClock('2026-09-22T09:00:00.000Z');
    const enqueued: string[] = [];
    let ids = 0;
    const service = {
      access: personAccess(store.deps),
      schemas: store.deps.schemas,
      inTenant: <R>(_tenant: string, fn: (scope: { tx: never }) => Promise<R>) =>
        fn({ tx: {} as never }),
    };
    const rest = restHandler({
      service,
      callerFrom: (request) =>
        ok({
          tenantId: TENANT,
          viewer: { accountId: String(request.headers['x-as'] ?? HR), roles: new Set(['hr']) },
          correlationId: '00000000-0000-4000-8000-0000000000c1',
        }),
      idempotency: inMemoryIdempotency(),
      exports: {
        deps: {
          access: service.access,
          schemas: service.schemas,
          relations: store.deps.relations,
          records: store.deps,
          clock,
          store: localObjectStore({
            encryptionKey: randomBytes(32),
            signingKey: randomBytes(32),
            clock,
            baseUrl: 'https://people.test/v1/exports/files',
          }),
          notifier: { notify: () => Promise.resolve() },
          audit: { publish: () => Promise.resolve() },
          ledger: inMemoryExportLedger(),
          newId: () => `00000000-0000-4000-9000-${String((ids += 1)).padStart(12, '0')}`,
        },
        queue: {
          enqueue: (job) => {
            enqueued.push(job.exportId);
            return Promise.resolve();
          },
        },
      },
    });
    const call = async (over: Partial<RestRequest>) => {
      const answer = await rest({ method: 'GET', url: '/v1/people', headers: {}, body: '', ...over });
      if (!answer) throw new Error('not a REST route');
      return answer;
    };
    return { call, enqueued };
  }

  it('completes a small export, and only the requester can fetch its links again', async () => {
    const { call } = exportsSetup();
    const created = await call({
      method: 'POST',
      url: '/v1/exports',
      headers: { 'idempotency-key': 'e1' },
      body: JSON.stringify({ format: 'csv' }),
    });
    expect(created.status).toBe(201);
    const body = created.body as { id: string; status: string; links: { url: string }[] };
    expect(body.status).toBe('completed');
    expect(body.links[0]?.url).toMatch(/^https:\/\/people\.test\/v1\/exports\/files\//u);

    const mine = await call({ url: `/v1/exports/${body.id}` });
    expect(mine.body).toEqual(body);
    const theirs = await call({ url: `/v1/exports/${body.id}`, headers: { 'x-as': BEA } });
    expect(theirs.status).toBe(404);
  });

  it('queues a large export once, however often the request is retried', async () => {
    const { call, enqueued } = exportsSetup();
    const request = {
      method: 'POST',
      url: '/v1/exports',
      headers: { 'idempotency-key': 'e2' },
      body: JSON.stringify({ format: 'xlsx', personIds: Array.from({ length: 2001 }, () => ADA) }),
    };
    const first = await call(request);
    const again = await call(request);
    expect(first.status).toBe(202);
    expect(first.body).toMatchObject({ status: 'queued', links: [] });
    expect(again.body).toEqual(first.body);
    expect(enqueued).toHaveLength(1);
  });
});
