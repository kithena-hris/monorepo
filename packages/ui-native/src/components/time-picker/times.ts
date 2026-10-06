/*
 * Times of day as `HH:MM`, 24-hour, whatever the locale shows: the stored
 * value never changes with who is looking at it. The web TimePicker's
 * reading and writing, unchanged.
 */

const pad = (n: number): string => String(n).padStart(2, '0');

export const toMinutes = (value: string): number =>
  Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

export const fromMinutes = (minutes: number): string => {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`;
};

/**
 * Reads what people type: `9`, `930`, `09:30`, `9.30`, `9h30`, `9:30pm`.
 * `null` for anything that is not unambiguously one time of day.
 */
export function parseTime(text: string): string | null {
  const compact = text.trim().toLowerCase().replace(/\s+/g, '');
  const match = /^(\d{1,4})(?:[:.h](\d{2}))?(am|pm|a|p)?$/.exec(compact);
  if (!match) return null;
  const [, head = '', tail, meridiem] = match;
  let hours: number;
  let minutes: number;
  if (tail !== undefined) {
    if (head.length > 2) return null;
    hours = Number(head);
    minutes = Number(tail);
  } else if (head.length <= 2) {
    hours = Number(head);
    minutes = 0;
  } else {
    hours = Number(head.slice(0, -2));
    minutes = Number(head.slice(-2));
  }
  if (minutes > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (meridiem.startsWith('p') ? 12 : 0);
  } else if (hours > 23) {
    return null;
  }
  return `${pad(hours)}:${pad(minutes)}`;
}

/** Whether the locale reads the clock in twelve hours. */
export function usesTwelveHours(locale?: string): boolean {
  return (
    new Intl.DateTimeFormat(locale, { hour: 'numeric', timeZone: 'UTC' }).resolvedOptions()
      .hour12 === true
  );
}

/** `HH:MM` as the locale writes it: `09:30` in Berlin, `9:30 AM` in Boston. */
export function formatTime(value: string, locale?: string): string {
  const minutes = toMinutes(value);
  const options = { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' } as const;
  const twelve = usesTwelveHours(locale);
  return new Intl.DateTimeFormat(locale, twelve ? options : { ...options, hour: '2-digit' }).format(
    new Date(Date.UTC(1970, 0, 1, Math.floor(minutes / 60), minutes % 60)),
  );
}

/** `7h 30m`, or `45m`, or `8h`: how a length of time is read back. */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${String(m)}m`;
  return m ? `${String(h)}h ${String(m)}m` : `${String(h)}h`;
}
