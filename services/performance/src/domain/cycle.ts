import type { ActivityKind, CalendarDate, CycleState } from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * A cycle (PRD §8, PRF-015 to PRF-019): who is reviewed, by which activities,
 * on which forms, by when, and who sees what. Its state machine, the
 * participant filter, deadlines and the checks before launch are here, pure.
 */

/**
 * One condition of the participant filter (§8.2), by member field, as the
 * directory's filter builder makes them: "is" (several on one field are
 * alternatives), "is not", "contains" for a title, "before" and "after" for a
 * start date. No `op` is "is", as every filter saved before there were any;
 * `startedBefore` is the start date "before" those filters used.
 */
export interface Condition {
  readonly field:
    | 'department'
    | 'status'
    | 'startedBefore'
    | 'hiredOn'
    | 'manager'
    | 'title'
    | 'legalEntity'
    | 'location';
  readonly value: string;
  readonly op?: 'is' | 'not' | 'contains' | 'before' | 'after' | undefined;
}

export interface PersonChoice {
  readonly personId: string;
  readonly reason: string | null;
  readonly by: string;
  readonly at: string;
}

/** Exact, or a number of days after the start or after nominations close (§8.4). */
export type Deadline =
  | { readonly kind: 'exact'; readonly date: CalendarDate }
  | { readonly kind: 'relative'; readonly days: number; readonly from: 'start' | 'nominations' };

export interface ActivityConfig {
  readonly on: boolean;
  readonly templateId: string | null;
  /** A version pinned by hand ("Keep using v3"); null follows the published one until launch. */
  readonly pinnedVersion: number | null;
  readonly due: Deadline;
  /** The manager waits for the self and peer reviews (§8.3). */
  readonly afterOthers?: boolean;
  /** This kind's own reminders; absent, the cycle's (§8.4). */
  readonly reminders?: Reminders | undefined;
}

export interface PeerConfig {
  readonly picker: 'subject' | 'manager' | 'hr';
  readonly min: number;
  readonly max: number;
  readonly approval: boolean;
  readonly declineReplace: boolean;
  /** "All peers": the subject's team, capped at `max` (§9.3). */
  readonly all: boolean;
  readonly perReviewerMax: number;
}

export type Visibility = 'hidden' | 'shown' | 'writer';

export interface CycleVisibility {
  /** Names shown to the subject, per confidential activity (§8.5). */
  readonly peerNames: Visibility;
  readonly upwardNames: Visibility;
  readonly minimum: number;
  readonly release: {
    readonly mode: 'manager' | 'hr_date' | 'close';
    readonly date: CalendarDate | null;
  };
  readonly acknowledge: boolean;
  readonly subjectComment: boolean;
  readonly peerSummary: boolean;
}

export interface Reminders {
  readonly rules: readonly string[];
  readonly email: boolean;
  readonly chat: boolean;
}

export interface Cycle {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly state: CycleState;
  readonly owner: string;
  readonly ownerName: string;
  readonly automationId: string | null;
  readonly start: { readonly date: CalendarDate; readonly time: string; readonly zone: string };
  readonly period: { readonly from: CalendarDate; readonly to: CalendarDate };
  readonly goals: 'none' | 'context' | 'scored';
  readonly participants: {
    readonly filter: readonly Condition[];
    /** All of the conditions, or any one. Absent: all, as every filter before the choice. */
    readonly match?: 'all' | 'any' | undefined;
    readonly include: readonly PersonChoice[];
    readonly exclude: readonly PersonChoice[];
    readonly keepInStep: boolean;
  };
  readonly activities: Readonly<Record<ActivityKind, ActivityConfig>>;
  readonly peer: PeerConfig;
  readonly nominations: Deadline;
  readonly visibility: CycleVisibility;
  readonly reminders: Reminders;
  /** Fixed at launch (§8.7): who, on which versions, due when. */
  readonly snapshot: {
    readonly subjects: readonly string[];
    readonly pinned: Readonly<
      Partial<Record<ActivityKind, { templateId: string; version: number }>>
    >;
    readonly due: Readonly<Partial<Record<ActivityKind | 'nominations', CalendarDate>>>;
  } | null;
  readonly launch: {
    readonly total: number;
    readonly created: number;
    /** Subjects done so far: a retry continues from here (§8.7). */
    readonly done: number;
    readonly error: string | null;
    readonly at: string | null;
  };
  /** People who left the filter after launch, for HR to decide (§8.2). */
  readonly noLongerMatches: readonly string[];
  /** Bumped on every change, so the live stream can drop a stale message. */
  readonly version: number;
  readonly createdAt: string;
  readonly closedAt: string | null;
}

export const KINDS: readonly ActivityKind[] = [
  'self',
  'manager',
  'peer',
  'upward',
  'skip',
  'goals',
];
export const REVIEW_KINDS: readonly ActivityKind[] = ['self', 'manager', 'peer', 'upward', 'skip'];

const NEXT: Readonly<Record<CycleState, readonly CycleState[]>> = {
  draft: ['scheduling', 'launching'],
  scheduling: ['scheduled', 'draft'],
  scheduled: ['launching', 'draft'],
  launching: ['in_progress', 'launch_failed'],
  launch_failed: ['launching', 'draft'],
  in_progress: ['closing'],
  closing: ['closed'],
  closed: ['archived'],
  archived: ['closed'],
};

export function move(c: Cycle, to: CycleState): Result<Cycle> {
  if (!NEXT[c.state].includes(to))
    return err(
      failure(
        'BAD_STATE',
        `A cycle that is ${c.state.replace('_', ' ')} cannot become ${to.replace('_', ' ')}`,
      ),
    );
  return ok({ ...c, state: to, version: c.version + 1 });
}

/** Whether a draft or scheduled cycle can still be edited. */
export const editable = (c: Cycle): boolean =>
  c.state === 'draft' || c.state === 'scheduled' || c.state === 'launch_failed';

/**
 * The one button (§8.1): launch when the start is today in the cycle's zone,
 * schedule when it is later; a start in the past is refused.
 */
export function startAction(c: Cycle, today: CalendarDate): Result<'launch' | 'schedule'> {
  if (c.start.date < today) return err(failure('START_PASSED', 'The start date has passed'));
  return ok(c.start.date === today ? 'launch' : 'schedule');
}

export const addDays = (date: CalendarDate, days: number): CalendarDate => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10) as CalendarDate;
};

/** A deadline as a date, against the start and the nominations' own (§8.4). */
export function resolve(c: Pick<Cycle, 'start' | 'nominations'>, d: Deadline): CalendarDate {
  if (d.kind === 'exact') return d.date;
  const base = d.from === 'nominations' ? resolve(c, c.nominations) : c.start.date;
  return addDays(base, d.days);
}

export function dueDates(c: Cycle): Partial<Record<ActivityKind | 'nominations', CalendarDate>> {
  const out: Partial<Record<ActivityKind | 'nominations', CalendarDate>> = {};
  for (const k of KINDS) if (c.activities[k].on) out[k] = resolve(c, c.activities[k].due);
  if (c.activities.peer.on && !c.peer.all) out.nominations = resolve(c, c.nominations);
  return out;
}

export interface Issue {
  readonly level: 'block' | 'warn' | 'ok';
  readonly title: string;
  readonly detail: string;
  /** The people it is about, by id. */
  readonly people?: readonly string[];
}

export interface CheckInput {
  readonly cycle: Cycle;
  readonly today: CalendarDate;
  readonly subjects: readonly {
    readonly personId: string;
    readonly name: string;
    readonly managerId: string | null;
  }[];
  /** Templates by id: whether each has a published version, and its number. */
  readonly templates: Readonly<
    Record<string, { readonly name: string; readonly published: number | null }>
  >;
  readonly holidays?: readonly CalendarDate[];
  /** Subjects already in another running cycle's self review in these weeks. */
  readonly overlapping?: readonly string[];
}

/** The checks before launch (§8.6): what blocks, what only warns, what is fine. */
export function checks(input: CheckInput): Issue[] {
  const { cycle: c } = input;
  const issues: Issue[] = [];
  if (input.subjects.length === 0)
    issues.push({
      level: 'block',
      title: 'Nobody is in the cycle',
      detail: 'Add a filter or name people.',
    });
  const on = REVIEW_KINDS.filter((k) => c.activities[k].on);
  if (on.length === 0 && !c.activities.goals.on)
    issues.push({
      level: 'block',
      title: 'No activity is on',
      detail: 'Turn on at least one review.',
    });
  for (const k of on) {
    const id = c.activities[k].templateId;
    const t = id === null ? undefined : input.templates[id];
    if (t === undefined)
      issues.push({
        level: 'block',
        title: `The ${label(k)} has no form`,
        detail: 'Pick a published template.',
      });
    else if (t.published === null)
      issues.push({
        level: 'block',
        title: `“${t.name}” is not published`,
        detail: 'Publish it, or pick another.',
      });
  }
  if (c.activities.manager.on) {
    // A founder, a contractor, someone between teams: they take part, and
    // the one review nobody can write is left out (`authorsFor`).
    const none = input.subjects.filter((s) => s.managerId === null);
    if (none.length > 0)
      issues.push({
        level: 'warn',
        title:
          none.length === 1
            ? `${none[0]?.name ?? 'Someone'} has no manager`
            : `${String(none.length)} people have no manager`,
        detail: 'They take part in the cycle; nobody writes their manager review.',
        people: none.map((s) => s.personId),
      });
  }
  const due = dueDates(c);
  for (const [k, d] of Object.entries(due))
    if (d < c.start.date)
      issues.push({
        level: 'block',
        title: `The ${label(k)} is due before the start`,
        detail: `Due ${d}.`,
      });
  if (
    c.activities.manager.on &&
    c.activities.manager.afterOthers === true &&
    due.manager !== undefined &&
    ((due.self !== undefined && due.manager < due.self) ||
      (due.peer !== undefined && due.manager < due.peer))
  )
    issues.push({
      level: 'warn',
      title: 'The manager review is due before what it reads',
      detail: 'Managers may write before every self and peer review is in.',
    });
  const holidays = new Set(input.holidays ?? []);
  for (const [k, d] of Object.entries(due))
    if (holidays.has(d))
      issues.push({
        level: 'warn',
        title: `The ${label(k)} is due on a public holiday`,
        detail: d,
      });
  if (c.start.date < input.today)
    issues.push({
      level: 'block',
      title: 'The start date has passed',
      detail: 'Pick today or later.',
    });
  if ((input.overlapping ?? []).length > 0)
    issues.push({
      level: 'warn',
      title: `${String(input.overlapping?.length)} people are already in a review then`,
      detail: 'Another cycle asks them for a self review in the same weeks.',
      people: input.overlapping ?? [],
    });
  if (issues.every((i) => i.level !== 'block'))
    issues.push({ level: 'ok', title: 'Ready', detail: 'Nothing blocks this cycle.' });
  return issues;
}

export const blocked = (issues: readonly Issue[]): boolean =>
  issues.some((i) => i.level === 'block');

export function label(kind: string): string {
  switch (kind) {
    case 'self':
      return 'self review';
    case 'manager':
      return 'manager review';
    case 'peer':
      return 'peer review';
    case 'upward':
      return 'upward review';
    case 'skip':
      return 'skip-level review';
    case 'goals':
      return 'goals review';
    case 'nominations':
      return 'peer nominations';
    default:
      return kind;
  }
}

/** A member as the filter reads them. */
export interface Filterable {
  readonly personId: string;
  readonly status: string;
  readonly department: string | null;
  readonly managerPersonId: string | null;
  readonly title: string | null;
  readonly hiredOn: string | null;
  readonly legalEntityId: string | null;
  readonly locationId: string | null;
}

/** The member's value a condition reads, lower-cased. */
function valueOf(m: Filterable, field: Condition['field']): string | null {
  const v = {
    department: m.department,
    status: m.status,
    startedBefore: m.hiredOn,
    hiredOn: m.hiredOn,
    manager: m.managerPersonId,
    title: m.title,
    legalEntity: m.legalEntityId,
    location: m.locationId,
  }[field];
  return v === null ? null : v.toLowerCase();
}

const opOf = (c: Condition): NonNullable<Condition['op']> =>
  c.op ?? (c.field === 'startedBefore' ? 'before' : c.field === 'title' ? 'contains' : 'is');

function holds(m: Filterable, c: Condition): boolean {
  const have = valueOf(m, c.field);
  const want = c.value.toLowerCase();
  switch (opOf(c)) {
    case 'is':
      return have === want;
    case 'not':
      return have !== want;
    case 'contains':
      return have !== null && have.includes(want);
    case 'before':
      return have !== null && have < want;
    case 'after':
      return have !== null && have > want;
  }
}

/**
 * Whether a member is in. With `all`, conditions "is" on one field are
 * alternatives ("Department is Sales or Support") and everything else must
 * hold; with `any`, one condition is enough (§8.2).
 */
export function matches(
  m: Filterable,
  filter: readonly Condition[],
  match: 'all' | 'any' = 'all',
): boolean {
  if (match === 'any') return filter.some((c) => holds(m, c));
  const alternatives = new Map<string, Condition[]>();
  for (const c of filter) {
    if (opOf(c) === 'is') alternatives.set(c.field, [...(alternatives.get(c.field) ?? []), c]);
    else if (!holds(m, c)) return false;
  }
  for (const group of alternatives.values()) if (!group.some((c) => holds(m, c))) return false;
  return true;
}

/** The reminders a kind of review follows: its own, else the cycle's. */
export const remindersFor = (c: Cycle, kind: ActivityKind): Reminders =>
  c.activities[kind].reminders ?? c.reminders;

/**
 * Whether a review `days` from its deadline (negative: late) is reminded
 * today: `before:3`, `on_day`, and `late:2`, every two days, three times at
 * most.
 */
export function remindsOn(rules: readonly string[], days: number): boolean {
  return rules.some((rule) => {
    const [kind, n] = rule.split(':');
    const every = Math.max(1, Number(n));
    if (kind === 'before') return days === Number(n);
    if (kind === 'on_day') return days === 0;
    if (kind === 'late') return days < 0 && -days % every === 0 && -days <= every * 3;
    return false;
  });
}

/** Who is in: the filter, then the inclusions, less the exclusions (§8.2). */
export function subjectsOf(c: Cycle, members: readonly Filterable[]): string[] {
  const out = new Set(
    c.participants.filter.length === 0
      ? []
      : members
          .filter(
            (m) =>
              m.status !== 'terminated' &&
              matches(m, c.participants.filter, c.participants.match ?? 'all'),
          )
          .map((m) => m.personId),
  );
  for (const p of c.participants.include) out.add(p.personId);
  for (const p of c.participants.exclude) out.delete(p.personId);
  return [...out];
}

/** A blank draft, with the PRD's defaults. */
export function draftCycle(input: {
  readonly id: string;
  readonly name: string;
  readonly owner: string;
  readonly ownerName: string;
  readonly start: CalendarDate;
  readonly zone: string;
  readonly at: string;
  readonly templates: Partial<Record<ActivityKind, string>>;
}): Cycle {
  const act = (
    k: ActivityKind,
    on: boolean,
    days: number,
    from: 'start' | 'nominations' = 'start',
  ): ActivityConfig => ({
    on,
    templateId: input.templates[k] ?? null,
    pinnedVersion: null,
    due: { kind: 'relative', days, from },
  });
  const from = new Date(`${input.start}T00:00:00Z`);
  from.setUTCMonth(from.getUTCMonth() - 6);
  return {
    id: input.id,
    name: input.name,
    description: '',
    state: 'draft',
    owner: input.owner,
    ownerName: input.ownerName,
    automationId: null,
    start: { date: input.start, time: '09:00', zone: input.zone },
    period: { from: from.toISOString().slice(0, 10) as CalendarDate, to: addDays(input.start, -1) },
    goals: 'context',
    participants: {
      filter: [{ field: 'status', value: 'active' }],
      include: [],
      exclude: [],
      keepInStep: true,
    },
    activities: {
      self: act('self', true, 14),
      manager: { ...act('manager', true, 28), afterOthers: true },
      peer: act('peer', true, 19, 'nominations'),
      upward: act('upward', false, 21),
      skip: act('skip', false, 28),
      goals: act('goals', false, 28),
    },
    peer: {
      picker: 'subject',
      min: 2,
      max: 4,
      approval: true,
      declineReplace: true,
      all: false,
      perReviewerMax: 5,
    },
    nominations: { kind: 'relative', days: 3, from: 'start' },
    visibility: {
      peerNames: 'hidden',
      upwardNames: 'hidden',
      minimum: 3,
      release: { mode: 'manager', date: null },
      acknowledge: true,
      subjectComment: true,
      peerSummary: true,
    },
    reminders: { rules: ['before:3', 'on_day', 'late:2'], email: true, chat: true },
    snapshot: null,
    launch: { total: 0, created: 0, done: 0, error: null, at: null },
    noLongerMatches: [],
    version: 1,
    createdAt: input.at,
    closedAt: null,
  };
}
