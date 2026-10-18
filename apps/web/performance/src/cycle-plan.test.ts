import { describe, expect, it } from 'vitest';

import { planRows, reminderDates, resolveDue } from './cycle-plan';

const plan = {
  start: { date: '2026-11-02' },
  nominations: { kind: 'relative' as const, days: 3, from: 'start' as const },
  activities: {
    self: { on: true, due: { kind: 'relative' as const, days: 14, from: 'start' as const } },
    peer: { on: true, due: { kind: 'relative' as const, days: 10, from: 'nominations' as const } },
    manager: { on: false, due: { kind: 'relative' as const, days: 21 } },
  },
  peer: { all: false },
  reminders: { rules: ['before:3', 'on_day', 'late:2'] },
};

describe('cycle plan', () => {
  it('works a relative deadline out from the start or from nominations', () => {
    expect(resolveDue(plan, plan.activities.self.due)).toBe('2026-11-16');
    expect(resolveDue(plan, plan.activities.peer.due)).toBe('2026-11-15');
    expect(resolveDue(plan, { kind: 'exact', date: '2026-12-01' })).toBe('2026-12-01');
  });

  it('reminds before, on the day and three times when late, never before it opens', () => {
    expect(reminderDates(['before:3', 'on_day', 'late:2'], '2026-11-02', '2026-11-16')).toEqual([
      '2026-11-13',
      '2026-11-16',
      '2026-11-18',
      '2026-11-20',
      '2026-11-22',
    ]);
    expect(reminderDates(['before:7'], '2026-11-12', '2026-11-16')).toEqual([]);
  });

  it('draws a lane per review that is on, with its deadline and reminders pinned', () => {
    const rows = planRows(plan, (k) => k);
    expect(rows.map((r) => r.label)).toEqual(['Nominations', 'self', 'peer']);
    const peer = rows[2]?.items ?? [];
    expect(peer[0]).toMatchObject({ start: '2026-11-05', end: '2026-11-15' });
    expect(peer.filter((i) => i.label === 'Reminder')).toHaveLength(4);
  });
});
