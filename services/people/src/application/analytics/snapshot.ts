import { and, eq, gt, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok, type Clock, type Result } from '@kithena/domain-kit';
import type { AttributeDefinition } from '@kithena/contracts';

import { entityDays, entityZone, type TenantCalendar } from '../../domain/org/calendar.js';
import { assessCompleteness } from '../../domain/person/completeness.js';
import type { Calendars } from '../org/org.js';
import type { PeopleFactsReader } from '../schema/schema-repository.js';
import { snapshot, snapshotMeasure, snapshotRun } from './tables.js';

/**
 * The daily headcount snapshot (§16.4), and the slow path that computes the
 * same rows for a day nobody snapshotted.
 *
 * This file is the only analytics code that reads `people.person`. Charts read
 * what it wrote; an `asOf` off the grid asks it to compute the same shape on
 * the fly, and the result says it did. The one live read is the expiry
 * timeline's (`expiringWithin`), whose items name people: see `queries.ts`.
 *
 * ### Membership comes from dated facts
 *
 * In headcount on day D means hired on or before D and not yet past the last
 * working day. Those two dates are facts with their own effective dates, so
 * the count for a past day is right even when the status column has moved on.
 * Department, location and employment type replay history as of D and fall
 * back to the row when history holds nothing for them.
 */

/** A chart dimension, the snapshot column holding it, and the field it reads. */
export const DIMENSIONS = {
  department: { column: 'department', key: 'org_unit' },
  location: { column: 'location', key: 'work_location' },
  status: { column: 'status', key: 'status' },
  employment_type: { column: 'employment_type', key: 'employment_type' },
  tenure_band: { column: 'tenure_band', key: 'hire_date' },
  // Derived by the module, not a field anybody filled in.
  completeness: { column: 'completeness', key: null },
} as const;
export type Dimension = keyof typeof DIMENSIONS;

/** Expiries the timeline shows, and the field each reads (Appendix A). */
export const EXPIRIES = {
  work_permit: 'work_permit_expiry',
  fixed_term: 'contract_end',
  probation: 'probation_end',
  certification: 'certification_expiry',
} as const;
export type ExpiryKind = keyof typeof EXPIRIES;

/** How far ahead the expiry timeline looks (§16.2). */
export const EXPIRY_HORIZON_DAYS = 90;

/**
 * The fields a self-identification breakdown can be drawn over.
 *
 * Special-category with a closed answer set. Free text is excluded because
 * every distinct answer is a cohort of one, which the minimum would withhold
 * anyway — and storing the counts would mean storing the text.
 */
export function selfIdFields(definitions: readonly AttributeDefinition[]): readonly string[] {
  return definitions
    .filter(
      (d) =>
        d.classification.classification === 'special-category' &&
        d.deprecatedAt === null &&
        (d.dataType === 'select' || d.dataType === 'multi_select' || d.dataType === 'boolean'),
    )
    .map((d) => d.key as string);
}

/**
 * Which day each person is counted on (PRD §6.8).
 *
 * A plain date for an `asOf` somebody asked for — a date is a date. For a
 * snapshot, each legal entity's own day at the moment of the run, and the
 * tenant's for anybody without one: a tenant-wide figure is then the sum of
 * per-entity figures, each on its own day.
 */
export type Days =
  | string
  | { readonly byEntity: ReadonlyMap<string, string>; readonly fallback: string };

/** `Days` as a per-person SQL date over `p`, the person row. */
export function dayOf(days: Days): SQL {
  if (typeof days === 'string') return sql`${days}::date`;
  if (days.byEntity.size === 0) return sql`${days.fallback}::date`;
  const cases = sql.join(
    [...days.byEntity].map(([id, day]) => sql`WHEN ${id} THEN ${day}::date`),
    sql` `,
  );
  return sql`(CASE p.legal_entity_id::text ${cases} ELSE ${days.fallback}::date END)`;
}

/** Replay one attribute from history as of the person's day; `found` separates "cleared" from "never recorded". */
const replay = (key: string) => sql`
  LEFT JOIN LATERAL (
    SELECT true AS found, h.value #>> '{}' AS v
      FROM people.person_attribute_history h
     WHERE h.tenant_id = p.tenant_id AND h.person_id = p.id
       AND h.attribute_key = ${key} AND h.effective_from <= d.day
     -- A correction shares its target's effective date and was recorded
     -- later, so it wins the tie without a separate supersedes filter.
     ORDER BY h.effective_from DESC, h.recorded_at DESC
     LIMIT 1
  ) AS ${sql.identifier(`h_${key}`)} ON true`;

const replayed = (key: string, fallback: SQL) =>
  sql`CASE WHEN ${sql.identifier(`h_${key}`)}.found THEN ${sql.identifier(`h_${key}`)}.v ELSE ${fallback} END`;

/**
 * Everybody who counts on D or moved in (flowsFrom, D], once per scope.
 *
 * `chain` is every (manager, report) pair, transitively. `UNION` rather than
 * `UNION ALL` is what stops a cycle in the manager graph recursing forever: a
 * pair already seen is not produced again. The tenant scope is the tenant id,
 * and a manager's scope is their whole chain.
 */
function scopedFacts(tenantId: string, day: string, flowsFrom: SQL, days: Days = day): SQL {
  return sql`
WITH RECURSIVE chain (ancestor, person_id) AS (
  SELECT manager_id, id FROM people.person
   WHERE tenant_id = ${tenantId}::uuid AND manager_id IS NOT NULL
  UNION
  SELECT p.manager_id, c.person_id
    FROM chain c
    JOIN people.person p ON p.tenant_id = ${tenantId}::uuid AND p.id = c.ancestor
   WHERE p.manager_id IS NOT NULL
),
facts AS (
  SELECT p.id, p.manager_id, p.custom, p.completeness, p.status, d.day,
         ${replayed('org_unit', sql`p.org_unit_id::text`)} AS department,
         ${replayed('work_location', sql`p.location_id::text`)} AS location,
         ${replayed('employment_type', sql`p.employment_type`)} AS employment_type,
         p.hire_date <= d.day
           AND (p.last_working_day IS NULL OR p.last_working_day >= d.day) AS present,
         p.hire_date > d.flows_from AND p.hire_date <= d.day AS joined,
         COALESCE(p.last_working_day >= d.flows_from AND p.last_working_day < d.day, false) AS gone,
         -- Tenure on D for somebody here, and at leaving for somebody who left.
         (SELECT extract(year FROM a) * 12 + extract(month FROM a)
            FROM age(CASE WHEN p.last_working_day < d.day THEN p.last_working_day ELSE d.day END,
                     p.hire_date) AS a) AS tenure_months
    FROM people.person p
    -- The person's day, and the start of their flow interval: the run's
    -- interval, anchored on their entity's day rather than the tenant's.
    CROSS JOIN LATERAL (
      SELECT ${dayOf(days)} AS day,
             ${dayOf(days)} - (${day}::date - ${flowsFrom}) AS flows_from
    ) AS d
    ${replay('org_unit')}
    ${replay('work_location')}
    ${replay('employment_type')}
   WHERE p.tenant_id = ${tenantId}::uuid
     AND p.status NOT IN ('provisional', 'discarded')
     AND p.hire_date IS NOT NULL
),
scoped AS (
  SELECT ${tenantId}::uuid AS scope_id, f.* FROM facts f
  UNION ALL
  SELECT c.ancestor, f.* FROM facts f JOIN chain c ON c.person_id = f.id
)`;
}

/**
 * The cube for D, with flows over (flowsFrom, D]. Columns match
 * `people.headcount_snapshot` from `scope_id` on.
 *
 * `flowsFrom` null means the day before D.
 */
export function cubeAt(
  tenantId: string,
  day: string,
  flowsFrom: string | null,
  days: Days = day,
): SQL {
  const from = sql`COALESCE(${flowsFrom}::date, ${day}::date - 1)`;
  return sql`${scopedFacts(tenantId, day, from, days)}
SELECT scope_id, department, location,
       CASE WHEN NOT present THEN 'terminated'
            WHEN status IN ('active', 'on_leave', 'notice') THEN status
            -- Present by its dates while the row says pre-hire or terminated:
            -- a day in the past, or a transition the scheduler has not run.
            ELSE 'active' END AS status,
       employment_type,
       CASE WHEN tenure_months < 6  THEN '0_6m'
            WHEN tenure_months < 12 THEN '6_12m'
            WHEN tenure_months < 18 THEN '12_18m'
            WHEN tenure_months < 24 THEN '18_24m'
            WHEN tenure_months < 60 THEN '2_5y'
            ELSE '5y_plus' END AS tenure_band,
       completeness,
       (count(*) FILTER (WHERE present))::int AS headcount,
       (count(*) FILTER (WHERE joined))::int  AS joiners,
       (count(*) FILTER (WHERE gone))::int    AS leavers
  FROM scoped
 WHERE present OR joined OR gone
 GROUP BY 1, 2, 3, 4, 5, 6, 7`;
}

/**
 * Span of control, upcoming expiries and — when keys are given, tenant scope
 * only — self-identification answers, for D. Columns match
 * `people.headcount_snapshot_measure` from `scope_id` on.
 */
export function measuresAt(
  tenantId: string,
  day: string,
  selfIdKeys: readonly string[],
  days: Days = day,
): SQL {
  const span = sql`
SELECT scope_id, 'span' AS measure, reports::text AS bucket, count(*)::int AS count
  FROM (SELECT scope_id, manager_id, count(*) AS reports
          FROM scoped WHERE present AND manager_id IS NOT NULL
         GROUP BY scope_id, manager_id) AS m
 GROUP BY scope_id, reports`;

  const expiries = sql`
SELECT f.scope_id, 'expiry:' || e.kind AS measure, e.on_day AS bucket, count(*)::int AS count
  FROM scoped f
 CROSS JOIN LATERAL (
         SELECT 'work_permit' AS kind, f.custom ->> ${EXPIRIES.work_permit} AS on_day
   UNION ALL SELECT 'fixed_term', f.custom ->> ${EXPIRIES.fixed_term}
   UNION ALL SELECT 'probation',  f.custom ->> ${EXPIRIES.probation}
   -- Certifications live in a repeating group, whichever one the tenant made.
   UNION ALL SELECT 'certification', x #>> '{}'
               FROM jsonb_path_query(f.custom, 'lax $.*[*].certification_expiry') AS x
       ) AS e
 WHERE f.present
   AND e.on_day ~ '^\\d{4}-\\d{2}-\\d{2}$'
   AND e.on_day::date > f.day
   AND e.on_day::date <= f.day + ${EXPIRY_HORIZON_DAYS}::int
 GROUP BY 1, 2, 3`;

  const parts = [span, expiries];

  if (selfIdKeys.length > 0) {
    const keys = sql.join(
      selfIdKeys.map((k) => sql`${k}`),
      sql`, `,
    );
    /*
     * One row per answer, `(unanswered)` for nobody-said. "Prefer not to say"
     * is a stored answer and lands in its own bucket; an option value is a
     * key and cannot contain a parenthesis, so the two never collide.
     */
    parts.push(sql`
SELECT f.scope_id, 'self_id:' || k.key AS measure, COALESCE(a.answer, '(unanswered)') AS bucket,
       count(*)::int AS count
  FROM scoped f
 CROSS JOIN unnest(ARRAY[${keys}]::text[]) AS k(key)
  LEFT JOIN LATERAL jsonb_array_elements_text(
         CASE jsonb_typeof(f.custom -> k.key)
           WHEN 'array'   THEN f.custom -> k.key
           WHEN 'string'  THEN jsonb_build_array(f.custom -> k.key)
           WHEN 'boolean' THEN jsonb_build_array(f.custom -> k.key)
           ELSE '[]'::jsonb END) AS a(answer) ON true
 WHERE f.present AND f.scope_id = ${tenantId}::uuid
 GROUP BY 1, 2, 3`);
  }

  return sql`${scopedFacts(tenantId, day, sql`${day}::date - 1`, days)}
${sql.join(parts, sql`\nUNION ALL\n`)}`;
}

/**
 * Who holds a dated value in (their day, their day + horizon], live, for the
 * expiry timeline (PEO-122): one row per person and kind, with the name
 * columns, not yet authorized. `root` narrows to one manager's chain.
 *
 * Present people only, counted as the snapshot counts them, each on their
 * legal entity's day (`dayOf`). The same predicate as `measuresAt`'s
 * expiries, so the tile and a snapshot of the same instant agree.
 */
export function expiringWithin(
  tenantId: string,
  days: Days,
  horizon: number,
  kinds: readonly ExpiryKind[],
  root: string | null,
): SQL {
  const inChain =
    root === null
      ? sql`true`
      : sql`p.id IN (SELECT id FROM chain) AND p.id <> ${root}::uuid`;
  return sql`
WITH RECURSIVE chain (id) AS (
  SELECT id FROM people.person WHERE tenant_id = ${tenantId}::uuid AND manager_id = ${root}::uuid
  UNION
  SELECT p.id FROM people.person p JOIN chain c ON p.manager_id = c.id
   WHERE p.tenant_id = ${tenantId}::uuid
)
SELECT DISTINCT p.id::text AS person_id, e.kind, e.on_day AS day,
       p.given_name, p.family_name, p.preferred_name
  FROM people.person p
 CROSS JOIN LATERAL (SELECT ${dayOf(days)} AS day) AS d
 CROSS JOIN LATERAL (
         SELECT 'work_permit' AS kind, p.custom ->> ${EXPIRIES.work_permit} AS on_day
   UNION ALL SELECT 'fixed_term', p.custom ->> ${EXPIRIES.fixed_term}
   UNION ALL SELECT 'probation',  p.custom ->> ${EXPIRIES.probation}
   UNION ALL SELECT 'certification', x #>> '{}'
               FROM jsonb_path_query(p.custom, 'lax $.*[*].certification_expiry') AS x
       ) AS e
 WHERE p.tenant_id = ${tenantId}::uuid
   AND p.status NOT IN ('provisional', 'discarded')
   AND p.hire_date <= d.day
   AND (p.last_working_day IS NULL OR p.last_working_day >= d.day)
   AND ${inChain}
   AND e.kind IN (${sql.join(
     kinds.map((k) => sql`${k}`),
     sql`, `,
   )})
   AND e.on_day ~ '^\\d{4}-\\d{2}-\\d{2}$'
   AND e.on_day::date > d.day
   AND e.on_day::date <= d.day + ${horizon}::int
 ORDER BY day, person_id, kind`;
}

export interface SnapshotDeps {
  /** Streams every person's facts, for the missing-field counts. */
  readonly facts: PeopleFactsReader;
  readonly clock: Clock;
  /** Each legal entity's calendar (PRD §6.8). */
  readonly calendars: Calendars;
}

export interface SnapshotRequest {
  /** The published definitions, for self-identification fields and requiredness. */
  readonly definitions: readonly AttributeDefinition[];
}

/** What a run counted on: its label, and each entity's own day at the run's instant. */
export interface SnapshotRun {
  /** The run's `day`: the tenant default's date at the run's instant. */
  readonly day: string;
  readonly flowsFrom: string;
  readonly days: Exclude<Days, string>;
}

/**
 * Take today's snapshot for one tenant, in the caller's transaction.
 *
 * Idempotent: a second run on the same day deletes the first and writes
 * again, and its flows start from the same previous run, so a retry neither
 * double-counts nor drops anybody. A run for a day before the latest one is
 * refused — slotting it in would split the next run's flow interval in two
 * and count those movements twice.
 */
export async function takeSnapshot(
  deps: SnapshotDeps,
  { tx, tenantId }: TenantScope,
  request: SnapshotRequest,
): Promise<Result<SnapshotRun>> {
  /*
   * One instant, read on every entity's calendar. The run is filed under the
   * tenant's day; each person is counted on their legal entity's day at the
   * same instant, so a tenant with entities in Madrid and Bangalore counts
   * each on its own day and the tenant figure is their sum (PRD §6.8, §16).
   * Runs are daily at about the same hour, so each entity's flow interval
   * stays contiguous: it is the run's interval, anchored on its own day.
   */
  const calendar = await deps.calendars.load(tx, tenantId);
  const at = deps.clock.instant();
  const days = entityDays(calendar, at);
  const day = days.fallback as string;

  const later = await tx
    .select({ day: snapshotRun.day })
    .from(snapshotRun)
    .where(and(eq(snapshotRun.tenantId, tenantId), gt(snapshotRun.day, day)))
    .limit(1);
  if (later.length > 0) {
    return err(
      failure('SNAPSHOT_OUT_OF_ORDER', `A snapshot for ${String(later[0]?.day)} already exists`, [
        'day',
      ]),
    );
  }

  await tx
    .delete(snapshotMeasure)
    .where(and(eq(snapshotMeasure.tenantId, tenantId), eq(snapshotMeasure.day, day)));
  await tx.delete(snapshot).where(and(eq(snapshot.tenantId, tenantId), eq(snapshot.day, day)));
  await tx
    .delete(snapshotRun)
    .where(and(eq(snapshotRun.tenantId, tenantId), eq(snapshotRun.day, day)));

  const [run] = await rows<{ flows_from: string }>(
    tx,
    sql`
INSERT INTO people.headcount_snapshot_run (tenant_id, day, flows_from)
SELECT ${tenantId}::uuid, ${day}::date,
       COALESCE(max(day), ${day}::date - 1)
  FROM people.headcount_snapshot_run
 WHERE tenant_id = ${tenantId}::uuid AND day < ${day}::date
RETURNING flows_from::text`,
  );
  const flowsFrom = run?.flows_from ?? day;

  await tx.execute(sql`
INSERT INTO people.headcount_snapshot
  (tenant_id, day, scope_id, department, location, status, employment_type, tenure_band,
   completeness, headcount, joiners, leavers)
SELECT ${tenantId}::uuid, ${day}::date, c.* FROM (${cubeAt(tenantId, day, flowsFrom, days)}) AS c`);

  await tx.execute(sql`
INSERT INTO people.headcount_snapshot_measure (tenant_id, day, scope_id, measure, bucket, count)
SELECT ${tenantId}::uuid, ${day}::date, m.*
  FROM (${measuresAt(tenantId, day, selfIdFields(request.definitions), days)}) AS m`);

  await writeMissing(deps, { tx, tenantId }, day, request.definitions, calendar);

  return ok({ day, flowsFrom, days });
}

/**
 * Which required fields are empty, counted across the tenant.
 *
 * Requiredness is a predicate grammar the domain evaluates, so this is the
 * one measure computed in TypeScript rather than SQL — by the same
 * `assessCompleteness` the record's own verdict comes from, so the chart and
 * the profile cannot disagree. Tenant scope only: this is HR's chart.
 */
async function writeMissing(
  deps: SnapshotDeps,
  { tx, tenantId }: TenantScope,
  day: string,
  definitions: readonly AttributeDefinition[],
  calendar: TenantCalendar,
): Promise<void> {
  const counts = new Map<string, number>();
  for await (const { facts } of deps.facts.forImpact(tx, tenantId)) {
    if (!['active', 'on_leave', 'notice'].includes(facts.status)) continue;
    // An aggregate, so the entity's day, like every other count in the run.
    const zone = entityZone(calendar, facts.legalEntityId);
    for (const gap of assessCompleteness(definitions, facts, deps.clock, zone).missing) {
      counts.set(gap.key, (counts.get(gap.key) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return;

  await tx.insert(snapshotMeasure).values(
    [...counts].map(([bucket, count]) => ({
      tenantId,
      day,
      scopeId: tenantId,
      measure: 'missing',
      bucket,
      count,
    })),
  );
}

/** One tenant's transaction, as `tenantTransaction` hands it out. */
export interface TenantScope {
  readonly tx: PostgresJsDatabase;
  readonly tenantId: string;
}

/** Raw rows, typed at the one place a query's shape is known. */
export async function rows<T>(tx: PostgresJsDatabase, query: SQL): Promise<T[]> {
  return [...(await tx.execute(query))] as T[];
}
