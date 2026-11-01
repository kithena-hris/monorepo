import { describe, expect, it } from 'vitest';
import type { InboxItem } from '@kithena/contracts';

import {
  countsOf,
  changed,
  EMPTY_STATE,
  feedOf,
  filtered,
  groupsOf,
  itemsOf,
  opensScreen,
  prune,
  shape,
  snoozedOf,
  snoozeUntil,
  stateOf,
} from './model';

const NOW = '2026-10-07T10:00:00.000Z';
const ZONE = 'Europe/Madrid';

type Over = Omit<Partial<InboxItem>, 'at' | 'due' | 'team'> &
  Pick<InboxItem, 'id' | 'lane'> & { at?: string; due?: string | null; team?: unknown };
const item = (over: Over): InboxItem =>
  ({
    kind: 'people.details',
    module: 'people',
    area: null,
    icon: 'user-round',
    tone: null,
    title: over.id,
    summary: null,
    from: null,
    at: '2026-10-06T09:00:00.000Z',
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

describe('the Inbox, merged', () => {
  it('drops an item that does not parse rather than guessing', () => {
    const items = itemsOf([
      { items: [item({ id: 'people:details:a', lane: 'task' }), { id: 'nope' }] },
      null,
      { items: [item({ id: 'timeoff:approval:b', lane: 'task', module: 'timeoff' })] },
    ]);
    expect(items.map((i) => i.id)).toEqual(['people:details:a', 'timeoff:approval:b']);
  });

  it('counts tasks only, a queue once, and not one snoozed, cancelled or taken by somebody else', () => {
    const shown = shape(
      [
        item({ id: 'people:details:a', lane: 'task' }),
        item({ id: 'people:review:queue', lane: 'task', count: 12 }),
        item({ id: 'people:details:b', lane: 'task' }),
        item({
          id: 'people:details:c',
          lane: 'task',
          outcome: { label: 'Cancelled', tone: 'neutral' },
        }),
        item({
          id: 'people:integration:d',
          lane: 'task',
          team: {
            role: 'All admins',
            takenBy: { name: 'Priya', personId: null },
            takenAt: NOW,
            mine: false,
          },
        }),
        item({ id: 'timeoff:decided:e', lane: 'update' }),
        item({ id: 'people:change:f', lane: 'request' }),
      ],
      { ...EMPTY_STATE, snoozed: { 'people:details:b': '2026-10-08T09:00:00.000Z' } },
      NOW,
    );
    expect(countsOf(shown)).toEqual({ todo: 2, updates: 1, requests: 1 });
    expect(shown.filter((i) => i.dim).map((i) => i.id)).toEqual([
      'people:details:c',
      'people:integration:d',
    ]);
    expect(snoozedOf(shown).map((i) => i.id)).toEqual(['people:details:b']);
  });

  it('reads an update when opened, all before a moment, and again unread when asked', () => {
    const items = [
      item({ id: 'u1', lane: 'update', at: '2026-10-05T09:00:00.000Z' }),
      item({ id: 'u2', lane: 'update', at: '2026-10-07T09:00:00.000Z' }),
      item({ id: 'u3', lane: 'update', at: '2026-10-07T09:30:00.000Z' }),
    ];
    const shown = shape(
      items,
      { ...EMPTY_STATE, readBefore: '2026-10-06T00:00:00.000Z', read: ['u2'], unread: ['u1'] },
      NOW,
    );
    expect(shown.filter((i) => i.unread).map((i) => i.id)).toEqual(['u1', 'u3']);
  });

  it('tidies updates into Done after 30 days, and muted ones at once', () => {
    const shown = shape(
      [
        item({ id: 'old', lane: 'update', at: '2026-09-01T09:00:00.000Z' }),
        item({ id: 'hol', lane: 'update', kind: 'timeoff.holidays', module: 'timeoff' }),
        item({ id: 'moved', lane: 'update' }),
        item({ id: 'fresh', lane: 'update' }),
      ],
      {
        ...EMPTY_STATE,
        done: { moved: NOW },
        muted: [{ what: 'timeoff.holidays', inbox: true, email: true, phone: true }],
      },
      NOW,
    );
    expect(shown.filter((i) => i.lane === 'done').map((i) => i.id)).toEqual([
      'old',
      'hol',
      'moved',
    ]);
  });

  it('groups To do by due date with queues last, updates by day, Done by month', () => {
    const shown = shape(
      [
        item({ id: 'later', lane: 'task', due: '2026-10-30' }),
        item({ id: 'over', lane: 'task', due: '2026-10-01' }),
        item({ id: 'week', lane: 'task', due: '2026-10-10' }),
        item({ id: 'queue', lane: 'task', count: 3 }),
        item({ id: 'today', lane: 'update', at: '2026-10-07T08:00:00.000Z' }),
        item({ id: 'yday', lane: 'update', at: '2026-10-06T08:00:00.000Z' }),
        item({ id: 'oct', lane: 'done', at: '2026-10-02T08:00:00.000Z' }),
        item({ id: 'sep', lane: 'done', at: '2026-09-02T08:00:00.000Z' }),
        item({ id: 'y24', lane: 'done', at: '2024-09-02T08:00:00.000Z' }),
      ],
      EMPTY_STATE,
      NOW,
    );
    const labels = (lane: Parameters<typeof groupsOf>[1]) =>
      groupsOf(shown, lane, NOW, ZONE).map((g) => [g.label, g.items.map((i) => i.id)]);
    expect(labels('todo')).toEqual([
      ['Overdue', ['over']],
      ['Due this week', ['week']],
      ['Later', ['later']],
      ['Queues', ['queue']],
    ]);
    expect(labels('updates')).toEqual([
      ['Today', ['today']],
      ['Yesterday', ['yday']],
    ]);
    expect(labels('done')).toEqual([
      ['October', ['oct']],
      ['September', ['sep']],
      ['2024', ['y24']],
    ]);
  });

  it('filters by source and words, and never snoozes past the due date', () => {
    const shown = shape(
      [
        item({ id: 'a', lane: 'task', title: 'Add your bank account' }),
        item({ id: 'b', lane: 'task', module: 'timeoff', title: 'Adam · 28–30 Dec' }),
      ],
      EMPTY_STATE,
      NOW,
    );
    expect(filtered(shown, { source: 'timeoff' }).map((i) => i.id)).toEqual(['b']);
    expect(filtered(shown, { q: 'bank' }).map((i) => i.id)).toEqual(['a']);
    expect(snoozeUntil({ due: '2026-10-08' } as never, '2026-10-12T09:00:00.000Z')).toBe(
      '2026-10-08T09:00:00.000Z',
    );
    expect(snoozeUntil({ due: null }, '2026-10-12T09:00:00.000Z')).toBe('2026-10-12T09:00:00.000Z');
  });

  it('keeps the state to what is still shown, and survives a bad one', () => {
    const kept = prune(
      { ...EMPTY_STATE, read: ['gone', 'here'], snoozed: { gone: NOW, here: NOW } },
      [item({ id: 'here', lane: 'update' })],
    );
    expect(kept.read).toEqual(['here']);
    expect(Object.keys(kept.snoozed)).toEqual(['here']);
    expect(stateOf({ read: 'not a list' })).toEqual(EMPTY_STATE);
  });
});

describe('an id that names a prototype property', () => {
  it('is kept as the item’s own entry and changes nothing else', () => {
    const ticked = changed(EMPTY_STATE, { kind: 'tick', id: '__proto__', step: 'a', on: true });
    expect(Object.hasOwn(ticked.ticks, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(ticked.ticks)).toBe(Object.prototype);
    const snoozed = changed(EMPTY_STATE, {
      kind: 'snooze',
      id: '__proto__',
      until: '2026-10-12T09:00:00.000Z',
      due: null,
    });
    expect(Object.hasOwn(snoozed.snoozed, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('the feed: new on top, then what each needs from you', () => {
  const at = (h: number) => `2026-10-07T0${String(h)}:00:00.000Z`;
  const items = [
    item({ id: 'fresh-task', lane: 'task', at: at(9) }),
    item({ id: 'old-task', lane: 'task', at: '2026-09-01T09:00:00.000Z', due: '2026-10-01' }),
    item({ id: 'later-task', lane: 'task', at: '2026-09-02T09:00:00.000Z', due: '2026-10-20' }),
    item({ id: 'fresh-news', lane: 'update', at: at(8) }),
    item({ id: 'old-news', lane: 'update', at: at(1) }),
    item({ id: 'asked', lane: 'request', at: at(2) }),
    ...[3, 4, 5].map((h) =>
      item({
        id: `card-${String(h)}`,
        lane: 'task',
        kind: 'recruiting.scorecard',
        at: '2026-09-0' + String(h) + 'T09:00:00.000Z',
      }),
    ),
  ];
  const shown = shape(items, { ...EMPTY_STATE, read: ['old-news'] }, NOW);

  it('puts what arrived and is unopened first, newest first, and nowhere else', () => {
    const feed = feedOf(shown);
    expect(feed[0]?.key).toBe('new');
    expect(feed[0]?.entries.map((e) => (e.kind === 'item' ? e.item.id : e.key))).toEqual([
      'fresh-task',
      'fresh-news',
    ]);
    const rest = feed.slice(1).flatMap((s) => s.entries);
    expect(rest.some((e) => e.kind === 'item' && e.item.id === 'fresh-task')).toBe(false);
  });

  it('then Needs you by urgency with three of a kind stacked, Waiting on others, For your information', () => {
    const feed = feedOf(shown);
    expect(feed.map((s) => s.key)).toEqual(['new', 'needs', 'waiting', 'fyi']);
    const needs = feed[1]?.entries ?? [];
    expect(needs[0]).toMatchObject({ kind: 'item', item: { id: 'old-task' } });
    expect(needs.find((e) => e.kind === 'stack')).toMatchObject({
      kind: 'stack',
      key: 'recruiting.scorecard',
    });
    expect(feed[2]?.entries).toMatchObject([{ kind: 'item', item: { id: 'asked' } }]);
    expect(feed[3]?.entries).toMatchObject([{ kind: 'item', item: { id: 'old-news' } }]);
  });

  it('counts a task weeks old as seen, so a first visit is not all new', () => {
    expect(shown.find((i) => i.id === 'old-task')?.unread).toBe(false);
    expect(shown.find((i) => i.id === 'fresh-task')?.unread).toBe(true);
  });
});

describe('opensScreen', () => {
  it('draws the module’s screen for a task the Inbox has no form of its own for', () => {
    const review = item({
      id: 'r',
      lane: 'task',
      module: 'performance',
      kind: 'performance.review',
    });
    const unlock = item({
      id: 'u',
      lane: 'task',
      module: 'performance',
      kind: 'performance.unlock',
      detail: { kind: 'unlock', reviewId: 'r1' },
    });
    const sign = item({ id: 's', lane: 'task', module: 'documents', kind: 'documents.sign' });
    const scorecard = item({
      id: 'c',
      lane: 'task',
      module: 'recruiting',
      kind: 'recruiting.scorecard',
    });
    const reply = item({ id: 'y', lane: 'task', module: 'recruiting', kind: 'recruiting.reply' });
    expect(opensScreen(review)).toBe(true);
    expect(opensScreen(unlock)).toBe(false);
    expect(opensScreen(sign)).toBe(true);
    expect(opensScreen(scorecard)).toBe(false);
    expect(opensScreen(reply)).toBe(true);
  });

  it('leaves updates, requests and the modules with forms of their own alone', () => {
    expect(opensScreen(item({ id: 'a', lane: 'update', module: 'performance' }))).toBe(false);
    expect(opensScreen(item({ id: 'b', lane: 'task', module: 'people' }))).toBe(false);
    expect(opensScreen(item({ id: 'c', lane: 'task', module: 'timeoff' }))).toBe(false);
  });
});
