import { logger } from '@kithena/telemetry';

import type { ReminderCompany } from '../../application/completeness/reminders.js';
import type { DisabledEndpoint } from './webhooks.js';

/**
 * The email a tenant gets when one of its webhook endpoints is disabled
 * (PEO-093), through `platform/messaging` over internal HTTP.
 *
 * To the endpoint's alert address — the person or list the admin who set it
 * up named for exactly this. Only the receiver's host crosses the wire: a
 * path or query can carry the receiver's own token, and an email is forwarded.
 */
export interface WebhookAlertMailer {
  send(tenantId: string, company: ReminderCompany, disabled: DisabledEndpoint): Promise<void>;
}

export interface WebhookAlertConfig {
  readonly baseUrl: string;
  readonly token: string;
  readonly timeoutMs?: number;
}

export function httpWebhookAlertMailer(config: WebhookAlertConfig): WebhookAlertMailer {
  const endpoint = new URL('/api/internal/messaging/notice', config.baseUrl).toString();

  return {
    async send(tenantId, company, disabled) {
      if (disabled.alertEmail === null) return;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-token': config.token },
        body: JSON.stringify({
          tenantId,
          email: disabled.alertEmail,
          // People on the company's own origin, and the company by name.
          url: new URL('/people', company.origin).toString(),
          companyName: company.name,
          // One disable is one email, however often this is retried.
          dedupeKey: `webhook-disabled/${disabled.endpointId}`,
          notice: { kind: 'webhook_disabled', host: new URL(disabled.url).hostname },
        }),
        signal: AbortSignal.timeout(config.timeoutMs ?? 5000),
      });
      if (!response.ok) {
        throw new Error(`messaging refused the alert: ${String(response.status)}`);
      }
    },
  };
}

/** Configured by `MESSAGING_URL` and `MESSAGING_PEOPLE_TOKEN`; otherwise the event is the only notice. */
export function webhookAlertMailerFrom(env: NodeJS.ProcessEnv): WebhookAlertMailer | undefined {
  const baseUrl = env['MESSAGING_URL'];
  const token = env['MESSAGING_PEOPLE_TOKEN'];
  if (!baseUrl || !token) {
    logger.info('MESSAGING_URL or MESSAGING_PEOPLE_TOKEN unset; webhook alerts not emailed');
    return undefined;
  }
  return httpWebhookAlertMailer({ baseUrl, token });
}
