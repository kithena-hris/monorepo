import type { IncomingMessage, ServerResponse } from 'node:http';
import * as z from 'zod';
import { presentsInternalToken } from '@kithena/auth-kit';

import { readJsonBody } from '../../shared/http.js';
import type { SendNotice } from '../application/send-notice.js';
import { REPORT_CADENCES, REPORT_FORMATS } from '../domain/notice.js';
import { STATUS, refusalOf } from './messaging-routes.js';

/**
 * `POST /api/internal/messaging/notice` — a module asking for one notice.
 *
 * Its own secret, not identity's: `MESSAGING_PEOPLE_TOKEN` is what People
 * presents, so a leak from People cannot send an invitation and a leak from
 * identity cannot send a notice. Absent, every request is refused.
 */
const NOTICE = '/api/internal/messaging/notice';

const NoticeRequest = z.object({
  tenantId: z.uuid(),
  email: z.string().min(3),
  url: z.string().min(1),
  companyName: z.string().min(1).max(120),
  dedupeKey: z.string().min(1).max(200),
  notice: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('profile_reminder'), missing: z.number().int().min(1).max(1000) }),
    z.object({ kind: z.literal('webhook_disabled'), host: z.string().min(1).max(253) }),
    z.object({
      kind: z.literal('scheduled_report'),
      cadence: z.enum(REPORT_CADENCES),
      format: z.enum(REPORT_FORMATS),
    }),
  ]),
});

export interface NoticeRoutesDeps {
  readonly sendNotice: SendNotice;
  readonly internalToken: string;
}

export function noticeRoutes({ sendNotice, internalToken }: NoticeRoutesDeps) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    if ((request.url ?? '').split('?')[0] !== NOTICE) return false;

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

    const body = await readJsonBody(request);
    if (body === null) return json(400, { code: 'MALFORMED_BODY' });

    const parsed = NoticeRequest.safeParse(body);
    if (!parsed.success) {
      return json(422, {
        code: 'MALFORMED_REQUEST',
        fields: parsed.error.issues.map((issue) => issue.path.join('.')),
      });
    }

    const sent = await sendNotice(parsed.data);
    if (!sent.ok) {
      const reason = refusalOf(sent.error.path?.[0]);
      return json(STATUS[reason], { code: sent.error.code, reason });
    }
    return json(202, { messageId: sent.value.messageId });
  };
}
