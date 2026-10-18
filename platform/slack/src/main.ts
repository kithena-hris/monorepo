import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AssistantAnswer } from '@kithena/contracts';
import { drain, logger, onShutdown, startTelemetry } from '@kithena/telemetry';

import { questionOf, type Envelope } from './events.js';
import * as api from './slack-api.js';
import {
  slackService,
  type Assistant,
  type Interaction,
  type People,
  type Performance,
  type Recruiting,
  type TimeOff,
} from './service.js';
import { tokenKeyFrom } from './secrets.js';
import { memoryStore, postgresStore, type Store } from './store.js';

/**
 * The Slack service: Kithena in Slack, for every company that connects it.
 *
 * Port 4102. Connected to Slack over Socket Mode — it opens a WebSocket to
 * Slack, so nothing of ours has to be reachable from the internet — and to
 * People over internal HTTP, both ways, with one token for the pair
 * (`SLACK_PEOPLE_TOKEN`).
 *
 * Settings:
 * - `SLACK_APP_TOKEN` (xapp-, Socket Mode) — the app's, one per environment.
 * - `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `AUTH_ORIGIN` — "Add to Slack".
 *   Slack returns to `${AUTH_ORIGIN}/chat/slack/done`, which has to be HTTPS.
 * - `SLACK_DATABASE_URL`, `SLACK_TOKEN_KEY` (32 bytes, base64) — where
 *   workspaces and their sealed tokens are kept.
 * - `PEOPLE_URL`, `SLACK_PEOPLE_TOKEN`, `SLACK_COMMAND`.
 * - `ASSISTANT_URL`, `SLACK_ASSISTANT_TOKEN` — where a question goes: the
 *   assistant answers it across every module the company has. Without the
 *   token every question is answered "not available".
 * - `TIMEOFF_URL`, `SLACK_TIMEOFF_TOKEN` — Time Off, the same way: it asks an
 *   approver through this service, and the press comes back here over the
 *   socket and is passed on to Time Off. Its token opens `/internal/timeoff/`
 *   only, as People's opens everything else.
 * - `RECRUITING_URL`, `SLACK_RECRUITING_TOKEN` — Recruiting, likewise
 *   (REC-137): digests into a job's channel, scorecard reminders, approvals
 *   and interviews to a person; its Approve comes back the same way. Its
 *   token opens `/internal/recruiting/` only.
 * - `PERFORMANCE_URL`, `SLACK_PERFORMANCE_TOKEN` — Performance, likewise
 *   (PRF-164): reminders, unlock requests and nominations with buttons that
 *   run its own operations, and a request the assistant could not answer,
 *   planned there for the asker to confirm. Its token opens
 *   `/internal/performance/` only.
 *
 * Off production, `SLACK_BOT_TOKEN` and `SLACK_TENANT_ID` connect the
 * developer's own workspace to one company at start, since "Add to Slack"
 * cannot return to a local address; `SLACK_DEV_ACT_AS` answers every Slack
 * user as that Kithena email, and `SLACK_DEV_INBOX` (a Slack user's email) is
 * where that person's notices arrive.
 */
startTelemetry('kithena-slack');

const env = process.env;
const production = env['NODE_ENV'] === 'production';
const PORT = Number(env['PORT'] ?? 4102);
const appToken = env['SLACK_APP_TOKEN'] ?? '';
const peopleUrl = (env['PEOPLE_URL'] ?? 'http://localhost:4001').replace(/\/$/, '');
const peopleToken = env['SLACK_PEOPLE_TOKEN'] ?? '';
const timeOffToken = env['SLACK_TIMEOFF_TOKEN'] ?? '';
const recruitingToken = env['SLACK_RECRUITING_TOKEN'] ?? '';
const performanceToken = env['SLACK_PERFORMANCE_TOKEN'] ?? '';
const devToken = production ? '' : (env['SLACK_BOT_TOKEN'] ?? '');
const devTenant = production ? '' : (env['SLACK_TENANT_ID'] ?? '');

function storeFrom(): Store {
  const url = env['SLACK_DATABASE_URL'];
  const key = tokenKeyFrom(env['SLACK_TOKEN_KEY'] ?? '');
  if (url && key) return postgresStore(url, key);
  if (production) throw new Error('SLACK_DATABASE_URL and a 32-byte SLACK_TOKEN_KEY are required');
  logger.info('SLACK_DATABASE_URL or SLACK_TOKEN_KEY unset; workspaces are kept in memory');
  return memoryStore();
}

const peopleCall = async (path: string, body: unknown): Promise<unknown> => {
  const response = await fetch(`${peopleUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-token': peopleToken },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`people ${path}: ${String(response.status)}`);
  return response.json();
};

const people: People = {
  act: async (tenantId, email, action) => {
    try {
      return (await peopleCall('/internal/chat/act', { tenantId, email, ...action })) as never;
    } catch (error) {
      logger.error({ err: error }, 'slack action failed');
      return { ok: false, message: 'Kithena could not do that just now. Try again in a moment.' };
    }
  },
};

const assistantUrl = (env['ASSISTANT_URL'] ?? 'http://localhost:4104').replace(/\/$/, '');
const assistantToken = env['SLACK_ASSISTANT_TOKEN'] ?? '';
const NOT_AVAILABLE = "The assistant isn't available right now.";
const assistant: Assistant = {
  ask: async (tenantId, email, question, earlier) => {
    if (assistantToken === '') return { text: NOT_AVAILABLE, understood: '' };
    const response = await fetch(`${assistantUrl}/internal/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': assistantToken },
      // The token, not this body, tells the assistant which channel is asking.
      body: JSON.stringify({
        tenantId,
        email,
        question,
        channel: 'slack',
        ...(earlier.length === 0 ? {} : { earlier }),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      logger.error({ status: response.status }, 'the assistant refused a question');
      throw new Error(`assistant: ${String(response.status)}`);
    }
    return AssistantAnswer.parse(await response.json());
  },
};

const timeOffUrl = (env['TIMEOFF_URL'] ?? 'http://localhost:4002').replace(/\/$/, '');
const timeOff: TimeOff = {
  relay: async (tenantId, value) => {
    const response = await fetch(`${timeOffUrl}/v1/timeoff/integrations/slack/relay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': timeOffToken },
      body: JSON.stringify({ tenantId, value }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      logger.error({ status: response.status }, 'time off refused a slack press');
      throw new Error(`timeoff relay: ${String(response.status)}`);
    }
    return (await response.json()) as { text: string };
  },
};

const recruitingUrl = (env['RECRUITING_URL'] ?? 'http://localhost:4005').replace(/\/$/, '');
const recruiting: Recruiting = {
  relay: async (tenantId, value) => {
    const response = await fetch(`${recruitingUrl}/v1/recruiting/integrations/slack/relay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': recruitingToken },
      body: JSON.stringify({ tenantId, value }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      logger.error({ status: response.status }, 'recruiting refused a slack press');
      throw new Error(`recruiting relay: ${String(response.status)}`);
    }
    return (await response.json()) as { text: string };
  },
};

const performanceUrl = (env['PERFORMANCE_URL'] ?? 'http://localhost:4007').replace(/\/$/, '');
const performanceCall = async (path: string, body: unknown): Promise<unknown> => {
  const response = await fetch(`${performanceUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-token': performanceToken },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    logger.error({ status: response.status, path }, 'performance refused a slack call');
    throw new Error(`performance ${path}: ${String(response.status)}`);
  }
  return response.json();
};
const performance: Performance = {
  relay: async (tenantId, value) =>
    (await performanceCall('/internal/chat/relay', { tenantId, value })) as { text: string },
  // Words are never logged: a request can name a person.
  plan: async (tenantId, email, text) =>
    (await performanceCall('/internal/chat/plan', { tenantId, email, text })) as never,
};

const clientId = env['SLACK_CLIENT_ID'] ?? '';
const clientSecret = env['SLACK_CLIENT_SECRET'] ?? '';
const authOrigin = env['AUTH_ORIGIN'] ?? '';
const store = storeFrom();
const service = slackService({
  store,
  people,
  assistant,
  timeOff,
  ...(recruitingToken === '' ? {} : { recruiting }),
  ...(performanceToken === '' ? {} : { performance }),
  slack: api,
  command: env['SLACK_COMMAND'] ?? '/kithena',
  now: () => Date.now(),
  oauth:
    clientId && clientSecret && authOrigin && peopleToken
      ? {
          clientId,
          clientSecret,
          redirectUri: new URL('/chat/slack/done', authOrigin).toString(),
          toolRedirectUri: new URL('/tools/slack/done', authOrigin).toString(),
          // Its own key, derived from the client secret: nothing else signs with it.
          stateSecret: createHmac('sha256', clientSecret).update('kithena-slack-state').digest(),
        }
      : null,
  ...(production || !env['SLACK_DEV_ACT_AS']
    ? {}
    : { dev: { actAs: env['SLACK_DEV_ACT_AS'], inbox: env['SLACK_DEV_INBOX'] ?? null } }),
  ...(devToken === '' ? {} : { keepToken: devToken }),
});

/* ------------------------------------------------------ Socket Mode -- */

let backoff = 1_000;

async function onEnvelope(socket: WebSocket, envelope: Envelope): Promise<void> {
  const ack = (payload?: unknown) => {
    if (envelope.envelope_id !== undefined)
      socket.send(
        JSON.stringify({
          envelope_id: envelope.envelope_id,
          ...(payload === undefined ? {} : { payload }),
        }),
      );
  };
  if (envelope.type === 'interactive') {
    const payload = envelope.payload as Interaction;
    if (payload.type === 'view_submission') {
      // A form's errors travel in its acknowledgement, which Slack waits three seconds for.
      const answer = await Promise.race([
        service.interact(payload).catch((error: unknown) => {
          logger.error({ err: error }, 'slack form failed');
          return undefined;
        }),
        new Promise<undefined>((resolve) => {
          setTimeout(() => {
            resolve(undefined);
          }, 2_500);
        }),
      ]);
      ack(answer);
      return;
    }
    ack();
    await service.interact(payload);
    return;
  }
  // Acknowledged at once, as Slack asks within three seconds; answered after.
  ack();
  const question = questionOf(envelope);
  if (question === null) return;
  // Words are never logged: a question can name a person.
  logger.info({ team: question.team, via: question.reply.via }, 'slack question');
  await service.question(question);
}

async function connect(): Promise<void> {
  const socket = new WebSocket(await api.openConnection(appToken));
  socket.addEventListener('open', () => {
    backoff = 1_000;
    logger.info('slack connected');
  });
  socket.addEventListener('message', (event) => {
    let envelope: Envelope;
    try {
      envelope = JSON.parse(String(event.data)) as Envelope;
    } catch {
      return;
    }
    if (envelope.type === 'disconnect') {
      socket.close();
      return;
    }
    onEnvelope(socket, envelope).catch((error: unknown) => {
      logger.error({ err: error, type: envelope.type }, 'slack envelope failed');
    });
  });
  socket.addEventListener('close', () => {
    logger.info({ retryInMs: backoff }, 'slack disconnected');
    retryLater();
  });
}

function retryLater(): void {
  setTimeout(() => {
    void connect().catch((error: unknown) => {
      logger.error({ err: error, retryInMs: backoff }, 'slack connection failed');
      retryLater();
    });
  }, backoff);
  backoff = Math.min(backoff * 2, 60_000);
}

/* -------------------------------------------------- internal routes -- */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const NAME = /^[a-z][a-z0-9_]{0,63}$/;

/** The pair's own secret: People's opens People's routes, Time Off's opens Time Off's, never each other's. */
function presents(request: IncomingMessage, token: string): boolean {
  const given = request.headers['x-internal-token'];
  if (token === '' || typeof given !== 'string') return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(token).digest();
  return timingSafeEqual(a, b);
}

async function bodyOf(request: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of request) {
    raw += String(chunk);
    if (raw.length > 64_000) return {};
  }
  try {
    const parsed = JSON.parse(raw === '' ? '{}' : raw) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const str = (v: unknown, max = 500) =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;

/** Time Off's routes: whether a company's workspace is connected, and asking an approver. */
async function timeOffRoute(
  request: IncomingMessage,
  pathname: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  if (pathname === '/internal/timeoff/approval' && request.method === 'POST') {
    const tenantId = str(body['tenantId'], 36);
    const email = str(body['email'], 320);
    const text = str(body['text'], 2000);
    // Slack keeps a button's value to 2,000 characters.
    const approve = str(body['approve'], 2000);
    const decline = str(body['decline'], 2000);
    if (!tenantId || !email || !text || !approve || !decline) return { status: 400, body: {} };
    const sent = await service.askTimeOff(tenantId, { email, text, approve, decline });
    if (sent === 'not_connected')
      return {
        status: 409,
        body: { sent, message: 'The company has not added Kithena to Slack.' },
      };
    if (sent === 'not_in_slack')
      return { status: 404, body: { sent, message: 'Slack has nobody at that address.' } };
    return { status: 202, body: { sent } };
  }
  const tenant = new RegExp(`^/internal/timeoff/tenants/(${UUID})/slack$`).exec(pathname);
  if (tenant !== null && request.method === 'GET') {
    return { status: 200, body: await service.status(tenant[1] ?? '') };
  }
  return { status: 404, body: {} };
}

/** Recruiting's one route: a message to a person or into a job's channel. */
async function recruitingRoute(
  request: IncomingMessage,
  pathname: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  if (pathname !== '/internal/recruiting/message' || request.method !== 'POST')
    return { status: 404, body: {} };
  const tenantId = str(body['tenantId'], 36);
  const email = str(body['email'], 320);
  const channel = str(body['channel'], 30);
  const text = str(body['text'], 2000);
  const approve = body['approve'] === undefined ? undefined : str(body['approve'], 2000);
  const links = Array.isArray(body['links'])
    ? (body['links'] as unknown[]).slice(0, 3).flatMap((l) => {
        const label = str((l as Record<string, unknown>)['label'], 60);
        const url = str((l as Record<string, unknown>)['url'], 2000);
        return label && url?.startsWith('https://') ? [{ label, url }] : [];
      })
    : [];
  if (!tenantId || !text || approve === null || (email === null) === (channel === null))
    return { status: 400, body: {} };
  const sent = await service.tellRecruiting(tenantId, {
    to: email === null ? { channel: channel ?? '' } : { email },
    text,
    ...(approve === undefined ? {} : { approve }),
    links,
  });
  const why = {
    not_connected: [409, 'The company has not added Kithena to Slack.'],
    not_in_slack: [404, 'Slack has nobody at that address.'],
    not_in_channel: [409, 'Invite Kithena to the channel first.'],
  } as const;
  if (sent !== 'sent') return { status: why[sent][0], body: { sent, message: why[sent][1] } };
  return { status: 202, body: { sent } };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A person's own Slack, for Performance (§22.3): link it, read what they can
 * see about someone in a period, unlink it. Performance has checked the
 * grant; this checks the state, the workspace and the token.
 */
async function toolsRoute(
  pathname: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const tenantId = str(body['tenantId'], 36);
  const personId = str(body['personId'], 36);
  if (!tenantId || !personId) return { status: 400, body: {} };
  const answer = <T>(done: { ok: true; body: T } | { ok: false; message: string }) =>
    done.ok ? { status: 200, body: done.body } : { status: 422, body: { message: done.message } };
  switch (pathname) {
    case '/internal/performance/tools/authorize': {
      const origin = str(body['origin'], 300);
      if (!origin) return { status: 400, body: {} };
      return answer(await service.toolAuthorizeUrl(tenantId, personId, origin));
    }
    case '/internal/performance/tools/complete': {
      const code = str(body['code'], 500);
      const state = str(body['state'], 2000);
      if (!code || !state) return { status: 400, body: {} };
      return answer(await service.toolComplete(tenantId, personId, code, state));
    }
    case '/internal/performance/tools/search': {
      const subjectEmail = str(body['subjectEmail'], 320);
      const from = str(body['from'], 10);
      const to = str(body['to'], 10);
      if (!subjectEmail || !from || !to || !DATE.test(from) || !DATE.test(to))
        return { status: 400, body: {} };
      return answer(await service.toolSearch(tenantId, personId, { subjectEmail, from, to }));
    }
    case '/internal/performance/tools/revoke':
      await service.toolRevoke(tenantId, personId);
      return { status: 200, body: {} };
    default:
      return { status: 404, body: {} };
  }
}

/** Performance's routes: a message to a person, with its buttons; and a person's own Slack. */
async function performanceRoute(
  request: IncomingMessage,
  pathname: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  if (pathname.startsWith('/internal/performance/tools/') && request.method === 'POST')
    return toolsRoute(pathname, body);
  if (pathname !== '/internal/performance/message' || request.method !== 'POST')
    return { status: 404, body: {} };
  const tenantId = str(body['tenantId'], 36);
  const email = str(body['email'], 320);
  const text = str(body['text'], 2000);
  const buttons = Array.isArray(body['buttons'])
    ? (body['buttons'] as unknown[]).slice(0, 5).flatMap((b) => {
        const r = b as Record<string, unknown>;
        const label = str(r['label'], 60);
        // Slack keeps a button's value to 2,000 characters.
        const value = str(r['value'], 2000);
        const style: 'primary' | 'danger' | undefined =
          r['style'] === 'primary' || r['style'] === 'danger' ? r['style'] : undefined;
        return label && value ? [{ label, value, ...(style === undefined ? {} : { style }) }] : [];
      })
    : [];
  if (!tenantId || !email || !text) return { status: 400, body: {} };
  const sent = await service.tellPerformance(tenantId, { email, text, buttons });
  if (sent === 'not_connected')
    return { status: 409, body: { sent, message: 'The company has not added Kithena to Slack.' } };
  if (sent === 'not_in_slack')
    return { status: 404, body: { sent, message: 'Slack has nobody at that address.' } };
  return { status: 202, body: { sent } };
}

async function route(request: IncomingMessage): Promise<{ status: number; body: unknown }> {
  // For the container's healthcheck and the deploy: up, and nothing more.
  if (request.url === '/health' && request.method === 'GET')
    return { status: 200, body: { ok: true } };
  const path = new URL(request.url ?? '/', 'http://slack.internal');
  const timeOff = path.pathname.startsWith('/internal/timeoff/');
  const recruitingCall = path.pathname.startsWith('/internal/recruiting/');
  const performanceCallIn = path.pathname.startsWith('/internal/performance/');
  const caller = timeOff
    ? 'Time Off'
    : recruitingCall
      ? 'Recruiting'
      : performanceCallIn
        ? 'Performance'
        : 'People';
  const token = timeOff
    ? timeOffToken
    : recruitingCall
      ? recruitingToken
      : performanceCallIn
        ? performanceToken
        : peopleToken;
  if (!presents(request, token)) {
    return { status: 401, body: { message: `Not ${caller}` } };
  }
  const body = request.method === 'GET' ? {} : await bodyOf(request);
  if (timeOff) return timeOffRoute(request, path.pathname, body);
  if (recruitingCall) return recruitingRoute(request, path.pathname, body);
  if (performanceCallIn) return performanceRoute(request, path.pathname, body);

  if (path.pathname === '/internal/notify' && request.method === 'POST') {
    const tenantId = str(body['tenantId'], 36);
    const email = str(body['email'], 320);
    const event = str(body['event'], 64);
    const url = str(body['url'], 2000);
    if (!tenantId || !email || !event || !url || !NAME.test(event))
      return { status: 400, body: {} };
    const sent = await service.notify(tenantId, {
      event: event as never,
      email,
      url,
      ...(body['decision'] === 'approved' || body['decision'] === 'rejected'
        ? { decision: body['decision'] }
        : {}),
      ...(typeof body['count'] === 'number' ? { count: body['count'] } : {}),
    });
    return { status: 202, body: { sent } };
  }

  const tenant = new RegExp(`^/internal/tenants/(${UUID})/slack(/[a-z]+)?$`).exec(path.pathname);
  if (tenant === null) return { status: 404, body: {} };
  const tenantId = tenant[1] ?? '';
  const action = tenant[2] ?? '';
  if (action === '' && request.method === 'GET') {
    return { status: 200, body: await service.status(tenantId) };
  }
  if (action === '/authorize' && request.method === 'POST') {
    const accountId = str(body['accountId'], 36);
    const origin = str(body['origin'], 300);
    if (!accountId || !origin) return { status: 400, body: {} };
    const url = service.authorizeUrl(tenantId, accountId, origin);
    return url === null
      ? { status: 503, body: { message: 'Slack is not set up here.' } }
      : { status: 200, body: { url } };
  }
  if (action === '/complete' && request.method === 'POST') {
    const code = str(body['code'], 500);
    const state = str(body['state'], 2000);
    if (!code || !state) return { status: 400, body: {} };
    const done = await service.complete(tenantId, code, state);
    return done.ok
      ? { status: 200, body: done.body }
      : { status: 422, body: { message: done.message } };
  }
  if (action === '/disconnect' && request.method === 'POST') {
    await service.disconnect(tenantId);
    return { status: 200, body: {} };
  }
  return { status: 404, body: {} };
}

const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  route(request)
    .then(({ status, body }) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    })
    .catch((error: unknown) => {
      logger.error({ err: error }, 'slack internal request failed');
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end('{"message":"Something went wrong"}');
    });
});

/** The developer's own workspace, connected to one company without "Add to Slack". */
async function connectDevWorkspace(): Promise<void> {
  if (devToken === '' || devTenant === '') return;
  if ((await store.installation(devTenant)) !== null) return;
  const me = await api.whoAmI(devToken);
  if ((await store.companyOf(me.teamId)) !== null) return;
  await store.install({
    tenantId: devTenant,
    ...me,
    botToken: devToken,
    installedBy: null,
    installedAt: new Date().toISOString(),
  });
  logger.info({ team: me.teamName }, 'slack dev workspace connected');
}

server.listen(PORT, () => {
  logger.info({ port: PORT }, 'slack listening');
});
onShutdown('slack', async () => {
  await drain(server);
  await store.close();
});

if (appToken === '' || peopleToken === '') {
  logger.info('SLACK_APP_TOKEN or SLACK_PEOPLE_TOKEN unset; Slack is off');
} else {
  if (assistantToken === '')
    logger.info("SLACK_ASSISTANT_TOKEN unset; questions are answered 'not available'");
  void connectDevWorkspace()
    .catch((error: unknown) => {
      logger.error({ err: error }, 'slack dev workspace not connected');
    })
    .then(() => connect())
    .catch(() => {
      retryLater();
    });
}
