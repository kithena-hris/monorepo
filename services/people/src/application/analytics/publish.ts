import { sql } from 'drizzle-orm';
import { err, failure, ok, type Clock, type Result } from '@kithena/domain-kit';
import type { AttributeDefinition } from '@kithena/contracts';

import { cohortMinimum, suppressSmallCohorts, type Suppressed } from './access.js';
import { entityDays } from '../../domain/org/calendar.js';
import type { Calendars } from '../org/org.js';
import {
  dayOf,
  DIMENSIONS,
  rows,
  selfIdFields,
  type Days,
  type Dimension,
  type SnapshotRun,
  type TenantScope,
} from './snapshot.js';

/**
 * Published special-category breakdowns (PEO-083, §16.1 rule 2).
 *
 * The cohort minimum holds on any single reading, and still leaks across two:
 * "disclosed a disability" 14 on Monday and 15 on Tuesday, and HR knows who
 * started on Tuesday. So a special-category breakdown is never read from the
 * live snapshot. The daily job publishes one, and every read — chart, tooltip,
 * export — serves the latest publication:
 *
 * - **at most once per calendar month**, and only on the month's first run,
 *   so the day a publication appears says nothing about when a change landed;
 * - **only once N people changed** in the population since the last one —
 *   joined, left, or changed that answer — where N is the cohort minimum. Below
 *   that the previous publication keeps being served, unchanged;
 * - **rounded to the nearest 5**, cells and total each on their own, after the
 *   minimum has been checked on the true counts.
 *
 * ### What is stored, and what is not
 *
 * `people.published_breakdown` holds the true aggregate counts, the population
 * and the instant of publication — nothing per person. "Who changed since" is
 * counted from `people.person_attribute_history`, which already holds every
 * answer with the instant it was recorded: the answer in force at publication
 * is the latest one recorded before it. No second copy of anybody's answer
 * exists to make the count possible.
 */

/** Every count in a published breakdown is a multiple of this. */
export const ROUNDED_TO = 5;

export const ROUNDING_NOTE =
  'Counts are rounded to the nearest 5 and the total is rounded on its own; the counts need not add up to the total.';

/**
 * To the nearest multiple of 5, a tie going away from zero: 2.5 → 5, −2.5 → −5.
 *
 * Counts are whole numbers and so never tie; the rule is stated for the day
 * something fractional is passed, rather than left to `Math.round`, which
 * sends −2.5 to −0.
 */
export function roundToFive(n: number): number {
  return Math.sign(n) * Math.floor(Math.abs(n) / ROUNDED_TO + 0.5) * ROUNDED_TO;
}

const monthOf = (day: string): string => day.slice(0, 7);

/**
 * Whether today's run publishes a new breakdown.
 *
 * The first publication needs no threshold: there is nothing before it to
 * subtract. After that, only on the first run of a month with no publication
 * yet, and only when enough people changed. "First run of a month" rather
 * than "the 1st", so a job that missed the 1st still publishes on the 2nd.
 */
export function publicationDue(input: {
  readonly today: string;
  /** The latest snapshot run before today's, or null for the first ever. */
  readonly previousRun: string | null;
  readonly lastPublishedOn: string | null;
  readonly changes: number;
  readonly threshold: number;
}): boolean {
  if (input.lastPublishedOn === null) return true;
  if (monthOf(input.lastPublishedOn) === monthOf(input.today)) return false;
  if (input.previousRun !== null && monthOf(input.previousRun) === monthOf(input.today))
    return false;
  return input.changes >= input.threshold;
}

export interface Publication<T> {
  readonly publishedOn: string;
  readonly population: number;
  /** True counts. Rounded on the way out, never on the way in. */
  readonly cells: readonly T[];
}

/** What every read of a published breakdown adds to the result it always had. */
export interface PublishedMarks {
  /** The snapshot day the breakdown reflects; null before anything was published. */
  readonly publishedAsOf: string | null;
  readonly rounded: typeof ROUNDED_TO;
  readonly note: typeof ROUNDING_NOTE;
}

/**
 * The publication as a chart may show it: withheld whole if any true cell is
 * under the minimum in force today, else every count and the total rounded.
 */
export function servePublished<T extends { readonly count: number }>(
  publication: Publication<T> | null,
  minimum: number,
): PublishedMarks & Suppressed<T> {
  const marks = {
    publishedAsOf: publication?.publishedOn ?? null,
    rounded: ROUNDED_TO,
    note: ROUNDING_NOTE,
  } as const;
  if (publication === null) return { ...marks, status: 'insufficient_data', minimum };
  const checked = suppressSmallCohorts(publication.cells, minimum);
  if (checked.status !== 'ok') return { ...marks, ...checked };
  return {
    ...marks,
    status: 'ok',
    total: roundToFive(publication.population),
    cells: checked.cells.map((c) => ({ ...c, count: roundToFive(c.count) })),
  };
}

// ------------------------------------------------------------- storage --

/** A special-category breakdown the job publishes, and the fields it is drawn over. */
interface Breakdown {
  /** `self_id:<attribute key>` or `composition:<dimension>`. */
  readonly measure: string;
  readonly key: string;
  readonly cells: (scope: TenantScope, day: string) => Promise<{ count: number }[]>;
}

export const selfIdMeasure = (key: string): string => `self_id:${key}`;
export const compositionMeasure = (dimension: Dimension): string => `composition:${dimension}`;

function breakdowns(definitions: readonly AttributeDefinition[]): Breakdown[] {
  const selfId = selfIdFields(definitions).map((key): Breakdown => ({
    measure: selfIdMeasure(key),
    key,
    cells: ({ tx, tenantId }, day) =>
      rows(
        tx,
        sql`SELECT bucket, count FROM people.headcount_snapshot_measure
               WHERE tenant_id = ${tenantId}::uuid AND scope_id = ${tenantId}::uuid
                 AND day = ${day}::date AND measure = ${selfIdMeasure(key)}
               ORDER BY bucket`,
      ),
  }));

  // A core field a tenant tightened to special-category, one dimension at a time.
  const special = new Set(
    definitions
      .filter((d) => d.classification.classification === 'special-category')
      .map((d) => d.key as string),
  );
  const composition = (Object.keys(DIMENSIONS) as Dimension[]).flatMap((dimension): Breakdown[] => {
    const key = DIMENSIONS[dimension].key;
    if (key === null || !special.has(key)) return [];
    const column = sql.identifier(DIMENSIONS[dimension].column);
    return [
      {
        measure: compositionMeasure(dimension),
        key,
        cells: ({ tx, tenantId }, day) =>
          rows(
            tx,
            sql`SELECT ARRAY[${column}]::text[] AS keys, sum(headcount)::int AS count
                  FROM people.headcount_snapshot
                 WHERE tenant_id = ${tenantId}::uuid AND scope_id = ${tenantId}::uuid
                   AND day = ${day}::date
                 GROUP BY ${column}
                HAVING sum(headcount) > 0
                 ORDER BY 2 DESC`,
          ),
      },
    ];
  });

  return [...selfId, ...composition];
}

/** The latest publication of one breakdown, or null. */
export async function latestPublication<T>(
  { tx, tenantId }: TenantScope,
  measure: string,
): Promise<(Publication<T> & { readonly publishedAt: string }) | null> {
  const [row] = await rows<{
    published_on: string;
    published_at: string;
    population: number;
    cells: T[];
  }>(
    tx,
    sql`SELECT published_on::text, published_at::text, population, cells
          FROM people.published_breakdown
         WHERE tenant_id = ${tenantId}::uuid AND measure = ${measure}
         ORDER BY month DESC LIMIT 1`,
  );
  if (row === undefined) return null;
  return {
    publishedOn: row.published_on,
    publishedAt: row.published_at,
    population: row.population,
    cells: row.cells,
  };
}

/** In headcount on each person's day, by the dated facts the snapshot counts by. */
const present = (days: Days) =>
  sql`(p.hire_date <= ${dayOf(days)} AND (p.last_working_day IS NULL OR p.last_working_day >= ${dayOf(days)}))`;

/**
 * How many people changed, for one field, since a publication.
 *
 * In the population on one day and not the other (joined or left, by the same
 * dated facts the snapshot counts by), or in it on both with a different
 * answer. Both answers come from history: today's is the latest in force, the
 * one at publication the latest in force then *and recorded by then* — so an
 * answer backdated after publishing counts as the change it is.
 *
 * A person counts once however many of those apply, and saving the same
 * answer again is not a change.
 */
export async function changesSince(
  { tx, tenantId }: TenantScope,
  key: string,
  /** Each entity's day at the publication, and now (PRD §6.8). */
  since: { readonly days: Days; readonly at: string },
  today: Days,
): Promise<number> {
  const answer = (days: Days, recordedBy: string | null) => sql`(
    SELECT h.value FROM people.person_attribute_history h
     WHERE h.tenant_id = p.tenant_id AND h.person_id = p.id AND h.attribute_key = ${key}
       AND h.effective_from <= ${dayOf(days)}
       AND (${recordedBy}::timestamptz IS NULL OR h.recorded_at <= ${recordedBy}::timestamptz)
     ORDER BY h.effective_from DESC, h.recorded_at DESC
     LIMIT 1)`;
  const [row] = await rows<{ n: number }>(
    tx,
    sql`SELECT count(*)::int AS n FROM people.person p
         WHERE p.tenant_id = ${tenantId}::uuid
           AND p.status NOT IN ('provisional', 'discarded', 'merged')
           AND p.hire_date IS NOT NULL
           AND (${present(today)} <> ${present(since.days)}
                OR (${present(today)}
                    AND ${answer(today, null)} IS DISTINCT FROM ${answer(since.days, since.at)}))`,
  );
  return row?.n ?? 0;
}

export interface PublishRequest {
  readonly definitions: readonly AttributeDefinition[];
  /** The tenant's cohort minimum, which is also the change threshold. */
  readonly cohortMinimum?: number;
  /** The run `takeSnapshot` just took: its day, and the day each entity was counted on. */
  readonly run: Pick<SnapshotRun, 'day' | 'days'>;
}

/**
 * Publish whichever special-category breakdowns are due, from today's
 * snapshot, in the caller's transaction. Run after `takeSnapshot`.
 *
 * Safe to run twice: a month holds one publication per breakdown, the primary
 * key says so, and a second replica racing the first loses quietly.
 */
export async function publishBreakdowns(
  deps: { readonly clock: Clock; readonly calendars: Calendars },
  scope: TenantScope,
  request: PublishRequest,
): Promise<Result<{ readonly published: readonly string[] }>> {
  const { tx, tenantId } = scope;
  // The snapshot's day, never a second reading of the clock: a publication
  // is of the run it reads, and each entity was counted on its own day.
  const today = request.run.day;
  const calendar = await deps.calendars.load(tx, tenantId);
  const threshold = cohortMinimum(request.cohortMinimum);

  const [run] = await rows<{ today: boolean; previous: string | null }>(
    tx,
    sql`SELECT bool_or(day = ${today}::date) AS today,
               max(day) FILTER (WHERE day < ${today}::date)::text AS previous
          FROM people.headcount_snapshot_run WHERE tenant_id = ${tenantId}::uuid`,
  );
  if (run?.today !== true) {
    return err(failure('NO_SNAPSHOT', `No snapshot was taken on ${today} to publish from`));
  }

  const published: string[] = [];
  for (const breakdown of breakdowns(request.definitions)) {
    /* eslint-disable no-await-in-loop -- a handful of breakdowns per tenant, in one transaction */
    const last = await latestPublication(scope, breakdown.measure);
    const due = (changes: number) =>
      publicationDue({
        today,
        previousRun: run.previous,
        lastPublishedOn: last?.publishedOn ?? null,
        changes,
        threshold,
      });
    // Not a boundary even with every change it could want: nothing to count.
    if (!due(threshold)) continue;
    if (last !== null) {
      const since = { days: entityDays(calendar, last.publishedAt), at: last.publishedAt };
      if (!due(await changesSince(scope, breakdown.key, since, request.run.days))) continue;
    }

    const cells = await breakdown.cells(scope, today);
    const inserted = await rows<{ measure: string }>(
      tx,
      sql`INSERT INTO people.published_breakdown
            (tenant_id, measure, month, published_on, published_at, population, cells)
          SELECT ${tenantId}::uuid, ${breakdown.measure}, date_trunc('month', ${today}::date)::date,
                 ${today}::date, ${deps.clock.instant()}::timestamptz,
                 COALESCE(sum(headcount), 0)::int, ${JSON.stringify(cells)}::jsonb
            FROM people.headcount_snapshot
           WHERE tenant_id = ${tenantId}::uuid AND scope_id = ${tenantId}::uuid AND day = ${today}::date
          ON CONFLICT DO NOTHING
          RETURNING measure`,
    );
    /* eslint-enable no-await-in-loop */
    if (inserted.length > 0) published.push(breakdown.measure);
  }
  return ok({ published });
}
