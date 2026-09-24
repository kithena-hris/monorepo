import { describe, expect, it, vi } from 'vitest';
import { ok } from '@kithena/domain-kit';

import type { PeopleService } from '../application/person/service.js';
import type { ScreenRouteDeps } from './screens.js';
import { screenRoutes } from './screens.js';
import type { CallerFrom } from './caller.js';
import { inMemoryIdempotency } from './idempotency.js';
import { openApiDocument } from './openapi.js';
import { restHandler, restRoutes, UUID, type RestDeps } from './rest.js';

/**
 * Every state-changing People route carries an Idempotency-Key and is in the
 * OpenAPI document (PEO-116).
 *
 * Enumerated from the router itself, so a route added tomorrow is checked
 * without anyone remembering to list it here. The only list kept by hand is
 * the POSTs that change nothing, so marking a write `safe` is a change to this
 * file that a reviewer sees.
 */

const TENANT = '00000000-0000-4000-8000-00000000000a';
const ACCOUNT = '00000000-0000-4000-8000-0000000000b1';
const SOMEONE = '00000000-0000-4000-8000-0000000000a1';
const KEY = '([a-z][a-z0-9_]{0,63})';

const SAFE = [
  'POST /v1/schema/draft/advice',
  'POST /v1/schema/draft/preview',
  // An import's upload (§14.2): a retried start is a fresh upload, and
  // completing twice checks the same file twice.
  'POST /v1/imports/uploads',
  'POST /v1/imports/uploads/{id}/complete',
  'POST /v1/imports/dry-run',
  // PEO-125: a check that stores nothing, and an audited read.
  'POST /v1/views/me/identifier-check',
  'POST /v1/views/people/{id}/identifier-check',
  'POST /v1/people/{id}/identifier-reviews/reveal',
  'POST /v1/views/completeness/identifier-check',
];

const callerFrom: CallerFrom = () =>
  Promise.resolve(
    ok({
      tenantId: TENANT,
      viewer: { accountId: ACCOUNT, roles: new Set(['people_admin', 'hr']) },
      correlationId: '00000000-0000-4000-8000-0000000000c1',
    }),
  );

/** `^/v1/people/(uuid)/notice$` → `/v1/people/{id}/notice`. */
const template = (pattern: RegExp): string =>
  pattern.source
    .replace(/^\^/, '')
    .replace(/\$$/, '')
    .replaceAll(UUID, '{id}')
    .replaceAll(KEY, '{key}')
    .replaceAll('\\/', '/');

function everyWrite(deps: Partial<RestDeps> = {}) {
  const idempotency = inMemoryIdempotency();
  const all: RestDeps = {
    service: {} as PeopleService,
    callerFrom,
    idempotency,
    screens: screenRoutes({} as ScreenRouteDeps, idempotency),
    ...deps,
  };
  return restRoutes(all)
    .filter((r) => r.method !== 'GET')
    .map((r) => ({ route: r, name: `${r.method} ${template(r.pattern)}` }));
}

type Operation = { parameters?: { name: string; in: string; required?: boolean }[] };
const paths = openApiDocument()['paths'] as Record<string, Record<string, Operation>>;

describe('every state-changing route', () => {
  const writes = everyWrite();

  it('finds the routes (the enumeration is not empty or stale)', () => {
    expect(writes.length).toBeGreaterThan(30);
    expect(writes.map((w) => w.name)).toContain('POST /v1/webhooks/endpoints');
    expect(
      writes
        .filter((w) => w.route.safe)
        .map((w) => w.name)
        .toSorted(),
    ).toEqual(SAFE.toSorted());
  });

  it.each(writes.map((w) => [w.name, w] as const))('%s is in the OpenAPI document', (_, w) => {
    const [method = '', path = ''] = w.name.split(' ');
    const operation = paths[path]?.[method.toLowerCase()];
    expect(operation, `${w.name} has no OpenAPI operation`).toBeDefined();
    const key = operation?.parameters?.find((p) => p.name === 'Idempotency-Key');
    if (w.route.safe) expect(key).toBeUndefined();
    else expect(key).toMatchObject({ in: 'header', required: true });
  });

  it.each(writes.filter((w) => !w.route.safe).map((w) => [w.name, w] as const))(
    '%s is refused without an Idempotency-Key',
    async (_, w) => {
      const [method = '', path = ''] = w.name.split(' ');
      const rest = restHandler({
        service: {} as PeopleService,
        callerFrom,
        idempotency: inMemoryIdempotency(),
        screens: screenRoutes({} as ScreenRouteDeps, inMemoryIdempotency()),
      });
      const answer = await rest({
        method,
        url: path.replace('{id}', SOMEONE).replace('{key}', 'personal'),
        headers: {},
        body: '{}',
      });
      expect(answer?.body).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED' } });
    },
  );

  it('documents no write the router does not serve', () => {
    const served = new Set(writes.map((w) => w.name));
    const documented = Object.entries(paths).flatMap(([path, operations]) =>
      Object.keys(operations)
        .filter((m) => m !== 'get')
        .map((m) => `${m.toUpperCase()} ${path}`),
    );
    expect(documented.filter((d) => !served.has(d))).toEqual([]);
  });
});

describe("a screen's keyed write", () => {
  const created = { id: '00000000-0000-4000-8000-0000000000e1', secret: 'whsec_once' };
  const createEndpoint = vi.fn(() => Promise.resolve(ok(created)));
  const service = {
    inTenant: (_tenant: string, fn: (scope: { tx: never }) => Promise<unknown>) =>
      fn({ tx: {} as never }),
  } as unknown as PeopleService;
  const deps = {
    service,
    relations: { relations: () => Promise.resolve({ isAdmin: true }) },
    webhooks: { createEndpoint },
  } as unknown as ScreenRouteDeps;
  const rest = restHandler({
    service,
    callerFrom,
    idempotency: inMemoryIdempotency(),
    screens: screenRoutes(deps, inMemoryIdempotency()),
  });
  const request = {
    method: 'POST',
    url: '/v1/webhooks/endpoints',
    headers: { 'idempotency-key': 'k-1' },
    body: JSON.stringify({
      url: 'https://hooks.example.com/people',
      events: ['people.person.hired'],
      allowlist: [],
      alertEmail: 'ops@example.com',
    }),
  };

  it('is made once, and a retry is answered without the secret', async () => {
    const first = await rest(request);
    const again = await rest(request);
    expect(first).toMatchObject({ status: 201, body: created });
    expect(again).toMatchObject({ status: 201, body: { id: created.id } });
    expect(again?.body).not.toHaveProperty('secret');
    expect(createEndpoint).toHaveBeenCalledTimes(1);
  });

  it('refuses the same key with a different body', async () => {
    const other = await rest({ ...request, body: request.body.replace('people', 'staff') });
    expect(other?.body).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } });
    expect(createEndpoint).toHaveBeenCalledTimes(1);
  });
});
