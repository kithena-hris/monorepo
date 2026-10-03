import { logger } from '@kithena/telemetry';

import type { NudgeMailer } from '../application/ports.js';

/**
 * Time Off's nudges, through `platform/messaging` over internal HTTP
 * (TOF-098): `fetch` and a secret of this pair's own, the way identity sends
 * an invitation and People a reminder. What crosses is the address, the
 * company's name, a link on its own origin and the recipient's own words;
 * messaging escapes them, records the outcome and never the words.
 */
export function httpNudgeMailer(config: {
  readonly baseUrl: string;
  readonly token: string;
  readonly timeoutMs?: number;
}): NudgeMailer {
  const endpoint = new URL('/api/internal/messaging/notice', config.baseUrl).toString();
  return {
    async send(tenantId, m) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-token': config.token },
        body: JSON.stringify({
          tenantId,
          email: m.email,
          url: m.url,
          companyName: m.companyName,
          dedupeKey: m.dedupeKey,
          notice: { kind: 'rest_nudge', heading: m.heading, lede: m.lede },
        }),
        signal: AbortSignal.timeout(config.timeoutMs ?? 5000),
      });
      if (!response.ok) throw new Error(`messaging refused the nudge: ${String(response.status)}`);
    },
  };
}

/** The mailer when `MESSAGING_URL` and `MESSAGING_TIMEOFF_TOKEN` are set; else none, said once. */
export function nudgeMailerFrom(env: NodeJS.ProcessEnv): NudgeMailer | undefined {
  const baseUrl = env['MESSAGING_URL'];
  const token = env['MESSAGING_TIMEOFF_TOKEN'];
  if (!baseUrl || !token) {
    logger.info({ module: 'timeoff' }, 'MESSAGING_URL or MESSAGING_TIMEOFF_TOKEN unset; no nudges');
    return undefined;
  }
  return httpNudgeMailer({ baseUrl, token });
}
