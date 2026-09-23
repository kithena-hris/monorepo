import { logger } from '@kithena/telemetry';

import type { ReminderMailer } from '../application/completeness/reminders.js';

/**
 * The reminder email, through `platform/messaging` over internal HTTP
 * (PEO-084).
 *
 * `fetch` and a secret of this pair's own, the way identity sends an
 * invitation. What crosses the wire is the address, the company's name, a
 * count and a link to the person's profile on the company's own origin —
 * never a missing key, which is the tenant's schema and which the person reads
 * signed in, on the page the link opens.
 *
 * A refusal rejects, which is how `sweepReminders` counts a failure. The claim
 * has already committed by then, so that week's reminder is lost rather than
 * sent twice: at most once is the property the cap asks for.
 */
export interface ReminderMailerConfig {
  readonly baseUrl: string;
  readonly token: string;
  readonly timeoutMs?: number;
}

/** Where the button goes: the person's own People area on their company's origin, no id. */
export function profileUrl(origin: string): string {
  return new URL('/people', origin).toString();
}

export function httpReminderMailer(config: ReminderMailerConfig): ReminderMailer {
  const endpoint = new URL('/api/internal/messaging/notice', config.baseUrl).toString();

  return {
    async send(tenantId, company, reminder) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-token': config.token },
        body: JSON.stringify({
          tenantId,
          email: reminder.workEmail,
          url: profileUrl(company.origin),
          companyName: company.name,
          dedupeKey: `${reminder.personId}/${reminder.remindedAt.toISOString()}`,
          notice: { kind: 'profile_reminder', missing: reminder.keys.length },
        }),
        signal: AbortSignal.timeout(config.timeoutMs ?? 5000),
      });
      if (!response.ok) {
        throw new Error(`messaging refused the reminder: ${String(response.status)}`);
      }
    },
  };
}

/** The mailer when `MESSAGING_URL` and `MESSAGING_PEOPLE_TOKEN` are set; else nothing, said once. */
export function reminderMailerFrom(env: NodeJS.ProcessEnv): ReminderMailer | undefined {
  const baseUrl = env['MESSAGING_URL'];
  const token = env['MESSAGING_PEOPLE_TOKEN'];
  if (!baseUrl || !token) {
    logger.info('MESSAGING_URL or MESSAGING_PEOPLE_TOKEN unset; no reminder mailer');
    return undefined;
  }
  return httpReminderMailer({ baseUrl, token });
}
