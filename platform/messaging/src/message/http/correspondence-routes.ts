import type { IncomingMessage, ServerResponse } from 'node:http';
import * as z from 'zod';
import { presentsInternalToken } from '@kithena/auth-kit';

import { readJsonBody } from '../../shared/http.js';
import { pushLine, type Push } from '../application/push.js';
import type { SendCorrespondence } from '../application/send-correspondence.js';
import { STATUS, refusalOf } from './messaging-routes.js';

/**
 * `POST /api/internal/messaging/correspondence` — a module sending an email
 * it wrote (Recruiting's candidate thread, Onboarding's welcome). One secret
 * per module, `MESSAGING_RECRUITING_TOKEN`, `MESSAGING_ONBOARDING_TOKEN` and `MESSAGING_PERFORMANCE_TOKEN`:
 * a leak from People cannot write to a candidate. Absent, every request is
 * refused.
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
  /**
   * The recipient's account, when they are a member of the company: their
   * devices hear of it too, in the same words, if they turned push on.
   */
  accountId: z.uuid().optional(),
  /** Whether it is something to do (shown at once) rather than news. */
  urgent: z.boolean().default(false),
  /** A calendar invitation or a drawn PDF, by kind of file only: at most two, each small. */
  attachments: z
    .array(
      z.object({
        filename: z.string().regex(/^[\w ,.()-]{1,100}\.(ics|pdf)$/u),
        base64: z.base64().max(200_000),
      }),
    )
    .max(2)
    .optional(),
  /** Structure beside the words: times by day, facts, a button. Drawn here; never markup. */
  parts: z
    .object({
      heading: z.string().max(200).nullable().optional(),
      times: z
        .object({
          title: z.string().min(1).max(120),
          days: z
            .array(
              z.object({
                day: z.string().min(1).max(120),
                times: z.array(z.string().min(1).max(120)).min(1).max(24),
              }),
            )
            .max(14),
          note: z.string().max(300).nullable().optional(),
        })
        .nullable()
        .optional(),
      facts: z
        .array(z.object({ label: z.string().max(120), value: z.string().max(500) }))
        .max(8)
        .optional(),
      action: z
        .object({ label: z.string().min(1).max(60), href: z.url().max(2000) })
        .nullable()
        .optional(),
      secondary: z
        .object({ label: z.string().min(1).max(60), href: z.url().max(2000) })
        .nullable()
        .optional(),
      /** What happens next, in order: a numbered list under the facts. */
      steps: z.array(z.string().min(1).max(300)).max(6).optional(),
      /** Small print under the button. */
      note: z.string().max(300).nullable().optional(),
      themeId: z.string().max(40).nullable().optional(),
      logoUrl: z.url().max(2000).nullable().optional(),
    })
    .optional(),
});

export function correspondenceRoutes({
  send,
  internalTokens,
  push,
}: {
  readonly send: SendCorrespondence;
  /** A member's devices; absent, the email alone. */
  readonly push?: Push;
  /** Each sending module's own secret; an empty one opens nothing. */
  readonly internalTokens: readonly string[];
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
    if (!internalTokens.some((token) => token !== '' && presentsInternalToken(request, token))) {
      response.writeHead(401).end();
      return true;
    }
    // Room for an invitation or a short PDF beside the words.
    const body = await readJsonBody(request, 512_000);
    if (body === null) return json(400, { code: 'MALFORMED_BODY' });
    const parsed = Request.safeParse(body);
    if (!parsed.success)
      return json(422, {
        code: 'MALFORMED_REQUEST',
        fields: parsed.error.issues.map((i) => i.path.join('.')),
      });
    const { accountId, urgent, ...asked } = parsed.data;
    // A member hears where to choose what reaches them: their notification settings, on the company's app.
    const origin = (() => {
      try {
        return asked.parts?.action?.href === undefined
          ? null
          : new URL(asked.parts.action.href).origin;
      } catch {
        return null;
      }
    })();
    const sent = await send({
      ...asked,
      ...(accountId === undefined
        ? {}
        : { member: { manageHref: origin === null ? null : `${origin}/settings/notifications` } }),
    });
    if (sent.ok && push !== undefined && accountId !== undefined) {
      await push(asked.tenantId, accountId, {
        title: asked.parts?.heading ?? asked.subject,
        body: pushLine(asked.text),
        url: asked.parts?.action?.href ?? '/inbox',
        tag: asked.dedupeKey,
        urgent,
      }).catch(() => 0);
    }
    if (!sent.ok) {
      const reason = refusalOf(sent.error.path?.[0]);
      return json(STATUS[reason], { code: sent.error.code, reason });
    }
    return json(202, { messageId: sent.value.messageId });
  };
}
