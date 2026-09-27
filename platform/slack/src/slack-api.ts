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

/** The Slack user with this email in the workspace, or null. */
export async function userByEmail(botToken: string, email: string): Promise<string | null> {
  const response = await fetch(`${API}/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
    headers: { authorization: `Bearer ${botToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  const answer = (await response.json()) as { ok?: boolean; user?: { id?: string; deleted?: boolean } };
  if (answer.ok !== true || answer.user?.deleted === true) return null;
  return answer.user?.id ?? null;
}

/** A message with blocks, to a channel or (by user id) a direct message. */
export async function postBlocks(
  botToken: string,
  message: { readonly channel: string; readonly text: string; readonly blocks: readonly unknown[] },
): Promise<void> {
  await call('chat.postMessage', botToken, { ...message, unfurl_links: false });
}

/** Replace the message a button was pressed on. */
export async function replaceMessage(
  url: string,
  message: { readonly text: string; readonly blocks: readonly unknown[] },
): Promise<void> {
  await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ replace_original: true, ...message }),
    signal: AbortSignal.timeout(10_000),
  });
}

export async function openView(botToken: string, triggerId: string, view: unknown): Promise<string> {
  const answer = await call('views.open', botToken, { trigger_id: triggerId, view });
  return (answer['view'] as { id?: string } | undefined)?.id ?? '';
}

export async function updateView(botToken: string, viewId: string, view: unknown): Promise<void> {
  await call('views.update', botToken, { view_id: viewId, view });
}

/** Who a bot token is: its workspace and its bot user. */
export async function whoAmI(
  botToken: string,
): Promise<{ readonly teamId: string; readonly teamName: string; readonly botUserId: string }> {
  const answer = await call('auth.test', botToken, {});
  return {
    teamId: String(answer['team_id']),
    teamName: String(answer['team']),
    botUserId: String(answer['user_id']),
  };
}

/** Finish "Add to Slack": the code Slack sent back, for the workspace's bot token. */
export async function exchangeCode(config: {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly code: string;
  readonly redirectUri: string;
}): Promise<{
  readonly botToken: string;
  readonly teamId: string;
  readonly teamName: string;
  readonly botUserId: string;
}> {
  const response = await fetch(`${API}/oauth.v2.access`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code: config.code,
      redirect_uri: config.redirectUri,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const answer = (await response.json()) as {
    ok?: boolean;
    error?: string;
    access_token?: string;
    bot_user_id?: string;
    team?: { id?: string; name?: string };
  };
  if (answer.ok !== true || !answer.access_token || !answer.team?.id) {
    throw new Error(`Slack oauth.v2.access: ${String(answer.error)}`);
  }
  return {
    botToken: answer.access_token,
    teamId: answer.team.id,
    teamName: answer.team.name ?? answer.team.id,
    botUserId: answer.bot_user_id ?? '',
  };
}

/** Give the token back: the app leaves the workspace. */
export async function revoke(botToken: string): Promise<void> {
  await call('auth.revoke', botToken, {});
}
