import { describe, expect, it } from 'vitest';

import { quietNow, whatToSay } from './say';

const item = (over: Record<string, unknown>) => ({
  id: 'x',
  lane: 'task',
  kind: 'people.details',
  counted: true,
  unread: false,
  due: null,
  title: 't',
  ...over,
});
const inbox = (items: Record<string, unknown>[]) =>
  ({
    lanes: { todo: [{ label: null, items: items.map(item) }], updates: [], requests: [], done: [] },
    zone: 'UTC',
  }) as never;

describe('the phone’s Inbox notifications', () => {
  it('says new tasks one by one and new updates together, not what was said before', () => {
    const said = whatToSay(
      inbox([
        { id: 'a' },
        { id: 'b' },
        { id: 'u1', lane: 'update', counted: false, unread: true },
        { id: 'u2', lane: 'update', counted: false, unread: true, kind: 'people.team' },
      ]),
      { updates: { team: { phone: false } } },
      new Set(['b']),
      new Date('2026-10-07T10:00:00'),
    );
    expect(said.tasks.map((t) => t.id)).toEqual(['a']);
    expect(said.updates.map((u) => u.id)).toEqual(['u1']);
  });

  it('holds everything in quiet hours but a task due today', () => {
    const night = new Date('2026-10-07T22:30:00');
    const settings = { quiet: { on: true, from: '19:00', to: '08:00', weekends: true } };
    expect(quietNow(settings, night)).toBe(true);
    expect(quietNow(settings, new Date('2026-10-07T09:00:00'))).toBe(false);
    expect(quietNow(settings, new Date('2026-10-10T12:00:00'))).toBe(true);
    const said = whatToSay(
      inbox([
        { id: 'today', due: '2026-10-07' },
        { id: 'later', due: '2026-10-20' },
      ]),
      settings,
      new Set(),
      night,
    );
    expect(said.tasks.map((t) => t.id)).toEqual(['today']);
  });
});
