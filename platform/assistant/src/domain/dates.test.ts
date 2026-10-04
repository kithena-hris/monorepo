import { describe, expect, it } from 'vitest';
import { CalendarDate } from '@kithena/contracts';
import { fixedClock } from '@kithena/domain-kit';

import { resolve, spoken, todayIn, type Today } from './dates.js';

/**
 * Date references resolved in the asker's zone (assistant PRD §9.4). The
 * worked examples' company is in Madrid on Tuesday 6 October 2026.
 */

const madrid = todayIn('Europe/Madrid', fixedClock('2026-10-06T10:00:00Z'));
const day = (date: string, zone = 'Europe/Madrid'): Today => ({
  date: CalendarDate.parse(date),
  zone,
  utc: false,
});
const range = (from: string, to: string) => ({
  from: CalendarDate.parse(from),
  to: CalendarDate.parse(to),
});

describe('today, in the asker’s zone', () => {
  it('is the 7th at 00:30 in Madrid, when UTC still says the 6th', () => {
    expect(todayIn('Europe/Madrid', fixedClock('2026-10-06T22:30:00Z'))).toEqual({
      date: '2026-10-07',
      zone: 'Europe/Madrid',
      utc: false,
    });
  });

  it('falls back to UTC for an unknown zone or none, and says it did', () => {
    const clock = fixedClock('2026-10-06T22:30:00Z');
    expect(todayIn('Mars/Olympus_Mons', clock)).toEqual({
      date: '2026-10-06',
      zone: 'UTC',
      utc: true,
    });
    expect(todayIn(null, clock)).toEqual({ date: '2026-10-06', zone: 'UTC', utc: true });
  });
});

describe('a reference stands for its whole range', () => {
  it('reads days', () => {
    expect(resolve('today', madrid)).toEqual(range('2026-10-06', '2026-10-06'));
    expect(resolve('tomorrow', madrid)).toEqual(range('2026-10-07', '2026-10-07'));
    expect(resolve('yesterday', madrid)).toEqual(range('2026-10-05', '2026-10-05'));
  });

  it('reads weeks as Monday to Sunday', () => {
    expect(resolve('this_week', madrid)).toEqual(range('2026-10-05', '2026-10-11'));
    expect(resolve('next_week', madrid)).toEqual(range('2026-10-12', '2026-10-18'));
    expect(resolve('last_week', madrid)).toEqual(range('2026-09-28', '2026-10-04'));
  });

  it('reads next week on a Sunday as the week starting the next day', () => {
    expect(resolve('this_week', day('2026-10-11'))).toEqual(range('2026-10-05', '2026-10-11'));
    expect(resolve('next_week', day('2026-10-11'))).toEqual(range('2026-10-12', '2026-10-18'));
  });

  it('reads months whole, across a year’s end', () => {
    expect(resolve('this_month', madrid)).toEqual(range('2026-10-01', '2026-10-31'));
    expect(resolve('next_month', day('2026-12-15'))).toEqual(range('2027-01-01', '2027-01-31'));
    expect(resolve('last_month', day('2026-01-15'))).toEqual(range('2025-12-01', '2025-12-31'));
    expect(resolve('this_month', day('2028-02-10'))).toEqual(range('2028-02-01', '2028-02-29'));
  });

  it('passes a calendar date through', () => {
    expect(resolve(CalendarDate.parse('2026-10-12'), madrid)).toEqual(
      range('2026-10-12', '2026-10-12'),
    );
  });

  it('reads a range from the start of its first to the end of its last', () => {
    expect(resolve({ from: 'today', to: 'next_week' }, madrid)).toEqual(
      range('2026-10-06', '2026-10-18'),
    );
    expect(resolve({ from: 'next_week', to: 'today' }, madrid)).toBeNull();
  });
});

describe('dates as people say them', () => {
  it('says one day with its weekday', () => {
    expect(spoken(range('2026-10-06', '2026-10-06'), madrid)).toBe('Tuesday 6 October');
  });

  it('says a range within a month, across months and across years', () => {
    expect(spoken(range('2026-10-12', '2026-10-18'), madrid)).toBe('12–18 October');
    expect(spoken(range('2026-09-28', '2026-10-04'), madrid)).toBe('28 September–4 October');
    expect(spoken(range('2026-12-28', '2027-01-03'), madrid)).toBe(
      '28 December 2026–3 January 2027',
    );
  });

  it('gives the year when it is not this one', () => {
    expect(spoken(range('2027-01-04', '2027-01-04'), madrid)).toBe('Monday 4 January 2027');
    expect(spoken(range('2027-01-01', '2027-01-31'), madrid)).toBe('1–31 January 2027');
  });
});
