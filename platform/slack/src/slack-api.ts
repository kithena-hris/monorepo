/**
 * The few Slack Web API calls the service makes, over `fetch`: open a Socket
 * Mode connection, read a user's verified email, and post an answer.
 */

const API = 'https://slack.com/api';

async function call(
  method: string,
  token: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const answer = (await response.json()) as Record<string, unknown>;
  if (answer['ok'] !== true) throw new Error(`Slack ${method}: ${String(answer['error'])}`);
  return answer;
}

/** The address to open the Socket Mode connection on, with the app-level token. */
export async function openConnection(appToken: string): Promise<string> {
  const answer = await call('apps.connections.open', appToken, {});
  return String(answer['url']);
}

/** The user's email as Slack has verified it, or null (a bot, a guest without one). */
export async function emailOf(botToken: string, user: string): Promise<string | null> {
  const response = await fetch(`${API}/users.info?user=${encodeURIComponent(user)}`, {
    headers: { authorization: `Bearer ${botToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  const answer = (await response.json()) as {
    ok?: boolean;
    user?: { is_bot?: boolean; profile?: { email?: string } };
  };
  if (answer.ok !== true || answer.user?.is_bot === true) return null;
  return answer.user?.profile?.email ?? null;
}

export async function postMessage(
  botToken: string,
  message: { readonly channel: string; readonly text: string; readonly threadTs?: string },
): Promise<void> {
  await call('chat.postMessage', botToken, {
    channel: message.channel,
    text: message.text,
    ...(message.threadTs === undefined ? {} : { thread_ts: message.threadTs }),
    unfurl_links: false,
  });
}

/** Answer a slash command to its asker alone, where they typed it. */
export async function respond(url: string, text: string): Promise<void> {
  await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ response_type: 'ephemeral', text }),
    signal: AbortSignal.timeout(10_000),
  });
}
