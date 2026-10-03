import { describe, expect, it } from 'vitest';
import { CalendarDate, DayAmount, PersonId, TeamKey } from '@kithena/contracts';

import { describable, whatChanged, type Facts, type Monthly } from './insights.js';

const d = (s: string) => CalendarDate.parse(s);
const days = (s: string) => DayAmount.parse(s);
const person = (n: number) =>
  PersonId.parse(`00000000-0000-7000-8000-${String(n).padStart(12, '0')}`);
const engineering = TeamKey.parse('engineering');
const sales = TeamKey.parse('sales');

const fact = (n: number, over: Partial<Facts> = {}): Facts => ({
  personId: person(n),
  team: engineering,
  hireDate: d('2022-01-10'),
  lastDayOff: d('2026-08-14'),
  left: days('10.000'),
  losesAtYearEnd: days('0.000'),
  ...over,
});
const month = (m: string, over: Partial<Monthly> = {}): Monthly => ({
  month: m,
  vacation: days('0.000'),
  personal: days('0.000'),
  sick: days('0.000'),
  missedClockOuts: 0,
  overtimeMinutes: 0,
  ...over,
});

// Eleven engineers with no day off since May, two in sales, one new joiner.
const facts: Facts[] = [
  ...Array.from({ length: 11 }, (_, i) => fact(i + 1, { lastDayOff: d('2026-04-30') })),
  fact(20, { team: sales, lastDayOff: null, losesAtYearEnd: days('3.000') }),
  fact(21, { team: sales, left: days('12.500'), losesAtYearEnd: days('7.500') }),
  fact(30, { hireDate: d('2026-07-01'), lastDayOff: null }),
];
const months = [
  month('2026-08', { missedClockOuts: 19, overtimeMinutes: 600 }),
  month('2026-09', { missedClockOuts: 6, overtimeMinutes: 828 }),
];

describe('whatChanged (PRD §14.2, the month summary)', () => {
  it('counts unbooked days and who would lose some, by the domain alone', () => {
    const [unbooked] = whatChanged({ facts, months, since: d('2026-05-01'), cohortMinimum: 10 });
    expect(unbooked).toEqual({
      kind: 'unbooked',
      days: '142.500',
      personIds: [person(20), person(21)],
    });
  });

  it('finds who has had no day off since a date, leaving out who joined after it', () => {
    const points = whatChanged({ facts, months, since: d('2026-05-01'), cohortMinimum: 10 });
    expect(points.find((p) => p.kind === 'no_break')).toEqual({
      kind: 'no_break',
      since: '2026-05-01',
      personIds: [...Array.from({ length: 11 }, (_, i) => person(i + 1)), person(20)],
      // Eleven of them in one team: a group large enough to describe.
      largestTeam: { team: engineering, count: 11 },
    });
  });

  it('never describes a group smaller than the cohort minimum', () => {
    const points = whatChanged({ facts, months, since: d('2026-05-01'), cohortMinimum: 12 });
    expect(points.find((p) => p.kind === 'no_break')).toMatchObject({ largestTeam: null });
  });

  it('compares this month’s missed clock-outs and overtime with last month’s, and omits a still month', () => {
    const points = whatChanged({ facts, months, since: d('2026-05-01'), cohortMinimum: 10 });
    expect(points.slice(2)).toEqual([
      { kind: 'missed_clock_outs', thisMonth: 6, lastMonth: 19 },
      { kind: 'overtime', thisMonthMinutes: 828, lastMonthMinutes: 600 },
    ]);
    const quiet = whatChanged({
      facts,
      months: [month('2026-08'), month('2026-09')],
      since: d('2026-05-01'),
      cohortMinimum: 10,
    });
    expect(quiet.map((p) => p.kind)).toEqual(['unbooked', 'no_break']);
  });
});

describe('describable', () => {
  it('keeps the groups at or above the minimum and counts the rest', () => {
    expect(
      describable(
        [
          { team: 'a', people: 10 },
          { team: 'b', people: 9 },
          { team: 'c', people: 40 },
        ],
        10,
      ),
    ).toEqual({
      shown: [
        { team: 'a', people: 10 },
        { team: 'c', people: 40 },
      ],
      hidden: 1,
    });
  });
});
