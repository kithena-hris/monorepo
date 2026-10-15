import type { IncomingMessage, ServerResponse } from 'node:http';
import * as z from 'zod';
import { presentsInternalToken } from '@kithena/auth-kit';

import { readJsonBody } from '../../shared/http.js';
import type { SendCorrespondence } from '../application/send-correspondence.js';
import { STATUS, refusalOf } from './messaging-routes.js';

/**
 * `POST /api/internal/messaging/correspondence` — a module sending an email
 * it wrote (Recruiting's candidate thread). Its own secret,
 * `MESSAGING_RECRUITING_TOKEN`: a leak from People cannot write to a
 * candidate. Absent, every request is refused.
 */
const CORRESPONDENCE = '/api/internal/messaging/correspondence';

const Request = z.object({
  tenantId: z.uuid(),
  to: z.string().min(3).max(320),
  subject: z.string().min(1).max(300),
  text: z.string().min(1).max(20_000),
  replyTo: z.string().min(3).max(320).nullable(),
  companyName: z.string().min(1).max(120).default('Kithena'),
  dedupeKey: z.string().min(1).max(200),
});

export function correspondenceRoutes({
  send,
  internalToken,
}: {
  readonly send: SendCorrespondence;
  readonly internalToken: string;
}) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    if ((request.url ?? '').split('?')[0] !== CORRESPONDENCE) return false;
    const json = (status: number, body: unknown): true => {
      response
        .writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(JSON.stringify(body));
      return true;
    };
    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'POST' }).end();
      return true;
    }
    if (!presentsInternalToken(request, internalToken)) {
      response.writeHead(401).end();
      return true;
    }
    const body = await readJsonBody(request, 64_000);
    if (body === null) return json(400, { code: 'MALFORMED_BODY' });
    const parsed = Request.safeParse(body);
    if (!parsed.success)
      return json(422, {
        code: 'MALFORMED_REQUEST',
        fields: parsed.error.issues.map((i) => i.path.join('.')),
      });
    const sent = await send(parsed.data);
    if (!sent.ok) {
      const reason = refusalOf(sent.error.path?.[0]);
      return json(STATUS[reason], { code: sent.error.code, reason });
    }
    return json(202, { messageId: sent.value.messageId });
  };
}
