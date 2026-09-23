import type { IncomingMessage, ServerResponse } from 'node:http';
import type * as z from 'zod';
import { presentsInternalToken } from '@kithena/auth-kit';
import type { AccountsPage } from '@kithena/contracts';

/**
 * A tenant's accounts, a page at a time: `GET /api/internal/tenants/<id>/accounts`.
 *
 * §8.2, "People is bought later": People asks for every account the tenant
 * already has and creates a provisional person for each. The shape is
 * `AccountsPage` in `@kithena/contracts`, which People parses with — neither
 * side owns it, so neither can change it alone.
 *
 * Behind the internal token like every `/api/internal/` route, and returns
 * only what provisioning needs: no mobile number, no status, no identity id.
 */
const PATH = /^\/api\/internal\/tenants\/([^/]+)\/accounts$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Enough that a tenant of a few thousand is a handful of requests. */
export const PAGE_SIZE = 500;

export interface DirectoryAccountRow {
  readonly id: string;
  readonly workEmail: string;
  readonly timeZone: string;
  readonly employmentStart: string;
  readonly givenName: string | null;
  readonly familyName: string | null;
  readonly preferredName: string | null;
}

export interface DirectoryRoutesDeps {
  readonly internalToken: string;
  /** `PAGE_SIZE` unless a test wants to see a second page without 501 accounts. */
  readonly pageSize?: number;
  /** One page after `after`, inside a transaction scoped to `tenantId`. */
  readonly page: (
    tenantId: string,
    after: string | null,
    limit: number,
  ) => Promise<readonly DirectoryAccountRow[]>;
}

export function directoryRoutes({ internalToken, page, pageSize = PAGE_SIZE }: DirectoryRoutesDeps) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const url = new URL(request.url ?? '/', 'http://identity');
    const match = PATH.exec(url.pathname);
    if (!match) return false;

    if (request.method !== 'GET') {
      response.writeHead(405, { allow: 'GET' }).end();
      return true;
    }
    if (!presentsInternalToken(request, internalToken)) {
      response.writeHead(401).end();
      return true;
    }

    const tenantId = match[1] ?? '';
    const cursor = url.searchParams.get('cursor');
    // Checked before a query, because `::uuid` on anything else is a 500.
    if (!UUID.test(tenantId) || (cursor !== null && !UUID.test(cursor))) {
      response.writeHead(400).end();
      return true;
    }

    // One more than a page, so a full last page does not promise another.
    const rows = await page(tenantId, cursor, pageSize + 1);
    const shown = rows.slice(0, pageSize);
    const body: z.input<typeof AccountsPage> = {
      accounts: shown.map((row) => ({
        accountId: row.id,
        workEmail: row.workEmail,
        timeZone: row.timeZone,
        employmentStart: row.employmentStart,
        // Both halves or none, as the account's own check constraint keeps them.
        name:
          row.givenName !== null && row.familyName !== null
            ? { given: row.givenName, family: row.familyName, preferred: row.preferredName }
            : null,
      })),
      nextCursor: rows.length > pageSize ? (shown.at(-1)?.id ?? null) : null,
    };

    response
      .writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end(JSON.stringify(body));
    return true;
  };
}
