import { logger, startTelemetry } from '@kithena/telemetry';

import { answerText, helpText, questionOf, type Envelope, type Question } from './events.js';
import { emailOf, openConnection, postMessage, respond } from './slack-api.js';

/**
 * The Slack service: Kithena's assistant in Slack.
 *
 * Connected over Socket Mode — it opens a WebSocket to Slack, and nothing of
 * ours has to be reachable from the internet. Each question is answered by
 * People as whoever asked it: this service reads the asker's verified email
 * from Slack and hands it, with the words, to People's internal route, and
 * People finds whose it is and answers with their account and their roles.
 * It holds no Kithena data and keeps nothing.
 *
 * One workspace, one company, for now (`SLACK_TENANT_ID`). A company
 * connecting its own workspace from Settings, with installations kept per
 * workspace, is the next step.
 *
 * Settings: `SLACK_APP_TOKEN` (xapp-, Socket Mode), `SLACK_BOT_TOKEN` (xoxb-),
 * `SLACK_TENANT_ID`, `PEOPLE_URL`, `SLACK_PEOPLE_TOKEN` (what People checks),
 * `SLACK_COMMAND` (the slash command, for its help text). Off production,
 * `SLACK_DEV_ACT_AS` answers every Slack user as that Kithena email, so a test
 * workspace whose people are not Kithena's can still be tried.
 */
startTelemetry('kithena-slack');

const env = process.env;
const appToken = env['SLACK_APP_TOKEN'] ?? '';
const botToken = env['SLACK_BOT_TOKEN'] ?? '';
const tenantId = env['SLACK_TENANT_ID'] ?? '';
const peopleUrl = (env['PEOPLE_URL'] ?? 'http://localhost:4001').replace(/\/$/, '');
const peopleToken = env['SLACK_PEOPLE_TOKEN'] ?? '';
const command = env['SLACK_COMMAND'] ?? '/kithena';
const actAs = env['NODE_ENV'] === 'production' ? undefined : env['SLACK_DEV_ACT_AS'];

async function answer(question: Question): Promise<string> {
  if (question.text === '') return helpText(command);
  const email = actAs ?? (await emailOf(botToken, question.user));
  if (email === null)
    return 'I could not read your email from Slack, so I cannot tell who you are in Kithena.';
  const response = await fetch(`${peopleUrl}/internal/assistant/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-token': peopleToken },
    body: JSON.stringify({ tenantId, email, question: question.text }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) return 'Kithena could not answer just now. Try again in a moment.';
  return answerText((await response.json()) as { text: string; understood: string });
}

async function reply(question: Question, text: string): Promise<void> {
  const to = question.reply;
  if (to.via === 'response_url') await respond(to.url, text);
  else if (to.via === 'thread')
    await postMessage(botToken, { channel: to.channel, text, threadTs: to.threadTs });
  else await postMessage(botToken, { channel: to.channel, text });
}

async function handle(envelope: Envelope): Promise<void> {
  const question = questionOf(envelope);
  if (question === null) return;
  // Words are never logged: a question can name a person.
  logger.info({ team: question.team, via: question.reply.via }, 'slack question');
  const text = await answer(question).catch((error: unknown) => {
    logger.error({ err: error }, 'slack question failed');
    return 'Kithena could not answer just now. Try again in a moment.';
  });
  await reply(question, text);
}

let backoff = 1_000;

async function connect(): Promise<void> {
  const url = await openConnection(appToken);
  const socket = new WebSocket(url);
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
    // Acknowledged at once, as Slack asks within three seconds; answered after.
    if (envelope.envelope_id !== undefined)
      socket.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
    if (envelope.type === 'disconnect') {
      socket.close();
      return;
    }
    void handle(envelope);
  });
  socket.addEventListener('close', () => {
    logger.info({ retryInMs: backoff }, 'slack disconnected');
    setTimeout(() => {
      void connect().catch(retry);
    }, backoff);
    backoff = Math.min(backoff * 2, 60_000);
  });
}

function retry(error: unknown): void {
  logger.error({ err: error, retryInMs: backoff }, 'slack connection failed');
  setTimeout(() => {
    void connect().catch(retry);
  }, backoff);
  backoff = Math.min(backoff * 2, 60_000);
}

if (appToken === '' || botToken === '' || tenantId === '' || peopleToken === '') {
  logger.info(
    'SLACK_APP_TOKEN, SLACK_BOT_TOKEN, SLACK_TENANT_ID or SLACK_PEOPLE_TOKEN unset; Slack is off',
  );
} else {
  void connect().catch(retry);
}
