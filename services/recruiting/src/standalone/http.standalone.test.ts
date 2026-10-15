import { randomUUID } from 'node:crypto';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { callerFromHeaders } from '../http/caller.js';
import { recruitingServer } from '../http/server.js';
import { uuidv7 } from '../infrastructure/ids.js';
import { memoryBlobs, memoryUnitOfWork } from '../testing/memory.js';

/**
 * Recruiting's transports alone (REC-060 to REC-062): REST with its keys,
 * the OpenAPI document, the subgraph, and the public API by a company's slug.
 */

const TOKEN = 'router-secret';
const tenantId = randomUUID();
const ada = { account: randomUUID(), person: randomUUID() };
const uow = memoryUnitOfWork();
let server: Server;
let base: string;

const principal = (who: { account: string; person: string }) =>
  JSON.stringify({
    userId: who.account,
    tenantId,
    personId: who.person,
    entitlements: ['module.recruiting'],
  });
const headers = (key?: string): Record<string, string> => ({
  'content-type': 'application/json',
  'x-internal-token': TOKEN,
  'x-kithena-principal': principal(ada),
  ...(key === undefined ? {} : { 'idempotency-key': key }),
});

beforeAll(async () => {
  await uow.run(tenantId as never, (tx) => tx.admins.add(ada.account));
  const { listener } = recruitingServer(
    {
      uow,
      blobs: memoryBlobs(),
      jobsOrigin: 'https://jobs.example',
      extractText: () => Promise.resolve(null),
      callerFrom: callerFromHeaders(TOKEN),
      listings: uow.listings,
    },
    uuidv7,
  );
  server = createServer(listener);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});
afterAll(
  () =>
    new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    }),
);

describe('Recruiting’s transports, alone', () => {
  it('publishes its OpenAPI document', async () => {
    const response = await fetch(`${base}/v1/recruiting/openapi.json`);
    const doc = (await response.json()) as { paths: Record<string, unknown> };
    expect(response.status).toBe(200);
    expect(Object.keys(doc.paths)).toContain('/v1/recruiting/jobs/{jobId}/pipeline');
  });

  it('refuses a caller the router did not send, and a write without a key', async () => {
    expect((await fetch(`${base}/v1/recruiting/home`)).status).toBe(401);
    const unkeyed = await fetch(`${base}/v1/recruiting/settings`, {
      method: 'PUT',
      headers: headers(),
      body: '{}',
    });
    expect(unkeyed.status).toBe(428);
  });

  it('saves the company’s settings once per key, and answers a replay the same', async () => {
    const body = JSON.stringify({
      requisitionsOn: false,
      revealInternalAt: 'offer',
      replyAddress: null,
      federalContractor: false,
      rejectionReasons: ['not_qualified'],
      referralBonus: null,
      companyName: 'Acme',
      companySlug: 'acme',
      about: null,
      themeId: 'indigo',
      logoUrl: null,
      searchable: true,
      ai: {
        parser: false,
        matrix: false,
        writer: false,
        assistant: false,
        charts: false,
        nycAuditOn: null,
      },
    });
    const key = randomUUID();
    const first = await fetch(`${base}/v1/recruiting/settings`, {
      method: 'PUT',
      headers: headers(key),
      body,
    });
    const again = await fetch(`${base}/v1/recruiting/settings`, {
      method: 'PUT',
      headers: headers(key),
      body,
    });
    expect(first.status).toBe(200);
    expect(await again.json()).toEqual(
      await (
        await fetch(`${base}/v1/recruiting/settings`, { headers: headers() })
      )
        .json()
        .then((s: { general: unknown }) => s.general),
    );
    const reused = await fetch(`${base}/v1/recruiting/settings`, {
      method: 'PUT',
      headers: headers(key),
      body: body.replace('Acme', 'Other'),
    });
    expect(reused.status).toBe(409);
  });

  it('answers the subgraph with the same read model', async () => {
    const response = await fetch(`${base}/graphql`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ query: '{ recruitingHome }' }),
    });
    const answer = (await response.json()) as { data?: { recruitingHome: { company: string } } };
    expect(answer.data?.recruitingHome.company).toBe('Acme');
  });

  it('serves the public API by the company’s slug, and nothing for an unknown one', async () => {
    const unknown = await fetch(`${base}/v1/recruiting/public/nobody/codes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobSlug: 'x', email: 'yuki@example.com', name: 'Yuki' }),
    });
    expect(unknown.status).toBe(404);
    const noJob = await fetch(`${base}/v1/recruiting/public/acme/codes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobSlug: 'missing', email: 'yuki@example.com', name: 'Yuki' }),
    });
    expect(((await noJob.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });
});

describe('Kithena Jobs’ reads', () => {
  it('searches without a caller, refuses a malformed search, and finds no unknown company', async () => {
    const found = await fetch(`${base}/v1/recruiting/listings?q=designer&workMode=remote,hybrid`);
    expect(found.status).toBe(200);
    expect(found.headers.get('cache-control')).toBe('public, max-age=60');
    expect(await found.json()).toEqual({ rows: [], total: 0 });
    expect((await fetch(`${base}/v1/recruiting/listings?page=0`)).status).toBe(400);
    expect((await fetch(`${base}/v1/recruiting/companies/nobody`)).status).toBe(404);
    expect((await fetch(`${base}/v1/recruiting/listings/nobody/a-job`)).status).toBe(404);
  });

  it('lets Kithena Jobs’ pages call the public API from the browser, and nobody else', async () => {
    // fetch will not send an Origin of our choosing; a bare request will.
    const asked = (origin: string) =>
      new Promise<{ status: number; allow: string | undefined }>((resolve, reject) => {
        request(
          `${base}/v1/recruiting/public/acme/codes`,
          { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST' } },
          (res) => {
            res.resume();
            resolve({
              status: res.statusCode ?? 0,
              allow: res.headers['access-control-allow-origin'] as string | undefined,
            });
          },
        )
          .on('error', reject)
          .end();
      });
    const jobs = await asked('https://jobs.example');
    expect(jobs).toEqual({ status: 204, allow: 'https://jobs.example' });
    expect((await asked('https://evil.example')).allow).toBeUndefined();
  });
});
