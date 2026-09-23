import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccountsPage } from '@kithena/contracts';

import { directoryRoutes, type DirectoryAccountRow } from './directory-routes.js';

/**
 * The account listing People reconciles from, over a real socket.
 *
 * Its half of the contract: every body it sends parses as `AccountsPage`, the
 * schema People's client parses with. People's contract test holds the other
 * half against the same schema.
 */

const TOKEN = 'people-identity-secret';
const TENANT = '00000000-0000-4000-8000-00000000000a';

const rows: DirectoryAccountRow[] = [1, 2, 3].map((i) => ({
  id: `00000000-0000-4000-8000-0000000000a${String(i)}`,
  workEmail: `p${String(i)}@acme.test`,
  timeZone: 'Europe/Madrid',
  employmentStart: `2026-01-0${String(i)}`,
  givenName: i === 1 ? 'Ada' : null,
  familyName: i === 1 ? 'Lovelace' : null,
  preferredName: null,
}));
const asked: { tenantId: string; after: string | null }[] = [];

let server: Server;
let base: string;

beforeAll(async () => {
  const handle = directoryRoutes({
    internalToken: TOKEN,
    pageSize: 2,
    page: (tenantId, after, limit) => {
      asked.push({ tenantId, after });
      return Promise.resolve(rows.filter((r) => after === null || r.id > after).slice(0, limit));
    },
  });
  server = createServer((request, response) => {
    void handle(request, response).then((handled) => {
      if (!handled) response.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const get = (path: string, token: string | null = TOKEN) =>
  fetch(`${base}${path}`, { headers: token === null ? {} : { 'x-internal-token': token } });

describe('listing a tenant’s accounts', () => {
  it('refuses a caller without the token, or with the wrong one', async () => {
    expect((await get(`/api/internal/tenants/${TENANT}/accounts`, null)).status).toBe(401);
    expect((await get(`/api/internal/tenants/${TENANT}/accounts`, 'wrong')).status).toBe(401);
  });

  it('serves pages in the contract’s shape, following the cursor to the end', async () => {
    const first = await get(`/api/internal/tenants/${TENANT}/accounts`);
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    const one = AccountsPage.parse(await first.json());
    expect(one.accounts.map((a) => a.accountId)).toEqual([rows[0]?.id, rows[1]?.id]);
    expect(one.nextCursor).toBe(rows[1]?.id);
    expect(one.accounts[0]?.name).toEqual({ given: 'Ada', family: 'Lovelace', preferred: null });
    expect(one.accounts[1]?.name).toBeNull();

    const second = await get(`/api/internal/tenants/${TENANT}/accounts?cursor=${one.nextCursor ?? ''}`);
    const two = AccountsPage.parse(await second.json());
    expect(two.accounts.map((a) => a.accountId)).toEqual([rows[2]?.id]);
    expect(two.nextCursor).toBeNull();
    expect(asked.at(-1)).toEqual({ tenantId: TENANT, after: rows[1]?.id });
  });

  it('sends only what provisioning needs', async () => {
    const body = (await (await get(`/api/internal/tenants/${TENANT}/accounts`)).json()) as {
      accounts: Record<string, unknown>[];
    };
    expect(Object.keys(body.accounts[0] ?? {}).toSorted()).toEqual([
      'accountId',
      'employmentStart',
      'name',
      'timeZone',
      'workEmail',
    ]);
  });

  it('refuses a malformed tenant or cursor before it reaches the database', async () => {
    const before = asked.length;
    expect((await get('/api/internal/tenants/acme/accounts')).status).toBe(400);
    expect((await get(`/api/internal/tenants/${TENANT}/accounts?cursor=x`)).status).toBe(400);
    expect(asked.length).toBe(before);
  });

  it('answers only GET', async () => {
    const posted = await fetch(`${base}/api/internal/tenants/${TENANT}/accounts`, {
      method: 'POST',
      headers: { 'x-internal-token': TOKEN },
    });
    expect(posted.status).toBe(405);
  });
});
