import { dateFormat, err, failure, localDate, ok, type Result } from '@kithena/domain-kit';
import type { CalendarDate, Instant, PunchSource } from '@kithena/contracts';

import { ms, type Shift } from './clock.js';
import { daysBetween, plannedOn, type PlannedDay, type Schedule } from './schedule.js';

/**
 * A working day against its schedule (PRD §11.3, §11.5; T20, MT17).
 *
 * Durations are whole minutes from the instants, so a day that crosses a
 * daylight-saving change is still as long as it was. Segments are minutes
 * after the day's local midnight, which is what the 07:00–19:00 bar draws; a
 * night shift runs past 1440.
 */

/** T33's "Breaks and limits" and "Overtime becomes". */
export interface AttendanceRules {
  /** More than this worked needs a break of at least `breakMinutes`. */
  readonly breakAfterMinutes: number;
  readonly breakMinutes: number;
  /** Between the end of one day and the start of the next. */
  readonly restMinutes: number;
  /** Planned week plus the overtime allowed on top: 40h + 2h. */
  readonly weeklyMaxMinutes: number;
  readonly overtime: OvertimePolicy;
  /** S16's "Ways to clock in": a way switched off refuses its punches. */
  readonly clockIn: ClockInWays;
  /** Where the company works from, which `clockIn.area` compares a clock-in with. */
  readonly offices: readonly Office[];
}

/** An office as a point and how near still counts as being there. Never a person's location. */
export interface Office {
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly radiusMetres: number;
}

export interface ClockInWays {
  /** A badge, or a phone's code, at a reader. */
  readonly reader: boolean;
  readonly web: boolean;
  readonly mobile: boolean;
  /** A shared kiosk, with a PIN. */
  readonly pin: boolean;
  /**
   * Only inside the office area: a clock-in from the web or the app says
   * whether the device was inside one of `offices`, checked there once and
   * sent as that boolean alone (PRD §11.2). A reader or kiosk is at the office.
   */
  readonly area: boolean;
}

/** Whether the rules refuse a punch from this source and, at a kiosk, this credential. */
export function clockInRefused(
  rules: AttendanceRules,
  source: PunchSource,
  credential?: 'badge' | 'pin' | 'qr',
): boolean {
  const way =
    source === 'web' || source === 'mobile' ? source : credential === 'pin' ? 'pin' : 'reader';
  return !rules.clockIn[way];
}

/** Whether the rules refuse this clock-in for not being inside the office area. */
export function outsideOfficeArea(
  rules: AttendanceRules,
  punch: {
    readonly source: PunchSource;
    readonly kind: string;
    readonly insideOfficeArea: boolean | null;
  },
): boolean {
  return (
    rules.clockIn.area &&
    punch.kind === 'in' &&
    (punch.source === 'web' || punch.source === 'mobile') &&
    punch.insideOfficeArea !== true
  );
}

export interface OvertimePolicy {
  readonly becomes: 'comp' | 'paid' | 'choose';
  /** Paid overtime's rate, as a decimal string for Payroll. Comp is hour for hour. */
  readonly multiplier: string;
}

export const DEFAULT_RULES: AttendanceRules = {
  breakAfterMinutes: 6 * 60,
  breakMinutes: 30,
  restMinutes: 12 * 60,
  weeklyMaxMinutes: 42 * 60,
  overtime: { becomes: 'choose', multiplier: '1.25' },
  clockIn: { reader: true, web: true, mobile: true, pin: true, area: false },
  offices: [],
};

export type SegmentKind = 'worked' | 'break' | 'overtime' | 'missing' | 'planned' | 'live';
export interface Segment {
  readonly kind: SegmentKind;
  readonly from: number;
  readonly to: number;
}

/**
 * `open` is a clock-out nobody made, `live` is running now, `absent` is a past
 * day with no punches (leave and holidays are someone else's business).
 */
export type DayStatus = 'complete' | 'live' | 'open' | 'planned' | 'absent';
export type DayFlag = 'break_missing' | 'core_hours_missed';

export interface Day {
  readonly date: CalendarDate;
  readonly status: DayStatus;
  /** `null` when it cannot be known yet: an open day, or one still to come. */
  readonly workedMinutes: number | null;
  readonly breakMinutes: number;
  readonly plannedMinutes: number;
  readonly overtimeMinutes: number;
  readonly segments: readonly Segment[];
  readonly flags: readonly DayFlag[];
}

export function dayOf(args: {
  date: CalendarDate;
  schedule: Schedule;
  /** All of the person's shifts; the day picks its own. */
  shifts: readonly Shift[];
  now: Instant;
  timeZone: string;
  rules: AttendanceRules;
}): Day {
  const { date, timeZone, rules } = args;
  const planned = plannedOn(args.schedule, date);
  const mine = args.shifts.filter((s) => s.date === date);
  const base = {
    date,
    plannedMinutes: planned.plannedMinutes,
    breakMinutes: 0,
    overtimeMinutes: 0,
    flags: [],
  };

  if (mine.length === 0) {
    if (date < localDate(args.now, timeZone)) {
      return { ...base, status: 'absent', workedMinutes: 0, segments: [] };
    }
    const w = planned.window;
    return {
      ...base,
      status: 'planned',
      workedMinutes: null,
      segments: w ? [{ kind: 'planned', from: w.start, to: w.end }] : [],
    };
  }

  const states = mine.map((s) => stateOfShift(s, args.shifts, planned, args.now, timeZone));
  const status: DayStatus = states.includes('open')
    ? 'open'
    : states.includes('live')
      ? 'live'
      : 'complete';
  const minute = (i: string) => minuteOfDay(i, date, timeZone);

  const parts = mine.flatMap((s, i) => {
    const state = states[i];
    const end = state === 'live' ? args.now : (s.out?.at ?? lastPunchAt(s));
    const ivs = intervals(s, end);
    if (state === 'live' && ivs.at(-1)?.kind === 'worked') {
      ivs.splice(-1, 1, { ...(ivs.at(-1) as Interval), kind: 'live' });
    }
    return ivs;
  });
  const worked = sum(parts.filter((p) => p.kind !== 'break'));
  const breaks = parts.filter((p) => p.kind === 'break');
  let segments: Segment[] = parts
    .map((p) => ({ kind: p.kind, from: minute(p.from), to: minute(p.to) }))
    .filter((s) => s.to > s.from);

  if (status === 'open') {
    const from = segments.at(-1)?.to ?? minute(mine[0]?.in.at ?? args.now);
    const left = planned.plannedMinutes - worked;
    if (left > 0) segments.push({ kind: 'missing', from, to: from + left });
    return { ...base, status, workedMinutes: null, breakMinutes: sum(breaks), segments };
  }

  const overtimeMinutes = Math.max(0, worked - planned.plannedMinutes);
  if (status === 'complete' && overtimeMinutes > 0) {
    segments = splitOvertime(segments, planned.plannedMinutes);
  }

  const flags: DayFlag[] = [];
  if (worked > rules.breakAfterMinutes && !breaks.some((b) => minutes(b) >= rules.breakMinutes)) {
    flags.push('break_missing');
  }
  const first = mine[0];
  const last = mine.at(-1)?.out;
  if (
    status === 'complete' &&
    planned.core &&
    first &&
    last &&
    (minute(first.in.at) > planned.core.start || minute(last.at) < planned.core.end)
  ) {
    flags.push('core_hours_missed');
  }

  return {
    ...base,
    status,
    workedMinutes: worked,
    breakMinutes: sum(breaks),
    overtimeMinutes,
    segments,
    flags,
  };
}

/**
 * Whether a shift with no clock-out was forgotten rather than still running.
 *
 * Forgotten once another shift has started, or once the day it belongs to is
 * over: midnight, or the end of a planned night shift that runs past it. The
 * morning check (§11.4) asks exactly this.
 */
export function missedClockOut(
  shift: Shift,
  shifts: readonly Shift[],
  schedule: Schedule,
  now: Instant,
  timeZone: string,
): boolean {
  return stateOfShift(shift, shifts, plannedOn(schedule, shift.date), now, timeZone) === 'open';
}

export interface WeekTotal {
  readonly workedMinutes: number;
  readonly plannedMinutes: number;
  readonly overtimeMinutes: number;
  readonly flags: readonly 'weekly_max_exceeded'[];
}

export function weekOf(days: readonly Day[], rules: AttendanceRules): WeekTotal {
  const workedMinutes = days.reduce((a, d) => a + (d.workedMinutes ?? 0), 0);
  return {
    workedMinutes,
    plannedMinutes: days.reduce((a, d) => a + d.plannedMinutes, 0),
    overtimeMinutes: days.reduce((a, d) => a + d.overtimeMinutes, 0),
    flags: workedMinutes > rules.weeklyMaxMinutes ? ['weekly_max_exceeded'] : [],
  };
}

/** Days that started less than `restMinutes` after the previous day ended. */
export function restBreaches(
  shifts: readonly Shift[],
  rules: AttendanceRules,
): { date: CalendarDate; restMinutes: number }[] {
  return shifts.flatMap((next, i) => {
    const prev = shifts[i - 1];
    // A split shift on one day is a lunch, not a night's rest.
    if (!prev?.out || prev.date === next.date) return [];
    const rest = epochMinute(next.in.at) - epochMinute(prev.out.at);
    return rest < rules.restMinutes ? [{ date: next.date, restMinutes: rest }] : [];
  });
}

/**
 * What overtime turns into (T33): comp time hour for hour, paid at the
 * multiplier, or whichever the person picks when the policy lets them.
 */
export function overtimeBecomes(
  minutes: number,
  policy: OvertimePolicy,
  choice: 'comp' | 'paid' | null,
): Result<{ use: 'comp' | 'paid'; minutes: number; multiplier: string | null }> {
  if (policy.becomes !== 'choose' && choice !== null && choice !== policy.becomes) {
    return err(
      failure('CHOICE_NOT_OFFERED', `Overtime here always becomes ${policy.becomes}`, ['choice']),
    );
  }
  const use = policy.becomes === 'choose' ? choice : policy.becomes;
  if (use === null) {
    return err(failure('CHOICE_REQUIRED', 'Choose comp time or paid overtime', ['choice']));
  }
  return ok({ use, minutes, multiplier: use === 'paid' ? policy.multiplier : null });
}

type Interval = { kind: 'worked' | 'break' | 'live'; from: Instant; to: Instant };

function intervals(shift: Shift, end: Instant): Interval[] {
  const out: Interval[] = [];
  let cursor = shift.in.at;
  for (const b of shift.breaks) {
    out.push({ kind: 'worked', from: cursor, to: b.start.at });
    cursor = b.end?.at ?? end;
    out.push({ kind: 'break', from: b.start.at, to: cursor });
  }
  out.push({ kind: 'worked', from: cursor, to: end });
  return out.filter((i) => ms(i.to) > ms(i.from));
}

function stateOfShift(
  shift: Shift,
  shifts: readonly Shift[],
  planned: PlannedDay,
  now: Instant,
  timeZone: string,
): 'closed' | 'live' | 'open' {
  if (shift.out) return 'closed';
  const later = shifts.some((s) => ms(s.in.at) > ms(shift.in.at));
  const dayOver =
    minuteOfDay(now, shift.date, timeZone) >= Math.max(1440, planned.window?.end ?? 0);
  return later || dayOver ? 'open' : 'live';
}

/** The last overtime minutes worked, wherever the planned day ran out. */
function splitOvertime(segments: readonly Segment[], plannedMinutes: number): Segment[] {
  let left = plannedMinutes;
  return segments.flatMap((s): Segment[] => {
    if (s.kind !== 'worked') return [s];
    const length = s.to - s.from;
    const regular = Math.min(Math.max(left, 0), length);
    left -= length;
    if (regular === length) return [s];
    if (regular === 0) return [{ ...s, kind: 'overtime' }];
    return [
      { ...s, to: s.from + regular },
      { kind: 'overtime', from: s.from + regular, to: s.to },
    ];
  });
}

export function lastPunchAt(shift: Shift): Instant {
  const b = shift.breaks.at(-1);
  return b ? (b.end?.at ?? b.start.at) : shift.in.at;
}

const epochMinute = (i: string) => Math.floor(ms(i) / 60_000);
const minutes = (i: { from: string; to: string }) => epochMinute(i.to) - epochMinute(i.from);
const sum = (is: readonly { from: string; to: string }[]) => is.reduce((a, i) => a + minutes(i), 0);

/** Minutes after local midnight on `date`, past 1440 for the next day. */
function minuteOfDay(instant: string, date: CalendarDate, timeZone: string): number {
  const [h = 0, m = 0] = dateFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(Date.parse(instant))
    .split(':')
    .map(Number);
  return daysBetween(date, localDate(instant, timeZone)) * 1440 + h * 60 + m;
}
