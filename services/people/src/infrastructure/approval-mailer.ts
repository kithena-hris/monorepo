import { logger } from '@kithena/telemetry';

import { chatNotifierFrom, quietly, type ChatNotice, type ChatNotifier } from './chat-notifier.js';
import type { TenantReads } from './chat-notifier.js';
import type { ReminderCompany } from '../application/completeness/reminders.js';

/**
 * The emails of a change held for approval (PEO-077), through
 * `platform/messaging` over internal HTTP, as the reminder and the webhook
 * alert go.
 *
 * What crosses the wire is an address, the company's name, a link to the
 * approvals inbox on the company's own origin and the kind of notice — never
 * the person, the field or the value, which the recipient reads signed in.
 * `dedupeKey` makes a retried activity one email, not two.
 */
export type ApprovalNotice =
  | { readonly kind: 'approval_requested' }
  | { readonly kind: 'approval_decided'; readonly decision: 'approved' | 'rejected' }
  | { readonly kind: 'approval_expired' }
  /** A review of the identifier they gave found errors: correct it on your profile (PEO-125). */
  | { readonly kind: 'correction_requested' };

export interface ApprovalMailer {
  send(
    tenantId: string,
    company: ReminderCompany,
    email: string,
    notice: ApprovalNotice,
    dedupeKey: string,
  ): Promise<void>;
}

/** Where the button goes: the changes in Review, on the company's own origin. */
export const inboxUrl = (origin: string): string => new URL('/people/review/waiting?kind=changes', origin).toString();

/** A correction is made on one's own profile, not in the inbox. */
export const urlFor = (notice: ApprovalNotice, origin: string): string =>
  notice.kind === 'correction_requested'
    ? new URL('/people/me', origin).toString()
    : inboxUrl(origin);

export function httpApprovalMailer(config: {
  readonly baseUrl: string;
  readonly token: string;
  readonly timeoutMs?: number;
}): ApprovalMailer {
  const endpoint = new URL('/api/internal/messaging/notice', config.baseUrl).toString();
  return {
    async send(tenantId, company, email, notice, dedupeKey) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-token': config.token },
        body: JSON.stringify({
          tenantId,
          email,
          url: urlFor(notice, company.origin),
          companyName: company.name,
          dedupeKey,
          notice,
        }),
        signal: AbortSignal.timeout(config.timeoutMs ?? 5000),
      });
      if (!response.ok) {
        throw new Error(`messaging refused the approval notice: ${String(response.status)}`);
      }
    },
  };
}

/** Configured by `MESSAGING_URL` and `MESSAGING_PEOPLE_TOKEN`; otherwise the events are the only notice. */
export function approvalMailerFrom(
  env: NodeJS.ProcessEnv,
  inTenant: TenantReads,
): ApprovalMailer | undefined {
  const baseUrl = env['MESSAGING_URL'];
  const token = env['MESSAGING_PEOPLE_TOKEN'];
  const mailer = !baseUrl || !token ? undefined : httpApprovalMailer({ baseUrl, token });
  if (mailer === undefined) {
    logger.info('MESSAGING_URL or MESSAGING_PEOPLE_TOKEN unset; approval changes not emailed');
  }
  // And in chat apps, where the company switched it on (`chat-notifier.ts`).
  return approvalWithChat(mailer, chatNotifierFrom(env, inTenant), urlFor);
}

/** An approval mailer that also tells the chat apps (`chat-notifier.ts`). */
export function approvalWithChat(
  mailer: ApprovalMailer | undefined,
  notify: ChatNotifier | undefined,
  url: (notice: ApprovalNotice, origin: string) => string,
): ApprovalMailer | undefined {
  if (notify === undefined) return mailer;
  return {
    async send(tenantId, company, email, notice, dedupeKey) {
      const chat: ChatNotice = {
        event: notice.kind,
        email,
        url: url(notice, company.origin),
        ...(notice.kind === 'approval_decided' ? { decision: notice.decision } : {}),
      };
      if (mailer === undefined) return notify(tenantId, chat);
      await Promise.all([
        mailer.send(tenantId, company, email, notice, dedupeKey),
        quietly(notify, tenantId, chat),
      ]);
    },
  };
}
