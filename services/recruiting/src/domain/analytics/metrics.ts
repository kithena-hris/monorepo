import type { StageCategory } from '@kithena/contracts';
import { Decimal } from 'decimal.js';

/**
 * Recruiting's metrics (PRD §23, REC-035): one module of definitions, each
 * with its test, and the catalogue a chart plan is validated against.
 *
 * - Time to hire: the application's first move to its hired move.
 * - Time to fill: the job opened to its last opening hired.
 * - Conversion: the share of applications that ever reached a category,
 *   read from the effective history (undone and corrected moves removed).
 * - Aggregates over people respect the cohort minimum of five.
 */

export const COHORT_MINIMUM = 5;

export const CATEGORIES: readonly StageCategory[] = [
  'applied',
  'screening',
  'interview',
  'assessment',
  'works_council',
  'offer',
  'hired',
];

export interface AppFacts {
  readonly id: string;
  readonly jobId: string;
  readonly receivedAt: string;
  readonly hiredAt: string | null;
  readonly reached: StageCategory;
  readonly outcome: 'active' | 'hired' | 'rejected' | 'withdrawn';
  readonly rejectionReason: string | null;
  readonly source: string;
  readonly department: string | null;
}

const days = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000;

/** The value at a percentile, nearest-rank, to one decimal place; null for none. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return new Decimal(sorted[rank - 1] as number).toDecimalPlaces(1).toNumber();
}

export const timeToHire = (app: AppFacts): number | null =>
  app.hiredAt === null ? null : days(app.receivedAt, app.hiredAt);

export function timeToFill(
  openedAt: string,
  hiredAts: readonly string[],
  openings: number,
): number | null {
  if (hiredAts.length < openings) return null;
  const last = hiredAts.toSorted().at(-1);
  return last === undefined ? null : days(openedAt, last);
}

const rank = (c: StageCategory) => CATEGORIES.indexOf(c);

/** How many applications reached each category, and the share of the one before (PRD §23.2 Funnel). */
export function funnel(
  apps: readonly AppFacts[],
): { category: StageCategory; count: number; ofPrevious: string | null }[] {
  const present = CATEGORIES.filter(
    (c) => c !== 'works_council' || apps.some((a) => a.reached === 'works_council'),
  );
  let previous: number | null = null;
  return present.map((category) => {
    const count = apps.filter((a) => rank(a.reached) >= rank(category)).length;
    const ofPrevious =
      previous === null || previous === 0
        ? null
        : new Decimal(count).div(previous).mul(100).toFixed(0);
    previous = count;
    return { category, count, ofPrevious };
  });
}

export interface Bucket {
  readonly key: string;
  readonly value: number | null;
  readonly n: number;
  /** Below the cohort minimum: the value is withheld. */
  readonly suppressed: boolean;
}

/** A breakdown of a metric by a dimension, with small cohorts withheld. */
export function breakdown(
  apps: readonly AppFacts[],
  by: (a: AppFacts) => string,
  value: (group: readonly AppFacts[]) => number | null,
  personal: boolean,
): Bucket[] {
  const groups = new Map<string, AppFacts[]>();
  for (const app of apps) groups.set(by(app), [...(groups.get(by(app)) ?? []), app]);
  return [...groups.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([key, group]) => {
      const suppressed = personal && group.length < COHORT_MINIMUM;
      return { key, n: group.length, suppressed, value: suppressed ? null : value(group) };
    });
}

/** The four-fifths rule (PRD §22.6): each group's pass rate over the best group's. */
export function adverseImpact(
  groups: readonly { key: string; passed: number; total: number }[],
): { key: string; ratio: string | null; flagged: boolean }[] {
  const rates = groups.map((g) => ({
    key: g.key,
    rate: g.total < COHORT_MINIMUM ? null : new Decimal(g.passed).div(g.total),
  }));
  const best = Decimal.max(
    ...rates.flatMap((r) => (r.rate === null ? [] : [r.rate])),
    new Decimal(0),
  );
  return rates.map((r) => {
    if (r.rate === null || best.isZero()) return { key: r.key, ratio: null, flagged: false };
    const ratio = r.rate.div(best);
    return { key: r.key, ratio: ratio.toFixed(2), flagged: ratio.lessThan(0.8) };
  });
}

/* ---------------------------------------------------------- catalogue -- */

export type ChartKind =
  'funnel' | 'trend' | 'bar' | 'stacked_bar' | 'heatmap' | 'bullet' | 'combo' | 'donut' | 'cohort';
export type Dimension =
  | 'department'
  | 'source'
  | 'job'
  | 'stage'
  | 'hiring_manager'
  | 'country'
  | 'month'
  | 'rejection_reason';
export type Period = 'last_30_days' | 'last_90_days' | 'this_quarter' | 'this_year' | 'last_year';

export interface MetricDefinition {
  readonly key: string;
  readonly label: string;
  readonly dimensions: readonly Dimension[];
  readonly charts: readonly ChartKind[];
  /** About people: breakdowns respect the cohort minimum. */
  readonly personal: boolean;
}

/** What the model may name when asked for a chart (PRD §23.4): names, never a value. */
export const METRICS: readonly MetricDefinition[] = [
  {
    key: 'applications',
    label: 'Applications',
    dimensions: ['department', 'source', 'job', 'country', 'month'],
    charts: ['trend', 'bar', 'stacked_bar', 'donut'],
    personal: false,
  },
  {
    key: 'hires',
    label: 'Hires',
    dimensions: ['department', 'source', 'job', 'country', 'month', 'hiring_manager'],
    charts: ['trend', 'bar', 'stacked_bar', 'combo'],
    personal: false,
  },
  {
    key: 'conversion',
    label: 'Conversion by stage',
    dimensions: ['stage', 'job', 'department', 'source'],
    charts: ['funnel', 'bar'],
    personal: false,
  },
  {
    key: 'time_to_hire',
    label: 'Time to hire',
    dimensions: ['department', 'job', 'source', 'month', 'country'],
    charts: ['bullet', 'bar', 'trend'],
    personal: false,
  },
  {
    key: 'time_to_fill',
    label: 'Time to fill',
    dimensions: ['department', 'job', 'month', 'country'],
    charts: ['bullet', 'bar', 'trend'],
    personal: false,
  },
  {
    key: 'time_in_stage',
    label: 'Time in stage',
    dimensions: ['stage', 'month', 'job'],
    charts: ['heatmap', 'bar'],
    personal: false,
  },
  {
    key: 'offer_acceptance',
    label: 'Offer acceptance rate',
    dimensions: ['department', 'month', 'country'],
    charts: ['trend', 'bar'],
    personal: false,
  },
  {
    key: 'rejection_reasons',
    label: 'Rejection reasons',
    dimensions: ['rejection_reason', 'stage', 'job'],
    charts: ['bar', 'stacked_bar', 'donut'],
    personal: false,
  },
  {
    key: 'source_cost_per_hire',
    label: 'Cost per hire by source',
    dimensions: ['source', 'month'],
    charts: ['combo', 'bar'],
    personal: false,
  },
  {
    key: 'scorecard_lateness',
    label: 'Scorecards late',
    dimensions: ['hiring_manager', 'month'],
    charts: ['bar'],
    personal: true,
  },
];

export interface ChartPlan {
  readonly metric: string;
  readonly breakdown: Dimension | null;
  readonly filters: Readonly<Partial<Record<Dimension, readonly string[]>>>;
  readonly period: Period;
  readonly compare: Period | null;
  readonly chart: ChartKind;
}

/** A plan is used whole or refused whole, with the reason (PRD §23.4 step 3). */
export function validatePlan(
  plan: ChartPlan,
): { ok: true; metric: MetricDefinition } | { ok: false; reason: string } {
  const metric = METRICS.find((m) => m.key === plan.metric);
  if (metric === undefined)
    return { ok: false, reason: `There is no metric called “${plan.metric}”` };
  if (plan.breakdown !== null && !metric.dimensions.includes(plan.breakdown)) {
    return {
      ok: false,
      reason: `${metric.label} cannot be broken down by ${plan.breakdown.replace('_', ' ')}`,
    };
  }
  for (const key of Object.keys(plan.filters)) {
    if (!(metric.dimensions as readonly string[]).includes(key))
      return {
        ok: false,
        reason: `${metric.label} cannot be filtered by ${key.replace('_', ' ')}`,
      };
  }
  if (!metric.charts.includes(plan.chart))
    return {
      ok: false,
      reason: `${metric.label} is not drawn as a ${plan.chart.replace('_', ' ')} chart`,
    };
  return { ok: true, metric };
}
