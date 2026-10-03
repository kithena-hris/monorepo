import { DateSpan, type CalendarDate, type PersonId } from '@kithena/contracts';

import {
  addDays,
  datesIn,
  isWorkingDay,
  weekday,
  type WorkCalendar,
} from '../calendar/working-days.js';
import {
  coverage,
  type Absence,
  type DayCoverage,
  type TeamMember,
  type TeamMinimum,
} from '../coverage/coverage.js';

/**
 * What to do about a request that breaks the team minimum (PRD §9.5, §9.6).
 *
 * Ranked by who each option inconveniences, and nothing else: the requester
 * changing their own dates first, then no change, then asking someone whose
 * time off was approved already. The AI writes the words; it never reorders.
 *
 * Every option carries the requester's dates under it and the coverage on
 * each, so a screen can say "keeps 5 of 7 in every day" without counting.
 * Swaps are whole days: a half day at the end of the original does not survive
 * being moved.
 */
export type Alternative =
  | (Option & {
      readonly kind: 'swap_days';
      readonly affects: 'requester';
      readonly swapped: {
        readonly out: readonly CalendarDate[];
        readonly in: readonly CalendarDate[];
      };
    })
  | (Option & { readonly kind: 'next_clean_week'; readonly affects: 'requester' })
  | (Option & { readonly kind: 'approve_as_asked'; readonly affects: 'nobody' })
  | (Option & {
      readonly kind: 'ask_teammate';
      readonly affects: 'teammate';
      readonly teammate: PersonId;
      /** Their approved time off that would move. Only ever a request, never a decision (§9.6). */
      readonly absence: DateSpan;
    });

interface Option {
  /** The requester's working days off under this option. */
  readonly dates: readonly CalendarDate[];
  /** The same days as contiguous spans, a weekend inside one costing nothing. */
  readonly spans: readonly DateSpan[];
  readonly coverage: readonly DayCoverage[];
}

/** How far ahead a swap or a clean week is looked for. */
const HORIZON_DAYS = 56;

export function alternatives(input: {
  readonly request: { readonly personId: PersonId; readonly span: DateSpan };
  readonly members: readonly TeamMember[];
  /** Everyone else's approved and pending time off. Not the request itself. */
  readonly absences: readonly Absence[];
  readonly minimum: TeamMinimum;
}): Alternative[] {
  const { request, members, minimum } = input;
  // Sorted, so the same inputs in another order rank and name the same teammates.
  const absences = input.absences.toSorted((a, b) =>
    a.span.from === b.span.from
      ? a.personId.localeCompare(b.personId)
      : a.span.from.localeCompare(b.span.from),
  );
  const calendar: WorkCalendar | undefined = members.find(
    (m) => m.personId === request.personId,
  )?.calendar;
  if (calendar === undefined) throw new Error('The requester is not on the team being covered');

  const asked = datesIn(request.span.from, request.span.to).filter((day) =>
    isWorkingDay(day, calendar),
  );
  const requesterOff = (spans: readonly DateSpan[]): Absence[] =>
    spans.map((span) => ({ personId: request.personId, span, status: 'pending' }));
  const coverageOn = (
    dates: readonly CalendarDate[],
    others: readonly Absence[],
    spans: readonly DateSpan[],
  ) => {
    const first = dates[0];
    const last = dates.at(-1);
    if (first === undefined || last === undefined) return [];
    const days = coverage({
      members,
      absences: [...others, ...requesterOff(spans)],
      minimum,
      from: first,
      to: last,
    }).days;
    return days.filter((day) => dates.includes(day.date));
  };
  const fineWithoutRequester = (day: CalendarDate) =>
    isWorkingDay(day, calendar) &&
    coverageOn([day], absences, [DateSpan.parse({ from: day, to: day })])[0]?.below === false;

  const asAsked = coverageOn(asked, absences, [request.span]);
  const approveAsAsked: Alternative = {
    kind: 'approve_as_asked',
    affects: 'nobody',
    dates: asked,
    spans: [request.span],
    coverage: asAsked,
  };
  const clash = asAsked.filter((day) => day.below).map((day) => day.date);
  if (clash.length === 0) return [approveAsAsked];

  const option = (dates: readonly CalendarDate[], others = absences) => {
    const spans = spansOf(dates, calendar);
    return { dates, spans, coverage: coverageOn(dates, others, spans) };
  };
  const ranked: Alternative[] = [];

  const replacements = datesIn(addDays(request.span.to, 1), addDays(request.span.to, HORIZON_DAYS))
    .filter(fineWithoutRequester)
    .slice(0, clash.length);
  if (replacements.length === clash.length) {
    const dates = [...asked.filter((day) => !clash.includes(day)), ...replacements];
    ranked.push({
      kind: 'swap_days',
      affects: 'requester',
      swapped: { out: clash, in: replacements },
      ...option(dates),
    });
  }

  const thisMonday = addDays(request.span.from, 1 - weekday(request.span.from));
  for (let week = 1; week * 7 <= HORIZON_DAYS; week += 1) {
    const monday = addDays(thisMonday, week * 7);
    const dates = datesIn(monday, addDays(monday, HORIZON_DAYS))
      .filter((day) => isWorkingDay(day, calendar))
      .slice(0, asked.length);
    if (dates.length === asked.length && dates.every(fineWithoutRequester)) {
      ranked.push({ kind: 'next_clean_week', affects: 'requester', ...option(dates) });
      break;
    }
  }

  ranked.push(approveAsAsked);

  const teammates = absences
    .filter((a) => a.status === 'approved' && a.personId !== request.personId)
    .filter((a) => clash.every((day) => a.span.from <= day && day <= a.span.to))
    .map((a) => {
      const rest = absences.filter((other) => other !== a);
      return { a, coverage: coverageOn(asked, rest, [request.span]) };
    })
    .filter(({ coverage: days }) => days.every((day) => !day.below))
    // The smallest ask first: one personal day before three days of somebody's holiday.
    .toSorted(
      (x, y) =>
        datesIn(x.a.span.from, x.a.span.to).length - datesIn(y.a.span.from, y.a.span.to).length,
    );
  for (const { a, coverage: days } of teammates) {
    ranked.push({
      kind: 'ask_teammate',
      affects: 'teammate',
      teammate: a.personId,
      absence: a.span,
      dates: asked,
      spans: [request.span],
      coverage: days,
    });
  }
  return ranked;
}

/** Runs of working days with nothing but non-working days between them. */
function spansOf(dates: readonly CalendarDate[], calendar: WorkCalendar): DateSpan[] {
  const runs: CalendarDate[][] = [];
  for (const day of dates) {
    const run = runs.at(-1);
    const last = run?.at(-1);
    const joined =
      run !== undefined &&
      last !== undefined &&
      datesIn(addDays(last, 1), addDays(day, -1)).every(
        (between) => !isWorkingDay(between, calendar),
      );
    if (joined) run.push(day);
    else runs.push([day]);
  }
  return runs.map((run) => DateSpan.parse({ from: run[0], to: run.at(-1) }));
}
