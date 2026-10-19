import type {
  CalendarDate,
  LaunchCountry,
  OwnerRole,
  Phase,
  TaskKind,
  WorkMode,
} from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * Templates and plans (Recruiting PRD §O3, §O4, ONB-003). Pure: a hire's
 * facts and the templates in, a plan with its dates out. Dates are calendar
 * dates; a due date that falls on a weekend or a holiday the shell passed
 * from Time Off moves to the nearest working day away from the start, so a
 * task before day one never lands after it.
 */

export interface DueRule {
  readonly from: 'start' | 'probation_end';
  readonly days: number;
}

/** "-14d", "0", "+30d" from the start; "probation-14d" from probation's end. */
export function parseDue(text: string): DueRule {
  const m = /^(probation)?([+-]?\d+)d?$/u.exec(text.trim());
  if (m === null) throw new Error(`Not a due rule: ${text}`);
  return { from: m[1] === undefined ? 'start' : 'probation_end', days: Number(m[2]) };
}

export const dueText = (r: DueRule): string =>
  `${r.from === 'probation_end' ? 'probation' : ''}${r.days > 0 && r.from === 'start' ? '+' : ''}${String(r.days)}d`;

export interface Conditions {
  readonly countries?: readonly LaunchCountry[] | undefined;
  readonly legalEntityIds?: readonly string[] | undefined;
  readonly departments?: readonly string[] | undefined;
  readonly workModes?: readonly WorkMode[] | undefined;
  readonly contractTypes?: readonly string[] | undefined;
}

export interface TaskTemplate {
  readonly key: string;
  readonly title: string;
  readonly phase: Phase;
  readonly ownerRole: OwnerRole;
  readonly ownerPersonId: string | null;
  readonly kind: TaskKind;
  readonly due: DueRule;
  /** A People form, a Documents request or a policy, when the kind links one. */
  readonly link: string | null;
}

export interface Template {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
  readonly conditions: Conditions;
  readonly tasks: readonly TaskTemplate[];
}

export interface HireFacts {
  readonly country: LaunchCountry;
  readonly legalEntityId: string | null;
  readonly department: string | null;
  readonly workMode: WorkMode;
  readonly contractType: string | null;
  readonly startDate: CalendarDate;
  readonly probationEnd: CalendarDate | null;
  readonly managerId: string | null;
}

const within = <T>(allowed: readonly T[] | undefined, value: T | null): boolean =>
  allowed === undefined || allowed.length === 0 || (value !== null && allowed.includes(value));

export function matches(c: Conditions, hire: HireFacts): boolean {
  return (
    within(c.countries, hire.country) &&
    within(c.legalEntityIds, hire.legalEntityId) &&
    within(c.departments, hire.department) &&
    within(c.workModes, hire.workMode) &&
    within(c.contractTypes, hire.contractType)
  );
}

/* --------------------------------------------------------------- dates -- */

const DAY = 86_400_000;
export const addDays = (date: CalendarDate, days: number): CalendarDate =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10) as CalendarDate;

export function addMonths(date: CalendarDate, months: number): CalendarDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0)).getUTCDate();
  at.setUTCDate(Math.min(d, last));
  return at.toISOString().slice(0, 10) as CalendarDate;
}

const working = (date: CalendarDate, holidays: ReadonlySet<string>): boolean => {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !holidays.has(date);
};

/** The rule's date, moved off a day nobody works: earlier before the start, later after it. */
export function dueOf(
  rule: DueRule,
  start: CalendarDate,
  probationEnd: CalendarDate | null,
  holidays: ReadonlySet<string>,
): CalendarDate | null {
  const anchor = rule.from === 'start' ? start : probationEnd;
  if (anchor === null) return null;
  let date = addDays(anchor, rule.days);
  const step = rule.from === 'start' && rule.days < 0 ? -1 : 1;
  for (let i = 0; i < 14 && !working(date, holidays); i += 1) date = addDays(date, step);
  return date;
}

/* ---------------------------------------------------------------- plan -- */

export type PlanState = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

export interface PlanTask extends TaskTemplate {
  readonly id: string;
  readonly due: DueRule;
  readonly dueOn: CalendarDate;
  readonly state: 'open' | 'done';
  readonly doneAt: string | null;
  readonly doneBy: string | null;
  /** A country's statutory task: kept whatever the templates say. */
  readonly locked: boolean;
}

export interface Plan {
  readonly id: string;
  readonly hireId: string;
  readonly state: PlanState;
  readonly startDate: CalendarDate;
  readonly probationEnd: CalendarDate | null;
  readonly buddyId: string | null;
  readonly templateIds: readonly string[];
  readonly tasks: readonly PlanTask[];
}

/**
 * Where a task of a kind opens when its template names no link: Performance's
 * goals and learning. The shell owns the addresses, as it does for every
 * link a task carries.
 */
const OPENS: Partial<Record<TaskTemplate['kind'], string>> = {
  goal: '/performance/goals',
  training: '/performance/learning',
};

/** The review the manager owes thirty days before probation ends (§O8). */
const REVIEW: TaskTemplate = {
  key: 'probation_review',
  title: 'Probation review',
  phase: 'probation',
  ownerRole: 'manager',
  ownerPersonId: null,
  kind: 'meeting',
  due: { from: 'probation_end', days: -30 },
  link: null,
};

export function buildPlan(input: {
  readonly id: string;
  readonly hireId: string;
  readonly hire: HireFacts;
  readonly templates: readonly Template[];
  readonly country: readonly TaskTemplate[];
  readonly holidays: ReadonlySet<string>;
  readonly newId: () => string;
}): Plan {
  const chosen = input.templates.filter((t) => t.active && matches(t.conditions, input.hire));
  const byKey = new Map<string, { task: TaskTemplate; locked: boolean }>();
  for (const t of chosen.flatMap((x) => x.tasks)) byKey.set(t.key, { task: t, locked: false });
  for (const t of input.country) byKey.set(t.key, { task: t, locked: true });
  if (input.hire.probationEnd !== null && !byKey.has(REVIEW.key))
    byKey.set(REVIEW.key, { task: REVIEW, locked: true });
  const tasks: PlanTask[] = [];
  for (const { task, locked } of byKey.values()) {
    const dueOn = dueOf(task.due, input.hire.startDate, input.hire.probationEnd, input.holidays);
    if (dueOn === null) continue;
    tasks.push({
      ...task,
      id: input.newId(),
      link: task.link ?? OPENS[task.kind] ?? null,
      dueOn,
      state: 'open',
      doneAt: null,
      doneBy: null,
      locked,
    });
  }
  tasks.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.key.localeCompare(b.key));
  return {
    id: input.id,
    hireId: input.hireId,
    state: 'scheduled',
    startDate: input.hire.startDate,
    probationEnd: input.hire.probationEnd,
    buddyId: null,
    templateIds: chosen.map((t) => t.id),
    tasks,
  };
}

const closed = (plan: Plan) => plan.state === 'completed' || plan.state === 'cancelled';

export function completeTask(
  plan: Plan,
  taskId: string,
  by: string,
  at: string,
  today: CalendarDate,
): Result<{ plan: Plan; late: boolean }> {
  if (closed(plan)) return err(failure('PLAN_CLOSED', `This plan is ${plan.state}`));
  const task = plan.tasks.find((t) => t.id === taskId);
  if (task === undefined) return err(failure('NOT_FOUND', 'No such task'));
  if (task.state === 'done') return err(failure('ALREADY_DONE', 'This task is already done'));
  const tasks = plan.tasks.map((t) =>
    t.id === taskId ? { ...t, state: 'done' as const, doneAt: at, doneBy: by } : t,
  );
  const state: PlanState = tasks.every((t) => t.state === 'done') ? 'completed' : 'in_progress';
  return ok({ plan: { ...plan, tasks, state }, late: today > task.dueOn });
}

export function reopenTask(plan: Plan, taskId: string): Result<Plan> {
  if (plan.state === 'cancelled') return err(failure('PLAN_CLOSED', 'This plan is cancelled'));
  if (!plan.tasks.some((t) => t.id === taskId && t.state === 'done'))
    return err(failure('NOT_DONE', 'This task is not done'));
  return ok({
    ...plan,
    state: 'in_progress',
    tasks: plan.tasks.map((t) =>
      t.id === taskId ? { ...t, state: 'open', doneAt: null, doneBy: null } : t,
    ),
  });
}

/** Day one has come: the plan is under way even if nobody has ticked anything. */
export const startIfDue = <P extends Plan>(plan: P, today: CalendarDate): P =>
  plan.state === 'scheduled' && today >= plan.startDate ? { ...plan, state: 'in_progress' } : plan;

/** A moved start moves every open task hanging off it, and probation's end by as much (§O4). */
export function moveStart<P extends Plan>(
  plan: P,
  start: CalendarDate,
  holidays: ReadonlySet<string>,
): P {
  const shift =
    (Date.parse(`${start}T00:00:00Z`) - Date.parse(`${plan.startDate}T00:00:00Z`)) / DAY;
  const probationEnd = plan.probationEnd === null ? null : addDays(plan.probationEnd, shift);
  return {
    ...plan,
    startDate: start,
    probationEnd,
    tasks: plan.tasks.map((t) =>
      t.state === 'done'
        ? t
        : { ...t, dueOn: dueOf(t.due, start, probationEnd, holidays) ?? t.dueOn },
    ),
  };
}

export const cancelPlan = <P extends Plan>(plan: P): P =>
  plan.state === 'completed' ? plan : { ...plan, state: 'cancelled' };

export function progress(
  plan: Plan,
  today: CalendarDate,
): { done: number; total: number; late: number; next: PlanTask | null } {
  const open = plan.tasks.filter((t) => t.state === 'open');
  return {
    done: plan.tasks.length - open.length,
    total: plan.tasks.length,
    late: plan.state === 'cancelled' ? 0 : open.filter((t) => t.dueOn < today).length,
    next: open[0] ?? null,
  };
}
