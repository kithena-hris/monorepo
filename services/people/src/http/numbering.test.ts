import { describe, expect, it } from 'vitest';
import { fixedClock, ok } from '@kithena/domain-kit';

import { inMemoryNumbers, inMemoryOrg } from '../application/org/in-memory.js';
import { orgAdmin } from '../application/org/org.js';
import { inMemoryPeople, TENANT, versionOf } from '../application/person/in-memory.js';
import { personAccess } from '../application/person/person-access.js';
import { inMemoryIdempotency } from './idempotency.js';
import { restHandler } from './rest.js';

/** PEO-101's `GET/PUT /v1/legal-entities/{id}/numbering`, over REST (PEO-108). */

const ADMIN = '00000000-0000-4000-8000-0000000000b3';

function setup(withNumbers = true) {
  const store = inMemoryPeople([versionOf(1, [])]);
  const org = inMemoryOrg();
  let n = 0;
  const rest = restHandler({
    service: {
      access: personAccess(store.deps),
      schemas: store.deps.schemas,
      inTenant: (_tenant, fn) => fn({ tx: {} as never }),
      org: orgAdmin({
        store: org.store,
        ...(withNumbers ? { numbers: inMemoryNumbers() } : {}),
        clock: fixedClock('2026-09-22T09:00:00.000Z'),
        newId: () => `01900000-0000-7000-8000-${String((n += 1)).padStart(12, '0')}`,
      }),
    },
    callerFrom: (request) =>
      ok({
        tenantId: TENANT,
        viewer: {
          accountId: ADMIN,
          roles: new Set(String(request.headers['x-roles'] ?? 'people_admin').split(',')),
        },
        correlationId: '00000000-0000-4000-8000-0000000000c1',
      }),
    idempotency: inMemoryIdempotency(),
  });
  const call = async (
    method: string,
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const answer = await rest({
      method,
      url,
      headers: { 'idempotency-key': `${method} ${url} ${JSON.stringify(body)}`, ...headers },
      body: body === undefined ? '' : JSON.stringify(body),
    });
    if (!answer) throw new Error('not a REST route');
    return answer;
  };
  const entity = async () => {
    const made = await call('POST', '/v1/legal-entities', {
      name: 'Acme Spain',
      country: 'ES',
      timeZone: 'Europe/Madrid',
    });
    return (made.body as { id: string }).id;
  };
  return { call, entity, org };
}

describe('GET /v1/legal-entities/{id}/numbering', () => {
  it('is 404 for an entity that does not number its people', async () => {
    const { call, entity } = setup();
    const id = await entity();
    expect(await call('GET', `/v1/legal-entities/${id}/numbering`)).toMatchObject({
      status: 404,
      body: { error: { code: 'NOT_FOUND' } },
    });
  });

  it('is 503 where numbering is not wired', async () => {
    const { call, entity } = setup(false);
    const id = await entity();
    expect((await call('GET', `/v1/legal-entities/${id}/numbering`)).status).toBe(503);
  });
});

describe('PUT /v1/legal-entities/{id}/numbering', () => {
  it('sets a scheme, serves it back, and never moves the sequence back', async () => {
    const { call, entity, org } = setup();
    const id = await entity();
    const set = await call('PUT', `/v1/legal-entities/${id}/numbering`, {
      prefix: 'ES-',
      digits: 5,
      start: 100,
    });
    expect(set).toMatchObject({
      status: 200,
      body: { legalEntityId: id, prefix: 'ES-', digits: 5, nextValue: 100 },
    });
    expect((await call('GET', `/v1/legal-entities/${id}/numbering`)).body).toEqual(set.body);
    expect(org.events.map((e) => e.eventName)).toContain('people.employee_numbering.set');

    const lower = await call('PUT', `/v1/legal-entities/${id}/numbering`, {
      prefix: 'ES-',
      digits: 5,
      start: 1,
    });
    expect(lower.body).toMatchObject({ nextValue: 100 });
  });

  it('answers a retried key without a second event', async () => {
    const { call, entity, org } = setup();
    const id = await entity();
    const body = { prefix: 'ES-', digits: 5, start: 1 };
    const first = await call('PUT', `/v1/legal-entities/${id}/numbering`, body);
    const count = org.events.length;
    expect(await call('PUT', `/v1/legal-entities/${id}/numbering`, body)).toEqual(first);
    expect(org.events).toHaveLength(count);
  });

  it('refuses HR, a scheme that cannot hold its start, an unknown entity and a bad body', async () => {
    const { call, entity } = setup();
    const id = await entity();
    const url = `/v1/legal-entities/${id}/numbering`;
    const asHr = await call(
      'PUT',
      url,
      { prefix: 'ES-', digits: 5, start: 1 },
      { 'x-roles': 'hr' },
    );
    expect(asHr).toMatchObject({ status: 403, body: { error: { code: 'FORBIDDEN' } } });

    const tooWide = await call('PUT', url, { prefix: 'ES-', digits: 2, start: 100 });
    expect(tooWide.body).toMatchObject({ error: { path: ['start'] } });

    const nobody = await call(
      'PUT',
      '/v1/legal-entities/00000000-0000-4000-8000-0000000000e9/numbering',
      { prefix: 'X', digits: 3, start: 1 },
    );
    expect(nobody.status).toBe(404);

    const extra = await call('PUT', url, { prefix: 'ES-', digits: 5, start: 1, reset: true });
    expect(extra.body).toMatchObject({ error: { code: 'BAD_REQUEST' } });
  });
});
