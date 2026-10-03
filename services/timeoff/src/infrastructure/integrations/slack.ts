import { createHmac, timingSafeEqual } from 'node:crypto';

import type { ChatPort, Integration, ProviderAnswer } from '../../application/ports.js';
import type { Sealer } from './seal.js';

/**
 * Slack (TOF-111), the first chat app behind `ChatPort`, by one Slack app of
 * Kithena's that each company installs to its workspace.
 *
 * Documented APIs only (https://api.slack.com/methods):
 * - install: OAuth v2 (`/oauth/v2/authorize`, `oauth.v2.access`), bot scopes
 *   to look a member up by address and message them, and the user scope
 *   `users.profile:write`, because a status is the person's to set — the
 *   installing person's own grant comes back with the company's;
 * - `users.lookupByEmail` and `chat.postMessage` to the user's id, which is
 *   the app's direct message, with Block Kit buttons carrying Time Off's
 *   signed values;
 * - `users.profile.set` with `status_expiration`, so Slack clears it;
 * - a press arrives on the app's interactivity URL, form-encoded, signed with
 *   the app's signing secret (`v0=` HMAC-SHA256 of `v0:<timestamp>:<body>`,
 *   refused when older than five minutes), and is answered in its
 *   conversation through its `response_url`.
 *
 * Tokens are sealed before they leave the adapter and opened only here.
 * **Inert without credentials**: the client id, client secret, signing
 * secret and `TIMEOFF_INTEGRATION_KEY` all set, or it is not configured and
 * calls nothing.
 */

const API = 'https://slack.com/api';
const BOT_SCOPES = ['chat:write', 'users:read', 'users:read.email', 'im:write'];
const USER_SCOPES = ['users.profile:write'];
const STALE_SECONDS = 300;

export interface SlackOptions {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

interface SlackAnswer {
  readonly ok: boolean;
  readonly error?: string;
}

export function slackChat(
  env: NodeJS.ProcessEnv,
  sealer: Sealer | null,
  options: SlackOptions = {},
): ChatPort {
  const http = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const clientId = env['TIMEOFF_SLACK_CLIENT_ID'] ?? '';
  const clientSecret = env['TIMEOFF_SLACK_CLIENT_SECRET'] ?? '';
  const signingSecret = env['TIMEOFF_SLACK_SIGNING_SECRET'] ?? '';
  const configured =
    clientId !== '' && clientSecret !== '' && signingSecret !== '' && sealer !== null;

  const open = (sealed: string | null): string => {
    if (sealer === null || sealed === null) throw new Error('Slack is not configured');
    return sealer.open(sealed);
  };

  async function call<T extends SlackAnswer>(
    method: string,
    token: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const answer = await http(`${API}/${method}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
    });
    const json = (await answer.json()) as T;
    if (!json.ok)
      throw new Error(`Slack ${method} refused: ${json.error ?? String(answer.status)}`);
    return json;
  }

  return {
    provider: 'slack',
    configured,

    connectUrl: (state, redirectUri, forMember = false) =>
      `https://slack.com/oauth/v2/authorize?${new URLSearchParams({
        client_id: clientId,
        // A member grants their own status only; the bot is the company's install.
        scope: forMember ? '' : BOT_SCOPES.join(','),
        user_scope: USER_SCOPES.join(','),
        redirect_uri: redirectUri,
        state,
      }).toString()}`,

    async complete(answer: ProviderAnswer, redirectUri: string) {
      if (sealer === null) throw new Error('Slack is not configured');
      const code = answer['code'];
      if (code === undefined) throw new Error('Slack sent no code');
      const response = await http(`${API}/oauth.v2.access`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        },
        body: new URLSearchParams({ code, redirect_uri: redirectUri }).toString(),
      });
      const json = (await response.json()) as SlackAnswer & {
        access_token?: string;
        team?: { id: string; name: string };
        authed_user?: { access_token?: string };
      };
      const user = json.authed_user?.access_token;
      if (!json.ok || json.team === undefined || (json.access_token ?? user) === undefined) {
        throw new Error(`Slack refused the install: ${json.error ?? 'no token'}`);
      }
      return {
        config: { team: json.team.id, name: json.team.name },
        // Absent when only a member's own grant was asked for.
        secret: json.access_token === undefined ? null : sealer.seal(json.access_token),
        memberSecret: user === undefined ? null : sealer.seal(user),
      };
    },

    async setStatus(_integration: Integration, memberSecret, status) {
      await call('users.profile.set', open(memberSecret), {
        profile: {
          status_text: status.text,
          status_emoji: ':palm_tree:',
          status_expiration: Math.floor(Date.parse(status.until) / 1000),
        },
      });
    },

    async askApproval(integration, message) {
      const bot = open(integration.secret);
      const found = await http(
        `${API}/users.lookupByEmail?${new URLSearchParams({ email: message.email }).toString()}`,
        { headers: { authorization: `Bearer ${bot}` } },
      );
      const lookup = (await found.json()) as SlackAnswer & { user?: { id: string } };
      if (!lookup.ok || lookup.user === undefined) {
        throw new Error(`Slack has nobody at that address: ${lookup.error ?? 'not found'}`);
      }
      await call('chat.postMessage', bot, {
        channel: lookup.user.id,
        text: message.text,
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: message.text } },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                action_id: 'timeoff_approve',
                style: 'primary',
                text: { type: 'plain_text', text: 'Approve' },
                value: message.approve,
              },
              {
                type: 'button',
                action_id: 'timeoff_decline',
                style: 'danger',
                text: { type: 'plain_text', text: 'Decline' },
                value: message.decline,
              },
            ],
          },
        ],
      });
    },

    action(request) {
      if (!configured) return null;
      const header = (name: string): string => {
        const v = request.headers[name];
        return typeof v === 'string' ? v : '';
      };
      const timestamp = Number(header('x-slack-request-timestamp'));
      if (!Number.isFinite(timestamp) || Math.abs(now() / 1000 - timestamp) > STALE_SECONDS) {
        return null;
      }
      const expected = Buffer.from(
        `v0=${createHmac('sha256', signingSecret)
          .update(`v0:${String(timestamp)}:${request.body}`)
          .digest('hex')}`,
      );
      const given = Buffer.from(header('x-slack-signature'));
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
      try {
        const payload = JSON.parse(new URLSearchParams(request.body).get('payload') ?? '') as {
          type?: string;
          actions?: { value?: string }[];
          response_url?: string;
        };
        const value = payload.actions?.[0]?.value;
        if (payload.type !== 'block_actions' || value === undefined) return null;
        const responseUrl = payload.response_url;
        return {
          value,
          reply: async (text: string) => {
            if (responseUrl === undefined || !responseUrl.startsWith('https://hooks.slack.com/'))
              return;
            await http(responseUrl, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ replace_original: true, text }),
            });
          },
        };
      } catch {
        return null;
      }
    },
  };
}
