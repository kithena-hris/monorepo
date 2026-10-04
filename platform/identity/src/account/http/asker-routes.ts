import type { IncomingMessage, ServerResponse } from 'node:http';
import * as z from 'zod';
import type { AssistantAsker, ModuleEntitlement } from '@kithena/contracts';

import { presentsInternalToken, readJsonBody } from '../../shared/internal-token.js';

/**
 * Who is asking the assistant: `POST /api/internal/tenants/<id>/assistant/asker`,
 * body `{ email }` or `{ accountId }` (assistant PRD §6.6, §10.1, §17 Phase 3).
 *
 * Slack knows a verified work email and nothing of Kithena; identity owns
 * accounts, so it turns that email into the one active account with it in
 * this tenant — its id, its time zone, the tenant's slug and its modules
 * (the recorded list, else the deployment's, as for `ent`). The web arrives
 * through the router already signed in, so it names the account itself, and
 * gets the same answer for it while it is active. Anything else is a 404 that
 * says nothing: nobody, several, or somebody whose access ended read the
 * same, so the route cannot be used to learn which.
 *
 * Behind `ASSISTANT_IDENTITY_TOKEN` alone: the assistant's pair secret, not
 * the shared internal one, and with none configured every caller is refused.
 * The shape is `AssistantAsker` in contracts, which the assistant parses with.
 */
const PATH = /^\/api\/internal\/tenants\/([^/]+)\/assistant\/asker$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const Body = z.union([
  z.strictObject({ email: z.email().max(320) }),
  z.strictObject({ accountId: z.uuid() }),
]);

/** Whom to find: a verified work email (a chat app), or a signed-in account (the web). */
export type AskerKey = z.infer<typeof Body>;

export interface AskerAccountRow {
  readonly id: string;
  readonly timeZone: string;
}

export interface AskerRoutesDeps {
  /** `ASSISTANT_IDENTITY_TOKEN`; empty refuses everyone. */
  readonly internalToken: string;
  /** Active accounts with this work email (members) or this id in the tenant: two are enough to refuse. */
  readonly accounts: (tenantId: string, who: AskerKey) => Promise<readonly AskerAccountRow[]>;
  /** The tenant's slug and its modules; null for a tenant there is not. */
  readonly tenant: (tenantId: string) => Promise<{
    readonly slug: string;
    readonly entitlements: readonly ModuleEntitlement[];
  } | null>;
}

export function askerRoutes({ internalToken, accounts, tenant }: AskerRoutesDeps) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const match = PATH.exec(new URL(request.url ?? '/', 'http://identity').pathname);
    if (!match) return false;

    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'POST' }).end();
      return true;
    }
    if (!presentsInternalToken(request, internalToken)) {
      response.writeHead(401).end();
      return true;
    }
    const tenantId = match[1] ?? '';
    const body = Body.safeParse(await readJsonBody(request, 4096));
    if (!UUID.test(tenantId) || !body.success) {
      response.writeHead(400).end();
      return true;
    }

    const found = await accounts(tenantId, body.data);
    const company = found.length === 1 ? await tenant(tenantId) : null;
    const account = found[0];
    if (company === null || account === undefined) {
      response.writeHead(404, { 'cache-control': 'no-store' }).end();
      return true;
    }
    const answer: z.input<typeof AssistantAsker> = {
      accountId: account.id,
      timeZone: account.timeZone,
      slug: company.slug,
      entitlements: [...company.entitlements],
    };
    response
      .writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end(JSON.stringify(answer));
    return true;
  };
}
