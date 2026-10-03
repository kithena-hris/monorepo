import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RuntimeCatalogue, TimeOffAway } from '@kithena/contracts';

import { people, TENANT, world } from '../application/testing/world.js';
import { callerFromHeaders, withMember } from './caller.js';
import { timeoffServer } from './server.js';

/**
 * AST-022: the assistant's token opens `/internal/capabilities` and nothing
 * else, and the router's does not open it (assistant PRD §10.2).
 */

const ROUTER = 'router-to-timeoff';
const ASSISTANT = 'assistant-to-timeoff';
const ADAM_ACCOUNT = people.adam.replace(/^00000000/u, '0000000a');

let server: Server;
let base: string;

beforeAll(async () => {
  const app = world();
  const { listener } = timeoffServer({
    ...app.deps,
    callerFrom: withMember(callerFromHeaders(ROUTER), app.deps.uow),
    assistantCallerFrom: withMember(callerFromHeaders(ASSISTANT), app.deps.uow),
  });
  server = createServer(listener);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const headers = (token: string, principal: Record<string, unknown> = {}) => ({
  'content-type': 'application/json',
  'x-internal-token': token,
  'x-kithena-principal': JSON.stringify({
    userId: ADAM_ACCOUNT,
    tenantId: TENANT,
    entitlements: ['module.timeoff'],
    impersonatedBy: null,
    viewedBy: null,
    ...principal,
  }),
  'x-correlation-id': '00000000-0000-4000-8000-0000000000c9',
});

const call = async (path: string, token: string, init: RequestInit = {}) => {
  const response = await fetch(`${base}${path}`, { ...init, headers: headers(token) });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

describe('the capability routes (AST-022)', () => {
  it('serve the catalogue to the assistant, as the asker', async () => {
    const { status, body } = await call('/internal/capabilities', ASSISTANT);
    expect(status).toBe(200);
    expect(RuntimeCatalogue.parse(body).module).toBe('timeoff');
  });

  it('refuse the router’s token', async () => {
    const { status, body } = await call('/internal/capabilities', ROUTER);
    expect(status).toBe(401);
    expect(body).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('are the only thing the assistant’s token opens', async () => {
    expect((await call('/v1/timeoff/overview', ASSISTANT)).status).toBe(401);
    const graphql = await call('/graphql', ASSISTANT, {
      method: 'POST',
      body: JSON.stringify({ query: '{ timeOffHolidays(year: 2026) { __typename } }' }),
    });
    expect(JSON.stringify(graphql.body)).toContain('UNAUTHENTICATED');
    // The router's token still opens REST.
    expect((await call('/v1/timeoff/overview', ROUTER)).status).toBe(200);
  });

  it('refuse what the router’s caller refuses: no Time Off, a support or view-as session', async () => {
    const as = async (principal: Record<string, unknown>) =>
      (await fetch(`${base}/internal/capabilities`, { headers: headers(ASSISTANT, principal) }))
        .status;
    expect(await as({ entitlements: ['module.people'] })).toBe(403);
    expect(await as({ viewedBy: '0000000b-0000-4000-8000-000000000001' })).toBe(403);
    expect(await as({ impersonatedBy: '0000000b-0000-4000-8000-000000000001' })).toBe(403);
  });

  it('answer timeoff.away with its contract’s input, and refuse anything else (AST-023)', async () => {
    const post = (body: unknown, token = ASSISTANT) =>
      call('/internal/capabilities/timeoff.away', token, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    const answer = await post({ on: { from: '2026-10-06', to: '2026-10-06' }, limit: 25 });
    expect(answer.status).toBe(200);
    expect(TimeOffAway.schemas.output.parse(answer.body)).toMatchObject({
      kind: 'people',
      scope: 'visible',
    });
    expect((await post({ limit: 25 })).status).toBe(400);
    expect(
      (await post({ on: { from: '2026-10-06', to: '2026-10-06' }, limit: 25, personIds: ['x'] }))
        .status,
    ).toBe(400);
    expect(
      (await post({ on: { from: '2026-10-06', to: '2026-10-06' }, limit: 25 }, ROUTER)).status,
    ).toBe(401);
  });

  it('answer nothing they do not serve', async () => {
    const unknown = await call('/internal/capabilities/people.find', ASSISTANT, {
      method: 'POST',
      body: '{}',
    });
    expect(unknown.status).toBe(404);
    expect(
      (await call('/internal/capabilities/constructor', ASSISTANT, { method: 'POST' })).status,
    ).toBe(404);
    expect((await call('/internal/capabilities', ASSISTANT, { method: 'POST' })).status).toBe(405);
    expect((await call('/internal/capabilitiesx', ASSISTANT)).status).toBe(404);
  });
});
