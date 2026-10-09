// Kept apart from model.ts so the shell can use it without bringing zod and
// the contracts into every page's first load.

/** The calendar day of an instant in a zone, `YYYY-MM-DD`. */
export function dayIn(instant: string, zone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(instant));
  } catch {
    return instant.slice(0, 10);
  }
}
