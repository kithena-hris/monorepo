import type { CalendarDate, DateSpan, PersonId } from '@kithena/contracts';

import { datesIn, isWorkingDay, type WorkCalendar } from '../calendar/working-days.js';

/**
 * Who is in, day by day, against the team's minimum (PRD §9.3).
 *
 * A minimum warns; whether it blocks is the policy's `blockBelowMinimum`, and
 * the caller's decision. This only counts.
 */

/** "At least N of M in" or "at least P% in" (T34). */
export interface TeamMinimum {
  readonly atLeast: number;
  readonly unit: 'people' | 'percent';
}

export interface TeamMember {
  readonly personId: PersonId;
  /** Their own pattern and their own location's holidays. */
  readonly calendar: WorkCalendar;
}

/** Time off that keeps someone out. Declined, withdrawn and cancelled are never passed in. */
export interface Absence {
  readonly personId: PersonId;
  readonly span: DateSpan;
  readonly status: 'approved' | 'pending';
}

export interface DayCoverage {
  readonly date: CalendarDate;
  readonly in: number;
  /** The team's size: "4 of 7". */
  readonly of: number;
  readonly required: number;
  /** Whether anyone on the team was due to work. A weekend, or a holiday they all have, is not held to the minimum. */
  readonly checked: boolean;
  readonly below: boolean;
}

/** Whole people, rounded up: 70% of 7 is 4.9, and 4 people is not 70%. */
export const requiredIn = (minimum: TeamMinimum, teamSize: number): number =>
  minimum.unit === 'people' ? minimum.atLeast : Math.ceil((minimum.atLeast * teamSize) / 100);

export function coverage(input: {
  readonly members: readonly TeamMember[];
  readonly absences: readonly Absence[];
  readonly minimum: TeamMinimum;
  readonly from: CalendarDate;
  readonly to: CalendarDate;
}): { readonly days: DayCoverage[]; readonly below: CalendarDate[] } {
  const of = input.members.length;
  const required = requiredIn(input.minimum, of);
  // A half day off counts as out: a minimum that warns too early costs a glance, one that warns too late costs the day.
  const isOff = (personId: PersonId, date: CalendarDate) =>
    input.absences.some((a) => a.personId === personId && a.span.from <= date && date <= a.span.to);

  const days = datesIn(input.from, input.to).map((date): DayCoverage => {
    const due = input.members.filter((m) => isWorkingDay(date, m.calendar));
    const present = due.filter((m) => !isOff(m.personId, date)).length;
    const checked = due.length > 0;
    return { date, in: present, of, required, checked, below: checked && present < required };
  });
  return { days, below: days.filter((day) => day.below).map((day) => day.date) };
}
