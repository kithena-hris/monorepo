import { createHash, timingSafeEqual } from 'node:crypto';

import type { ChatPort } from '../../application/ports.js';

/**
 * Slack (TOF-111), through Kithena's one Slack app, which `platform/slack`
 * owns: the company adds Kithena to Slack once, in its settings, and the
 * Slack service keeps the workspace's token and the socket every press
 * arrives on. Time Off reaches it over internal HTTP with the pair's one
 * secret (`SLACK_TIMEOFF_TOKEN`), as People does.
 *
 * - connecting is recorded at once (`connectUrl` is null): the install is the
 *   Slack service's, not Time Off's;
 * - asking an approver is `POST /internal/timeoff/approval` with Time Off's
 *   sentence and its two signed values; the service finds the person by
 *   address and sends the direct message;
 * - a press reaches the Slack service over its socket and is relayed to
 *   `POST /v1/timeoff/integrations/slack/relay` with the same secret, which
 *   `action` checks; that route is internal, never on the public tunnel.
 *
 * **Inert without `SLACK_URL` and `SLACK_TIMEOFF_TOKEN`.**
 */

export interface SlackOptions {
  readonly fetch?: typeof fetch;
}

const NOT_YET = 'A Slack status while away is not available yet';

export function slackThroughService(env: NodeJS.ProcessEnv, options: SlackOptions = {}): ChatPort {
  const http = options.fetch ?? fetch;
  const url = (env['SLACK_URL'] ?? '').replace(/\/$/u, '');
  const token = env['SLACK_TIMEOFF_TOKEN'] ?? '';

  return {
    provider: 'slack',
    configured: url !== '' && token !== '',
    // ponytail: no member status through the shared app — it has no user scope. Needs
    // `users.profile:write` as a user scope on the app and a member grant flow in platform/slack.
    memberGrant: false,

    connectUrl: () => null,

    complete: () => Promise.reject(new Error('Slack is connected in Kithena’s Slack settings')),

    setStatus: () => Promise.reject(new Error(NOT_YET)),

    async askApproval(_integration, message) {
      const response = await http(`${url}/internal/timeoff/approval`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-token': token },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        const answer = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(`Slack did not send it: ${answer.message ?? String(response.status)}`);
      }
    },

    // The service answers the conversation itself, with what the relay returns.
    action(request) {
      const given = request.headers['x-internal-token'];
      if (token === '' || typeof given !== 'string') return null;
      const a = createHash('sha256').update(given).digest();
      const b = createHash('sha256').update(token).digest();
      if (!timingSafeEqual(a, b)) return null;
      try {
        const body = JSON.parse(request.body) as { tenantId?: unknown; value?: unknown };
        if (typeof body.tenantId !== 'string' || typeof body.value !== 'string') return null;
        return { value: body.value, tenantId: body.tenantId, reply: () => Promise.resolve() };
      } catch {
        return null;
      }
    },
  };
}
