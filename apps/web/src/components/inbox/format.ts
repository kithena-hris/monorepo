import { icons, type IconName } from '@reach/ui';
import type { ComponentType } from 'react';

import { dayIn } from '../../lib/inbox/plain';

/**
 * How the Inbox says dates and kinds: one place, so the list, the detail,
 * the bell and the phone's tab say them the same way. Read against the time
 * the modules answered and the person's own zone, so the server's render and
 * the browser's agree.
 */

const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "3 Oct". */
export function shortDay(day: string): string {
  return `${String(Number(day.slice(8, 10)))} ${MONTHS[Number(day.slice(5, 7)) - 1] ?? ''}`;
}

/** "3 Oct, 09:40", in the person's zone. */
export function when(instant: string, zone: string): string {
  const day = dayIn(instant, zone);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(instant));
  return `${shortDay(day)}, ${time}`;
}

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** A task's due date as its row says it, and how loudly (C9). */
export function dueOf(
  due: string,
  verb: 'due' | 'decide',
  now: string,
  zone: string,
): { readonly label: string; readonly tone: 'danger' | 'warning' | 'neutral' } {
  const days = daysBetween(dayIn(now, zone), due);
  const word = verb === 'decide' ? 'Decide by' : 'Due';
  if (days < 0) {
    return { label: `Overdue ${String(-days)} day${days === -1 ? '' : 's'}`, tone: 'danger' };
  }
  if (days === 0)
    return { label: verb === 'decide' ? 'Decide today' : 'Due today', tone: 'warning' };
  if (days === 1) {
    return { label: verb === 'decide' ? 'Decide by tomorrow' : 'Due tomorrow', tone: 'warning' };
  }
  return { label: `${word} ${shortDay(due)}`, tone: 'neutral' };
}

/** A module's item icon, by the design system's word for it; the Inbox's own otherwise. */
export function iconOf(
  name: string,
): ComponentType<{ 'aria-hidden'?: boolean; className?: string }> {
  return Object.hasOwn(icons, name) ? icons[name as IconName] : icons.inbox;
}

/** The first name, for "Ask Ada" and "Nudge Marco". */
export const firstName = (name: string | null | undefined): string =>
  (name ?? '').split(' ')[0] ?? '';

/** "1 day", "3 days". */
export const days = (n: string | number): string => {
  const v = Number(n);
  const shown = Number.isInteger(v) ? String(v) : v.toFixed(1).replace(/\.0$/u, '');
  return `${shown} day${v === 1 ? '' : 's'}`;
};

/** "28–30 December", "30 December – 2 January", "24 December". */
export function spanLong(from: string, to: string): string {
  const long = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    });
  if (from === to) return long(from);
  if (from.slice(0, 7) === to.slice(0, 7)) {
    return `${String(Number(from.slice(8, 10)))}–${long(to)}`;
  }
  return `${long(from)} – ${long(to)}`;
}

/** "Monday to Wednesday", "Thursday". */
export function weekdays(from: string, to: string): string {
  const name = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  return from === to ? name(from) : `${name(from)} to ${name(to)}`;
}
