import { describe, expect, it } from 'vitest';
import { ok } from '@kithena/domain-kit';

import type { Caller } from '../application/ports.js';
import { ADA_ACCOUNT, caller, people, world } from '../application/testing/world.js';
import { openApiDocument } from './openapi.js';
import { restHandler, ROUTES, type RestRequest } from './rest.js';

/** TOF-046: the document generated from the routes, and the routes answering. */

function boot() {
  const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
  const as: Record<string, Caller> = { adam: caller(people.adam), ada: caller(null, ADA_ACCOUNT) };
  const rest = restHandler({
    deps: app.deps,
    callerFrom: (request) => ok(as[String(request.headers['x-as'])] ?? caller(people.adam)),
  });
  const call = async (over: Partial<RestRequest> & { as?: string }) => {
    const answer = await rest({
      method: 'GET',
      url: '/v1/timeoff/overview',
      body: '',
      ...over,
      headers: { 'x-as': over.as ?? 'adam', ...over.headers },
    });
    if (answer === null) throw new Error('not a route');
    return answer;
  };
  return { app, call };
}

describe('the OpenAPI document', () => {
  const doc = openApiDocument() as {
    openapi: string;
    paths: Record<
      string,
      Record<string, { operationId: string; parameters: { name: string; in: string }[] }>
    >;
    components: { schemas: Record<string, Record<string, unknown>> };
  };

  it('has one operation per route, each named', () => {
    expect(doc.openapi).toBe('3.1.0');
    const operations = Object.values(doc.paths).flatMap((p) => Object.values(p));
    expect(operations).toHaveLength(ROUTES.length);
    expect(new Set(operations.map((o) => o.operationId)).size).toBe(ROUTES.length);
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(['/v1/timeoff/requests', '/v1/timeoff/members:import']),
    );
  });

  it('declares every path parameter, and a key on every write', () => {
    for (const [path, methods] of Object.entries(doc.paths)) {
      const inPath = [...path.matchAll(/\{([a-zA-Z]+)\}/gu)].map((m) => m[1]);
      for (const [method, op] of Object.entries(methods)) {
        const declared = op.parameters.filter((p) => p.in === 'path').map((p) => p.name);
        expect(declared.toSorted(), `${method} ${path}`).toEqual(inPath.toSorted());
        if (method !== 'get') {
          expect(
            op.parameters.map((p) => p.name),
            `${method} ${path}`,
          ).toContain('Idempotency-Key');
        }
      }
    }
  });

  it('resolves every reference, and describes a body as the handler parses it', () => {
    const refs = [...JSON.stringify(doc).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/gu)];
    expect(refs.length).toBeGreaterThan(0);
    for (const [, id] of refs) expect(doc.components.schemas, id).toHaveProperty(id as string);
    expect(JSON.stringify(doc)).not.toContain('"$ref":"#/$defs');
    // A strict body refuses unknown keys, and the document says so.
    expect(doc.components.schemas['DecideTimeOffRequestBody']).toMatchObject({
      additionalProperties: false,
      required: ['decision'],
    });
  });
});

describe('REST', () => {
  it('sends a request and reads it back', async () => {
    const { call } = boot();
    const sent = await call({
      method: 'POST',
      url: '/v1/timeoff/requests',
      headers: { 'idempotency-key': 'k1' },
      body: JSON.stringify({
        leaveTypeKey: 'vacation',
        span: { from: '2026-10-05', to: '2026-10-06' },
      }),
    });
    expect(sent).toMatchObject({ status: 201, body: { status: 'pending', noteRequired: false } });
    const id = (sent.body as { requestId: string }).requestId;
    const mine = await call({ url: '/v1/timeoff/my-requests?tab=upcoming' });
    expect(mine.body).toMatchObject({
      tab: 'upcoming',
      items: [{ requestId: id, workingDays: '2.000' }],
    });
    const one = await call({ url: `/v1/timeoff/requests/${id}` });
    expect(one.body).toMatchObject({ mine: true, canCancel: true, chain: ['manager'] });
  });

  it('refuses a write without a key, a body that does not parse, and what is not a route', async () => {
    const { call } = boot();
    const unkeyed = await call({ method: 'POST', url: '/v1/timeoff/requests', body: '{}' });
    expect(unkeyed).toMatchObject({
      status: 400,
      body: { error: { code: 'IDEMPOTENCY_KEY_REQUIRED' } },
    });
    const bad = await call({
      method: 'POST',
      url: '/v1/timeoff/requests',
      headers: { 'idempotency-key': 'k2' },
      body: JSON.stringify({
        leaveTypeKey: 'vacation',
        span: { from: '2026-10-06', to: '2026-10-05' },
      }),
    });
    expect(bad).toMatchObject({
      status: 400,
      body: { error: { code: 'BAD_REQUEST', path: ['span', 'to'] } },
    });
    expect((await call({ url: '/v1/timeoff/nothing' })).status).toBe(404);
    expect((await call({ method: 'DELETE', url: '/v1/timeoff/overview' })).status).toBe(405);
    expect((await call({ url: '/v1/timeoff/settings/leave-types' })).status).toBe(403);
    expect((await call({ as: 'ada', url: '/v1/timeoff/settings/leave-types' })).status).toBe(200);
  });

  it('serves a signed calendar feed without a caller, and stops when it is revoked', async () => {
    const { call } = boot();
    const issued = await call({
      method: 'POST',
      url: '/v1/timeoff/calendar/feeds',
      headers: { 'idempotency-key': 'f1' },
      body: JSON.stringify({ scope: 'me' }),
    });
    const { token } = issued.body as { token: string };
    const feed = await call({
      url: `/v1/timeoff/calendar/feed.ics?token=${encodeURIComponent(token)}`,
    });
    expect(feed.status).toBe(200);
    expect(feed.headers?.['content-type']).toContain('text/calendar');
    expect(String(feed.body)).toContain('BEGIN:VCALENDAR');
    await call({
      method: 'DELETE',
      url: '/v1/timeoff/calendar/feeds',
      headers: { 'idempotency-key': 'f2' },
    });
    const revoked = await call({
      url: `/v1/timeoff/calendar/feed.ics?token=${encodeURIComponent(token)}`,
    });
    expect(revoked).toMatchObject({ status: 401, body: { error: { code: 'INVALID_TOKEN' } } });
  });
});
