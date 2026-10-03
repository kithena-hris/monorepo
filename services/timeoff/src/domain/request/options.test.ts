import { describe, expect, it } from 'vitest';
import { CalendarDate } from '@kithena/contracts';

import { MONDAY_TO_FRIDAY, datesIn, type WorkCalendar } from '../calendar/working-days.js';
import { dateOptions, type TeamDay } from './options.js';

const d = (s: string): CalendarDate => CalendarDate.parse(s);
/** Madrid's October 2026: Monday 12 is Fiesta Nacional. */
const calendar: WorkCalendar = { pattern: MONDAY_TO_FRIDAY, holidays: new Set([d('2026-10-12')]) };
const october = { from: d('2026-10-01'), to: d('2026-10-31') };

/** Platform's seven, five needed; Omar and Yuki are off on Wednesday 21, so 5 of 7 are in. */
function team(): Map<CalendarDate, TeamDay> {
  const out = new Map<CalendarDate, TeamDay>();
  for (const date of datesIn(october.from, october.to)) {
    const checked = MONDAY_TO_FRIDAY.has(((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1);
    out.set(date, { in: date === '2026-10-21' ? 5 : 7, of: 7, required: 5, checked });
  }
  return out;
}

describe('dateOptions', () => {
  it('ranks by days away for days used, a holiday counting when it is wanted', () => {
    const options = dateOptions({
      calendar,
      window: october,
      days: 5,
      booked: [],
      team: team(),
      nextToHoliday: true,
      avoidShort: true,
    });
    expect(options[0]).toMatchObject({
      from: '2026-10-13',
      to: '2026-10-16',
      used: 4,
      away: { from: '2026-10-10', to: '2026-10-18', days: 9 },
      holidays: ['2026-10-12'],
      short: [],
    });
    expect(options).toHaveLength(3);
    // Never two that overlap.
    for (const [i, a] of options.entries()) {
      for (const b of options.slice(i + 1)) {
        expect(a.away.to < b.away.from || b.away.to < a.away.from).toBe(true);
      }
    }
  });

  it('says which days would leave the team short', () => {
    const options = dateOptions({
      calendar,
      window: { from: d('2026-10-19'), to: d('2026-10-23') },
      days: 5,
      booked: [],
      team: team(),
      nextToHoliday: false,
      avoidShort: true,
    });
    expect(options[0]).toMatchObject({
      from: '2026-10-19',
      to: '2026-10-23',
      short: [{ date: '2026-10-21', in: 4, of: 7, required: 5 }],
    });
  });

  it('skips days already booked and offers nothing in a window with no room', () => {
    const options = dateOptions({
      calendar,
      window: october,
      days: 5,
      booked: [{ from: d('2026-10-01'), to: d('2026-10-31') }],
      team: team(),
      nextToHoliday: false,
      avoidShort: false,
    });
    expect(options).toEqual([]);
  });
});
