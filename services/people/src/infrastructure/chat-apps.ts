import type { ChatApp, ChatConnection } from '../application/settings/chat-port.js';

/**
 * The chat apps this deployment has, each a platform service over internal
 * HTTP: Slack (`platform/slack`) when `SLACK_URL` and `SLACK_PEOPLE_TOKEN` are
 * set. Another app is another entry here and another service; nothing about
 * the settings page or the notices changes.
 */

type Answer = { readonly status: number; readonly body: Record<string, unknown> };

function client(baseUrl: string, token: string) {
  return async (method: string, path: string, body?: unknown): Promise<Answer> => {
    const response = await fetch(new URL(path, baseUrl), {
      method,
      headers: { 'content-type': 'application/json', 'x-internal-token': token },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    return { status: response.status, body: (await response.json().catch(() => ({}))) as Record<string, unknown> };
  };
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const connection = (body: Record<string, unknown>): ChatConnection => ({
  workspace: text(body['teamName']),
  connectedAt: text(body['installedAt']),
});

const why = (answer: Answer, otherwise: string) =>
  typeof answer.body['message'] === 'string' ? answer.body['message'] : otherwise;

export function slackApp(baseUrl: string, token: string): ChatApp {
  const call = client(baseUrl, token);
  const at = (tenantId: string, action = '') => `/internal/tenants/${tenantId}/slack${action}`;
  return {
    key: 'slack',
    name: 'Slack',
    async status(tenantId) {
      const answer = await call('GET', at(tenantId));
      const c = answer.body['connection'];
      return {
        canConnect: answer.body['canConnect'] === true,
        connection: typeof c === 'object' && c !== null ? connection(c as Record<string, unknown>) : null,
      };
    },
    async authorize(tenantId, accountId, origin) {
      const answer = await call('POST', at(tenantId, '/authorize'), { accountId, origin });
      return answer.status === 200 && typeof answer.body['url'] === 'string'
        ? { ok: true, value: answer.body['url'] }
        : { ok: false, message: why(answer, 'Slack is not set up here.') };
    },
    async complete(tenantId, code, state) {
      const answer = await call('POST', at(tenantId, '/complete'), { code, state });
      return answer.status === 200
        ? { ok: true, value: connection(answer.body) }
        : { ok: false, message: why(answer, 'Slack did not confirm the connection. Try again.') };
    },
    async disconnect(tenantId) {
      const answer = await call('POST', at(tenantId, '/disconnect'), {});
      if (answer.status !== 200) throw new Error(`slack disconnect: ${String(answer.status)}`);
    },
  };
}

export function chatAppsFrom(env: NodeJS.ProcessEnv): readonly ChatApp[] {
  const slack = env['SLACK_URL'];
  const token = env['SLACK_PEOPLE_TOKEN'];
  return slack && token ? [slackApp(slack, token)] : [];
}
