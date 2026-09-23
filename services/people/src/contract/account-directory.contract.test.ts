import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type * as z from 'zod';
import { AccountsPage } from '@kithena/contracts';

import { httpAccountDirectory } from '../infrastructure/consumers/identity.js';

/**
 * People's half of the account-listing contract (PEO-081).
 *
 * Identity serves `GET /api/internal/tenants/<id>/accounts`; this client reads
 * it. The two may not import each other, so both are pinned to `AccountsPage`
 * in `@kithena/contracts`: identity's route test parses everything it sends
 * with that schema, and this one serves only bodies that schema accepts and
 * checks the client reads every account out of them.
 */

const TENANT = '00000000-0000-4000-8000-00000000000a';
const TOKEN = 'people-identity-secret';

const pages: z.input<typeof AccountsPage>[] = [
  {
    accounts: [
      {
        accountId: '00000000-0000-4000-8000-0000000000a1',
        workEmail: 'ada@acme.test',
        timeZone: 'Europe/Madrid',
        employmentStart: '2026-01-01',
        name: { given: 'Ada', family: 'Lovelace', preferred: null },
      },
    ],
    nextCursor: '00000000-0000-4000-8000-0000000000a1',
  },
  {
    accounts: [
      {
        accountId: '00000000-0000-4000-8000-0000000000a2',
        workEmail: 'grace@acme.test',
        timeZone: 'Europe/Madrid',
        employmentStart: '2026-04-01',
        name: null,
      },
    ],
    nextCursor: null,
  },
];

let server: Server;
let base: string;
let served: unknown = null;

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.headers['x-internal-token'] !== TOKEN) {
      response.writeHead(401).end();
      return;
    }
    const url = new URL(request.url ?? '/', 'http://identity');
    if (url.pathname !== `/api/internal/tenants/${TENANT}/accounts`) {
      response.writeHead(404).end();
      return;
    }
    const body = served ?? (url.searchParams.get('cursor') === null ? pages[0] : pages[1]);
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function all(token = TOKEN) {
  const seen = [];
  for await (const account of httpAccountDirectory({ baseUrl: base, internalToken: token }).accounts(
    TENANT,
  )) {
    seen.push(account);
  }
  return seen;
}

describe('reading identity’s account listing', () => {
  it('serves only bodies the shared schema accepts', () => {
    for (const page of pages) expect(AccountsPage.safeParse(page).success).toBe(true);
  });

  it('reads every account across pages, presenting the internal token', async () => {
    served = null;
    const seen = await all();
    expect(seen.map((a) => a.accountId)).toEqual([
      '00000000-0000-4000-8000-0000000000a1',
      '00000000-0000-4000-8000-0000000000a2',
    ]);
    expect(seen[0]?.name).toEqual({ given: 'Ada', family: 'Lovelace', preferred: null });
  });

  it('is refused without the right token, and says so rather than seeing an empty tenant', async () => {
    await expect(all('wrong')).rejects.toThrow('401');
  });

  it('refuses a body the schema does not accept', async () => {
    served = { accounts: [{ accountId: 'not-a-uuid' }], nextCursor: null };
    await expect(all()).rejects.toThrow();
    served = null;
  });
});
