import type { IncomingMessage, ServerResponse } from 'node:http';
import * as z from 'zod';

import type { InviteAccount } from '../application/invite-account.js';
import { presentsInternalToken, readJsonBody } from '../../shared/internal-token.js';

/**
 * People inviting a hire into their company (People PRD §8.2, step 8):
 * `POST /api/internal/tenants/<id>/invitations`.
 *
 * The same invitation the back office sends — one account, one single-use
 * link, the email — commissioned `via: people_module`, with People's own token
 * as the sign-up question report has. People sends what the sign-up page shows
 * already filled in: the name on file and its answers to the tenant's own
 * questions. The second channel is a known value: the hire signed their
 * contract after a code sent to this very address.
 *
 * The link stays here. People learns the account and when the link runs out,
 * never the link itself.
 */
const PATH =
  /^\/api\/internal\/tenants\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/invitations$/i;

const Body = z.strictObject({
  email: z.email().max(254),
  employmentStart: z.string().max(10).optional(),
  timeZone: z.string().max(64).optional(),
  name: z
    .strictObject({
      given: z.string().trim().min(1).max(100),
      family: z.string().trim().min(1).max(100),
      preferred: z.string().trim().max(100).nullable(),
    })
    .nullable()
    .default(null),
  answers: z.record(z.string().max(80), z.string().max(500)).default({}),
});

export function peopleInvitationRoutes({
  token,
  invite,
}: {
  readonly token: string;
  readonly invite: InviteAccount;
}) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const match = PATH.exec((request.url ?? '').split('?')[0] ?? '');
    if (!match) return false;
    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'POST' }).end();
      return true;
    }
    if (!presentsInternalToken(request, token)) {
      response.writeHead(401).end();
      return true;
    }
    const body = Body.safeParse(await readJsonBody(request, 64 * 1024));
    if (!body.success) {
      response.writeHead(400).end();
      return true;
    }
    const invited = await invite({
      tenantId: match[1] ?? '',
      email: body.data.email,
      issuedBy: null,
      employmentStart: body.data.employmentStart,
      timeZone: body.data.timeZone,
      secondChannel: 'known_value',
      via: 'people_module',
      prefill: { name: body.data.name, answers: body.data.answers },
    });
    const json = (status: number, value: unknown) => {
      response
        .writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(JSON.stringify(value));
      return true;
    };
    if (!invited.ok) return json(422, { code: invited.error.code, message: invited.error.message });
    return json(201, {
      accountId: invited.value.accountId,
      expiresAt: invited.value.expiresAt,
      delivery: invited.value.delivery,
    });
  };
}
