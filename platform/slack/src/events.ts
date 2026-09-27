/**
 * What Slack sends over Socket Mode, read into a question and where its
 * answer goes. Pure: an envelope in, a decision out.
 *
 * Three ways in, one assistant behind them:
 *
 * - The slash command (`/kithena …`): answered to the asker alone, in the
 *   channel they typed it in, through the command's response URL.
 * - A mention (`@Kithena …`) in a channel: answered in a thread under it.
 * - A direct message to the app: answered in the conversation.
 *
 * The bot's own messages, edits and joins are not questions.
 */

export type Envelope = {
  readonly envelope_id?: string;
  readonly type: string;
  readonly payload?: unknown;
  readonly accepts_response_payload?: boolean;
};

export type Reply =
  | { readonly via: 'response_url'; readonly url: string }
  | { readonly via: 'thread'; readonly channel: string; readonly threadTs: string }
  | { readonly via: 'channel'; readonly channel: string };

export interface Question {
  readonly team: string;
  readonly user: string;
  readonly text: string;
  readonly reply: Reply;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (typeof v === 'object' && v !== null ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** `<@U123> who is in sales?` as `who is in sales?`: the mention is not the question. */
export function withoutMentions(text: string): string {
  return text
    .replace(/<@[A-Z0-9]+(\|[^>]*)?>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The question an envelope asks, or null when it asks none. */
export function questionOf(envelope: Envelope): Question | null {
  const payload = obj(envelope.payload);
  if (payload === null) return null;

  if (envelope.type === 'slash_commands') {
    const team = str(payload['team_id']);
    const user = str(payload['user_id']);
    const url = str(payload['response_url']);
    if (team === null || user === null || url === null) return null;
    return {
      team,
      user,
      text: (str(payload['text']) ?? '').trim(),
      reply: { via: 'response_url', url },
    };
  }

  if (envelope.type === 'events_api') {
    const event = obj(payload['event']);
    const team = str(payload['team_id']);
    if (event === null || team === null) return null;
    // Our own messages, and anything that is not somebody writing.
    if (event['bot_id'] !== undefined || event['subtype'] !== undefined) return null;
    const user = str(event['user']);
    const channel = str(event['channel']);
    const ts = str(event['ts']);
    if (user === null || channel === null || ts === null) return null;
    const text = withoutMentions(str(event['text']) ?? '');
    if (event['type'] === 'app_mention') {
      return {
        team,
        user,
        text,
        reply: { via: 'thread', channel, threadTs: str(event['thread_ts']) ?? ts },
      };
    }
    if (event['type'] === 'message' && event['channel_type'] === 'im') {
      return { team, user, text, reply: { via: 'channel', channel } };
    }
  }
  return null;
}

/** What the command says when asked nothing. */
export function helpText(command: string): string {
  return [
    `Ask me about the people in your company, as you: I only show what you could see in Kithena yourself.`,
    `• \`${command} who reports to Michael?\``,
    `• \`${command} how many people are in Scranton, by department?\``,
    `• \`${command} who started after 2020?\``,
    `• \`${command} what is waiting for my approval?\``,
  ].join('\n');
}

/** The answer as Slack shows it: the words, then how the question was read, quietly. */
export function answerText(answer: { readonly text: string; readonly understood: string }): string {
  return `${answer.text}\n_${answer.understood}_`;
}
