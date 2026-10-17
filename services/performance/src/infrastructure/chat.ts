import { createHmac, timingSafeEqual } from 'node:crypto';
import { logger } from '@kithena/telemetry';

import type { Chat, ChatPress } from '../application/ports.js';

/**
 * Slack (PRD §23.2, PRF-164), through Kithena's one Slack app, which
 * `platform/slack` owns: Performance reaches it over internal HTTP with the
 * pair's one secret (`SLACK_PERFORMANCE_TOKEN`), as Recruiting does, and a
 * press comes back to Performance's relay with the same secret.
 *
 * A button's value is sealed here: the press as JSON, and an HMAC over it
 * with a key derived from the pair's secret, so the Slack service can carry it
 * but not make one, and Performance runs only buttons it sent.
 *
 * **Off without `SLACK_URL` and `SLACK_PERFORMANCE_TOKEN`.**
 */
export function chatFrom(env: NodeJS.ProcessEnv, http: typeof fetch = fetch): Chat | undefined {
  const url = (env['SLACK_URL'] ?? '').replace(/\/$/u, '');
  const token = env['SLACK_PERFORMANCE_TOKEN'] ?? '';
  if (url === '' || token === '') return undefined;
  const key = createHmac('sha256', token).update('performance-chat-press').digest();
  const sign = (body: string) => createHmac('sha256', key).update(body).digest('base64url');
  return {
    async send(tenantId, message) {
      const response = await http(`${url}/internal/performance/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-token': token },
        body: JSON.stringify({ tenantId, ...message }),
        signal: AbortSignal.timeout(10_000),
      }).catch((e: unknown) => {
        logger.warn({ module: 'performance', err: String(e) }, 'Slack was not reached');
        return null;
      });
      if (response !== null && !response.ok && response.status !== 404 && response.status !== 409)
        logger.warn({ module: 'performance', status: response.status }, 'Slack did not send');
    },
    seal(press) {
      const body = Buffer.from(JSON.stringify(press)).toString('base64url');
      return `${body}.${sign(body)}`;
    },
    open(value) {
      const dot = value.lastIndexOf('.');
      if (dot <= 0) return null;
      const body = value.slice(0, dot);
      const given = Buffer.from(value.slice(dot + 1));
      const expected = Buffer.from(sign(body));
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
      try {
        return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ChatPress;
      } catch {
        return null;
      }
    },
  };
}
