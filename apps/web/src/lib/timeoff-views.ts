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

/** The holidays from today on, soonest first. */
export function upcomingHolidays(holidays: readonly Holiday[], today: string, max = 6): Holiday[] {
  return holidays
    .filter((h) => h.date >= today)
    .toSorted((a, b) => a.date.localeCompare(b.date))
    .slice(0, max);
}
