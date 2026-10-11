import { describe, expect, it } from 'vitest';

import { homeBrief, todoBrief, updatesBrief } from './brief';

const item = (over: Record<string, unknown>) => ({
  id: 'x',
  lane: 'task',
  kind: 'people.details',
  dueVerb: 'due',
  counted: true,
  unread: false,
  due: null,
  from: { name: 'Ada Lovelace', personId: null },
  title: 'Add an emergency contact',
  ...over,
});
const inbox = (items: Record<string, unknown>[]) =>
  ({
    lanes: {
      todo: [{ label: null, items: items.map(item) }],
      updates: [],
      requests: [],
      done: [],
    },
    now: '2026-10-07T09:00:00Z',
    zone: 'UTC',
  }) as never;

describe('the Inbox’s opening line', () => {
  it('names the one urgent task and when the rest is due', () => {
    const said = todoBrief(
      inbox([
        { id: 'a', title: 'Correct your National ID', due: '2026-10-08' },
        { id: 'b', due: '2026-10-15' },
      ]),
    );
    expect(said).toBe(
      'One thing is urgent: correct your National ID, due tomorrow. The rest can wait until 15 Oct.',
    );
  });

  it('counts time off waiting for a manager when nothing is pressing', () => {
    expect(
      todoBrief(
        inbox([
          { id: 'a', kind: 'timeoff.approval', dueVerb: 'decide', due: '2026-10-20' },
          { id: 'b', kind: 'timeoff.approval', dueVerb: 'decide', due: null },
        ]),
      ),
    ).toBe('Two time off requests wait for you.');
  });

  it('says nothing for an empty To do, and counts new updates', () => {
    expect(todoBrief(inbox([]))).toBeNull();
    expect(
      updatesBrief(
        inbox([
          { id: 'u1', lane: 'update', unread: true },
          { id: 'u2', lane: 'update', unread: true },
          { id: 'u3', lane: 'update' },
        ]),
      ),
    ).toBe('Two new updates. None need anything from you.');
  });

  it('opens Home on the most pressing task and the newest update', () => {
    expect(
      homeBrief(
        inbox([
          { id: 'a', title: 'Correct your National ID', due: '2026-10-08' },
          { id: 'u', lane: 'update', unread: true, title: 'Marco approved your time off' },
        ]),
      ),
    ).toBe('Ada asks: correct your National ID, due tomorrow. Marco approved your time off.');
  });
});
