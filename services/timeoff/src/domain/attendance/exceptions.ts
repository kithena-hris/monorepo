import { dateFormat } from '@kithena/domain-kit';
import type { CalendarDate, Instant } from '@kithena/contracts';

import { ms, type Shift } from './clock.js';
import type { Day } from './day.js';

/**
 * What HR acts on in attendance (PRD §11.7, T23), and the daily record a
 * labour inspector asks for.
 *
 * Only what needs action: a day nobody clocked out of, a night shorter than
 * the rest the rules require, overtime nobody has decided, and a holiday
 * worked (a day in lieu is owed). Everything else is a normal day and is not
 * listed.
 */

export type ExceptionKind =
  'missed_clock_out' | 'short_rest' | 'overtime_waiting' | 'worked_on_holiday';

export interface Exception {
  readonly kind: ExceptionKind;
  readonly date: CalendarDate;
  /** The rest taken, the overtime waiting or the time worked on the holiday. */
  readonly minutes: number | null;
  readonly holiday: string | null;
}

export function exceptionsOf(args: {
  readonly days: readonly Day[];
  readonly restBreaches: readonly { readonly date: CalendarDate; readonly restMinutes: number }[];
  /** The holidays where the member works. */
  readonly holidays: readonly { readonly date: CalendarDate; readonly name: string }[];
  /** Days whose overtime a manager already decided. */
  readonly decided: readonly CalendarDate[];
}): Exception[] {
  const holidays = new Map(args.holidays.map((h) => [h.date, h.name]));
  const found: Exception[] = args.restBreaches.map((r) => ({
    kind: 'short_rest',
    date: r.date,
    minutes: r.restMinutes,
    holiday: null,
  }));
  for (const day of args.days) {
    if (day.status === 'open') {
      found.push({ kind: 'missed_clock_out', date: day.date, minutes: null, holiday: null });
      continue;
    }
    if (day.status !== 'complete') continue;
    const holiday = holidays.get(day.date);
    if (holiday !== undefined && (day.workedMinutes ?? 0) > 0) {
      found.push({
        kind: 'worked_on_holiday',
        date: day.date,
        minutes: day.workedMinutes,
        holiday,
      });
    }
    if (day.overtimeMinutes > 0 && !args.decided.includes(day.date)) {
      found.push({
        kind: 'overtime_waiting',
        date: day.date,
        minutes: day.overtimeMinutes,
        holiday: null,
      });
    }
  }
  return found.toSorted((a, b) => a.date.localeCompare(b.date) || rank(a.kind) - rank(b.kind));
}

const ORDER: readonly ExceptionKind[] = [
  'worked_on_holiday',
  'short_rest',
  'overtime_waiting',
  'missed_clock_out',
];
const rank = (kind: ExceptionKind): number => ORDER.indexOf(kind);

/** One shift as the inspector reads it: wall times in the member's zone. */
export interface DailyRecord {
  readonly date: CalendarDate;
  readonly start: string;
  /** `null` when nobody clocked out. */
  readonly end: string | null;
  readonly breaks: readonly { readonly start: string; readonly end: string | null }[];
  readonly breakMinutes: number;
  /** `null` while the end is not known. */
  readonly workedMinutes: number | null;
}

/**
 * The per-person daily record (§11.7): start, end and breaks for each shift,
 * from the punches that still stand. Times only, never a location or a
 * source; a correction already replaced what it superseded.
 */
export function dailyRecord(shifts: readonly Shift[], timeZone: string): DailyRecord[] {
  const time = (i: Instant): string =>
    dateFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(ms(i));
  const minutes = (from: Instant, to: Instant): number =>
    Math.floor(ms(to) / 60_000) - Math.floor(ms(from) / 60_000);
  return shifts.map((s) => {
    const breakMinutes = s.breaks.reduce(
      (n, b) => n + (b.end === null ? 0 : minutes(b.start.at, b.end.at)),
      0,
    );
    return {
      date: s.date,
      start: time(s.in.at),
      end: s.out === null ? null : time(s.out.at),
      breaks: s.breaks.map((b) => ({
        start: time(b.start.at),
        end: b.end === null ? null : time(b.end.at),
      })),
      breakMinutes,
      workedMinutes: s.out === null ? null : minutes(s.in.at, s.out.at) - breakMinutes,
    };
  });
}
