import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { AttributeDefinition } from '@kithena/contracts';

import {
  attritionTrend,
  chartFilters,
  completeByMonth,
  completeness,
  completenessByDay,
  composition,
  expiryTimeline,
  headcountTrend,
  joinerHeatmap,
  percentComplete,
  movementWaterfall,
  selfIdBreakdown,
  spanOfControl,
  tenure,
  TENURE_BANDS,
  type ChartContext,
  type Filters,
} from '../analytics/queries.js';
import { cohortMinimum } from '../analytics/access.js';
import { payCharts, type PayCell } from '../analytics/pay.js';
import { selfIdFields } from '../analytics/snapshot.js';
import { fromMinor } from '../import/cells.js';
import { relationsToMany, type Asking } from '../person/person-access.js';
import { run } from '../person/service.js';
import type { ViewerRelations } from '../../domain/access/field-access.js';
import { NOBODY, tenantToday, type ScreenDeps, type Tx } from './record.js';
import { chartViewerOf, segmentFor, segmentsFor, type SegmentView } from './segments.js';

/**
 * The analytics screen (PRD §16, design screen 12): every chart of §16.2 that
 * People can answer, each already shaped by the query layer.
 *
 * HR sees the tenant; anybody with a record sees their own chain, which for
 * somebody who manages nobody is empty; anybody else is refused. A chart the
 * viewer may not draw — a field they cannot read, a breakdown they may not
 * have — is null and is not drawn, the absent-not-empty rule a profile
 * follows. Field authorization and the cohort minimum are the queries' own,
 * so they hold here, in a tooltip and in an export alike.
 *
 * ### A segment (PEO-068)
 *
 * Applied as chart filters, and authorized as any filter is, as this viewer
 * and over their scope — a segment HR shared shows a manager their own chain
 * matching it, and a segment over a field the viewer cannot read is refused.
 * A chart that cannot honour a segment (span of control, the live expiry
 * timeline, self-identification, which is never filtered) is not drawn under
 * one, rather than drawn unfiltered beside charts that are.
 */

export interface Point {
  readonly label: string;
  readonly value: number;
}

export interface SelfIdChart {
  readonly key: string;
  readonly label: string;
  /** "insufficient data" is `insufficient_data`, with the minimum that withheld it. */
  readonly status: 'ok' | 'insufficient_data';
  readonly minimum: number | null;
  /** The snapshot day the publication reflects; null before the first. */
  readonly publishedAsOf: string | null;
  /** Rounded to 5 on its own: never the sum of the cells. */
  readonly total: number | null;
  readonly note: string;
  readonly cells: readonly Point[];
}

export interface AnalyticsView {
  readonly asOf: string;
  readonly source: 'snapshot' | 'history';
  readonly sourceNote: string;
  /** The segment applied, and those this viewer could apply. */
  readonly segment: { readonly id: string; readonly name: string } | null;
  readonly segments: readonly Pick<SegmentView, 'id' | 'name'>[];
  readonly headcount: {
    readonly value: number;
    readonly change: number | null;
    readonly trend: readonly Point[];
  };
  /**
   * Hired and not started yet (`pre_hire`, "Starting soon"): HR's only, the
   * tenant's count. Null for anybody else — a manager's directory is wider
   * than their chain, so it would not be theirs — and under a segment, which
   * the snapshot cannot hold a pre-hire in (they are not on the headcount yet).
   */
  readonly startingSoon: number | null;
  readonly attrition: {
    readonly percent: number;
    readonly leavers: number;
    readonly formula: string;
    /** Rolling 12-month attrition, in percent, by month (PEO-067). */
    readonly trend: readonly Point[];
  } | null;
  /** Groups smaller than this are withheld from every breakdown (§11). */
  readonly minimum: number;
  readonly complete: {
    readonly percent: number;
    readonly incomplete: number;
    /**
     * Points since the snapshot a month ago; null when that day has none,
     * rather than a figure computed against nothing.
     */
    readonly change: number | null;
    /** Percent complete by month, snapshot months only. */
    readonly trend: readonly Point[];
  } | null;
  readonly expiringIn90Days: number | null;
  readonly movement: {
    readonly period: string;
    readonly opening: number;
    readonly joiners: number;
    readonly moves: number;
    readonly leavers: number;
    readonly closing: number;
  } | null;
  readonly completenessBySection: readonly Point[] | null;
  /** The timeline's items (PEO-122); null when the viewer may see no kind of expiry. */
  readonly expiries: {
    readonly today: string;
    readonly items: readonly {
      readonly kind: string;
      readonly personId: string;
      readonly name: string | null;
      readonly day: string;
    }[];
  } | null;
  /** Here now, and left in the last 12 months, by tenure band (PEO-067). */
  readonly tenure:
    | readonly {
        readonly label: string;
        readonly headcount: number;
        readonly leavers: number;
      }[]
    | null;
  /** How many managers have how many direct reports (PEO-067). */
  readonly span: readonly Point[] | null;
  /** Joiners by department and month over the last 12 months (PEO-067). */
  readonly joiners: {
    readonly months: readonly string[];
    readonly departments: readonly string[];
    readonly cells: readonly {
      readonly row: string;
      readonly column: string;
      readonly value: number;
    }[];
  } | null;
  /** Headcount by department, split by employment type (PEO-067). */
  readonly composition: {
    readonly categories: readonly string[];
    readonly series: readonly { readonly label: string; readonly values: readonly number[] }[];
  } | null;
  /** Voluntary self-identification, HR's only, from the monthly publication (PEO-070). */
  readonly selfId: readonly SelfIdChart[] | null;
  /** Pay in aggregate, finance's only, never under a segment (PEO-078). */
  readonly pay: PayView | null;
  readonly funnel: null;
}

/**
 * One group's quartiles, or "insufficient data" with no number at all.
 * Salary figures are minor units; compa-ratio figures a ratio to four places.
 */
export interface PayGroupView {
  readonly label: string;
  readonly currency: string;
  readonly status: 'ok' | 'insufficient_data';
  readonly people: number | null;
  readonly p25: string | null;
  readonly median: string | null;
  readonly p75: string | null;
  /** The band in force for this grade and currency, in minor units; null for none, and for tenure. */
  readonly band: {
    readonly minimumMinor: string;
    readonly midpointMinor: string;
    readonly maximumMinor: string;
  } | null;
}

export interface PayView {
  /** The snapshot day the figures are from; null before the first. */
  readonly asOf: string | null;
  readonly minimum: number;
  /** Salary per grade, inside its band. */
  readonly grade: readonly PayGroupView[];
  /** Salary per tenure band: pay against tenure, never a point per person. */
  readonly tenure: readonly PayGroupView[];
  /** Salary over the band midpoint, per grade. */
  readonly compa: readonly PayGroupView[];
}

export const minusMonths = (day: string, n: number): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
};

export const TENURE_LABELS: Readonly<Record<(typeof TENURE_BANDS)[number], string>> = {
  '0_6m': 'Under 6 months',
  '6_12m': '6 to 12 months',
  '12_18m': '12 to 18 months',
  '18_24m': '18 to 24 months',
  '2_5y': '2 to 5 years',
  '5y_plus': '5 years or more',
};

/** A select's stored value as the label its options give it; "Not set" for none. */
export function labeller(
  definitions: readonly AttributeDefinition[],
  key: string,
): (value: string | null) => string {
  const definition = definitions.find((d) => d.key === key);
  const options =
    definition?.typeConfig.kind === 'select' || definition?.typeConfig.kind === 'multi_select'
      ? new Map(definition.typeConfig.options.map((o) => [o.value as string, o.label.default]))
      : new Map<string, string>();
  return (value) => {
    if (value === null) return 'Not set';
    if (value === '(unanswered)') return 'Not answered';
    return options.get(value) ?? value;
  };
}

/** Two dimensions' cells as a stacked bar: categories by total, one series per second value. */
export function stacked(
  cells: readonly { readonly keys: readonly (string | null)[]; readonly count: number }[],
  category: (v: string | null) => string,
  series: (v: string | null) => string,
): NonNullable<AnalyticsView['composition']> {
  const totals = new Map<string, number>();
  const bySeries = new Map<string, Map<string, number>>();
  for (const { keys, count } of cells) {
    const c = category(keys[0] ?? null);
    const s = series(keys[1] ?? null);
    totals.set(c, (totals.get(c) ?? 0) + count);
    const row = bySeries.get(s) ?? new Map<string, number>();
    row.set(c, (row.get(c) ?? 0) + count);
    bySeries.set(s, row);
  }
  const categories = [...totals].toSorted((a, b) => b[1] - a[1]).map(([c]) => c);
  return {
    categories,
    series: [...bySeries].map(([label, row]) => ({
      label,
      values: categories.map((c) => row.get(c) ?? 0),
    })),
  };
}

export async function analyticsView(
  deps: ScreenDeps,
  asking: Asking,
  request: { readonly segmentId?: string } = {},
): Promise<Result<AnalyticsView>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const scoped = await chartScope(deps, tx, asking, request.segmentId);
    if (!scoped.ok) return scoped;
    return chartsView(deps, tx, asking, scoped.value);
  });
}

/** What every chart of one viewer is drawn under: who they are, the schema, the segment. */
export interface ChartScope {
  readonly ctx: ChartContext;
  readonly today: string;
  readonly filters: Filters | undefined;
  readonly segment: AnalyticsView['segment'];
  readonly definitions: readonly AttributeDefinition[];
  /** Section keys to their labels. */
  readonly sections: ReadonlyMap<string, string>;
  readonly everyone: ViewerRelations;
}

/**
 * The viewer's charts' context, or why they have none: anybody but HR and
 * managers is refused, as is a segment they may not use.
 */
export async function chartScope(
  deps: ScreenDeps,
  tx: Tx,
  asking: Asking,
  segmentId?: string,
): Promise<Result<ChartScope>> {
  const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
  const viewer = await chartViewerOf(deps, tx, asking, everyone);
  if (viewer === null) return err(failure('FORBIDDEN', 'Analytics is for HR and managers'));
  const version = await deps.service.schemas.current(tx, asking.tenantId);
  if (!version) return err(failure('SCHEMA_NOT_PUBLISHED', 'Nothing is published yet'));
  const definitions = version.document.attributes;
  // The tenant's own minimum, never below the floor (`cohortMinimum`).
  const settings = await deps.service.org?.settings(tx, asking);
  const ctx: ChartContext = {
    tx,
    tenantId: asking.tenantId,
    viewer,
    definitions,
    ...(settings?.ok === true ? { cohortMinimum: settings.value.cohortMinimum } : {}),
  };
  const today = await tenantToday(deps, tx, asking.tenantId);
  let segment: AnalyticsView['segment'] = null;
  let filters: Filters | undefined;
  if (segmentId !== undefined) {
    const found = await segmentFor(deps, tx, asking, segmentId);
    if (!found.ok) return found;
    const charted = chartFilters(found.value.filter);
    if (!charted.ok) return charted;
    segment = { id: found.value.id, name: found.value.name };
    filters = charted.value;
  }
  return ok({
    ctx,
    today,
    filters,
    segment,
    definitions,
    sections: new Map(version.document.sections.map((s) => [s.key as string, s.label.default])),
    everyone,
  });
}

async function chartsView(
  deps: ScreenDeps,
  tx: Tx,
  asking: Asking,
  scope: ChartScope,
): Promise<Result<AnalyticsView>> {
  const { ctx, today, filters, segment, definitions, everyone } = scope;
  const viewer = ctx.viewer;
  const range = (from: string) => ({ from, to: today, ...(filters ? { filters } : {}) });

  const trend = await headcountTrend(ctx, range(minusMonths(today, 12)));
  // The one chart every viewer gets: a segment they may not use stops here.
  if (!trend.ok) return trend;
  const starting =
    viewer.kind === 'hr' && filters === undefined
      ? await deps.service.access.count(tx, {
          ...asking,
          refine: { conditions: [{ key: 'status', op: 'is', values: ['pre_hire'] }] },
        })
      : null;
  const points = trend.value.points;
  const last = points.at(-1);
  const before = points.at(-2);

  const attrition = await attritionTrend(ctx, range(minusMonths(today, 12)));
  const latest = attrition.ok ? attrition.value.points.at(-1) : undefined;
  const states = await completeness(ctx, { asOf: today, ...(filters ? { filters } : {}) });
  const completeDays = await completenessByDay(ctx, range(minusMonths(today, 12)));
  const monthAgo = completeDays.ok
    ? completeDays.value.find((d) => d.day === minusMonths(today, 1))
    : undefined;
  const then = monthAgo === undefined ? null : percentComplete(monthAgo);
  const moved = await movementWaterfall(ctx, range(minusMonths(today, 1)));

  const expiring =
    filters === undefined
      ? await expiryTimeline(ctx, {
          calendar: await deps.calendars.load(tx, asking.tenantId),
          at: deps.clock.instant(),
          everyone,
          relations: (personIds) =>
            relationsToMany(deps.relations, tx, asking.tenantId, asking.viewer, personIds),
        })
      : null;
  const expiries =
    expiring?.ok === true && expiring.value.kinds.length > 0
      ? { today: expiring.value.today, items: expiring.value.items }
      : null;

  const bands = await tenure(ctx, { asOf: today, ...(filters ? { filters } : {}) });
  const spans = filters === undefined ? await spanOfControl(ctx, { asOf: today }) : null;
  const joined = await joinerHeatmap(ctx, range(minusMonths(today, 12)));
  const made = await composition(ctx, {
    asOf: today,
    by: ['department', 'employment_type'],
    ...(filters ? { filters } : {}),
  });
  const department = labeller(definitions, 'org_unit');
  const employment = labeller(definitions, 'employment_type');

  const percent = states.ok ? percentComplete(states.value.states) : null;
  const bySection = new Map<string, number>();
  if (states.ok && states.value.byField !== null) {
    for (const f of states.value.byField) {
      bySection.set(f.sectionKey, (bySection.get(f.sectionKey) ?? 0) + f.missing);
    }
  }
  const sectionLabel = scope.sections;
  const source = states.ok ? states.value.source : 'snapshot';

  return ok({
    asOf: today,
    source,
    sourceNote:
      source === 'snapshot'
        ? 'From the daily snapshot.'
        : 'Computed from history for this date, which is slower.',
    segment,
    segments: (await segmentsFor(deps, tx, asking))
      .filter((s) => s.usableIn.analytics)
      .map((s) => ({ id: s.id, name: s.name })),
    headcount: {
      value: last?.headcount ?? 0,
      change: last !== undefined && before !== undefined ? last.headcount - before.headcount : null,
      trend: points.map((p) => ({ label: p.month, value: p.headcount })),
    },
    startingSoon: starting?.ok === true ? starting.value.all : null,
    attrition:
      !attrition.ok || latest === undefined || latest.rate === null
        ? null
        : {
            percent: Math.round(latest.rate * 1000) / 10,
            leavers: latest.leavers,
            formula: attrition.value.formula,
            trend: attrition.value.points.flatMap((p) =>
              p.rate === null ? [] : [{ label: p.month, value: Math.round(p.rate * 1000) / 10 }],
            ),
          },
    minimum: cohortMinimum(ctx.cohortMinimum),
    complete:
      states.ok && percent !== null
        ? {
            percent,
            incomplete: states.value.states.incomplete,
            change: then === null ? null : percent - then,
            trend: completeDays.ok
              ? completeByMonth(completeDays.value).map((p) => ({
                  label: p.month,
                  value: p.percent,
                }))
              : [],
          }
        : null,
    // The items drawn, so the tile and the chart cannot disagree by a hidden one.
    expiringIn90Days: expiries === null ? null : expiries.items.length,
    movement: moved.ok
      ? {
          period: `${minusMonths(today, 1)} to ${today}`,
          opening: moved.value.opening,
          joiners: moved.value.joiners,
          moves: moved.value.internalMoves,
          leavers: moved.value.leavers,
          closing: moved.value.closing,
        }
      : null,
    completenessBySection:
      bySection.size === 0
        ? null
        : [...bySection].map(([key, value]) => ({ label: sectionLabel.get(key) ?? key, value })),
    expiries,
    tenure: bands.ok
      ? bands.value.bands.map((b) => ({
          label: TENURE_LABELS[b.band as keyof typeof TENURE_LABELS],
          headcount: b.headcount,
          leavers: b.leavers,
        }))
      : null,
    span:
      spans?.ok === true
        ? spans.value.spans.map((s) => ({
            label: `${String(s.reports)} ${s.reports === 1 ? 'report' : 'reports'}`,
            value: s.managers,
          }))
        : null,
    joiners: joined.ok
      ? {
          months: [...new Set(joined.value.cells.map((c) => c.month))].toSorted(),
          departments: [...new Set(joined.value.cells.map((c) => department(c.department)))],
          cells: joined.value.cells.map((c) => ({
            row: department(c.department),
            column: c.month,
            value: c.joiners,
          })),
        }
      : null,
    composition:
      made.ok && made.value.status === 'ok'
        ? stacked(made.value.cells, department, employment)
        : null,
    selfId: filters === undefined ? await selfIdCharts(ctx) : null,
    // Finance's, and never under a segment: a segment's pay beside the
    // tenant's is the pay of everybody outside it.
    pay: filters === undefined ? await payView(ctx, asking, definitions) : null,
    // ponytail: the onboarding funnel is drawn by the screen but has no
    // query shaped for it yet; absent, not empty.
    funnel: null,
  });
}

/**
 * Every self-identification question, HR's only (§6.7), each as its latest
 * publication serves it: withheld whole below the cohort minimum, else every
 * count and the total rounded to 5 (PEO-083). Null for anybody else, so the
 * section is not drawn at all rather than drawn empty.
 */
async function selfIdCharts(ctx: ChartContext): Promise<SelfIdChart[] | null> {
  if (ctx.viewer.kind !== 'hr') return null;
  const charts: SelfIdChart[] = [];
  for (const key of selfIdFields(ctx.definitions)) {
    // eslint-disable-next-line no-await-in-loop -- a handful of questions, one transaction
    const served = await selfIdBreakdown(ctx, { attributeKey: key });
    if (!served.ok) continue;
    const label = labeller(ctx.definitions, key);
    const s = served.value;
    charts.push({
      key,
      label: ctx.definitions.find((d) => d.key === key)?.label.default ?? key,
      status: s.status,
      minimum: s.status === 'ok' ? null : s.minimum,
      publishedAsOf: s.publishedAsOf,
      total: s.status === 'ok' ? (s.total ?? null) : null,
      note: s.note,
      cells:
        s.status === 'ok' ? s.cells.map((c) => ({ label: label(c.bucket), value: c.count })) : [],
    });
  }
  return charts.length === 0 ? null : charts;
}

/**
 * Pay in aggregate as finance's screen draws it (PEO-078), or null for
 * anybody else, so the section is absent rather than empty. Grades are
 * labelled by their field's options, tenure bands by the tenure chart's.
 */
export async function payView(
  ctx: ChartContext,
  asking: Asking,
  definitions: readonly AttributeDefinition[],
): Promise<PayView | null> {
  const charts = await payCharts(
    ctx,
    asking,
    ctx.cohortMinimum === undefined ? {} : { cohortMinimum: ctx.cohortMinimum },
  );
  if (!charts.ok) return null;
  const { bands } = charts.value;
  const grade = labeller(definitions, 'grade');
  const bandOf = (bucket: string, currency: string): PayGroupView['band'] => {
    const band = bands.find((b) => b.grade === bucket && b.currency === currency);
    return band === undefined
      ? null
      : {
          minimumMinor: band.minimumMinor,
          midpointMinor: band.midpointMinor,
          maximumMinor: band.maximumMinor,
        };
  };
  const view =
    (label: (bucket: string) => string, banded: boolean) =>
    (c: PayCell): PayGroupView => ({
      label: label(c.bucket),
      currency: c.currency,
      status: c.status,
      people: c.people,
      p25: c.p25,
      median: c.median,
      p75: c.p75,
      band: banded ? bandOf(c.bucket, c.currency) : null,
    });
  const order = (b: string) => TENURE_BANDS.indexOf(b as (typeof TENURE_BANDS)[number]);
  return {
    asOf: charts.value.asOf,
    minimum: charts.value.minimum,
    grade: charts.value.grade.map(view(grade, true)),
    tenure: charts.value.tenure
      .toSorted((a, b) => order(a.bucket) - order(b.bucket) || a.currency.localeCompare(b.currency))
      .map(
        view((b) => {
          // A stored bucket this build has no label for reads as itself.
          const band = TENURE_BANDS.find((t) => t === b);
          return band === undefined ? b : TENURE_LABELS[band];
        }, false),
      ),
    compa: charts.value.compa.map(view(grade, true)),
  };
}

const INSUFFICIENT = 'insufficient data';

/**
 * The rows a CSV of the pay charts carries (§16.3: exporting a chart exports
 * its data). Built from the view and nothing else, so a withheld group is
 * "insufficient data" and empty cells here too: no count, no figure. There is
 * no total row, because quartiles do not add up to one.
 */
export function payExport(pay: PayView): readonly (readonly string[])[] {
  const money = (minor: string | null, currency: string) =>
    minor === null ? '' : fromMinor(Number(minor), currency);
  const rowsOf = (chart: string, groups: readonly PayGroupView[], ratio: boolean) =>
    groups.map((g) =>
      g.status !== 'ok'
        ? [chart, g.label, g.currency, INSUFFICIENT, '', '', '']
        : [
            chart,
            g.label,
            g.currency,
            String(g.people),
            ...[g.p25, g.median, g.p75].map((v) => (ratio ? (v ?? '') : money(v, g.currency))),
          ],
    );
  return [
    ['chart', 'group', 'currency', 'people', '25th percentile', 'median', '75th percentile'],
    ...rowsOf('salary by grade', pay.grade, false),
    ...rowsOf('salary by tenure', pay.tenure, false),
    ...rowsOf('compa-ratio by grade', pay.compa, true),
  ];
}

/** Insights' four tabs, each a route: `/people/insights/<tab>`. */
export const INSIGHTS_TABS = ['headcount', 'turnover', 'data-quality', 'pay'] as const;
export type InsightsTab = (typeof INSIGHTS_TABS)[number];

/**
 * The rows a CSV of one Insights tab carries (§16.3: exporting a chart exports
 * its data), for the tab and segment the viewer is looking at. Built from the
 * view and nothing else, as `payExport` is: a chart the viewer may not see is
 * null there and absent here, and the cohort minimum was applied where the
 * numbers were counted. Aggregates only — the expiry timeline names people,
 * so it stays on the screen and out of a file.
 *
 * One shape, `chart, group, series, value`, for every tab but pay, whose
 * quartiles are `payExport`'s own columns.
 */
export function analyticsExport(
  view: AnalyticsView,
  tab: InsightsTab,
): readonly (readonly string[])[] {
  const n = String;
  const rows: string[][] = [];
  const add = (chart: string, group: string, series: string, value: number) => {
    rows.push([chart, group, series, n(value)]);
  };
  if (tab === 'pay') {
    const pay: (readonly string[])[] =
      view.pay === null
        ? [['chart', 'group', 'currency', 'people', '25th percentile', 'median', '75th percentile']]
        : [...payExport(view.pay)];
    for (const q of view.selfId ?? []) {
      if (q.status !== 'ok') pay.push([q.label, '', '', INSUFFICIENT, '', '', '']);
      else for (const c of q.cells) pay.push([q.label, c.label, '', n(c.value), '', '', '']);
    }
    return pay;
  }
  const day = view.asOf;
  if (tab === 'headcount') {
    add('Headcount', day, '', view.headcount.value);
    if (view.startingSoon !== null) add('Starting soon', day, '', view.startingSoon);
    for (const p of view.headcount.trend) add('Headcount by month', p.label, '', p.value);
    const m = view.movement;
    if (m !== null) {
      const where = 'Where the change came from';
      add(where, 'Opening', m.period, m.opening);
      add(where, 'Joined', m.period, m.joiners);
      add(where, 'Moved', m.period, m.moves);
      add(where, 'Left', m.period, m.leavers);
      add(where, 'Closing', m.period, m.closing);
    }
    const c = view.composition;
    if (c !== null) {
      for (const s of c.series) {
        c.categories.forEach((category, i) => {
          add('Headcount by department', category, s.label, s.values[i] ?? 0);
        });
      }
    }
    for (const cell of view.joiners?.cells ?? []) {
      add('Joiners by department', cell.row, cell.column, cell.value);
    }
  }
  if (tab === 'turnover') {
    const a = view.attrition;
    if (a !== null) {
      add('Attrition, rolling 12 months', day, 'percent', a.percent);
      add('Left, 12 months', day, '', a.leavers);
      for (const p of a.trend) add('Attrition by month', p.label, 'percent', p.value);
    }
    for (const b of view.tenure ?? []) {
      add('Tenure', b.label, 'Here now', b.headcount);
      add('Tenure', b.label, 'Left in 12 months', b.leavers);
    }
    for (const p of view.span ?? []) add('Span of control', p.label, 'managers', p.value);
  }
  if (tab === 'data-quality') {
    if (view.complete !== null) {
      add('Records complete', day, 'percent', view.complete.percent);
      add('Incomplete records', day, '', view.complete.incomplete);
    }
    if (view.expiringIn90Days !== null) add('Expiring in 90 days', day, '', view.expiringIn90Days);
    for (const p of view.completenessBySection ?? []) {
      add('Missing details by section', p.label, '', p.value);
    }
  }
  return [['chart', 'group', 'series', 'value'], ...rows];
}
