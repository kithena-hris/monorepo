// The Inbox helpers the shell and Home draw with, kept apart from model.ts so
// they do not bring zod and the contracts into every page's first load.

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

/** What a module is called in the source filter and on a row's tag. */
export const MODULE_NAMES: Readonly<Record<string, string>> = {
  people: 'People',
  timeoff: 'Time off',
};
export const moduleName = (module: string): string =>
  MODULE_NAMES[module] ?? module.charAt(0).toUpperCase() + module.slice(1);
