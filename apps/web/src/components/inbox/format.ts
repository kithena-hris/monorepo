import { dateFormat, formatNumber, icons, type IconName } from '@reach/ui';
import type { ComponentType } from 'react';

import type { Shown } from '../../lib/inbox/model';
import type { InboxPeek } from '../../lib/inbox/peek';
import { dayIn, moduleName } from '../../lib/inbox/plain';
import { t } from '../../lib/t';

/**
 * How the Inbox says dates and kinds: one place, so the list, the detail,
 * the bell and the phone's tab say them the same way. Read against the time
 * the modules answered and the person's own zone, so the server's render and
 * the browser's agree.
 */

const DAY_MS = 86_400_000;
const noon = (day: string): number => Date.parse(`${day}T12:00:00Z`);
const SHORT_DAY = dateFormat({ day: 'numeric', month: 'short', timeZone: 'UTC' });
const LONG_DAY = dateFormat({ day: 'numeric', month: 'long', timeZone: 'UTC' });
const WEEKDAY = dateFormat({ weekday: 'long', timeZone: 'UTC' });

/** "3 Oct", "Oct 3", "3. Okt.": a calendar day, as the reader's language writes it. */
export function shortDay(day: string): string {
  return SHORT_DAY.format(noon(day));
}

/** "3 Oct, 09:40", in the person's zone and language. */
export function when(instant: string, zone: string): string {
  return dateFormat({
    timeZone: zone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(instant));
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
  if (days < 0) {
    return {
      label: t(
        'components.inbox.format.overdue_days',
        { one: 'Overdue {{count}} day', other: 'Overdue {{count}} days' },
        { count: -days },
      ),
      tone: 'danger',
    };
  }
  if (days === 0)
    return {
      label:
        verb === 'decide'
          ? t('components.inbox.format.decide_today', 'Decide today')
          : t('components.inbox.format.due_today', 'Due today'),
      tone: 'warning',
    };
  if (days === 1) {
    return {
      label:
        verb === 'decide'
          ? t('components.inbox.format.decide_by_tomorrow', 'Decide by tomorrow')
          : t('components.inbox.format.due_tomorrow', 'Due tomorrow'),
      tone: 'warning',
    };
  }
  return {
    label:
      verb === 'decide'
        ? t('components.inbox.format.decide_by_day', 'Decide by {{day}}', { day: shortDay(due) })
        : t('components.inbox.format.due_day', 'Due {{day}}', { day: shortDay(due) }),
    tone: 'neutral',
  };
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
  return t(
    'components.inbox.format.days',
    { one: '{{shown}} day', other: '{{shown}} days' },
    { count: v, shown: formatNumber(v, { maximumFractionDigits: 1 }) },
  );
};

/** "28–30 December", "30 December – 2 January", "24 December". */
export function spanLong(from: string, to: string): string {
  return from === to ? LONG_DAY.format(noon(from)) : LONG_DAY.formatRange(noon(from), noon(to));
}

/** "Monday to Wednesday", "Thursday". */
export function weekdays(from: string, to: string): string {
  const name = (d: string) => WEEKDAY.format(noon(d));
  return from === to
    ? name(from)
    : t('components.inbox.format.weekday_to_weekday', '{{from}} to {{to}}', {
        from: name(from),
        to: name(to),
      });
}

/** A Home row as a module's own Home draws it: plain data, worded here. */
export interface HomeTask {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly href: string;
  readonly icon: string;
  readonly tone?: 'warning' | 'danger';
}

/**
 * Home's To do and what waits on others (B1), for a module that draws Home:
 * plain data rather than the shell's card, so the module's server render can
 * be handed it too.
 */
export function homeToDo(peek: InboxPeek): {
  readonly href: string;
  readonly tasks: readonly HomeTask[];
  readonly waiting: readonly HomeTask[];
} {
  const row = (i: Shown, lane: string): HomeTask => {
    const due = i.due === null ? null : dueOf(i.due, i.dueVerb, peek.now, peek.zone);
    const where =
      i.area === null
        ? moduleName(i.module)
        : t('components.inbox.format.text_5', '{{moduleName}} › {{area}}', {
            moduleName: moduleName(i.module),
            area: i.area,
          });
    return {
      id: i.id,
      title: i.title,
      description: [where, i.status?.label, due?.label].filter(Boolean).join(' · '),
      href: `/inbox/${lane}?item=${encodeURIComponent(i.id)}`,
      icon: i.icon,
      ...(due === null || due.tone === 'neutral' || i.lane !== 'task' ? {} : { tone: due.tone }),
    };
  };
  return {
    href: '/inbox/todo',
    tasks: peek.todo.map((i) => row(i, 'todo')),
    waiting: peek.requests.map((i) => row(i, 'requests')),
  };
}
