/**
 * How Home's To do is cut: which tasks (a module, when they are due), in what
 * groups (one level, then another inside it) and in what order. Pure, so the
 * widget only draws what this answers.
 */

export interface ViewTask {
  readonly id: string;
  readonly title: string;
  readonly module?: string;
  readonly area?: string;
  readonly from?: string;
  /** A calendar date, compared as text. */
  readonly dueDay?: string;
  /** An instant. */
  readonly at?: string;
  readonly overdue?: boolean;
}

export type Grouping = 'none' | 'module' | 'area' | 'due' | 'from';

export interface TaskView {
  /** A module's name, or '' for every module. */
  readonly module: string;
  readonly due: 'any' | 'overdue' | 'week';
  readonly group: Grouping;
  /** A second level inside each group; never the same as `group`. */
  readonly inside: Grouping;
  readonly sort: 'due' | 'newest' | 'oldest';
}

export const DEFAULT_VIEW: TaskView = {
  module: '',
  due: 'any',
  group: 'none',
  inside: 'none',
  sort: 'due',
};

const one = <T extends string>(value: unknown, of: readonly T[], or: T): T =>
  of.includes(value as T) ? (value as T) : or;

const GROUPINGS = ['none', 'module', 'area', 'due', 'from'] as const;

/** A view read back from where it was kept: anything it does not know is the default. */
export function viewOf(raw: unknown): TaskView {
  const v = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const group = one(v['group'], GROUPINGS, 'none');
  const inside = one(v['inside'], GROUPINGS, 'none');
  return {
    module: typeof v['module'] === 'string' ? v['module'] : '',
    due: one(v['due'], ['any', 'overdue', 'week'] as const, 'any'),
    group,
    inside: group === 'none' || inside === group ? 'none' : inside,
    sort: one(v['sort'], ['due', 'newest', 'oldest'] as const, 'due'),
  };
}

/** What a group is called when a task has nothing to group by. */
export interface GroupWords {
  readonly overdue: string;
  readonly week: string;
  readonly later: string;
  readonly noDue: string;
  readonly noArea: string;
  readonly noSender: string;
  readonly noModule: string;
}

export interface TaskSection<T> {
  /** The group, and the group inside it; null where the view has no such level. */
  readonly group: string | null;
  readonly sub: string | null;
  /** The rows drawn: the first of the section, as many as the limit leaves. */
  readonly tasks: readonly T[];
  /** Every task in the section, drawn or not. */
  readonly count: number;
}

const plus = (day: string, days: number): string =>
  new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const DUE_ORDER = ['overdue', 'week', 'later', 'noDue'] as const;

function bucket(t: ViewTask, today: string): (typeof DUE_ORDER)[number] {
  if (t.overdue === true || (t.dueDay !== undefined && t.dueDay < today)) return 'overdue';
  if (t.dueDay === undefined) return 'noDue';
  return t.dueDay <= plus(today, 7) ? 'week' : 'later';
}

function keyOf(t: ViewTask, by: Grouping, today: string, words: GroupWords): string | null {
  switch (by) {
    case 'none':
      return null;
    case 'module':
      return t.module ?? words.noModule;
    case 'area':
      return t.area ?? words.noArea;
    case 'from':
      return t.from ?? words.noSender;
    case 'due':
      return words[bucket(t, today)];
  }
}

/**
 * The tasks the view keeps, sorted, in their sections, with at most `limit`
 * rows drawn in all: a filter or a group changes which rows show, never how
 * many. Sections come in the order of their first task, so the most pressing
 * group leads; groups by when they are due come soonest first.
 */
export function cut<T extends ViewTask>(
  tasks: readonly T[],
  view: TaskView,
  today: string,
  words: GroupWords,
  limit: number,
): { readonly sections: readonly TaskSection<T>[]; readonly matched: number } {
  const kept = tasks
    .filter((t) => view.module === '' || t.module === view.module)
    .filter((t) => {
      const b = bucket(t, today);
      return view.due === 'any' || b === 'overdue' || (view.due === 'week' && b === 'week');
    })
    .toSorted((a, b) =>
      view.sort === 'due'
        ? (a.dueDay ?? '9999').localeCompare(b.dueDay ?? '9999') ||
          (b.at ?? '').localeCompare(a.at ?? '')
        : view.sort === 'newest'
          ? (b.at ?? '').localeCompare(a.at ?? '')
          : (a.at ?? '').localeCompare(b.at ?? ''),
    );
  const dueRank = (label: string | null): number => DUE_ORDER.findIndex((k) => words[k] === label);
  const sections = new Map<string, { group: string | null; sub: string | null; all: T[] }>();
  for (const t of kept) {
    const group = keyOf(t, view.group, today, words);
    const sub = view.group === 'none' ? null : keyOf(t, view.inside, today, words);
    const key = `${group ?? ''}\u0000${sub ?? ''}`;
    const had = sections.get(key);
    if (had === undefined) sections.set(key, { group, sub, all: [t] });
    else had.all.push(t);
  }
  const ordered = [...sections.values()];
  const first = new Map<string | null, number>();
  ordered.forEach((s, i) => {
    if (!first.has(s.group)) first.set(s.group, i);
  });
  // A group's sections stay together, groups in the order they first appear
  // (or soonest first, by when they are due), and the same inside a group.
  ordered.sort(
    (a, b) =>
      (view.group === 'due' ? dueRank(a.group) - dueRank(b.group) : 0) ||
      (first.get(a.group) ?? 0) - (first.get(b.group) ?? 0) ||
      (view.inside === 'due' ? dueRank(a.sub) - dueRank(b.sub) : 0),
  );
  let left = limit;
  return {
    matched: kept.length,
    sections: ordered
      .map((s) => {
        const drawn = s.all.slice(0, Math.max(0, left));
        left -= drawn.length;
        return { group: s.group, sub: s.sub, tasks: drawn, count: s.all.length };
      })
      .filter((s) => s.tasks.length > 0),
  };
}
