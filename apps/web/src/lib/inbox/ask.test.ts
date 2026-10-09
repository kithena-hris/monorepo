import { describe, expect, it } from 'vitest';
import type { InboxItem } from '@kithena/contracts';

import { aboutInbox, answerInbox } from './ask';
import { EMPTY_STATE, shape } from './model';

const NOW = '2026-10-07T10:00:00.000Z';
const item = (
  over: Partial<Record<keyof InboxItem, unknown>> & { id: string; lane: InboxItem['lane'] },
) =>
  ({
    kind: 'people.details',
    module: 'people',
    area: null,
    icon: 'edit',
    tone: null,
    title: over.id,
    summary: null,
    from: null,
    at: '2026-10-05T09:00:00.000Z',
    due: null,
    dueVerb: 'due',
    status: null,
    outcome: null,
    count: null,
    team: null,
    replies: 0,
    link: '/people/me',
    openIn: 'People',
    message: null,
    detail: null,
    ...over,
  }) as InboxItem;

const items = shape(
  [
    item({ id: 'nid', lane: 'task', title: 'Correct your National ID', due: '2026-10-08' }),
    item({ id: 'sig', lane: 'task', title: 'Sign the addendum', due: '2026-10-10' }),
    item({ id: 'later', lane: 'task', title: 'Fill in your tax form', due: '2026-10-30' }),
    item({
      id: 'addr',
      lane: 'request',
      title: 'Change your address',
      status: { label: 'With Ada Lovelace', tone: 'warning' },
      detail: { nudge: { from: '2026-10-07T09:00:00.000Z', used: false } },
    }),
    item({ id: 'u1', lane: 'update', title: 'Marco approved your time off' }),
  ],
  EMPTY_STATE,
  NOW,
);

describe('asking about your Inbox', () => {
  it('says what is due this week, nearest first', () => {
    const r = answerInbox('What do I need to do this week?', items, NOW, 'UTC');
    expect(r.text).toBe('2 tasks are due this week. Correct your National ID is due tomorrow.');
    expect(r.items.map((i) => i.id)).toEqual(['nid', 'sig']);
  });

  it('says who has a request and offers the nudge once it is open', () => {
    const r = answerInbox('Has Ada looked at my address change?', items, NOW, 'UTC');
    expect(r.text).toContain('with ada lovelace');
    expect(r.nudge).toEqual({ itemId: 'addr', label: 'Nudge Ada' });
  });

  it('lists what waits on others and what is new', () => {
    expect(
      answerInbox('What’s waiting on others?', items, NOW, 'UTC').items.map((i) => i.id),
    ).toEqual(['addr']);
    expect(answerInbox('Any updates?', items, NOW, 'UTC').text).toBe(
      '1 update you haven’t opened.',
    );
  });

  it('knows an Inbox question from another', () => {
    expect(aboutInbox('What do I need to do this week?')).toBe(true);
    expect(aboutInbox('Who reports to me?')).toBe(false);
  });
});
