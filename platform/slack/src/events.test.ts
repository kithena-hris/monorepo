import { describe, expect, it } from 'vitest';

import { answerText, questionOf, withoutMentions } from './events.js';

describe('a Slack envelope as a question', () => {
  it('reads a slash command, answered to the asker alone', () => {
    expect(
      questionOf({
        type: 'slash_commands',
        envelope_id: 'e1',
        payload: {
          team_id: 'T1',
          user_id: 'U1',
          text: ' who is in sales? ',
          response_url: 'https://hooks.slack.com/commands/x',
        },
      }),
    ).toEqual({
      team: 'T1',
      user: 'U1',
      text: 'who is in sales?',
      reply: { via: 'response_url', url: 'https://hooks.slack.com/commands/x' },
    });
  });

  it('answers a mention in a thread under it, and a direct message where it was sent', () => {
    const mention = questionOf({
      type: 'events_api',
      payload: {
        team_id: 'T1',
        event: {
          type: 'app_mention',
          user: 'U1',
          channel: 'C1',
          ts: '1.1',
          text: '<@UBOT> who is in sales?',
        },
      },
    });
    expect(mention).toMatchObject({
      text: 'who is in sales?',
      reply: { via: 'thread', channel: 'C1', threadTs: '1.1' },
    });
    const dm = questionOf({
      type: 'events_api',
      payload: {
        team_id: 'T1',
        event: {
          type: 'message',
          channel_type: 'im',
          user: 'U1',
          channel: 'D1',
          ts: '2.2',
          text: 'hi',
        },
      },
    });
    expect(dm).toMatchObject({ reply: { via: 'channel', channel: 'D1' } });
  });

  it('is not asked anything by its own messages, an edit or a channel message without a mention', () => {
    const base = { team_id: 'T1' };
    expect(
      questionOf({
        type: 'events_api',
        payload: {
          ...base,
          event: {
            type: 'message',
            channel_type: 'im',
            bot_id: 'B1',
            user: 'U1',
            channel: 'D1',
            ts: '1',
            text: 'x',
          },
        },
      }),
    ).toBeNull();
    expect(
      questionOf({
        type: 'events_api',
        payload: {
          ...base,
          event: {
            type: 'message',
            channel_type: 'im',
            subtype: 'message_changed',
            channel: 'D1',
            ts: '1',
          },
        },
      }),
    ).toBeNull();
    expect(
      questionOf({
        type: 'events_api',
        payload: {
          ...base,
          event: {
            type: 'message',
            channel_type: 'channel',
            user: 'U1',
            channel: 'C1',
            ts: '1',
            text: 'x',
          },
        },
      }),
    ).toBeNull();
    expect(questionOf({ type: 'hello' })).toBeNull();
  });

  it('drops the mention from the words, and shows how the question was read', () => {
    expect(withoutMentions('<@U123|kithena>   who   is here')).toBe('who is here');
    expect(
      answerText({ text: '6 people.', understood: 'How many where Department in Sales' }),
    ).toBe('6 people.\n_How many where Department in Sales_');
  });
});
