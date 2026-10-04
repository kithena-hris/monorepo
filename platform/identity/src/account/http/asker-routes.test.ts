import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AssistantAsker } from '@kithena/contracts';

import { askerRoutes, type AskerAccountRow } from './asker-routes.js';

/**
 * Who is asking the assistant, over a real socket (assistant PRD §10.1).
 *
 * Its half of the contract: every 200 parses as `AssistantAsker`, the schema
 * the assistant's client parses with. Nobody, several and an unknown company
 * are the same bodiless 404.
 */

const TOKEN = 'assistant-identity-secret';
const TENANT = '00000000-0000-4000-8000-00000000000a';
const ADA = '00000000-0000-4000-8000-0000000000a1';

const accounts: Record<string, AskerAccountRow[]> = {
  'ada@acme.example': [{ id: ADA, timeZone: 'Europe/Madrid' }],
  'twice@acme.example': [
    { id: '00000000-0000-4000-8000-0000000000a2', timeZone: 'UTC' },
    { id: '00000000-0000-4000-8000-0000000000a3', timeZone: 'UTC' },
  ],
};

let server: Server;
let base: string;

function serve(token: string) {
  const handle = askerRoutes({
    internalToken: token,
    accounts: (_tenantId, who) =>
      Promise.resolve(
        'email' in who
          ? (accounts[who.email.toLowerCase()] ?? [])
          : Object.values(accounts)
              .flat()
              .filter((a) => a.id === who.accountId),
      ),
    tenant: (tenantId) =>
      Promise.resolve(
        tenantId === TENANT
          ? { slug: 'acme', entitlements: ['module.people', 'module.timeoff'] as const }
          : null,
      ),
  });
  return createServer((request, response) => {
    void handle(request, response).then((handled) => {
      if (!handled) response.writeHead(404, { 'x-unrouted': '1' }).end();
    });
  });
}

beforeAll(async () => {
  server = serve(TOKEN);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const ask = (body: unknown, token: string | null = TOKEN, tenant = TENANT, method = 'POST') =>
  fetch(`${base}/api/internal/tenants/${tenant}/assistant/asker`, {
    method,
    headers: token === null ? {} : { 'x-internal-token': token },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });

describe('who is asking the assistant', () => {
  it('answers one active account with its zone, the slug and the modules', async () => {
    const response = await ask({ email: 'Ada@Acme.example' });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(AssistantAsker.parse(await response.json())).toEqual({
      accountId: ADA,
      timeZone: 'Europe/Madrid',
      slug: 'acme',
      entitlements: ['module.people', 'module.timeoff'],
    });
  });

  it('answers the web’s signed-in account by its id, as for its email', async () => {
    const response = await ask({ accountId: ADA });
    expect(response.status).toBe(200);
    expect(AssistantAsker.parse(await response.json())).toMatchObject({
      accountId: ADA,
      timeZone: 'Europe/Madrid',
      slug: 'acme',
    });
    expect((await ask({ accountId: '00000000-0000-4000-8000-0000000000ff' })).status).toBe(404);
  });

  it('is the same bodiless 404 for nobody, for several, and for a company there is not', async () => {
    for (const [body, tenant] of [
      [{ email: 'nobody@acme.example' }, TENANT],
      [{ email: 'twice@acme.example' }, TENANT],
      [{ email: 'ada@acme.example' }, '00000000-0000-4000-8000-00000000000b'],
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop -- one request at a time, each its own case
      const response = await ask(body, TOKEN, tenant);
      expect(response.status).toBe(404);
      // oxlint-disable-next-line no-await-in-loop -- as above
      expect(await response.text()).toBe('');
    }
  });

  it('refuses without the assistant’s token, and everyone when none is configured', async () => {
    expect((await ask({ email: 'ada@acme.example' }, null)).status).toBe(401);
    expect((await ask({ email: 'ada@acme.example' }, 'internal-api-token')).status).toBe(401);
    const unset = serve('');
    await new Promise<void>((resolve) => unset.listen(0, '127.0.0.1', resolve));
    const port = String((unset.address() as AddressInfo).port);
    const refused = await fetch(
      `http://127.0.0.1:${port}/api/internal/tenants/${TENANT}/assistant/asker`,
      {
        method: 'POST',
        headers: { 'x-internal-token': '' },
        body: JSON.stringify({ email: 'ada@acme.example' }),
      },
    );
    expect(refused.status).toBe(401);
    await new Promise((resolve) => unset.close(resolve));
  });

  it('takes a POST with an email or an account id, never both, for a tenant id', async () => {
    expect((await ask(undefined, TOKEN, TENANT, 'GET')).status).toBe(405);
    expect((await ask({ email: 'not an email' })).status).toBe(400);
    expect((await ask({ accountId: 'ada' })).status).toBe(400);
    expect((await ask({ email: 'ada@acme.example', accountId: ADA })).status).toBe(400);
    expect((await ask({ email: 'ada@acme.example' }, TOKEN, 'acme')).status).toBe(400);
  });
});
