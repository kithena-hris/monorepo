import { InboxItem, type InboxLane } from '@kithena/contracts';
import * as z from 'zod';

/**
 * The Inbox as the shell draws it (INB-002, INB-003): every module's items in
 * the one shape, with what is the person's alone laid over them — read,
 * snoozed, moved to Done, muted — then grouped and counted.
 *
 * Pure: the page, the bell, the phone's route and the tests all call it. The
 * modules decide what an item is; this only decides where it shows.
 */

export const LANES = ['todo', 'updates', 'requests', 'done'] as const;
export type LaneName = (typeof LANES)[number];
export const LANE_OF: Readonly<Record<LaneName, InboxLane>> = {
  todo: 'task',
  updates: 'update',
  requests: 'request',
  done: 'done',
};
export const laneName = (value: string | undefined): LaneName =>
  LANES.find((l) => l === value) ?? 'todo';

/** Updates are tidied into Done after this long (A3). */
export const UPDATE_DAYS = 30;
const DAY_MS = 86_400_000;

/** A kind or a whole module muted, and where (D6): Done keeps them either way. */
export const Mute = z.object({
  /** `timeoff.holidays`, or `timeoff` for everything from Time Off. */
  what: z.string().max(80),
  inbox: z.boolean(),
  email: z.boolean(),
  phone: z.boolean(),
});
export type Mute = z.infer<typeof Mute>;

/**
 * What is the person's alone, kept with their account (`inbox` preference):
 * small, and pruned to the items still shown on every write (`prune`).
 */
export const InboxState = z.object({
  read: z.array(z.string().max(200)).max(400).default([]),
  /** Marked unread again: wins over `readBefore`. */
  unread: z.array(z.string().max(200)).max(100).default([]),
  /** "Mark all read": every update before this is read. */
  readBefore: z.string().max(40).nullable().default(null),
  /** Remind me later: until when, never past the due date. */
  snoozed: z.record(z.string().max(200), z.string().max(40)).default({}),
  /** Moved to Done early, and when. */
  done: z.record(z.string().max(200), z.string().max(40)).default({}),
  muted: z.array(Mute).max(50).default([]),
  /** A checklist's own ticks, by item (G5): steps nobody else keeps. */
  ticks: z.record(z.string().max(200), z.array(z.string().max(120)).max(30)).default({}),
});
export type InboxState = z.infer<typeof InboxState>;

export const EMPTY_STATE: InboxState = InboxState.parse({});

export function stateOf(value: unknown): InboxState {
  const parsed = InboxState.safeParse(value ?? {});
  return parsed.success ? parsed.data : EMPTY_STATE;
}

/** An item as a list draws it: the module's, with the person's state over it. */
export interface Shown extends InboxItem {
  readonly unread: boolean;
  readonly snoozedUntil: string | null;
  /** In the red number: a task that is the person's to do now. */
  readonly counted: boolean;
  /** Greyed: cancelled by the sender, or a team task somebody else took (Z2, Z3). */
  readonly dim: boolean;
  readonly ticks: readonly string[];
}

/** Every module's answer, read safely: an item that does not parse is dropped, not guessed. */
export function itemsOf(answers: readonly unknown[]): InboxItem[] {
  const all: InboxItem[] = [];
  for (const answer of answers) {
    const list =
      answer !== null && typeof answer === 'object' && Array.isArray(Reflect.get(answer, 'items'))
        ? (Reflect.get(answer, 'items') as unknown[])
        : [];
    for (const raw of list) {
      const item = InboxItem.safeParse(raw);
      if (item.success) all.push(item.data);
    }
  }
  return all;
}

const mutedIn = (item: InboxItem, muted: readonly Mute[], where: 'inbox' | 'email' | 'phone') =>
  muted.some((m) => m[where] && (m.what === item.kind || m.what === item.module));

/** The person's state laid over the modules' items (INB-003). */
export function shape(items: readonly InboxItem[], state: InboxState, now: string): Shown[] {
  const nowMs = Date.parse(now);
  const read = new Set(state.read);
  const unread = new Set(state.unread);
  return items.map((item) => {
    const old = item.lane === 'update' && nowMs - Date.parse(item.at) > UPDATE_DAYS * DAY_MS;
    const moved =
      item.lane !== 'request' && item.lane !== 'done' && state.done[item.id] !== undefined;
    const muted = item.lane === 'update' && mutedIn(item, state.muted, 'inbox');
    const lane: InboxLane = old || moved || muted ? 'done' : item.lane;
    const until = state.snoozed[item.id];
    const snoozedUntil =
      lane === 'task' && until !== undefined && Date.parse(until) > nowMs ? until : null;
    const takenByOther = item.team !== null && item.team.takenBy !== null && !item.team.mine;
    const cancelled = lane === 'task' && item.outcome !== null;
    return {
      ...item,
      lane,
      unread:
        lane === 'update' &&
        (unread.has(item.id) ||
          (!read.has(item.id) && (state.readBefore === null || item.at > state.readBefore))),
      snoozedUntil,
      counted: lane === 'task' && snoozedUntil === null && !takenByOther && !cancelled,
      dim: takenByOther || cancelled,
      ticks: state.ticks[item.id] ?? [],
    };
  });
}

export interface Counts {
  /** The red number: tasks only, a bundled queue counted once (G2). */
  readonly todo: number;
  /** Unread updates: a dot, never a number on the bell. */
  readonly updates: number;
  readonly requests: number;
}

export function countsOf(items: readonly Shown[]): Counts {
  return {
    todo: items.filter((i) => i.counted).length,
    updates: items.filter((i) => i.unread).length,
    requests: items.filter((i) => i.lane === 'request').length,
  };
}

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

const addDays = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' });

export interface Group {
  /** Null for a lane drawn as one list (My requests). */
  readonly label: string | null;
  readonly items: readonly Shown[];
}

const byDue = (a: Shown, b: Shown): number =>
  (a.due ?? '9999') < (b.due ?? '9999')
    ? -1
    : (a.due ?? '9999') > (b.due ?? '9999')
      ? 1
      : newest(a, b);
const newest = (a: Shown, b: Shown): number => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0);

/**
 * A lane's groups (C9, D1, F1): tasks by their due date with bundled queues
 * last, updates by day, Done by month (years before this one by year). A
 * snoozed task is left out: the list folds them into one line (`snoozedOf`).
 */
export function groupsOf(
  items: readonly Shown[],
  lane: LaneName,
  now: string,
  zone: string,
): Group[] {
  const today = dayIn(now, zone);
  const mine = items.filter((i) => i.lane === LANE_OF[lane]);
  const groups = new Map<string, Shown[]>();
  const put = (label: string, item: Shown) =>
    groups.set(label, [...(groups.get(label) ?? []), item]);
  if (lane === 'requests')
    return mine.length === 0 ? [] : [{ label: null, items: mine.toSorted(newest) }];
  if (lane === 'todo') {
    const week = addDays(today, 7);
    for (const i of mine.filter((x) => x.snoozedUntil === null).toSorted(byDue)) {
      put(
        i.count !== null
          ? 'Queues'
          : i.due === null
            ? 'No due date'
            : i.due < today
              ? 'Overdue'
              : i.due <= week
                ? 'Due this week'
                : 'Later',
        i,
      );
    }
    const order = ['Overdue', 'Due this week', 'Later', 'No due date', 'Queues'];
    return order.flatMap((label) => {
      const g = groups.get(label);
      return g === undefined ? [] : [{ label, items: g }];
    });
  }
  if (lane === 'updates') {
    const yesterday = addDays(today, -1);
    for (const i of mine.toSorted(newest)) {
      const day = dayIn(i.at, zone);
      put(day === today ? 'Today' : day === yesterday ? 'Yesterday' : 'Earlier', i);
    }
    return ['Today', 'Yesterday', 'Earlier'].flatMap((label) => {
      const g = groups.get(label);
      return g === undefined ? [] : [{ label, items: g }];
    });
  }
  const year = today.slice(0, 4);
  for (const i of mine.toSorted(newest)) {
    const day = dayIn(i.at, zone);
    put(day.slice(0, 4) === year ? MONTH.format(new Date(`${day}T12:00:00Z`)) : day.slice(0, 4), i);
  }
  return [...groups].map(([label, g]) => ({ label, items: g }));
}

/** The snoozed tasks, folded into one line under To do (C9). */
export const snoozedOf = (items: readonly Shown[]): Shown[] =>
  items.filter((i) => i.lane === 'task' && i.snoozedUntil !== null);

/** The source filter and search (C9, F1): by module, and by words in what a row shows. */
export function filtered(
  items: readonly Shown[],
  filter: {
    readonly source?: string | null;
    readonly q?: string | null;
    readonly outcome?: string | null;
  },
): Shown[] {
  const words = (filter.q ?? '').trim().toLowerCase();
  return items.filter(
    (i) =>
      (filter.source == null || filter.source === '' || i.module === filter.source) &&
      (filter.outcome == null || filter.outcome === '' || i.outcome?.label === filter.outcome) &&
      (words === '' ||
        [i.title, i.summary, i.from?.name, i.area].some((t) =>
          (t ?? '').toLowerCase().includes(words),
        )),
  );
}

/**
 * Snooze can't go past the due date (C6): the latest a task may be put off
 * to, or the time asked for.
 */
export function snoozeUntil(item: Pick<InboxItem, 'due'>, asked: string): string {
  if (item.due === null) return asked;
  const dueMorning = `${item.due}T09:00:00.000Z`;
  return asked > dueMorning ? dueMorning : asked;
}

/**
 * Keep the state small (identity holds 16 KB a preference): only what touches
 * an item still shown, and the newest of each list.
 */
export function prune(state: InboxState, items: readonly InboxItem[]): InboxState {
  const live = new Set(items.map((i) => i.id));
  const keep = <T>(r: Readonly<Record<string, T>>) =>
    Object.fromEntries(Object.entries(r).filter(([id]) => live.has(id)));
  return {
    ...state,
    read: state.read.filter((id) => live.has(id)).slice(-400),
    unread: state.unread.filter((id) => live.has(id)).slice(-100),
    snoozed: keep(state.snoozed),
    done: keep(state.done),
    ticks: keep(state.ticks),
  };
}

/** What a module is called in the source filter and on a row's tag. */
export const MODULE_NAMES: Readonly<Record<string, string>> = {
  people: 'People',
  timeoff: 'Time off',
};
export const moduleName = (module: string): string =>
  MODULE_NAMES[module] ?? module.charAt(0).toUpperCase() + module.slice(1);

/** One change to the person's state, as the web's actions and the phone's route both make it. */
export type StateChange =
  | { readonly kind: 'read'; readonly ids: readonly string[]; readonly read: boolean }
  | { readonly kind: 'readAll'; readonly at: string }
  | {
      readonly kind: 'snooze';
      readonly id: string;
      readonly until: string | null;
      readonly due: string | null;
    }
  | { readonly kind: 'done'; readonly ids: readonly string[]; readonly at: string }
  | { readonly kind: 'mute'; readonly mute: Mute }
  | { readonly kind: 'unmute'; readonly what: string }
  | { readonly kind: 'tick'; readonly id: string; readonly step: string; readonly on: boolean };

export function changed(s: InboxState, c: StateChange): InboxState {
  switch (c.kind) {
    case 'read':
      return {
        ...s,
        read: c.read
          ? [...new Set([...s.read, ...c.ids])]
          : s.read.filter((id) => !c.ids.includes(id)),
        unread: c.read
          ? s.unread.filter((id) => !c.ids.includes(id))
          : [...new Set([...s.unread, ...c.ids])],
      };
    case 'readAll':
      return { ...s, readBefore: c.at, read: [], unread: [] };
    case 'snooze': {
      const { [c.id]: _was, ...rest } = s.snoozed;
      return {
        ...s,
        snoozed:
          c.until === null
            ? rest
            : { ...rest, [c.id]: snoozeUntil({ due: c.due as never }, c.until) },
      };
    }
    case 'done':
      return { ...s, done: { ...s.done, ...Object.fromEntries(c.ids.map((id) => [id, c.at])) } };
    case 'mute':
      return { ...s, muted: [...s.muted.filter((m) => m.what !== c.mute.what), c.mute] };
    case 'unmute':
      return { ...s, muted: s.muted.filter((m) => m.what !== c.what) };
    case 'tick': {
      const was = s.ticks[c.id] ?? [];
      return {
        ...s,
        ticks: {
          ...s.ticks,
          [c.id]: c.on ? [...new Set([...was, c.step])] : was.filter((x) => x !== c.step),
        },
      };
    }
  }
}

/** A change as the phone sends it, checked: anything else is refused. */
export const StateChangeInput = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('read'),
    ids: z.array(z.string().max(200)).max(200),
    read: z.boolean(),
  }),
  z.object({ kind: z.literal('readAll') }),
  z.object({
    kind: z.literal('snooze'),
    id: z.string().max(200),
    until: z.iso.datetime().nullable(),
  }),
  z.object({ kind: z.literal('done'), ids: z.array(z.string().max(200)).max(200) }),
  z.object({ kind: z.literal('mute'), mute: Mute }),
  z.object({ kind: z.literal('unmute'), what: z.string().max(80) }),
  z.object({
    kind: z.literal('tick'),
    id: z.string().max(200),
    step: z.string().max(120),
    on: z.boolean(),
  }),
]);
