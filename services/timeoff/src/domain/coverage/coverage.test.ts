import { describe, expect, it } from 'vitest';

import { MONDAY_TO_FRIDAY, type WorkCalendar } from '../calendar/working-days.js';
import { coverage } from './coverage.js';
import { d, members, october, platform } from './october-2026.fixture.js';

describe('coverage and team minimums (PRD §9.3, T13)', () => {
  const month = { members, absences: october, from: d('2026-10-01'), to: d('2026-10-31') };

  it('October gives 4 of 7 on the 21st and nothing else below 5', () => {
    const result = coverage({ ...month, minimum: { atLeast: 5, unit: 'people' } });
    expect(result.below).toEqual([d('2026-10-21')]);
    expect(result.days.find((day) => day.date === '2026-10-21')).toEqual({
      date: d('2026-10-21'),
      in: 4,
      of: 7,
      required: 5,
      checked: true,
      below: true,
    });
  });

  it('a percentage rounds up to whole people: 70% of 7 is 5', () => {
    const result = coverage({ ...month, minimum: { atLeast: 70, unit: 'percent' } });
    expect(result.below).toEqual([d('2026-10-21')]);
    expect(result.days[0]?.required).toBe(5);
  });

  it('weekends and a holiday everyone has are not checked', () => {
    const result = coverage({ ...month, minimum: { atLeast: 5, unit: 'people' } });
    const day = (s: string) => result.days.find((x) => x.date === s);
    expect(day('2026-10-12')).toMatchObject({ in: 0, checked: false, below: false });
    expect(day('2026-10-17')).toMatchObject({ checked: false, below: false });
  });

  it('a holiday only some of the team have leaves the rest in', () => {
    const barcelona: WorkCalendar = { pattern: MONDAY_TO_FRIDAY, holidays: new Set() };
    const mixed = [{ personId: platform.marco, calendar: barcelona }, ...members.slice(1)];
    const result = coverage({ ...month, members: mixed, minimum: { atLeast: 5, unit: 'people' } });
    expect(result.days.find((x) => x.date === '2026-10-12')).toMatchObject({
      in: 1,
      checked: true,
      below: true,
    });
  });

  it('someone whose pattern does not include the day is not in', () => {
    const fourDays: WorkCalendar = { pattern: new Set([1, 2, 3, 4]), holidays: new Set() };
    const result = coverage({
      ...month,
      members: members.map((m, i) => ({
        personId: m.personId,
        calendar: i < 3 ? fourDays : m.calendar,
      })),
      minimum: { atLeast: 5, unit: 'people' },
    });
    expect(result.days.find((x) => x.date === '2026-10-02')).toMatchObject({ in: 3, below: true });
  });

  it('declined and withdrawn requests are not passed in, so only approved and pending count', () => {
    const result = coverage({
      ...month,
      absences: october.filter((a) => a.status === 'approved'),
      minimum: { atLeast: 5, unit: 'people' },
    });
    expect(result.below).toEqual([]);
  });
});
