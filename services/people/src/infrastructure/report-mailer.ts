import { logger } from '@kithena/telemetry';

import type { ReportMailer } from '../application/reports/scheduled.js';
import type { SummaryMailer } from '../application/screens/what-changed.js';

/**
 * A scheduled report's email (PEO-069), through `platform/messaging` over
 * internal HTTP — the reminder mailer's endpoint and secret, a notice of its
 * own kind. What crosses the wire is the address, the company's name, the
 * cadence, the format and a link to the tenant app. Never the schedule's
 * name, who it is about, a number, or a file.
 */
export function httpReportMailer(config: {
  readonly baseUrl: string;
  readonly token: string;
  readonly timeoutMs?: number;
}): ReportMailer {
  const endpoint = new URL('/api/internal/messaging/notice', config.baseUrl).toString();
  return {
    async send(tenantId, company, mail) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-token': config.token },
        body: JSON.stringify({
          tenantId,
          email: mail.email,
          url: mail.url,
          companyName: company.name,
          dedupeKey: mail.dedupeKey,
          notice: { kind: 'scheduled_report', cadence: mail.cadence, format: mail.format },
        }),
        signal: AbortSignal.timeout(config.timeoutMs ?? 5000),
      });
      if (!response.ok) {
        throw new Error(`messaging refused the report email: ${String(response.status)}`);
      }
    },
  };
}

/**
 * A summary sent from Insights (design AI6, MA5): its own notice kind, the
 * same endpoint and secret. What crosses is the address, the company's name
 * and a link to the summary on the tenant app — never a figure, a sentence of
 * it, or who sent it.
 */
export function httpSummaryMailer(config: {
  readonly baseUrl: string;
  readonly token: string;
  readonly timeoutMs?: number;
}): SummaryMailer {
  const endpoint = new URL('/api/internal/messaging/notice', config.baseUrl).toString();
  return {
    async send(tenantId, company, mail) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-token': config.token },
        body: JSON.stringify({
          tenantId,
          email: mail.email,
          url: mail.url,
          companyName: company.name,
          dedupeKey: mail.dedupeKey,
          notice: { kind: 'summary_shared' },
        }),
        signal: AbortSignal.timeout(config.timeoutMs ?? 5000),
      });
      if (!response.ok) {
        throw new Error(`messaging refused the summary email: ${String(response.status)}`);
      }
    },
  };
}

/** The summary mailer when messaging is configured, as for reports; else none. */
export function summaryMailerFrom(env: NodeJS.ProcessEnv): SummaryMailer | undefined {
  const baseUrl = env['MESSAGING_URL'];
  const token = env['MESSAGING_PEOPLE_TOKEN'];
  return baseUrl && token ? httpSummaryMailer({ baseUrl, token }) : undefined;
}

/** The mailer when `MESSAGING_URL` and `MESSAGING_PEOPLE_TOKEN` are set; else nothing, said once. */
export function reportMailerFrom(env: NodeJS.ProcessEnv): ReportMailer | undefined {
  const baseUrl = env['MESSAGING_URL'];
  const token = env['MESSAGING_PEOPLE_TOKEN'];
  if (!baseUrl || !token) {
    logger.info('MESSAGING_URL or MESSAGING_PEOPLE_TOKEN unset; no scheduled report emails');
    return undefined;
  }
  return httpReportMailer({ baseUrl, token });
}
