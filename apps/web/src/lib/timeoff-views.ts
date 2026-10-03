/**
 * What the shell makes of Time Off's answers before the remote draws them,
 * as `people-views.ts` does for People's: nothing a screen could not be told
 * plainly, and nothing Time Off did not say.
 */

export interface Holiday {
  readonly date: string;
  readonly name: string;
  readonly layer: string;
}

/** One day off that joins a holiday to a weekend: 1 day for 4 (T1, MT1). */
export interface Bridge {
  /** The working day to ask for. */
  readonly take: string;
  /** The four days away, Saturday to Tuesday or Thursday to Sunday. */
  readonly from: string;
  readonly to: string;
  readonly holiday: string;
  readonly days: number;
}

const DAY_MS = 86_400_000;
const shift = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const weekday = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();

/** The holidays from today on, soonest first. */
export function upcomingHolidays(holidays: readonly Holiday[], today: string, max = 6): Holiday[] {
  return holidays
    .filter((h) => h.date >= today)
    .toSorted((a, b) => a.date.localeCompare(b.date))
    .slice(0, max);
}

/**
 * The days that bridge a holiday to a weekend: a Tuesday holiday's Monday, a
 * Thursday's Friday. Only ahead of today, never a day that is already a
 * holiday or already booked (`booked`, the person's own requests).
 *
 * ponytail: a Monday-to-Friday week, as most of the demo's schedules are; the
 * member's own work pattern, longer bridges and the AI's sentence are
 * TOF-085's, which moves this into Time Off's domain.
 */
export function bridgeDays(
  holidays: readonly Holiday[],
  today: string,
  booked: readonly { readonly from: string; readonly to: string }[],
  max = 2,
): Bridge[] {
  const off = new Set(holidays.map((h) => h.date));
  const found: Bridge[] = [];
  for (const h of upcomingHolidays(holidays, today, Infinity)) {
    const day = weekday(h.date);
    if (day !== 2 && day !== 4) continue;
    const take = shift(h.date, day === 2 ? -1 : 1);
    if (take <= today || off.has(take) || booked.some((b) => b.from <= take && take <= b.to)) {
      continue;
    }
    if (found.some((b) => b.take === take)) continue;
    found.push({
      take,
      from: day === 2 ? shift(h.date, -3) : h.date,
      to: day === 2 ? h.date : shift(h.date, 3),
      holiday: h.name,
      days: 4,
    });
    if (found.length === max) break;
  }
  return found;
}
