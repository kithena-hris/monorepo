import type { InboxAnswer, Item } from './model';
import { dayIn } from './time';

/**
 * What the phone says of the Inbox, and when (INB-051, M:A2): pure, so the
 * rules are tested without a phone.
 */

export type Settings = {
  readonly tasks?: { readonly asked?: { readonly phone?: boolean } };
  readonly updates?: Readonly<Record<string, { readonly phone?: boolean } | undefined>>;
  readonly quiet?: {
    readonly on?: boolean;
    readonly from?: string;
    readonly to?: string;
    readonly weekends?: boolean;
  };
};

const ROW: Readonly<Record<string, string>> = {
  'timeoff.holidays': 'calendars',
  'timeoff.expiring': 'calendars',
  'people.document': 'documents',
  'people.team': 'team',
};

/** Whether now is inside the person's quiet hours, on the phone's own clock. */
export function quietNow(settings: Settings, now: Date): boolean {
  const q = settings.quiet;
  if (q?.on !== true) return false;
  const day = now.getDay();
  if (q.weekends === true && (day === 0 || day === 6)) return true;
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const from = q.from ?? '19:00';
  const to = q.to ?? '08:00';
  return from <= to ? hm >= from && hm < to : hm >= from || hm < to;
}

/** What to say now, of what is new: tasks one by one, updates as one. */
export function whatToSay(
  inbox: InboxAnswer,
  settings: Settings,
  already: ReadonlySet<string>,
  now: Date,
): { readonly tasks: readonly Item[]; readonly updates: readonly Item[] } {
  const items = Object.values(inbox.lanes).flatMap((groups) => groups.flatMap((g) => g.items));
  const today = dayIn(now.toISOString(), inbox.zone);
  const quiet = quietNow(settings, now);
  const tasks = items.filter(
    (i) =>
      i.counted &&
      !already.has(i.id) &&
      settings.tasks?.asked?.phone !== false &&
      (!quiet || i.due === today),
  );
  const updates = quiet
    ? []
    : items.filter(
        (i) =>
          i.unread &&
          !already.has(i.id) &&
          settings.updates?.[ROW[i.kind] ?? 'decided']?.phone !== false,
      );
  return { tasks, updates };
}
