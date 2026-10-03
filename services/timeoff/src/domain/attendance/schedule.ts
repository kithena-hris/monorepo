import { CalendarDate } from '@kithena/contracts';

/**
 * What a day is planned to be (PRD §11.5, T33): fixed, flexible with core
 * hours, seasonal (summer hours), rotating shifts.
 *
 * Times are minutes after local midnight, so a schedule says "09:00" in
 * Madrid and means it in winter and summer alike. A night shift ends after
 * 1440.
 */

export interface WorkWindow {
  readonly start: number;
  readonly end: number;
  /** Unpaid, inside the window. */
  readonly breakMinutes: number;
}

/** ISO weekday: Monday is 1. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type Week = Partial<Record<Weekday, WorkWindow>>;

export type Schedule =
  | { readonly kind: 'fixed'; readonly name: string; readonly week: Week }
  | {
      readonly kind: 'flexible';
      readonly name: string;
      /** The usual day, which the timesheet draws as planned. */
      readonly week: Week;
      /** When everyone is expected in. Outside it, any time counts. */
      readonly core: { readonly start: number; readonly end: number };
    }
  | {
      readonly kind: 'seasonal';
      readonly name: string;
      readonly base: Schedule;
      /** `MM-DD`, inclusive. A season whose `from` is after its `to` wraps the new year. */
      readonly seasons: readonly {
        readonly from: string;
        readonly to: string;
        readonly schedule: Schedule;
      }[];
    }
  | {
      readonly kind: 'rotating';
      readonly name: string;
      /** The day the cycle's first entry falls on. */
      readonly anchor: CalendarDate;
      /** One entry per day; `null` is a day off. */
      readonly cycle: readonly (WorkWindow | null)[];
    };

export interface PlannedDay {
  readonly date: CalendarDate;
  readonly plannedMinutes: number;
  readonly window: WorkWindow | null;
  readonly core: { readonly start: number; readonly end: number } | null;
}

/** `'09:30'` as minutes after midnight. */
export const hm = (time: string): number => {
  const [h = 0, m = 0] = time.split(':').map(Number);
  return h * 60 + m;
};

/** The same window Monday to Friday. */
export const weekdays = (window: WorkWindow): Week => ({
  1: window,
  2: window,
  3: window,
  4: window,
  5: window,
});

export function plannedOn(schedule: Schedule, date: CalendarDate): PlannedDay {
  switch (schedule.kind) {
    case 'fixed':
      return planned(date, schedule.week[weekday(date)] ?? null, null);
    case 'flexible':
      return planned(date, schedule.week[weekday(date)] ?? null, schedule.core);
    case 'seasonal': {
      const md = date.slice(5);
      const season = schedule.seasons.find(({ from, to }) =>
        from <= to ? md >= from && md <= to : md >= from || md <= to,
      );
      return plannedOn(season?.schedule ?? schedule.base, date);
    }
    case 'rotating': {
      const n = schedule.cycle.length;
      const i = ((daysBetween(schedule.anchor, date) % n) + n) % n;
      return planned(date, schedule.cycle[i] ?? null, null);
    }
  }
}

/** The minutes planned in the seven days from `monday`. */
export function plannedWeek(schedule: Schedule, monday: CalendarDate): number {
  return Array.from(
    { length: 7 },
    (_, i) => plannedOn(schedule, addDays(monday, i)).plannedMinutes,
  ).reduce((a, b) => a + b, 0);
}

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` parses as UTC midnight, so this is whole days, DST or not. */
export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

export const addDays = (date: CalendarDate, days: number): CalendarDate =>
  CalendarDate.parse(new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10));

/** 1 January 1970 was a Thursday. */
export const weekday = (date: string): Weekday =>
  (((((daysBetween('1970-01-01', date) + 3) % 7) + 7) % 7) + 1) as Weekday;

function planned(
  date: CalendarDate,
  window: WorkWindow | null,
  core: PlannedDay['core'],
): PlannedDay {
  return {
    date,
    plannedMinutes: window ? window.end - window.start - window.breakMinutes : 0,
    window,
    core: window ? core : null,
  };
}
