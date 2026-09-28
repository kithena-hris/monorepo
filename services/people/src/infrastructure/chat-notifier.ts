import { logger } from '@kithena/telemetry';

import type { ReminderMailer } from '../application/completeness/reminders.js';
import { drizzleChatNotices } from './drizzle-chat-notices.js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

/**
 * The same notices, in the company's chat apps (Slack today) as well as by
 * email, where the company switched each one on.
 *
 * Handed to each chat app's service over internal HTTP, which decides the
 * rest: whether the company connected it, and who the email is there. What
 * crosses the wire is what the email
 * carries — an address, the kind of notice and a link — never a field or a
 * value; the message reads what it shows from People as its reader, when it is
 * drawn or a button is pressed.
 *
 * Email stays the notice of record: a Slack that is down or not connected
 * changes nothing about the email, and a failed email still fails as before.
 */

/** Every notice People sends to chat apps. `application/settings/chat.ts` lists the same, with words. */
export type ChatEvent =
  | 'approval_requested'
  | 'approval_decided'
  | 'approval_expired'
  | 'correction_requested'
  | 'details_requested'
  | 'profile_reminder';

export interface ChatNotice {
  readonly event: ChatEvent;
  readonly email: string;
  /** Where the notice's "Open in Kithena" goes, on the company's own origin. */
  readonly url: string;
  readonly decision?: 'approved' | 'rejected';
  /** How many details it is about. */
  readonly count?: number;
}

/** A read in one tenant's transaction: `InTenantTransaction`, or the service's `inTenant`. */
export type TenantReads = <T>(
  tenantId: string,
  fn: (scope: { readonly tx: PostgresJsDatabase }) => Promise<T>,
) => Promise<T>;

export type ChatNotifier = (tenantId: string, notice: ChatNotice) => Promise<void>;

/**
 * Sends a notice to every chat app the deployment has, when the company
 * switched that notice on (`people.chat_notice`). A notice switched off is not
 * sent and is not a failure.
 */
export function httpChatNotifier(config: {
  readonly endpoints: readonly { readonly url: string; readonly token: string }[];
  readonly enabled: (tenantId: string) => Promise<ReadonlySet<string>>;
}): ChatNotifier {
  return async (tenantId, notice) => {
    if (!(await config.enabled(tenantId)).has(notice.event)) return;
    const sent = await Promise.allSettled(
      config.endpoints.map(async ({ url, token }) => {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-internal-token': token },
          body: JSON.stringify({ tenantId, ...notice }),
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error(`a chat app refused the notice: ${String(response.status)}`);
      }),
    );
    const failed = sent.find((s) => s.status === 'rejected');
    if (failed !== undefined) throw failed.reason;
  };
}

/** Every chat app configured (`SLACK_URL` and `SLACK_PEOPLE_TOKEN` today); none, email only. */
export function chatNotifierFrom(
  env: NodeJS.ProcessEnv,
  inTenant: TenantReads,
): ChatNotifier | undefined {
  const endpoints: { url: string; token: string }[] = [];
  const slack = env['SLACK_URL'];
  const token = env['SLACK_PEOPLE_TOKEN'];
  if (slack && token) endpoints.push({ url: new URL('/internal/notify', slack).toString(), token });
  if (endpoints.length === 0) return undefined;
  const notices = drizzleChatNotices();
  return httpChatNotifier({
    endpoints,
    enabled: (tenantId) => inTenant(tenantId, ({ tx }) => notices.enabled(tx, tenantId)),
  });
}

/** Tell the chat apps, and never let their answer decide anything. */
export const quietly = (notify: ChatNotifier, tenantId: string, notice: ChatNotice): Promise<void> =>
  notify(tenantId, notice).catch((error: unknown) => {
    logger.warn({ err: error, event: notice.event }, 'slack notice not sent');
  });

/**
 * A reminder mailer that also tells the chat apps. With no email configured
 * the chat notice is the only one, and its failure is the send's failure.
 */
export function reminderWithChat(
  mailer: ReminderMailer | undefined,
  notify: ChatNotifier | undefined,
  event: 'details_requested' | 'profile_reminder',
  url: (origin: string) => string,
): ReminderMailer | undefined {
  if (notify === undefined) return mailer;
  return {
    async send(tenantId, company, reminder) {
      const notice = {
        event,
        email: reminder.workEmail,
        url: url(company.origin),
        count: reminder.keys.length,
      };
      if (mailer === undefined) return notify(tenantId, notice);
      await Promise.all([mailer.send(tenantId, company, reminder), quietly(notify, tenantId, notice)]);
    },
  };
}
