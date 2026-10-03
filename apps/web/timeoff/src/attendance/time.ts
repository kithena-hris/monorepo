/**
 * The clock's words and arithmetic, shared by the top bar's clock, the
 * timesheet and the team's board: times of day in the person's zone, calendar
 * dates as dates, and what Time Off's punches say about now.
 */

export type ClockState = 'out' | 'in' | 'on_break';
export type WorkModel = 'office' | 'remote' | 'client';
export type PunchKind = 'in' | 'out' | 'break_start' | 'break_end';

export interface Punch {
  readonly id: string;
  /** The instant it claims, ISO. */
  readonly at: string;
  readonly recordedAt: string;
  readonly kind: PunchKind;
  readonly source: string;
  readonly workModel: WorkModel;
  readonly supersedes: string | null;
  readonly reason: string | null;
}

export interface Day {
  readonly date: string;
  readonly status: 'complete' | 'live' | 'open' | 'planned' | 'absent';
  /** `null` when it cannot be known yet: an open day, or one still to come. */
  readonly workedMinutes: number | null;
  readonly breakMinutes: number;
  readonly plannedMinutes: number;
  readonly overtimeMinutes: number;
  /** Minutes after the day's local midnight. */
  readonly segments: readonly {
    readonly kind: string;
    readonly from: number;
    readonly to: number;
  }[];
  readonly flags: readonly string[];
}

export const pad = (n: number): string => String(n).padStart(2, '0');

/** 532 as "08:52". */
export const clockTime = (minutes: number): string =>
  `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;

/** 485 as "8h 05m"; 45 as "45m"; 480 as "8h". */
export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m === 0 ? `${String(h)}h` : h === 0 ? `${String(m)}m` : `${String(h)}h ${pad(m)}m`;
}

/** Seconds as the pill shows them: "3:41:08". */
export function stopwatch(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

function parts(at: string | number, zone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  );
}

/** The calendar date an instant falls on, in `zone`. */
export function localDate(at: string | number, zone: string): string {
  const p = parts(at, zone);
  return `${p['year'] ?? ''}-${p['month'] ?? ''}-${p['day'] ?? ''}`;
}

/** Minutes after local midnight, in `zone`. */
export function minuteOfDay(at: string | number, zone: string): number {
  const p = parts(at, zone);
  return Number(p['hour']) * 60 + Number(p['minute']);
}

/**
 * The instant a wall-clock time on a date is in `zone`: "18:05" on
 * 2026-09-30 in Madrid is 16:05Z. The zone's offset is read at a first guess
 * and the guess corrected by it, which is right everywhere but the hour a
 * clock skips in spring, where it lands an hour on.
 */
export function instantAt(date: string, time: string, zone: string): string {
  const wanted = Date.parse(`${date}T${time}:00Z`);
  const p = parts(wanted, zone);
  const seen = Date.parse(
    `${p['year'] ?? ''}-${p['month'] ?? ''}-${p['day'] ?? ''}T${p['hour'] ?? ''}:${p['minute'] ?? ''}:00Z`,
  );
  return new Date(wanted - (seen - wanted)).toISOString();
}

/** Calendar dates are dates: read and written in UTC, so no zone moves them a day. */
const dateFormat = (options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' });
const asDate = (date: string): Date => new Date(`${date}T00:00:00Z`);

/** "Wed 30 Sep". */
export const shortDate = (date: string): string =>
  dateFormat({ weekday: 'short', day: 'numeric', month: 'short' }).format(asDate(date));
/** "Wednesday". */
export const weekdayName = (date: string): string =>
  dateFormat({ weekday: 'long' }).format(asDate(date));
/** "28 Sep". */
export const dayMonth = (date: string): string =>
  dateFormat({ day: 'numeric', month: 'short' }).format(asDate(date));
/** "September 2026". */
export const monthName = (date: string): string =>
  dateFormat({ month: 'long', year: 'numeric' }).format(asDate(date));

export const addDays = (date: string, days: number): string =>
  new Date(asDate(date).getTime() + days * 86_400_000).toISOString().slice(0, 10);

/** The month (`YYYY-MM`) `by` months from `month`. */
export function shiftMonth(month: string, by: number): string {
  const d = asDate(`${month}-01`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
}

/** What the last punch left the clock at: one clock, whichever source punched. */
export function stateAfter(punches: readonly Punch[]): ClockState {
  const last = punches.toSorted((a, b) => a.at.localeCompare(b.at)).at(-1);
  return last === undefined || last.kind === 'out'
    ? 'out'
    : last.kind === 'break_start'
      ? 'on_break'
      : 'in';
}

/**
 * Seconds worked across these punches, and since when the current stretch of
 * work or break runs: what the pill counts on from. `at` is now, in ms.
 */
export function workedSeconds(
  punches: readonly Punch[],
  at: number,
): { readonly worked: number; readonly breakSince: number | null } {
  let worked = 0;
  let from: number | null = null;
  let breakSince: number | null = null;
  for (const p of punches.toSorted((a, b) => a.at.localeCompare(b.at))) {
    const t = Date.parse(p.at);
    if (p.kind === 'in' || p.kind === 'break_end') {
      from ??= t;
      breakSince = null;
    } else {
      if (from !== null) worked += t - from;
      from = null;
      breakSince = p.kind === 'break_start' ? t : null;
    }
  }
  if (from !== null) worked += Math.max(0, at - from);
  return { worked: worked / 1000, breakSince };
}

export const WHERE: Record<WorkModel, string> = {
  office: 'Office',
  remote: 'Remote',
  client: 'At a client',
};

export const SOURCE: Record<string, string> = {
  badge: 'Badge reader',
  kiosk: 'Kiosk',
  web: 'Web',
  mobile: 'Phone',
};

export const PUNCHED: Record<PunchKind, string> = {
  in: 'Clocked in',
  out: 'Clocked out',
  break_start: 'Started a break',
  break_end: 'Back from a break',
};
