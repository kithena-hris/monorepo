import { describe, expect, it } from 'vitest';
import { ok } from '@kithena/domain-kit';
import { DateSpan, LeaveTypeKey } from '@kithena/contracts';

import type { Caller } from '../application/ports.js';
import { askApproverInChat } from '../application/reach/chat.js';
import { sendRequest } from '../application/request/request.js';
import { ADA_ACCOUNT, caller, people, TENANT, world } from '../application/testing/world.js';
import { slackThroughService } from '../infrastructure/integrations/slack.js';
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
      Record<
        string,
        { operationId: string; parameters: { name: string; in: string }[]; security?: [] }
      >
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
        if (method !== 'get' && op.security === undefined) {
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

  it("reaches every GET route by its own path, never a sibling's parameter", async () => {
    // \`/balances/adjustments\` once answered as the balance of a leave type
    // called "adjustments": every literal path must reach its own route.
    const { call } = boot();
    for (const route of ROUTES.filter((r) => r.method === 'GET' && !r.path.includes('{'))) {
      const answer = await call({ as: 'ada', url: route.path });
      expect([route.path, answer.status]).not.toEqual([route.path, 404]);
    }
    expect((await call({ as: 'ada', url: '/v1/timeoff/balance-adjustments' })).status).toBe(200);
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

  it('answers, sends and approves a parental plan; the entitlement reads from the query', async () => {
    const { call } = boot();
    const asked = await call({
      url: '/v1/timeoff/parental?role=other_parent&childDate=2027-01-14&singleParent=false&children=2',
    });
    expect(asked.body).toMatchObject({ plan: null, preview: { flexibleWeeks: 12 } });
    const answered = await call({
      method: 'POST',
      url: '/v1/timeoff/parental',
      headers: { 'idempotency-key': 'p1' },
      body: JSON.stringify({ role: 'other_parent', childDate: '2027-01-14' }),
    });
    const { planId } = answered.body as { planId: string };
    const sent = await call({
      method: 'POST',
      url: `/v1/timeoff/parental/${planId}/send`,
      headers: { 'idempotency-key': 'p2' },
    });
    expect(sent.body).toEqual({ status: 'submitted' });
    expect((await call({ url: `/v1/timeoff/parental/${planId}/case` })).status).toBe(200);
    const approved = await call({
      as: 'ada',
      method: 'POST',
      url: `/v1/timeoff/parental/${planId}/approve`,
      headers: { 'idempotency-key': 'p3' },
    });
    expect(approved.body).toEqual({ status: 'approved' });
  });
});

describe('a kiosk, with its own token (TOF-107)', () => {
  it('registers through HR, then punches with the device token and no key or session', async () => {
    const { app, call } = boot();
    const registered = await call({
      as: 'ada',
      method: 'POST',
      url: '/v1/timeoff/kiosks',
      headers: { 'idempotency-key': 'k-1' },
      body: JSON.stringify({ name: 'Main entrance', locationKey: 'madrid' }),
    });
    expect(registered.status).toBe(201);
    const { deviceId, token } = registered.body as { deviceId: string; token: string };
    expect(
      (
        await call({
          as: 'ada',
          method: 'PUT',
          url: `/v1/timeoff/members/${people.adam}/kiosk-credentials/pin`,
          headers: { 'idempotency-key': 'k-2' },
          body: JSON.stringify({ value: '482193' }),
        })
      ).status,
    ).toBe(200);

    const status = await call({
      url: `/v1/timeoff/kiosk/${deviceId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(status).toMatchObject({ status: 200, body: { name: 'Main entrance' } });

    const synced = await call({
      method: 'POST',
      url: `/v1/timeoff/kiosk/${deviceId}/punches`,
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({
        sentAt: '2026-10-01T07:00:00.000Z',
        punches: [
          {
            sequence: 1,
            at: '2026-10-01T06:59:00.000Z',
            credential: { kind: 'pin', value: '482193' },
          },
        ],
      }),
    });
    expect(synced).toMatchObject({
      status: 200,
      body: { results: [{ sequence: 1, outcome: 'punched', kind: 'in', firstName: 'Adam' }] },
    });
    expect(app.state(TENANT).punches.get(people.adam)?.[0]?.source).toBe('kiosk');

    const wrong = await call({
      url: `/v1/timeoff/kiosk/${deviceId}`,
      headers: { authorization: 'Bearer kk_nope' },
    });
    expect(wrong.status).toBe(401);
  });
});

describe('a provider’s callback (TOF-109)', () => {
  it('sends the browser back where HR came from, with a 302', async () => {
    const app = world('2026-10-01T07:00:00.000Z');
    const microsoft = {
      provider: 'microsoft' as const,
      configured: true,
      connectUrl: (state: string) => `https://login.example/?state=${state}`,
      complete: () => Promise.resolve({ config: { directory: 'd-1' }, secret: null }),
      put: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    };
    const rest = restHandler({
      deps: {
        ...app.deps,
        reach: { calendars: [microsoft], chats: [], publicUrl: 'https://to.example' },
      },
      callerFrom: () => ok(caller(null, ADA_ACCOUNT)),
    });
    const connect = await rest({
      method: 'POST',
      url: '/v1/timeoff/integrations/microsoft/connect',
      headers: { 'idempotency-key': 'c-1' },
      body: JSON.stringify({ back: 'https://acme.example/settings/time-off/integrations' }),
    });
    if (connect === null) throw new Error('not a route');
    const state = new URL((connect.body as { url: string }).url).searchParams.get('state') ?? '';
    const back = await rest({
      method: 'GET',
      url: `/v1/timeoff/integrations/microsoft/callback?state=${encodeURIComponent(state)}&tenant=d-1&admin_consent=True`,
      headers: {},
      body: '',
    });
    expect(back).toEqual({
      status: 302,
      body: '',
      headers: {
        location: 'https://acme.example/settings/time-off/integrations?connected=microsoft',
      },
    });
  });
});

describe('a Slack press, relayed by the Slack service (TOF-111)', () => {
  it('is decided with the pair’s secret, and refused without it', async () => {
    const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
    const sent: string[] = [];
    const http = (_url: string, init: RequestInit = {}) => {
      sent.push(typeof init.body === 'string' ? init.body : '');
      return Promise.resolve(new Response('{"sent":"sent"}', { status: 202 }));
    };
    const slack = slackThroughService(
      { SLACK_URL: 'http://slack:4102', SLACK_TIMEOFF_TOKEN: 'pair-value' },
      { fetch: http as unknown as typeof fetch },
    );
    const deps = {
      ...app.deps,
      reach: { calendars: [], chats: [slack], publicUrl: 'https://to.example' },
    };
    app.state(TENANT).integrations.set('slack', {
      provider: 'slack',
      config: {},
      secret: null,
      connectedAt: '2026-09-01T00:00:00.000Z' as never,
      connectedBy: ADA_ACCOUNT,
    });
    const requested = await sendRequest(deps)(caller(people.adam), {
      leaveTypeKey: LeaveTypeKey.parse('vacation'),
      span: DateSpan.parse({ from: '2026-10-19', to: '2026-10-23' }),
    });
    if (!requested.ok) throw new Error(requested.error.message);
    await askApproverInChat(deps)(TENANT, requested.value.requestId);
    const { approve } = JSON.parse(sent[0] ?? '{}') as { approve: string };

    const rest = restHandler({ deps, callerFrom: () => ok(caller(people.adam)) });
    const relay = (token: string) =>
      rest({
        method: 'POST',
        url: '/v1/timeoff/integrations/slack/relay',
        headers: { 'x-internal-token': token },
        body: JSON.stringify({ tenantId: TENANT, value: approve }),
      });
    expect((await relay('the-routers-token'))?.status).toBe(401);
    expect(await relay('pair-value')).toEqual({
      status: 200,
      body: { text: 'Approved: Adam Novak, 19–23 Oct.' },
    });
  });
});
