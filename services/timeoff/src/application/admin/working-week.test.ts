import { describe, expect, it } from 'vitest';

import { workingWeeks } from '../screens/employee.js';
import { caller, hr, people, world } from '../testing/world.js';
import { setDefaultSchedule } from './admin.js';

/** T33: HR sets the company's working week; anyone may read who works when, for a meeting. */
describe('the company working week', () => {
  it('is the standard week until HR sets one, then theirs, and only HR may set it', async () => {
    const app = world('2026-10-05T07:00:00.000Z');
    const adam = caller(people.adam);
    const before = await workingWeeks(app.deps)(adam, [people.adam]);
    expect(before.ok && before.value.weeks[0]?.days.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5]);

    const week = {
      kind: 'fixed' as const,
      name: 'Standard',
      week: {
        1: { start: 600, end: 1080, breakMinutes: 30 },
        2: { start: 600, end: 1080, breakMinutes: 30 },
      },
    };
    expect((await setDefaultSchedule(app.deps)(adam, week)).ok).toBe(false);
    expect((await setDefaultSchedule(app.deps)(hr, week)).ok).toBe(true);
    const after = await workingWeeks(app.deps)(adam, [people.adam, people.marco]);
    expect(after.ok && after.value.weeks.map((w) => w.days)).toEqual([
      [
        { weekday: 1, start: 600, end: 1080 },
        { weekday: 2, start: 600, end: 1080 },
      ],
      [
        { weekday: 1, start: 600, end: 1080 },
        { weekday: 2, start: 600, end: 1080 },
      ],
    ]);

    const backwards = { ...week, week: { 1: { start: 1080, end: 600, breakMinutes: 0 } } };
    const refused = await setDefaultSchedule(app.deps)(hr, backwards);
    expect(refused.ok ? null : refused.error.code).toBe('HOURS_ORDER');
  });
});
