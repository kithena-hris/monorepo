import { describe, expect, it } from 'vitest';
import { CalendarDate } from '@kithena/contracts';

import { holidayDates, resolveHolidays, type HolidayLayer } from './holiday-calendar.js';

const d = (s: string) => CalendarDate.parse(s);
const layer = (
  key: string,
  weekendRule: HolidayLayer['weekendRule'],
  holidays: [string, string][],
  level: HolidayLayer['level'] = 'national',
): HolidayLayer => ({
  key,
  name: key,
  level,
  weekendRule,
  holidays: holidays.map(([date, name]) => ({ date: d(date), name })),
});

describe('layered holiday calendars (PRD §10.2)', () => {
  const national = layer('nation', 'none', [
    ['2026-01-01', 'New Year'],
    ['2026-08-15', 'Assumption'],
    ['2027-01-01', 'New Year'],
  ]);
  const region = layer('region', 'none', [['2026-04-02', 'Maundy Thursday']], 'regional');
  const city = layer('city', 'none', [['2026-05-15', 'Patron saint']], 'city');

  it('a location gets every layer’s days for the year asked, in date order', () => {
    expect(resolveHolidays([city, national, region], 2026).map((h) => [h.date, h.layer])).toEqual([
      ['2026-01-01', 'nation'],
      ['2026-04-02', 'region'],
      ['2026-05-15', 'city'],
      ['2026-08-15', 'nation'],
    ]);
  });

  it('a layer with no weekend rule leaves a Saturday holiday where it falls', () => {
    expect(holidayDates([national], 2026).has(d('2026-08-15'))).toBe(true);
  });

  it('move_to_monday moves a weekend holiday to the next weekday no other holiday holds', () => {
    // England 2027: Christmas on a Saturday, Boxing Day on a Sunday.
    const england = layer('england', 'move_to_monday', [
      ['2027-12-25', 'Christmas Day'],
      ['2027-12-26', 'Boxing Day'],
    ]);
    expect(resolveHolidays([england], 2027)).toEqual([
      {
        date: d('2027-12-27'),
        name: 'Christmas Day',
        layer: 'england',
        movedFrom: d('2027-12-25'),
      },
      { date: d('2027-12-28'), name: 'Boxing Day', layer: 'england', movedFrom: d('2027-12-26') },
    ]);
  });

  it('a moved day does not land on a weekday another layer already holds', () => {
    const moving = layer('moving', 'move_to_monday', [['2026-10-11', 'Sunday holiday']]);
    const fixed = layer('fixed', 'none', [['2026-10-12', 'Monday holiday']], 'regional');
    expect([...holidayDates([moving, fixed], 2026)]).toEqual([d('2026-10-12'), d('2026-10-13')]);
  });

  it('a day moved across new year belongs to the year it is observed in', () => {
    const moving = layer('moving', 'move_to_monday', [['2022-12-31', 'Eve']]);
    expect(holidayDates([moving], 2022).size).toBe(0);
    expect([...holidayDates([moving], 2023)]).toEqual([d('2023-01-02')]);
  });

  it('the same date in two layers is one holiday', () => {
    const again = layer('again', 'none', [['2026-01-01', 'New Year']], 'regional');
    expect(
      resolveHolidays([national, again], 2026).filter((h) => h.date === '2026-01-01'),
    ).toHaveLength(1);
  });
});
