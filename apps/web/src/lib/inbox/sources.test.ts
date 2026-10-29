import { describe, expect, it } from 'vitest';

import { EMPTY_STATE } from './model';
import { readInbox, type Run } from './sources';

const NOW = '2026-10-07T10:00:00.000Z';

const item = (id: string, from: { name: string; personId: string | null } | null) => ({
  id,
  lane: 'task',
  kind: 'timeoff.approval',
  module: 'timeoff',
  area: null,
  icon: 'leave',
  tone: null,
  title: id,
  summary: null,
  from,
  at: '2026-10-06T09:00:00.000Z',
  due: null,
  dueVerb: 'decide',
  status: null,
  outcome: null,
  count: null,
  team: null,
  replies: 0,
  link: '/time-off',
  openIn: 'Time Off',
  message: null,
  detail: null,
});

describe('the Inbox, read', () => {
  it('puts the face People lets the reader see on what each person sent, and asks only once', async () => {
    const asked: string[] = [];
    const run: Run = (area, name, variables) => {
      asked.push(`${area}:${name}`);
      if (name === 'Names') {
        expect(variables).toEqual({ personIds: ['p1', 'p2'] });
        return Promise.resolve({
          ok: true,
          data: {
            people: [
              { personId: 'p1', avatarUrl: 'https://cdn.example/p1.jpg' },
              { personId: 'p2', avatarUrl: null },
            ],
          },
        });
      }
      // People's own Inbox has nothing in it here; Time Off's has the requests.
      if (area === 'people') return Promise.resolve({ ok: true, data: { items: [] } });
      return Promise.resolve({
        ok: true,
        data: {
          items: [
            item('timeoff:approval:a', { name: 'Priya Shah', personId: 'p1' }),
            item('timeoff:approval:b', { name: 'Jonas Weber', personId: 'p2' }),
            item('timeoff:approval:c', { name: 'Priya Shah', personId: 'p1' }),
            item('timeoff:approval:d', null),
          ],
        },
      });
    };
    const read = await readInbox(['module.timeoff', 'module.people'], run, EMPTY_STATE, NOW);
    expect(read.items.map((i) => i.photo)).toEqual([
      'https://cdn.example/p1.jpg',
      undefined,
      'https://cdn.example/p1.jpg',
      undefined,
    ]);
    expect(asked.filter((a) => a === 'people:Names')).toHaveLength(1);
  });

  it('keeps initials without People', async () => {
    const run: Run = (_area, name) =>
      Promise.resolve(
        name === 'Names'
          ? { ok: false, code: 'FORBIDDEN', message: 'no' }
          : {
              ok: true,
              data: { items: [item('timeoff:approval:a', { name: 'Priya', personId: 'p1' })] },
            },
      );
    const read = await readInbox(['module.timeoff'], run, EMPTY_STATE, NOW);
    expect(read.items[0]?.photo).toBeUndefined();
  });
});
