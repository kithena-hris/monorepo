import { logger } from '@kithena/telemetry';

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

/** Where the button goes: the inbox, on the company's own origin. */
export const inboxUrl = (origin: string): string => new URL('/people/approvals', origin).toString();

/** A correction is made on one's own profile, not in the inbox. */
const urlFor = (notice: ApprovalNotice, origin: string): string =>
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
export function approvalMailerFrom(env: NodeJS.ProcessEnv): ApprovalMailer | undefined {
  const baseUrl = env['MESSAGING_URL'];
  const token = env['MESSAGING_PEOPLE_TOKEN'];
  if (!baseUrl || !token) {
    logger.info('MESSAGING_URL or MESSAGING_PEOPLE_TOKEN unset; approval changes not emailed');
    return undefined;
  }
  return httpApprovalMailer({ baseUrl, token });
}
