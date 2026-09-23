import { and, eq, gt, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok, type Clock, type Result } from '@kithena/domain-kit';
import type { AttributeDefinition } from '@kithena/contracts';

import { assessCompleteness } from '../../domain/person/completeness.js';
import type { PeopleFactsReader } from '../schema/schema-repository.js';
import { snapshot, snapshotMeasure, snapshotRun } from './tables.js';

/**
 * The daily headcount snapshot (§16.4), and the slow path that computes the
 * same rows for a day nobody snapshotted.
 *
 * This file is the only analytics code that reads `people.person`. Charts read
 * what it wrote; an `asOf` off the grid asks it to compute the same shape on
 * the fly, and the result says it did.
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

/** Replay one attribute from history as of D; `found` separates "cleared" from "never recorded". */
const replay = (key: string, day: string) => sql`
  LEFT JOIN LATERAL (
    SELECT true AS found, h.value #>> '{}' AS v
      FROM people.person_attribute_history h
     WHERE h.tenant_id = p.tenant_id AND h.person_id = p.id
       AND h.attribute_key = ${key} AND h.effective_from <= ${day}::date
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
function scopedFacts(tenantId: string, day: string, flowsFrom: SQL): SQL {
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
  SELECT p.id, p.manager_id, p.custom, p.completeness, p.status,
         ${replayed('org_unit', sql`p.org_unit_id::text`)} AS department,
         ${replayed('work_location', sql`p.location_id::text`)} AS location,
         ${replayed('employment_type', sql`p.employment_type`)} AS employment_type,
         p.hire_date <= ${day}::date
           AND (p.last_working_day IS NULL OR p.last_working_day >= ${day}::date) AS present,
         p.hire_date > ${flowsFrom} AND p.hire_date <= ${day}::date AS joined,
         COALESCE(p.last_working_day >= ${flowsFrom} AND p.last_working_day < ${day}::date, false) AS gone,
         -- Tenure on D for somebody here, and at leaving for somebody who left.
         (SELECT extract(year FROM a) * 12 + extract(month FROM a)
            FROM age(CASE WHEN p.last_working_day < ${day}::date THEN p.last_working_day ELSE ${day}::date END,
                     p.hire_date) AS a) AS tenure_months
    FROM people.person p
    ${replay('org_unit', day)}
    ${replay('work_location', day)}
    ${replay('employment_type', day)}
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
export function cubeAt(tenantId: string, day: string, flowsFrom: string | null): SQL {
  const from = sql`COALESCE(${flowsFrom}::date, ${day}::date - 1)`;
  return sql`${scopedFacts(tenantId, day, from)}
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
export function measuresAt(tenantId: string, day: string, selfIdKeys: readonly string[]): SQL {
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
   AND e.on_day::date > ${day}::date
   AND e.on_day::date <= ${day}::date + ${EXPIRY_HORIZON_DAYS}::int
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

  return sql`${scopedFacts(tenantId, day, sql`${day}::date - 1`)}
${sql.join(parts, sql`\nUNION ALL\n`)}`;
}

export interface SnapshotDeps {
  /** Streams every person's facts, for the missing-field counts. */
  readonly facts: PeopleFactsReader;
  readonly clock: Clock;
}

export interface SnapshotRequest {
  /** The published definitions, for self-identification fields and requiredness. */
  readonly definitions: readonly AttributeDefinition[];
  /** The tenant's calendar: "today" is the tenant's today. */
  readonly timeZone?: string;
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
): Promise<Result<{ readonly day: string; readonly flowsFrom: string }>> {
  const timeZone = request.timeZone ?? 'Etc/UTC';
  const day = deps.clock.date(timeZone) as string;

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
SELECT ${tenantId}::uuid, ${day}::date, c.* FROM (${cubeAt(tenantId, day, flowsFrom)}) AS c`);

  await tx.execute(sql`
INSERT INTO people.headcount_snapshot_measure (tenant_id, day, scope_id, measure, bucket, count)
SELECT ${tenantId}::uuid, ${day}::date, m.*
  FROM (${measuresAt(tenantId, day, selfIdFields(request.definitions))}) AS m`);

  await writeMissing(deps, { tx, tenantId }, day, request.definitions, timeZone);

  return ok({ day, flowsFrom });
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
  timeZone: string,
): Promise<void> {
  const counts = new Map<string, number>();
  for await (const { facts } of deps.facts.forImpact(tx, tenantId)) {
    if (!['active', 'on_leave', 'notice'].includes(facts.status)) continue;
    for (const gap of assessCompleteness(definitions, facts, deps.clock, timeZone).missing) {
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
