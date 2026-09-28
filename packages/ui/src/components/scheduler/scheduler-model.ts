import { addDays, parseIsoDate, type IsoDate } from '../calendar/calendar';

/**
 * The scheduler's arithmetic, apart from React so it can be tested as data.
 *
 * Two rules keep it honest. A day is a calendar `date` string and never a
 * `Date`: the grid only ever asks "which day" and "how many minutes past
 * midnight", and neither question needs a time zone. And nothing here reads
 * the clock. "Now" is a value the caller passes in, which is what lets a story
 * or a test pin it to 10:30 on a Wednesday.
 */

/** Minutes past midnight, 0 to 1440. `9 * 60 + 30` is half past nine. */
export type Minutes = number;

export interface SchedulerEventTiming {
  id: string;
  column: string;
  start: Minutes;
  end: Minutes;
}

export interface EventSlot {
  /** Which side-by-side lane the event sits in, from 0. */
  lane: number;
  /** How many lanes its group of overlapping events needs. */
  lanes: number;
}

/**
 * Where each event sits across its column.
 *
 * Events that overlap, directly or through a chain, form a group; each takes
 * the first lane free when it starts, and every event in the group is as
 * narrow as the group's widest moment needs. That is the layout every
 * calendar uses, and it keeps two clashing interviews side by side rather than
 * one hiding the other.
 */
export function layoutEvents(events: readonly SchedulerEventTiming[]): Map<string, EventSlot> {
  const slots = new Map<string, EventSlot>();
  const byColumn = new Map<string, SchedulerEventTiming[]>();
  for (const event of events)
    byColumn.set(event.column, [...(byColumn.get(event.column) ?? []), event]);

  for (const columnEvents of byColumn.values()) {
    const sorted = columnEvents.toSorted((a, b) => a.start - b.start || b.end - a.end);
    let group: { id: string; lane: number }[] = [];
    let laneEnds: Minutes[] = [];
    let groupEnd = -1;

    const close = (): void => {
      for (const member of group)
        slots.set(member.id, { lane: member.lane, lanes: laneEnds.length });
      group = [];
      laneEnds = [];
    };

    for (const event of sorted) {
      if (event.start >= groupEnd) close();
      let lane = laneEnds.findIndex((end) => end <= event.start);
      if (lane === -1) lane = laneEnds.push(event.end) - 1;
      else laneEnds[lane] = event.end;
      group.push({ id: event.id, lane });
      groupEnd = Math.max(groupEnd, event.end);
    }
    close();
  }
  return slots;
}

/** `9:00`, `14:30`. The 24-hour clock, which needs no locale to be unambiguous. */
export function formatMinutes(minutes: Minutes): string {
  const hours = Math.floor(minutes / 60);
  return `${String(hours)}:${String(minutes % 60).padStart(2, '0')}`;
}

export interface DayColumn {
  /** The calendar date, which is also the column's id. */
  id: IsoDate;
  /** `Wed 14`. */
  label: string;
  /** `Wed`, for the day strip under a finger. */
  weekday: string;
  /** `14`. */
  day: string;
  /** `Wednesday 14 October`, for assistive tech. */
  fullLabel: string;
}

/**
 * One column per day, starting at `from`.
 *
 * Formatted in UTC because `parseIsoDate` produces a UTC midnight. Asking for
 * the local weekday of a UTC midnight is how Sunday the 1st becomes Saturday
 * the 31st for everyone west of Greenwich.
 */
export function dayColumns(from: IsoDate, count: number, locale?: string): DayColumn[] {
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone: 'UTC' });
  const full = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  return Array.from({ length: count }, (_, offset) => {
    const id = addDays(from, offset);
    const at = parseIsoDate(id);
    const short = weekday.format(at);
    const date = day.format(at);
    return { id, label: `${short} ${date}`, weekday: short, day: date, fullLabel: full.format(at) };
  });
}
