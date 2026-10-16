import { logger } from '@kithena/telemetry';

import type { Chat } from '../application/ports.js';

/**
 * Slack (PRD §26.3, REC-137), through Kithena's one Slack app, which
 * `platform/slack` owns: the company adds Kithena to Slack once, and the Slack
 * service keeps the workspace's token. Recruiting reaches it over internal
 * HTTP with the pair's one secret (`SLACK_RECRUITING_TOKEN`), as Time Off
 * does; an Approve pressed comes back to Recruiting's relay with the same.
 *
 * **Off without `SLACK_URL` and `SLACK_RECRUITING_TOKEN`.**
 */
export function chatFrom(env: NodeJS.ProcessEnv, http: typeof fetch = fetch): Chat | undefined {
  const url = (env['SLACK_URL'] ?? '').replace(/\/$/u, '');
  const token = env['SLACK_RECRUITING_TOKEN'] ?? '';
  if (url === '' || token === '') return undefined;
  return {
    token,
    appBase: env['TENANT_APP_BASE'] || 'https://{slug}.app.kithena.com',
    async send(tenantId, message) {
      const response = await http(`${url}/internal/recruiting/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-token': token },
        body: JSON.stringify({
          tenantId,
          ...message.to,
          text: message.text,
          ...(message.approve === undefined ? {} : { approve: message.approve }),
          links: message.links ?? [],
        }),
        signal: AbortSignal.timeout(10_000),
      }).catch((e: unknown) => {
        logger.warn({ module: 'recruiting', err: String(e) }, 'Slack was not reached');
        return null;
      });
      if (response !== null && !response.ok) {
        const answer = (await response.json().catch(() => ({}))) as { sent?: string };
        logger.warn(
          { module: 'recruiting', status: response.status, sent: answer.sent },
          'Slack did not send a Recruiting message',
        );
      }
    },
  };
}
