import { sql, type SQL } from 'drizzle-orm';
import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { AttributeDefinition } from '@kithena/contracts';

import { visibleTo } from '../../domain/access/field-access.js';
import {
  authorizeFields,
  cohortMinimum,
  relationsOf,
  scopeOf,
  suppressSmallCohorts,
  type ChartViewer,
  type Suppressed,
} from './access.js';
import {
  cubeAt,
  DIMENSIONS,
  EXPIRIES,
  measuresAt,
  rows,
  type Dimension,
  type ExpiryKind,
  type TenantScope,
} from './snapshot.js';

/**
 * The charts of §16.2, as queries over the snapshot.
 *
 * Every query takes the viewer and authorizes before it reads: a breakdown or
 * a filter is a read of that field, and a manager's rows are their chain's.
 * None of them touches `people.person`. A point-in-time chart whose `asOf` is
 * not a snapshot day asks `cubeAt` for the same rows computed from history,
 * and says so in `source` — the UI marks it slow rather than pretending.
 *
 * ### Special-category data
 *
 * A breakdown touching it (self-identification, or a core field a tenant
 * tightened to special-category) is served to HR only, unfiltered, from the
 * latest snapshot only, and withheld whole below the cohort minimum. Each of
 * those closes one way round the minimum:
 *
 * - **unfiltered**, because "all of X" minus "X in Engineering" is X outside
 *   Engineering, whatever the minimum said about that cell;
 * - **latest only, never a range**, because this March minus last March is
 *   whoever changed in between;
 * - **all or nothing**, because headcount minus the cells shown is the cell
 *   withheld.
 *
 * `ponytail:` two reads of the latest snapshot on different days still differ
 * by whoever changed in between. Closing that needs noise (differential
 * privacy) or a coarse publication cadence; add it when a works council asks.
 */

export interface ChartContext extends TenantScope {
  readonly viewer: ChartViewer;
  /** The published definitions — what field-level authorization reads. */
  readonly definitions: readonly AttributeDefinition[];
  /** The tenant's setting. Never lowers the floor of ten. */
  readonly cohortMinimum?: number;
}

/** Only rows whose dimension holds one of these values. */
export type Filters = Partial<Record<Dimension, readonly string[]>>;

/** `snapshot` is the fast path; `history` was computed on the fly and is slow. */
export type Source = 'snapshot' | 'history';

// ------------------------------------------------------------ plumbing --

function keysOf(dimensions: readonly Dimension[], filters: Filters | undefined): string[] {
  const all = [...dimensions, ...(Object.keys(filters ?? {}) as Dimension[])];
  return [...new Set(all.map((d): string | null => DIMENSIONS[d].key).filter((k): k is string => k !== null))];
}

/** Any key at all counts, so a stray `{ department: undefined }` errs towards refusing. */
const hasFilters = (filters: Filters | undefined): boolean => Object.keys(filters ?? {}).length > 0;

/**
 * Authorize a breakdown: every dimension and filter must be one the snapshot
 * holds, and a field this viewer may read.
 *
 * An unknown dimension is refused here rather than left to throw further
 * down: the names arrive from a transport, and `Object.hasOwn` keeps
 * `constructor` from passing as a column.
 */
function authorizeChart(
  ctx: ChartContext,
  dimensions: readonly Dimension[],
  filters: Filters | undefined,
): Result<{ readonly special: boolean }> {
  const unknown = [...dimensions, ...Object.keys(filters ?? {})].find(
    (d) => !Object.hasOwn(DIMENSIONS, d),
  );
  if (unknown !== undefined) {
    return err(
      failure('UNKNOWN_DIMENSION', `${unknown} is not a dimension a chart can use`, [unknown]),
    );
  }
  return authorizeFields(ctx.definitions, ctx.viewer, keysOf(dimensions, filters));
}

/**
 * Authorize a chart over a range of days.
 *
 * Special-category data never appears in a range: a trend of a sensitive
 * breakdown is a sequence of differences, and each difference is a person.
 */
function authorizeRange(
  ctx: ChartContext,
  dimensions: readonly Dimension[],
  filters: Filters | undefined,
): Result<void> {
  const authorized = authorizeChart(ctx, dimensions, filters);
  if (!authorized.ok) return authorized;
  if (authorized.value.special) {
    return err(
      failure(
        'SPECIAL_CATEGORY_POINT_IN_TIME',
        'Special-category data is reported at the latest snapshot only, never over time',
      ),
    );
  }
  return ok(undefined);
}

function filterSql(filters: Filters | undefined): SQL {
  const entries: [string, readonly string[] | undefined][] = Object.entries(filters ?? {});
  const clauses = entries.flatMap(([dimension, values]) => {
    if (values === undefined) return [];
    const column = sql.identifier(DIMENSIONS[dimension as Dimension].column);
    // An empty list matches nothing, which is what "none of these" means.
    if (values.length === 0) return [sql`false`];
    return [sql`${column} IN (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`];
  });
  return clauses.length === 0 ? sql`true` : sql.join(clauses, sql` AND `);
}

async function isSnapshotDay(ctx: ChartContext, day: string): Promise<boolean> {
  const found = await rows<{ one: number }>(
    ctx.tx,
    sql`SELECT 1 AS one FROM people.headcount_snapshot_run
         WHERE tenant_id = ${ctx.tenantId}::uuid AND day = ${day}::date`,
  );
  return found.length > 0;
}

async function latestSnapshotDay(ctx: ChartContext): Promise<string | null> {
  const [row] = await rows<{ day: string | null }>(
    ctx.tx,
    sql`SELECT max(day)::text AS day FROM people.headcount_snapshot_run
         WHERE tenant_id = ${ctx.tenantId}::uuid`,
  );
  return row?.day ?? null;
}

/** The cube rows for one day and this viewer's scope, from the snapshot or from history. */
async function cubeFor(
  ctx: ChartContext,
  day: string,
  flowsFrom: string | null = null,
): Promise<{ from: SQL; source: Source }> {
  const scope = scopeOf(ctx.viewer, ctx.tenantId);
  if (flowsFrom === null && (await isSnapshotDay(ctx, day))) {
    return {
      source: 'snapshot',
      from: sql`(SELECT * FROM people.headcount_snapshot
                  WHERE tenant_id = ${ctx.tenantId}::uuid AND scope_id = ${scope}::uuid
                    AND day = ${day}::date)`,
    };
  }
  return {
    source: 'history',
    from: sql`(SELECT * FROM (${cubeAt(ctx.tenantId, day, flowsFrom)}) AS built
                WHERE built.scope_id = ${scope}::uuid)`,
  };
}

/** One distribution for one day and this viewer's scope. */
async function measureFor(
  ctx: ChartContext,
  day: string,
  measure: SQL,
): Promise<{ rows: { measure: string; bucket: string; count: number }[]; source: Source }> {
  const scope = scopeOf(ctx.viewer, ctx.tenantId);
  const onGrid = await isSnapshotDay(ctx, day);
  const from = onGrid
    ? sql`(SELECT * FROM people.headcount_snapshot_measure
            WHERE tenant_id = ${ctx.tenantId}::uuid AND day = ${day}::date)`
    : sql`(${measuresAt(ctx.tenantId, day, [])})`;
  const found = await rows<{ measure: string; bucket: string; count: number }>(
    ctx.tx,
    sql`SELECT m.measure, m.bucket, m.count FROM ${from} AS m
         WHERE m.scope_id = ${scope}::uuid AND ${measure}
         ORDER BY m.measure, m.bucket`,
  );
  return { rows: found, source: onGrid ? 'snapshot' : 'history' };
}

interface DayTotals {
  readonly day: string;
  readonly headcount: number;
  readonly joiners: number;
  readonly leavers: number;
}

/** Totals per snapshot day in [from, to]. Grid only: a range has no slow path. */
async function totalsByDay(
  ctx: ChartContext,
  from: string,
  to: string,
  filters: Filters | undefined,
): Promise<DayTotals[]> {
  const scope = scopeOf(ctx.viewer, ctx.tenantId);
  // From the runs, so a day whose filter matched nobody is a zero rather
  // than a gap — and a day nobody snapshotted is a gap rather than a zero.
  return rows<DayTotals>(
    ctx.tx,
    sql`SELECT r.day::text AS day,
               COALESCE(sum(s.headcount), 0)::int AS headcount,
               COALESCE(sum(s.joiners), 0)::int   AS joiners,
               COALESCE(sum(s.leavers), 0)::int   AS leavers
          FROM people.headcount_snapshot_run r
          LEFT JOIN people.headcount_snapshot s
            ON s.tenant_id = r.tenant_id AND s.day = r.day
           AND s.scope_id = ${scope}::uuid AND ${filterSql(filters)}
         WHERE r.tenant_id = ${ctx.tenantId}::uuid
           AND r.day BETWEEN ${from}::date AND ${to}::date
         GROUP BY r.day
         ORDER BY r.day`,
  );
}

export interface MonthPoint {
  /** `YYYY-MM`. */
  readonly month: string;
  /** Headcount on the month's last snapshot day. */
  readonly headcount: number;
  /** Summed over the month's runs, whose flow intervals do not overlap. */
  readonly joiners: number;
  readonly leavers: number;
}

/** Fold daily totals into months. A month with no snapshot is absent, not zero. */
export function byMonth(days: readonly DayTotals[]): MonthPoint[] {
  const months = new Map<string, MonthPoint>();
  for (const d of days) {
    const month = d.day.slice(0, 7);
    const seen = months.get(month);
    months.set(month, {
      month,
      headcount: d.headcount, // days arrive in order, so the last one wins
      joiners: (seen?.joiners ?? 0) + d.joiners,
      leavers: (seen?.leavers ?? 0) + d.leavers,
    });
  }
  return [...months.values()];
}

/** `YYYY-MM` plus n months, without a clock. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + n;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

// --------------------------------------------------------------- charts --

/** Are we growing? Headcount by month, with joiners and leavers beneath it. */
export async function headcountTrend(
  ctx: ChartContext,
  range: { readonly from: string; readonly to: string; readonly filters?: Filters },
): Promise<Result<{ readonly points: readonly MonthPoint[] }>> {
  const authorized = authorizeRange(ctx, [], range.filters);
  if (!authorized.ok) return authorized;
  return ok({ points: byMonth(await totalsByDay(ctx, range.from, range.to, range.filters)) });
}

export interface Waterfall {
  readonly opening: number;
  readonly joiners: number;
  /**
   * Net transfers in: what the closing number needs that joiners and leavers
   * do not explain. Zero tenant-wide unless a dated fact was corrected
   * between the two days.
   */
  readonly internalMoves: number;
  readonly leavers: number;
  readonly closing: number;
  readonly source: Source;
}

/**
 * Where did the change come from? Opening, joiners, moves, leavers, closing —
 * and it reconciles, because the flows are summed over runs whose intervals
 * tile (from, to] exactly.
 */
export async function movementWaterfall(
  ctx: ChartContext,
  range: { readonly from: string; readonly to: string; readonly filters?: Filters },
): Promise<Result<Waterfall>> {
  if (range.from >= range.to) {
    return err(failure('INVALID_RANGE', 'A waterfall runs from an earlier day to a later one'));
  }
  const authorized = authorizeRange(ctx, [], range.filters);
  if (!authorized.ok) return authorized;

  const where = filterSql(range.filters);
  const onGrid = (await isSnapshotDay(ctx, range.from)) && (await isSnapshotDay(ctx, range.to));

  let totals: { opening: number; closing: number; joiners: number; leavers: number };
  if (onGrid) {
    const scope = scopeOf(ctx.viewer, ctx.tenantId);
    const [row] = await rows<typeof totals>(
      ctx.tx,
      sql`SELECT COALESCE(sum(headcount) FILTER (WHERE day = ${range.from}::date), 0)::int AS opening,
                 COALESCE(sum(headcount) FILTER (WHERE day = ${range.to}::date), 0)::int   AS closing,
                 COALESCE(sum(joiners) FILTER (WHERE day > ${range.from}::date), 0)::int  AS joiners,
                 COALESCE(sum(leavers) FILTER (WHERE day > ${range.from}::date), 0)::int  AS leavers
            FROM people.headcount_snapshot
           WHERE tenant_id = ${ctx.tenantId}::uuid AND scope_id = ${scope}::uuid
             AND day BETWEEN ${range.from}::date AND ${range.to}::date
             AND ${where}`,
    );
    totals = row ?? { opening: 0, closing: 0, joiners: 0, leavers: 0 };
  } else {
    // Off the grid: the opening as of `from`, and one build of `to` whose
    // flows start at `from` — the same interval the grid path sums.
    const opening = await cubeFor(ctx, range.from);
    const closing = await cubeFor(ctx, range.to, range.from);
    const [open] = await rows<{ n: number }>(
      ctx.tx,
      sql`SELECT COALESCE(sum(headcount), 0)::int AS n FROM ${opening.from} AS c WHERE ${where}`,
    );
    const [close] = await rows<{ closing: number; joiners: number; leavers: number }>(
      ctx.tx,
      sql`SELECT COALESCE(sum(headcount), 0)::int AS closing,
                 COALESCE(sum(joiners), 0)::int   AS joiners,
                 COALESCE(sum(leavers), 0)::int   AS leavers
            FROM ${closing.from} AS c WHERE ${where}`,
    );
    totals = {
      opening: open?.n ?? 0,
      closing: close?.closing ?? 0,
      joiners: close?.joiners ?? 0,
      leavers: close?.leavers ?? 0,
    };
  }

  return ok({
    ...totals,
    internalMoves: totals.closing - totals.opening - totals.joiners + totals.leavers,
    source: onGrid ? 'snapshot' : 'history',
  });
}

export interface CompositionCell {
  /** One value per requested dimension; null is "not set". */
  readonly keys: readonly (string | null)[];
  readonly count: number;
}

/**
 * What are we made of? Headcount by one dimension, or by two for a stacked
 * bar. A special-category dimension or filter makes this a cohort-guarded
 * breakdown — see the file comment for the three rules it then follows.
 */
export async function composition(
  ctx: ChartContext,
  request: {
    readonly asOf?: string;
    readonly by: readonly [Dimension] | readonly [Dimension, Dimension];
    readonly filters?: Filters;
  },
): Promise<Result<{ readonly asOf: string; readonly source: Source } & Suppressed<CompositionCell>>> {
  const authorized = authorizeChart(ctx, request.by, request.filters);
  if (!authorized.ok) return authorized;
  const special = authorized.value.special;

  const latest = await latestSnapshotDay(ctx);
  if (special) {
    if (hasFilters(request.filters)) {
      return err(
        failure('SPECIAL_CATEGORY_UNFILTERED', 'A special-category breakdown cannot be filtered'),
      );
    }
    if (request.asOf !== undefined && request.asOf !== latest) {
      return err(
        failure(
          'SPECIAL_CATEGORY_LATEST_ONLY',
          'A special-category breakdown is reported at the latest snapshot only',
        ),
      );
    }
  }

  const asOf = request.asOf ?? latest;
  if (asOf === null) return err(failure('NO_SNAPSHOT', 'No snapshot has been taken yet'));

  const cube = await cubeFor(ctx, asOf);
  const columns = request.by.map((d) => sql.identifier(DIMENSIONS[d].column));
  const found = await rows<{ keys: (string | null)[]; count: number }>(
    ctx.tx,
    sql`SELECT ARRAY[${sql.join(columns, sql`, `)}]::text[] AS keys, sum(headcount)::int AS count
          FROM ${cube.from} AS c
         WHERE ${filterSql(request.filters)}
         GROUP BY ${sql.join(columns, sql`, `)}
        HAVING sum(headcount) > 0
         ORDER BY 2 DESC`,
  );

  const cells: Suppressed<CompositionCell> = special
    ? suppressSmallCohorts(found, cohortMinimum(ctx.cohortMinimum))
    : { status: 'ok', cells: found };
  return ok({ asOf, source: cube.source, ...cells });
}

export interface AttritionPoint {
  readonly month: string;
  readonly leavers: number;
  readonly averageHeadcount: number;
  /** Leavers ÷ average headcount over the twelve months; null with no headcount. */
  readonly rate: number | null;
  /** How many of the twelve months had a snapshot. Under 12 is a partial year. */
  readonly monthsCovered: number;
}

export const ATTRITION_FORMULA =
  'Leavers in the 12 months to the month shown ÷ the average of month-end headcount over those months';

/** Are people leaving faster? Rolling 12-month attrition, per month. */
export async function attritionTrend(
  ctx: ChartContext,
  range: { readonly from: string; readonly to: string; readonly filters?: Filters },
): Promise<Result<{ readonly formula: string; readonly points: readonly AttritionPoint[] }>> {
  const authorized = authorizeRange(ctx, [], range.filters);
  if (!authorized.ok) return authorized;

  const start = `${addMonths(range.from.slice(0, 7), -11)}-01`;
  const months = byMonth(await totalsByDay(ctx, start, range.to, range.filters));
  const firstShown = range.from.slice(0, 7);

  const points = months
    .filter((m) => m.month >= firstShown)
    .map((m) => {
      const window = months.filter((w) => w.month > addMonths(m.month, -12) && w.month <= m.month);
      const leavers = window.reduce((n, w) => n + w.leavers, 0);
      const average = window.reduce((n, w) => n + w.headcount, 0) / window.length;
      return {
        month: m.month,
        leavers,
        averageHeadcount: average,
        rate: average > 0 ? leavers / average : null,
        monthsCovered: window.length,
      };
    });

  return ok({ formula: ATTRITION_FORMULA, points });
}

export const TENURE_BANDS = ['0_6m', '6_12m', '12_18m', '18_24m', '2_5y', '5y_plus'] as const;

/**
 * Who is at risk of leaving? Headcount by tenure band on `asOf`, beside the
 * leavers of the twelve months before it in the same bands (tenure at leaving).
 */
export async function tenure(
  ctx: ChartContext,
  request: { readonly asOf: string; readonly filters?: Filters },
): Promise<
  Result<{
    readonly source: Source;
    readonly bands: readonly { band: string; headcount: number; leavers: number }[];
  }>
> {
  const authorized = authorizeRange(ctx, ['tenure_band'], request.filters);
  if (!authorized.ok) return authorized;
  const where = filterSql(request.filters);
  const scope = scopeOf(ctx.viewer, ctx.tenantId);

  let found: { band: string; headcount: number; leavers: number }[];
  let source: Source;
  if (await isSnapshotDay(ctx, request.asOf)) {
    source = 'snapshot';
    found = await rows(
      ctx.tx,
      sql`SELECT tenure_band AS band,
                 COALESCE(sum(headcount) FILTER (WHERE day = ${request.asOf}::date), 0)::int AS headcount,
                 COALESCE(sum(leavers), 0)::int AS leavers
            FROM people.headcount_snapshot
           WHERE tenant_id = ${ctx.tenantId}::uuid AND scope_id = ${scope}::uuid
             AND day > ${request.asOf}::date - interval '1 year' AND day <= ${request.asOf}::date
             AND ${where}
           GROUP BY tenure_band`,
    );
  } else {
    const cube = await cubeFor(ctx, request.asOf, yearBefore(request.asOf));
    source = cube.source;
    found = await rows(
      ctx.tx,
      sql`SELECT tenure_band AS band, sum(headcount)::int AS headcount, sum(leavers)::int AS leavers
            FROM ${cube.from} AS c WHERE ${where} GROUP BY tenure_band`,
    );
  }

  const byBand = new Map(found.map((f) => [f.band, f]));
  return ok({
    source,
    bands: TENURE_BANDS.map((band) => ({
      band,
      headcount: byBand.get(band)?.headcount ?? 0,
      leavers: byBand.get(band)?.leavers ?? 0,
    })),
  });
}

/** The same calendar day a year earlier; 29 February falls to the 28th. */
function yearBefore(day: string): string {
  const [y, m, d] = day.split('-') as [string, string, string];
  const year = String(Number(y) - 1).padStart(4, '0');
  return m === '02' && d === '29' ? `${year}-02-28` : `${year}-${m}-${d}`;
}

/** Is the org shaped sensibly? How many managers have how many direct reports. */
export async function spanOfControl(
  ctx: ChartContext,
  request: { readonly asOf: string },
): Promise<
  Result<{ readonly source: Source; readonly spans: readonly { reports: number; managers: number }[] }>
> {
  const authorized = authorizeRange(ctx, [], undefined);
  if (!authorized.ok) return authorized;
  const manager = authorizeFields(ctx.definitions, ctx.viewer, ['manager']);
  if (!manager.ok) return manager;

  const { rows: found, source } = await measureFor(ctx, request.asOf, sql`m.measure = 'span'`);
  return ok({
    source,
    spans: found
      .map((r) => ({ reports: Number(r.bucket), managers: r.count }))
      .toSorted((a, b) => a.reports - b.reports),
  });
}

/**
 * What is about to expire? Counts per kind per day over the next 90 days.
 *
 * A kind whose field the viewer cannot read is absent, not zero — the same
 * rule a profile read follows.
 */
export async function expiries(
  ctx: ChartContext,
  request: { readonly asOf: string },
): Promise<
  Result<{
    readonly source: Source;
    readonly expiries: readonly { kind: ExpiryKind; day: string; count: number }[];
  }>
> {
  const relations = relationsOf(ctx.viewer);
  const readableKinds = (Object.keys(EXPIRIES) as ExpiryKind[]).filter((kind) => {
    const definition = ctx.definitions.find((d) => d.key === EXPIRIES[kind]);
    return (
      definition !== undefined &&
      definition.classification.classification !== 'special-category' &&
      visibleTo(definition, relations)
    );
  });
  if (readableKinds.length === 0) return ok({ source: 'snapshot', expiries: [] });

  const measures = sql.join(
    readableKinds.map((k) => sql`${`expiry:${k}`}`),
    sql`, `,
  );
  const { rows: found, source } = await measureFor(ctx, request.asOf, sql`m.measure IN (${measures})`);
  return ok({
    source,
    expiries: found.map((r) => ({
      kind: r.measure.slice('expiry:'.length) as ExpiryKind,
      day: r.bucket,
      count: r.count,
    })),
  });
}

export interface CompletenessChart {
  readonly source: Source;
  readonly states: Readonly<Record<'complete' | 'incomplete' | 'not_applicable', number>>;
  /**
   * Missing values per field, with its section. HR's, tenant-wide, from a
   * snapshot day only; null otherwise rather than an empty list that would
   * read as "nothing missing".
   */
  readonly byField: readonly { key: string; sectionKey: string; missing: number }[] | null;
}

/** Is our data any good? Complete versus incomplete, and which field is dragging. */
export async function completeness(
  ctx: ChartContext,
  request: { readonly asOf: string; readonly filters?: Filters },
): Promise<Result<CompletenessChart>> {
  const authorized = authorizeRange(ctx, ['completeness'], request.filters);
  if (!authorized.ok) return authorized;

  const cube = await cubeFor(ctx, request.asOf);
  const found = await rows<{ state: string; count: number }>(
    ctx.tx,
    sql`SELECT completeness AS state, sum(headcount)::int AS count
          FROM ${cube.from} AS c WHERE ${filterSql(request.filters)} GROUP BY completeness`,
  );
  const states = { complete: 0, incomplete: 0, not_applicable: 0 };
  for (const f of found) states[f.state as keyof typeof states] = f.count;

  let byField: CompletenessChart['byField'] = null;
  if (ctx.viewer.kind === 'hr' && cube.source === 'snapshot' && !hasFilters(request.filters)) {
    const relations = relationsOf(ctx.viewer);
    const { rows: missing } = await measureFor(ctx, request.asOf, sql`m.measure = 'missing'`);
    byField = missing.flatMap((m) => {
      const definition = ctx.definitions.find((d) => d.key === m.bucket);
      if (definition === undefined || !visibleTo(definition, relations)) return [];
      return [{ key: m.bucket, sectionKey: definition.sectionKey, missing: m.count }];
    });
  }

  return ok({ source: cube.source, states, byField });
}

/** When do people join? Joiners by month against department. */
export async function joinerHeatmap(
  ctx: ChartContext,
  range: { readonly from: string; readonly to: string },
): Promise<
  Result<{ readonly cells: readonly { month: string; department: string | null; joiners: number }[] }>
> {
  const authorized = authorizeRange(ctx, ['department'], undefined);
  if (!authorized.ok) return authorized;
  const scope = scopeOf(ctx.viewer, ctx.tenantId);

  const cells = await rows<{ month: string; department: string | null; joiners: number }>(
    ctx.tx,
    sql`SELECT to_char(day, 'YYYY-MM') AS month, department, sum(joiners)::int AS joiners
          FROM people.headcount_snapshot
         WHERE tenant_id = ${ctx.tenantId}::uuid AND scope_id = ${scope}::uuid
           AND day > ${range.from}::date AND day <= ${range.to}::date
         GROUP BY 1, 2
        HAVING sum(joiners) > 0
         ORDER BY 1, 2`,
  );
  return ok({ cells });
}

/**
 * What does the workforce look like in aggregate? One self-identification
 * question, answered at the latest snapshot, tenant-wide, to HR, withheld
 * whole below the cohort minimum (§6.7).
 *
 * No `asOf` and no filters, by construction rather than by check: there is
 * nothing to pass that could narrow the cohort.
 */
export async function selfIdBreakdown(
  ctx: ChartContext,
  request: { readonly attributeKey: string },
): Promise<Result<{ readonly asOf: string | null } & Suppressed<{ bucket: string; count: number }>>> {
  const definition = ctx.definitions.find((d) => d.key === request.attributeKey);
  if (definition?.classification.classification !== 'special-category') {
    return err(
      failure('NOT_A_SELF_ID_FIELD', `${request.attributeKey} is not a self-identification field`, [
        'attributeKey',
      ]),
    );
  }
  const authorized = authorizeFields(ctx.definitions, ctx.viewer, [request.attributeKey]);
  if (!authorized.ok) return authorized;

  const minimum = cohortMinimum(ctx.cohortMinimum);
  const asOf = await latestSnapshotDay(ctx);
  if (asOf === null) return ok({ asOf, status: 'insufficient_data', minimum });

  const cells = await rows<{ bucket: string; count: number }>(
    ctx.tx,
    sql`SELECT bucket, count FROM people.headcount_snapshot_measure
         WHERE tenant_id = ${ctx.tenantId}::uuid AND scope_id = ${ctx.tenantId}::uuid
           AND day = ${asOf}::date AND measure = ${`self_id:${request.attributeKey}`}
         ORDER BY bucket`,
  );
  return ok({ asOf, ...suppressSmallCohorts(cells, minimum) });
}
