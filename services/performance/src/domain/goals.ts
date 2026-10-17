import { Decimal } from 'decimal.js';
import type { CalendarDate } from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * Goals (PRD §14, PRF-100 to PRF-103): key results measured as numbers,
 * percentages, money or done-or-not; progress and the goal score computed
 * here, never typed; weights that sum to 100 before a set is committed.
 */

export type Measure = 'number' | 'percentage' | 'currency' | 'done';
export type Confidence = 'on_track' | 'at_risk' | 'off_track';

export interface KeyResult {
  readonly id: string;
  readonly title: string;
  readonly measure: Measure;
  readonly start: number;
  readonly target: number;
  readonly current: number;
  readonly unit: string | null;
  /** Its share of the goal, in percent; equal shares when none is set. */
  readonly weight: number | null;
  /** A Linear project or Jira epic it follows, read with the owner's grant. */
  readonly linked: string | null;
}

export interface CheckIn {
  readonly at: string;
  readonly by: string;
  readonly values: Readonly<Record<string, number>>;
  readonly confidence: Confidence;
  readonly note: string | null;
}

/**
 * Who sees a goal (§14.2): its owner and their managers only, the owner's team
 * and managers, or everyone. Private until made public.
 */
export type GoalVisibility = 'owner' | 'team' | 'everyone';

export interface Goal {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly ownerId: string | null;
  readonly ownerKind: 'person' | 'team' | 'company';
  readonly periodId: string;
  readonly parentId: string | null;
  /** In percent of the owner's goals for the period, when weighted. */
  readonly weight: number | null;
  readonly commitment: 'committed' | 'aspirational';
  readonly status: 'draft' | 'active' | 'completed' | 'missed' | 'cancelled';
  readonly keyResults: readonly KeyResult[];
  readonly checkIns: readonly CheckIn[];
  readonly createdAt: string;
  /** Absent on a goal set before visibility existed, which is private like any other. */
  readonly visibility?: GoalVisibility;
}

/** A goal's visibility: as set, else private, except the company's own goals, which are everyone's. */
export const visibilityOf = (g: Pick<Goal, 'visibility' | 'ownerKind'>): GoalVisibility =>
  g.visibility ?? (g.ownerKind === 'company' ? 'everyone' : 'owner');

/**
 * Whether this reader sees this goal. HR and the owner always; anyone the
 * owner reports to, at any depth (`org`, the reader's organisation); then as
 * the goal says: for `team`, the owner's peers under the same manager and the
 * owner's own reports; for `everyone`, everyone.
 */
export function canSeeGoal(
  g: Pick<Goal, 'visibility' | 'ownerKind' | 'ownerId'>,
  reader: {
    readonly personId: string | null;
    readonly managerId: string | null;
    readonly hr: boolean;
    readonly org: ReadonlySet<string>;
  },
  owner: { readonly managerId: string | null } | null,
): boolean {
  if (reader.hr) return true;
  const visibility = visibilityOf(g);
  if (visibility === 'everyone') return true;
  if (g.ownerId === null) return false;
  if (g.ownerId === reader.personId || reader.org.has(g.ownerId)) return true;
  if (visibility === 'owner') return false;
  const peers = reader.managerId !== null && reader.managerId === owner?.managerId;
  return peers || reader.managerId === g.ownerId;
}

export interface Period {
  readonly id: string;
  readonly name: string;
  readonly from: string;
  readonly to: string;
  readonly cadence: 'weekly' | 'fortnightly' | 'monthly' | 'none';
}

/** One key result's progress, 0–100: current against start and target, either direction. */
export function krProgress(kr: KeyResult): number {
  if (kr.measure === 'done') return kr.current >= 1 ? 100 : 0;
  if (kr.target === kr.start) return kr.current === kr.target ? 100 : 0;
  const share = new Decimal(kr.current - kr.start).dividedBy(kr.target - kr.start).times(100);
  return Math.max(0, Math.min(100, share.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()));
}

/** A goal's progress: its key results averaged by weight (§14.2). */
export function progress(g: Pick<Goal, 'keyResults'>): number {
  if (g.keyResults.length === 0) return 0;
  const weighted = g.keyResults.every((k) => k.weight !== null);
  let sum = new Decimal(0);
  let total = new Decimal(0);
  for (const k of g.keyResults) {
    const w = new Decimal(weighted ? (k.weight ?? 0) : 1);
    sum = sum.plus(w.times(krProgress(k)));
    total = total.plus(w);
  }
  return total.isZero()
    ? 0
    : sum.dividedBy(total).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/** The owner's last word on it; on track until they say otherwise. */
export const confidence = (g: Goal): Confidence => g.checkIns.at(-1)?.confidence ?? 'on_track';

/**
 * Progress as a rating on the scale (settings S4): 0–39% → 2, 40–69% → 3,
 * 70–99% → 4, 100% → 5. An aspirational goal is scored the same way: 70% of it
 * is already a 4 (S4).
 */
export function rating(g: Pick<Goal, 'keyResults'>, p: number = progress(g)): number {
  if (p >= 100) return 5;
  if (p >= 70) return 4;
  if (p >= 40) return 3;
  return 2;
}

/** The goal score (§14.3): ratings weighted by the goals' weights, in hundredths. */
export function goalScore(
  goals: readonly Goal[],
  ratings?: Readonly<Record<string, number>>,
): number | null {
  const counted = goals.filter((g) => g.status !== 'cancelled' && g.status !== 'draft');
  if (counted.length === 0) return null;
  const weighted = counted.every((g) => g.weight !== null);
  let sum = new Decimal(0);
  let total = new Decimal(0);
  for (const g of counted) {
    const w = new Decimal(weighted ? (g.weight ?? 0) : 1);
    sum = sum.plus(w.times(ratings?.[g.id] ?? rating(g)));
    total = total.plus(w);
  }
  if (total.isZero()) return null;
  return sum.dividedBy(total).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/** Weights in a weighted set sum to 100 before it is committed (§14.3). */
export function checkWeights(goals: readonly Pick<Goal, 'weight'>[]): Result<true> {
  if (goals.some((g) => g.weight === null)) return ok(true);
  const sum = goals.reduce((n, g) => n + (g.weight ?? 0), 0);
  return sum === 100
    ? ok(true)
    : err(failure('WEIGHTS', `Weights add up to ${String(sum)}%, not 100%`));
}

export function checkIn(g: Goal, c: CheckIn): Result<Goal> {
  if (g.status !== 'active')
    return err(failure('NOT_ACTIVE', 'Only an active goal takes a check-in'));
  for (const id of Object.keys(c.values))
    if (!g.keyResults.some((k) => k.id === id))
      return err(failure('UNKNOWN_KR', `No key result ${id}`));
  return ok({
    ...g,
    keyResults: g.keyResults.map((k) =>
      k.id in c.values ? { ...k, current: c.values[k.id] ?? k.current } : k,
    ),
    checkIns: [...g.checkIns, c],
  });
}

/** When the next check-in falls due, from the last one and the period's cadence (§14.5). */
export function nextCheckIn(g: Goal, period: Period): CalendarDate | null {
  const days =
    period.cadence === 'weekly'
      ? 7
      : period.cadence === 'fortnightly'
        ? 14
        : period.cadence === 'monthly'
          ? 30
          : null;
  if (days === null || g.status !== 'active') return null;
  const last = g.checkIns.at(-1)?.at.slice(0, 10) ?? g.createdAt.slice(0, 10);
  const d = new Date(`${last}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10) as CalendarDate;
}
