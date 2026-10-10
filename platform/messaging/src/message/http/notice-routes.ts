import type { IncomingMessage, ServerResponse } from 'node:http';
import * as z from 'zod';
import { presentsInternalToken } from '@kithena/auth-kit';

import { readJsonBody } from '../../shared/http.js';
import type { SendNotice } from '../application/send-notice.js';
import {
  INBOX_TASK_TOPICS,
  INBOX_UPDATE_TOPICS,
  NUDGE_HEADING_MAX,
  NUDGE_LEDE_MAX,
  REPORT_CADENCES,
  REPORT_FORMATS,
} from '../domain/notice.js';
import type { InboxOutcome, InboxRequest } from '../application/inbox-delivery.js';
import type { Result } from '@kithena/domain-kit';
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
  /** The Inbox's: whose notification settings to follow. */
  accountId: z.uuid().optional(),
  notice: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('inbox_task'), topic: z.enum(INBOX_TASK_TOPICS) }),
    z.object({ kind: z.literal('inbox_update'), topic: z.enum(INBOX_UPDATE_TOPICS) }),
    z.object({ kind: z.literal('profile_reminder'), missing: z.number().int().min(1).max(1000) }),
    z.object({ kind: z.literal('webhook_disabled'), host: z.string().min(1).max(253) }),
    z.object({ kind: z.literal('approval_requested') }),
    z.object({ kind: z.literal('approval_decided'), decision: z.enum(['approved', 'rejected']) }),
    z.object({ kind: z.literal('approval_expired') }),
    z.object({ kind: z.literal('correction_requested') }),
    z.object({ kind: z.literal('export_shared') }),
    z.object({ kind: z.literal('export_share_requested') }),
    z.object({ kind: z.literal('summary_shared') }),
    z.object({
      kind: z.literal('rest_nudge'),
      heading: z.string().min(1).max(NUDGE_HEADING_MAX),
      lede: z.string().min(1).max(NUDGE_LEDE_MAX),
    }),
    z.object({
      kind: z.literal('scheduled_report'),
      cadence: z.enum(REPORT_CADENCES),
      format: z.enum(REPORT_FORMATS),
    }),
  ]),
});

export interface NoticeRoutesDeps {
  readonly sendNotice: SendNotice;
  /** The Inbox's notices, routed by the person's settings; absent, sent as any notice is. */
  readonly deliverInbox?: (request: InboxRequest) => Promise<Result<InboxOutcome>>;
  /** One secret per module that asks: People's, Time Off's. Each empty one matches nothing. */
  readonly internalToken: string | readonly string[];
}

export function noticeRoutes({ sendNotice, deliverInbox, internalToken }: NoticeRoutesDeps) {
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
    if (![internalToken].flat().some((token) => presentsInternalToken(request, token))) {
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

    const { accountId, ...asked } = parsed.data;
    const notice = asked.notice;
    if (
      (notice.kind === 'inbox_task' || notice.kind === 'inbox_update') &&
      deliverInbox !== undefined
    ) {
      const routed = await deliverInbox({
        ...asked,
        notice,
        ...(accountId === undefined ? {} : { accountId }),
      });
      if (!routed.ok) {
        const reason = refusalOf(routed.error.path?.[0]);
        return json(STATUS[reason], { code: routed.error.code, reason });
      }
      return json(202, routed.value);
    }
    const sent = await sendNotice(asked);
    if (!sent.ok) {
      const reason = refusalOf(sent.error.path?.[0]);
      return json(STATUS[reason], { code: sent.error.code, reason });
    }
    return json(202, { messageId: sent.value.messageId });
  };
}
