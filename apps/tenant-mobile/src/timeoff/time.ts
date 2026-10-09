import { pad } from './words';

/** 541 as "09:01": minutes after midnight on a clock face. */
export const clockTime = (minutes: number): string =>
  `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;

/** 485 as "8h 05m"; 45 as "45m"; 480 as "8h". */
export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m === 0 ? `${String(h)}h` : h === 0 ? `${String(m)}m` : `${String(h)}h ${pad(m)}m`;
}

/** Seconds as a running clock: "3:41:08". */
export function stopwatch(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/*
 * The wall clock in a zone, read from one formatted string: Hermes on iOS has
 * no `formatToParts`, so "09/10/2026, 01:23" is taken apart instead.
 */
function wall(at: string | number, zone: string): { date: string; minute: number } {
  const text = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(at));
  const m = /(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2})/.exec(text);
  if (m === null) return { date: new Date(at).toISOString().slice(0, 10), minute: 0 };
  const [, d = '', mo = '', y = '', h = '0', mi = '0'] = m;
  return { date: `${y}-${mo}-${d}`, minute: (Number(h) % 24) * 60 + Number(mi) };
}

/** The calendar date it is in `zone` at an instant. */
export const localDate = (at: string | number, zone: string): string => wall(at, zone).date;

/** Minutes after local midnight in `zone`. */
export const minuteOfDay = (at: string | number, zone: string): number => wall(at, zone).minute;

export const partOfDay = (at: string | number, zone: string): string => {
  const hour = Math.floor(minuteOfDay(at, zone) / 60);
  return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
};

/** Today on this phone's own calendar, not UTC's: after midnight here is the next day. */
export const todayHere = (): string =>
  localDate(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone);

/**
 * The instant a wall-clock time on a date is in `zone`: "18:05" on 2026-09-30
 * in Madrid is 16:05Z. The zone's offset is read at a first guess and the
 * guess corrected by it, right everywhere but the hour a clock skips in spring.
 */
export function instantAt(date: string, time: string, zone: string): string {
  const wanted = Date.parse(`${date}T${time}:00Z`);
  const seen = wall(wanted, zone);
  const back = Date.parse(
    `${seen.date}T${String(Math.floor(seen.minute / 60)).padStart(2, '0')}:${String(seen.minute % 60).padStart(2, '0')}:00Z`,
  );
  return new Date(wanted - (back - wanted)).toISOString();
}
