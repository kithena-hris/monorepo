import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import { fixedClock, ok } from '@kithena/domain-kit';

import { asking as exportAsking, FINANCE, financeTenant } from '../application/export/fixture.js';
import { inMemoryFullValuesStore } from '../application/export/full-values-store.js';
import { inMemoryExportLedger } from '../application/export/ledger.js';
import { localObjectStore } from '../application/export/object-store.js';
import { inMemoryOrg } from '../application/org/in-memory.js';
import { orgAdmin } from '../application/org/org.js';
import { define, inMemoryPeople, TENANT, versionOf } from '../application/person/in-memory.js';
import { personAccess } from '../application/person/person-access.js';
import { inMemoryIdempotency } from './idempotency.js';
import { openApiDocument } from './openapi.js';
import { restHandler, type RestRequest } from './rest.js';
import { utcCalendars } from '../application/org/org.js';

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
        deps: { calendars: utcCalendars,
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
      const answer = await rest({
        method: 'GET',
        url: '/v1/people',
        headers: {},
        body: '',
        ...over,
      });
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

describe('full-values requests', () => {
  function fullSetup() {
    const store = financeTenant();
    const clock = fixedClock('2026-09-22T09:00:00.000Z');
    const hooks: string[] = [];
    let ids = 0;
    const service = {
      access: personAccess(store.deps),
      schemas: store.deps.schemas,
      inTenant: <R>(_tenant: string, fn: (scope: { tx: never }) => Promise<R>) =>
        fn({ tx: {} as never }),
    };
    const rest = restHandler({
      service,
      callerFrom: (request) => {
        const who = String(request.headers['x-as'] ?? 'finance');
        return ok({
          ...exportAsking(FINANCE),
          viewer:
            who === 'finance'
              ? FINANCE
              : { accountId: '00000000-0000-4000-8000-0000000000ff', roles: new Set([who]) },
        });
      },
      idempotency: inMemoryIdempotency(),
      fullValues: {
        deps: { calendars: utcCalendars,
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
          requests: inMemoryFullValuesStore(),
          reveal: () => Promise.resolve(null),
        },
        started: (_t, id) => (hooks.push(`started ${id}`), Promise.resolve()),
        decided: (_t, id) => (hooks.push(`decided ${id}`), Promise.resolve()),
      },
    });
    const call = async (over: Partial<RestRequest>) => {
      const answer = await rest({
        method: 'GET',
        url: '/v1/people',
        headers: {},
        body: '',
        ...over,
      });
      if (!answer) throw new Error('not a REST route');
      return answer;
    };
    return { call, hooks };
  }

  it('lets finance ask once, HR decide, and wakes the workflow after each', async () => {
    const { call, hooks } = fullSetup();
    const ask = {
      method: 'POST',
      url: '/v1/exports/full-values',
      headers: { 'idempotency-key': 'f1' },
      body: JSON.stringify({ fields: ['iban'], reason: 'September payroll run' }),
    };
    const created = await call(ask);
    const again = await call(ask);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ state: 'pending', attributeKeys: ['iban'], link: null });
    expect(again.body).toEqual(created.body);
    const id = (created.body as { id: string }).id;
    expect(hooks).toEqual([`started ${id}`]);

    const decision = (who: string, key = 'd1') => ({
      method: 'POST',
      url: `/v1/exports/full-values/${id}/decision`,
      headers: { 'x-as': who, 'idempotency-key': key },
      body: JSON.stringify({ approve: true }),
    });
    expect((await call(decision('finance'))).status).toBe(403);
    const decided = await call(decision('hr'));
    expect(decided.status).toBe(200);
    expect(decided.body).toMatchObject({ state: 'approved' });
    expect(hooks).toEqual([`started ${id}`, `decided ${id}`]);

    // A retried decision, same key and body, replays rather than refusing (PEO-107).
    const replayed = await call(decision('hr'));
    expect(replayed.status).toBe(200);
    expect(replayed.body).toEqual(decided.body);
    // A second decision is a new request, and deciding twice is still refused.
    expect((await call(decision('hr', 'd2'))).status).toBe(409);
    const unkeyed = await call({ ...decision('hr'), headers: { 'x-as': 'hr' } });
    expect(unkeyed.body).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED' } });

    const stranger = await call({
      url: `/v1/exports/full-values/${id}`,
      headers: { 'x-as': 'manager' },
    });
    expect(stranger.status).toBe(404);
  });

  it('refuses a request from anyone but finance', async () => {
    const { call, hooks } = fullSetup();
    const refused = await call({
      method: 'POST',
      url: '/v1/exports/full-values',
      headers: { 'idempotency-key': 'f2', 'x-as': 'hr' },
      body: JSON.stringify({ fields: ['iban'], reason: 'r' }),
    });
    expect(refused.status).toBe(403);
    expect(hooks).toEqual([]);
  });
});

describe('legal entities, locations and settings', () => {
  function withOrg(roles: string[]) {
    const store = inMemoryPeople([versionOf(1, [title])]);
    const org = inMemoryOrg();
    let n = 0;
    const rest = restHandler({
      service: {
        access: personAccess(store.deps),
        schemas: store.deps.schemas,
        inTenant: (_tenant, fn) => fn({ tx: {} as never }),
        org: orgAdmin({
          store: org.store,
          clock: fixedClock('2026-03-31T20:00:00.000Z'),
          newId: () => `01900000-0000-7000-8000-${String((n += 1)).padStart(12, '0')}`,
        }),
      },
      callerFrom: () =>
        ok({
          tenantId: TENANT,
          viewer: { accountId: HR, roles: new Set(roles) },
          correlationId: '00000000-0000-4000-8000-0000000000c1',
        }),
      idempotency: inMemoryIdempotency(),
    });
    const call = async (method: string, url: string, body?: unknown, key = `${method} ${url}`) => {
      const answer = await rest({
        method,
        url,
        headers: { 'idempotency-key': key },
        body: body === undefined ? '' : JSON.stringify(body),
      });
      if (!answer) throw new Error('not a REST route');
      return answer;
    };
    return { call, org };
  }

  it('creates an entity and a location, and serves the zone in force', async () => {
    const { call } = withOrg(['people_admin']);
    const entity = await call('POST', '/v1/legal-entities', {
      name: 'Acme India',
      country: 'IN',
      timeZone: 'Asia/Kolkata',
    });
    expect(entity.status).toBe(201);
    const { id } = entity.body as { id: string };

    // 20:00 UTC on the 31st is already 1 April in Kolkata: the default effective date.
    const office = await call('POST', '/v1/locations', {
      legalEntityId: id,
      name: 'Bangalore',
      country: 'IN',
      timeZone: 'Asia/Kolkata',
    });
    expect(office).toMatchObject({
      status: 201,
      body: { timeZone: 'Asia/Kolkata', zones: [{ effectiveFrom: '2026-04-01' }] },
    });
    expect((await call('GET', '/v1/locations')).body).toMatchObject({
      items: [{ name: 'Bangalore' }],
    });
  });

  it('refuses a writer who is not a People administrator', async () => {
    const { call } = withOrg(['hr']);
    const refused = await call('POST', '/v1/legal-entities', {
      name: 'Acme',
      country: 'ES',
      timeZone: 'Europe/Madrid',
    });
    expect(refused).toMatchObject({ status: 403, body: { error: { code: 'FORBIDDEN' } } });
  });

  it('never lowers the cohort minimum', async () => {
    const { call } = withOrg(['people_admin']);
    expect((await call('PATCH', '/v1/settings', { cohortMinimum: 20 }, 'a')).body).toMatchObject({
      cohortMinimum: 20,
    });
    expect((await call('PATCH', '/v1/settings', { cohortMinimum: 15 }, 'b')).body).toMatchObject({
      error: { code: 'COHORT_MINIMUM_LOWERED' },
    });
    expect((await call('GET', '/v1/settings')).body).toMatchObject({ cohortMinimum: 20 });
  });
});
