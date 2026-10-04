import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { CORE_COLUMNS } from '../application/person/core.js';
import {
  LEAVERS,
  type GapsIn,
  type PersonReader,
  type PersonRecord,
  type PersonSearch,
  type Refine,
  type RelationsResolver,
  type ScheduledRefusals,
  type SchemaVersions,
} from '../application/person/ports.js';
import type { Arrivals, Leavers, Scheduled } from '../application/person/start.js';
import type { GapFigures, GapTotals } from '../application/screens/record.js';
import { EXPIRY_KEYS } from '../domain/person/metrics.js';
import { reminderDueBefore } from '../domain/person/reminder-cadence.js';
import type { PersonState } from '../domain/person/person.js';
import {
  deepFreeze,
  type PublishedVersion,
  type SchemaDocument,
} from '../domain/schema/publish.js';
import { toEmployment, withEmployment } from './drizzle-person-repository.js';
import { person, schemaVersion } from './tables.js';

/**
 * The read side of a person, the version they were written under, and who is
 * asking — as Drizzle.
 *
 * Every query names the tenant as well as relying on RLS. The policy is what
 * is true; the predicate is what lets the planner use the index.
 */

type Row = typeof person.$inferSelect;

/** The columns a person's attribute values come from. */
export type ValueColumns = Pick<
  Row,
  (typeof CORE_COLUMNS)[keyof typeof CORE_COLUMNS] | 'hireDate' | 'lastWorkingDay' | 'custom'
>;

/**
 * A row's values by registry key: `custom`, plus the core columns and the
 * lifecycle dates, which hold theirs outside it. Every reader that asks "is
 * this field filled in" goes through here, or a core field reads as missing.
 */
export function valuesOf(row: ValueColumns): Record<string, unknown> {
  const values: Record<string, unknown> = { ...((row.custom ?? {}) as Record<string, unknown>) };

  for (const [key, column] of Object.entries(CORE_COLUMNS)) {
    const value = row[column];
    if (value !== null) values[key] = value;
  }
  if (row.hireDate !== null) values['hire_date'] = row.hireDate;
  if (row.lastWorkingDay !== null) values['last_working_day'] = row.lastWorkingDay;
  return values;
}

function toRecord(row: Row & { employment: Record<string, unknown> | null }): PersonRecord {
  const custom = (row.custom ?? {}) as Record<string, unknown>;
  const values = valuesOf(row);

  return {
    snapshot: {
      id: row.id,
      tenantId: row.tenantId,
      status: row.status as PersonState,
      identityAccountId: row.identityAccountId,
      hireDate: row.hireDate,
      lastWorkingDay: row.lastWorkingDay,
      accessEndedAt: row.accessEndedAt?.toISOString() ?? null,
      employment: toEmployment(row.employment),
      mergedInto: row.mergedInto,
    },
    values,
    custom,
    schemaVersion: row.schemaVersion,
    legalEntityId: row.legalEntityId,
    employmentType: row.employmentType,
    workModel: row.workModel,
    sourceOfRecord: row.sourceOfRecord === 'external' ? 'external' : 'own',
  };
}

const SEARCH_COLUMNS = {
  given_name: person.givenName,
  family_name: person.familyName,
  preferred_name: person.preferredName,
  work_email: person.workEmail,
} as const;

/** `%`, `_` and `\` typed into a search are the characters, not wildcards. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * The directory's predicate: the tenant, `where` by containment, `search` by
 * substring.
 *
 * Containment is what `person_tenant_directory_idx` (GIN) answers, one
 * `@>` for every key at once, though under RLS only through
 * `people.person_custom_candidates`, for the reason below. The search is
 * `ILIKE` over at most four short text columns and the two full names. Under
 * RLS that predicate cannot use an index, so the trigram index narrows it
 * first, through
 * `people.person_search_candidates` (20260924370000_people_directory_search.sql
 * has why that is safe). The candidates only narrow: the predicate below is
 * still what decides a match. Under three characters there is no trigram to
 * look up, so a short search is the scan it always was.
 */
function matching(
  tenantId: string,
  where: Readonly<Record<string, string>> | undefined,
  search: PersonSearch | undefined,
  gaps?: readonly string[],
  leavers = true,
  gapsIn: GapsIn = 'staff',
): SQL | undefined {
  const text = search?.text.trim() ?? '';
  const keys = new Set(search?.keys ?? []);
  const pattern = likePattern(text);
  const matches: SQL[] = [...keys].map((k) => sql`${SEARCH_COLUMNS[k]} ILIKE ${pattern}`);
  // "Ada Lovelace" finds Ada Lovelace: each full name the viewer may read.
  for (const given of ['given_name', 'preferred_name'] as const) {
    if (keys.has(given) && keys.has('family_name')) {
      matches.push(
        sql`concat_ws(' ', ${SEARCH_COLUMNS[given]}, ${person.familyName}) ILIKE ${pattern}`,
      );
    }
  }
  // `manager_id` is a typed column (`filterable` lets it through); the rest
  // of `where` is `custom`.
  const { manager_id: reportsTo, ...custom } = where ?? {};
  const filter = Object.keys(custom).length === 0 ? undefined : JSON.stringify(custom);
  return and(
    eq(person.tenantId, tenantId),
    reportsTo === undefined ? undefined : eq(person.managerId, reportsTo),
    leavers ? undefined : notInArray(person.status, [...LEAVERS]),
    filter === undefined ? undefined : sql`${person.custom} @> ${filter}::jsonb`,
    // The same narrowing for the filter, through `person_tenant_directory_idx`
    // (20260926120000_people_custom_filter.sql); the `@>` above still decides.
    filter === undefined
      ? undefined
      : sql`${person.id} = ANY((SELECT people.person_custom_candidates(${filter}::jsonb))::uuid[])`,
    text === '' ? undefined : matches.length === 0 ? sql`false` : or(...matches),
    // A scalar subquery, so it runs once per statement and never at plan time;
    // the cast keeps `ANY` from reading it as `= ANY (subquery)`.
    text.length < 3 || matches.length === 0
      ? undefined
      : sql`${person.id} = ANY((SELECT people.person_search_candidates(${pattern}))::uuid[])`,
    // The gap row's key is the person's, so this is one index probe per row.
    gaps === undefined
      ? undefined
      : gaps.length === 0
        ? sql`false`
        : sql`EXISTS (SELECT 1 FROM people.completeness_gap g
                   WHERE g.tenant_id = person.tenant_id AND g.person_id = person.id
                     AND ${gapsIn === 'any' ? sql`(g.staff_keys || g.employee_keys)` : sql`g.staff_keys`}
                         && ARRAY[${sql.join(
                           gaps.map((k) => sql`${k}`),
                           sql`, `,
                         )}]::text[])`,
  );
}

/**
 * The grid's totals, off `people.completeness_gap` alone: one pass over one
 * narrow row per person, so its cost is the tenant's size and not a
 * completeness verdict per person.
 */
/**
 * A field as SQL: its typed column when it has one, the start date, the
 * status, or its value in `custom` as text. Dates are ISO strings, so text
 * order is date order.
 */
function fieldSql(key: string): SQL {
  const metric = metricSql(key);
  if (metric !== null) return sql`(${metric})::text`;
  if (key === 'status') return sql`${person.status}::text`;
  if (key === 'hire_date') return sql`${person.hireDate}::text`;
  if (Object.hasOwn(CORE_COLUMNS, key)) {
    const column = person[CORE_COLUMNS[key as keyof typeof CORE_COLUMNS]];
    return sql`${column}::text`;
  }
  return sql`(${person.custom} ->> ${key})`;
}

const stillHere = sql.raw(`(${LEAVERS.map((l) => `'${l}'`).join(', ')})`);

/** Missing values, as the gap row holds the verdict: one probe by the person's key. */
const missingSql = sql`coalesce((
  SELECT cardinality(ARRAY(SELECT DISTINCT unnest(g.staff_keys || g.employee_keys)))
    FROM people.completeness_gap g
   WHERE g.tenant_id = ${person.tenantId} AND g.person_id = ${person.id}), 0)`;

/**
 * A metric (`domain/person/metrics.ts`) as SQL over the row being read; null
 * for a key that is not one. The caller authorized it (`refinable`).
 *
 * ponytail: `team_size` walks each row's reporting line, so a sorted page of
 * a large tenant costs a walk per person; keep a closure table if it is felt.
 */
function metricSql(key: string): SQL | null {
  switch (key) {
    case 'missing_count':
      return missingSql;
    case 'completeness':
      return sql`(0 - ${missingSql})`;
    case 'tenure_days':
      return sql`(current_date - ${person.hireDate})`;
    case 'direct_reports':
      return sql`(SELECT count(*)::int FROM people.person r
                   WHERE r.tenant_id = ${person.tenantId} AND r.manager_id = ${person.id}
                     AND r.status NOT IN ${stillHere})`;
    case 'team_size':
      return sql`(WITH RECURSIVE below(id) AS (
                    SELECT r.id FROM people.person r
                     WHERE r.tenant_id = ${person.tenantId} AND r.manager_id = ${person.id}
                       AND r.status NOT IN ${stillHere}
                    UNION
                    SELECT r.id FROM people.person r JOIN below b ON r.manager_id = b.id
                     WHERE r.tenant_id = ${person.tenantId} AND r.status NOT IN ${stillHere}
                  ) SELECT count(*)::int FROM below)`;
    case 'pending_changes':
      return sql`(SELECT count(*)::int FROM people.pending_change c
                   WHERE c.tenant_id = ${person.tenantId} AND c.person_id = ${person.id}
                     AND c.state = 'pending')`;
    case 'next_expiry':
      // The soonest of the dated fields still to come; dates are ISO text.
      return sql`LEAST(${sql.join(
        EXPIRY_KEYS.map(
          (k) =>
            sql`CASE WHEN (${person.custom} ->> ${k}) >= current_date::text THEN (${person.custom} ->> ${k}) END`,
        ),
        sql`, `,
      )})`;
    case 'updated_at':
      return sql`${person.updatedAt}`;
    default:
      return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The directory's conditions as one predicate, all or any of them. Values
 * are parameters, never SQL; the keys were authorized by the caller
 * (`refinable`) and only ever name a column or a JSON key.
 */
function refined(tenantId: string, refine: Refine | undefined): SQL | undefined {
  const ids = refine?.personIds;
  const within =
    ids === undefined ? undefined : ids.length === 0 ? sql`false` : inArray(person.id, [...ids]);
  return and(within, conditioned(tenantId, refine));
}

function conditioned(tenantId: string, refine: Refine | undefined): SQL | undefined {
  const conditions = refine?.conditions ?? [];
  if (conditions.length === 0) return undefined;
  const parts = conditions.map((c): SQL => {
    const [first = '', second = ''] = c.values;
    // A range over numbers compares numbers ("9" < "10"); a value that is not
    // one reads as NULL rather than failing the statement. Dates stay text.
    const numeric =
      ['before', 'after', 'between'].includes(c.op) &&
      c.values.length > 0 &&
      c.values.every((v) => /^-?\d+(\.\d+)?$/.test(v));
    const text = fieldSql(c.key);
    const field = numeric
      ? sql`(CASE WHEN ${text} ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (${text})::numeric END)`
      : text;
    const bound = (v: string): SQL => (numeric ? sql`${v}::numeric` : sql`${v}`);
    switch (c.op) {
      case 'is':
        return sql`${field} = ${first}`;
      case 'in':
        return c.values.length === 0
          ? sql`false`
          : sql`${field} IN (${sql.join(
              c.values.map((v) => sql`${v}`),
              sql`, `,
            )})`;
      case 'not_in':
        // "Not in Sales" holds for somebody with no department too.
        return c.values.length === 0
          ? sql`true`
          : sql`(${field} IS NULL OR ${field} NOT IN (${sql.join(
              c.values.map((v) => sql`${v}`),
              sql`, `,
            )}))`;
      case 'contains':
        return sql`${text} ILIKE ${likePattern(first)}`;
      case 'before':
        return sql`${field} <= ${bound(first)}`;
      case 'after':
        return sql`${field} >= ${bound(first)}`;
      case 'between':
        return sql`${field} BETWEEN ${bound(first)} AND ${bound(second)}`;
      case 'empty':
        return sql`(${field} IS NULL OR ${field} = '')`;
      case 'not_empty':
        return sql`(${field} IS NOT NULL AND ${field} <> '')`;
      case 'under':
        // Everybody below a manager, however deep. UNION, not UNION ALL, so a
        // cycle in bad data ends rather than looping.
        return UUID.test(first)
          ? sql`${person.id} IN (
              WITH RECURSIVE below(id) AS (
                SELECT id FROM people.person
                 WHERE tenant_id = ${tenantId}::uuid AND manager_id = ${first}::uuid
                UNION
                SELECT p.id FROM people.person p JOIN below b ON p.manager_id = b.id
                 WHERE p.tenant_id = ${tenantId}::uuid
              ) SELECT id FROM below)`
          : sql`false`;
    }
  });
  return refine?.match === 'any' ? or(...parts) : and(...parts);
}

/** The order a sorted directory asks for, always ending in the id so pages are stable. */
/** One key of a sorted directory's order: descending or not, and whether it may be null (last). */
interface SortKey {
  readonly expr: SQL;
  readonly desc: boolean;
  readonly nullable: boolean;
}

function orderOf(refine: Refine | undefined): readonly SortKey[] | undefined {
  const sort = refine?.sort;
  if (sort === undefined) return undefined;
  const desc = sort.direction === 'desc';
  const id = { expr: sql`${person.id}`, desc: false, nullable: false };
  if (sort.key === 'name') {
    return [
      {
        expr: sql`lower(coalesce(${person.preferredName}, ${person.givenName}, ''))`,
        desc,
        nullable: false,
      },
      { expr: sql`lower(coalesce(${person.familyName}, ''))`, desc, nullable: false },
      id,
    ];
  }
  // A person with no value sorts last whichever way the list runs.
  const metric = metricSql(sort.key);
  if (metric !== null) return [{ expr: metric, desc, nullable: true }, id];
  // A number orders as a number ("9" before "10"), anything else as text.
  const text = fieldSql(sort.key);
  return [
    {
      expr: sql`(CASE WHEN ${text} ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (${text})::numeric END)`,
      desc,
      nullable: true,
    },
    { expr: text, desc, nullable: true },
    id,
  ];
}

const orderBy = (keys: readonly SortKey[]): SQL[] =>
  keys.map(
    (k) => sql`${k.expr} ${k.desc ? sql`DESC` : sql`ASC`}${k.nullable ? sql` NULLS LAST` : sql``}`,
  );

/**
 * The rows after a person in a sorted order (a keyset, never an offset): the
 * cursor person's own values, read beside, and the first key that differs
 * decides. A key with no value sorts last, so after a valued one comes a
 * smaller (or larger) value or none; after none, only what ties on it.
 */
function seek(keys: readonly SortKey[], tenantId: string, after: string): SQL {
  const at = (k: SortKey) =>
    sql`(SELECT ${k.expr} FROM people.person WHERE tenant_id = ${tenantId}::uuid AND id = ${after}::uuid)`;
  const beyond = (k: SortKey): SQL => {
    const strictly = k.desc ? sql`${k.expr} < ${at(k)}` : sql`${k.expr} > ${at(k)}`;
    return k.nullable
      ? sql`(${at(k)} IS NOT NULL AND (${k.expr} IS NULL OR ${strictly}))`
      : strictly;
  };
  const branches = keys.map((k, i) =>
    sql.join(
      [...keys.slice(0, i).map((j) => sql`${j.expr} IS NOT DISTINCT FROM ${at(j)}`), beyond(k)],
      sql` AND `,
    ),
  );
  return sql`(${sql.join(
    branches.map((b) => sql`(${b})`),
    sql` OR `,
  )})`;
}

export function drizzleGapTotals() {
  return async (tx: PostgresJsDatabase, tenantId: string): Promise<GapTotals> => {
    const [waiting] = await tx.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM people.completeness_gap
       WHERE tenant_id = ${tenantId}::uuid AND cardinality(employee_keys) > 0`);
    const staff = await tx.execute<{ key: string; people: number }>(sql`
      SELECT key, count(*)::int AS people
        FROM people.completeness_gap g, unnest(g.staff_keys) AS key
       WHERE g.tenant_id = ${tenantId}::uuid
       GROUP BY key ORDER BY key`);
    return { waiting: waiting?.n ?? 0, staff: [...staff] };
  };
}

/**
 * The completeness screen's figures beside the totals (V4), off
 * `people.completeness_gap`: one pass for the tenant's three counts, and one
 * probe per listed person for their last reminder.
 *
 * `due` is `dueReminders`' condition, counted: an employee-owned gap, a work
 * email, and no reminder in the last week. The working-hours window is each
 * person's own clock, so it is the sweep's to apply, not a count's.
 */
export function drizzleGapFigures() {
  return async (
    tx: PostgresJsDatabase,
    tenantId: string,
    ask: {
      readonly payroll: readonly string[];
      readonly now: Date;
      readonly people: readonly string[];
    },
  ): Promise<GapFigures> => {
    const payroll = sql`ARRAY[${sql.join(
      ask.payroll.map((k) => sql`${k}`),
      sql`, `,
    )}]::text[]`;
    const [totals] = await tx.execute<{
      blocking: number;
      last_reminded: Date | string | null;
      due: number;
    }>(sql`
      SELECT count(*) FILTER (WHERE (g.staff_keys || g.employee_keys) && ${payroll})::int AS blocking,
             max(g.reminded_at) FILTER (WHERE cardinality(g.employee_keys) > 0) AS last_reminded,
             count(*) FILTER (
               WHERE cardinality(g.employee_keys) > 0
                 AND p.work_email IS NOT NULL
                 AND (g.reminded_at IS NULL
                      OR g.reminded_at <= ${reminderDueBefore(ask.now).toISOString()}::timestamptz)
             )::int AS due
        FROM people.completeness_gap g
        JOIN people.person p ON p.tenant_id = g.tenant_id AND p.id = g.person_id
       WHERE g.tenant_id = ${tenantId}::uuid`);
    // The weekly email, or somebody asking for one of the same fields since.
    const reminded =
      ask.people.length === 0
        ? []
        : await tx.execute<{ person_id: string; reminded_at: Date | string | null }>(sql`
            SELECT g.person_id::text AS person_id,
                   greatest(g.reminded_at, (
                     SELECT max(d.requested_at) FROM people.detail_request d
                      WHERE d.tenant_id = g.tenant_id AND d.person_id = g.person_id
                        AND d.attribute_key = ANY(g.employee_keys))) AS reminded_at
              FROM people.completeness_gap g
             WHERE g.tenant_id = ${tenantId}::uuid
               AND g.person_id = ANY(${`{${ask.people.join(',')}}`}::uuid[])`);
    const iso = (at: Date | string) => new Date(at).toISOString();
    return {
      blocking: totals?.blocking ?? 0,
      lastReminded:
        totals?.last_reminded === null || totals?.last_reminded === undefined
          ? null
          : iso(totals.last_reminded),
      due: totals?.due ?? 0,
      remindedAt: new Map(
        [...reminded].flatMap((r) =>
          r.reminded_at === null ? [] : [[r.person_id, iso(r.reminded_at)] as const],
        ),
      ),
    };
  };
}

export function drizzlePersonReader(): PersonReader {
  return {
    async record(tx, tenantId, personId, lock = false) {
      const query = tx
        .select(withEmployment)
        .from(person)
        .where(and(eq(person.tenantId, tenantId), eq(person.id, personId)))
        .limit(1);
      const rows = lock ? await query.for('update') : await query;
      const row = rows[0];
      return row ? toRecord(row) : null;
    },

    async records(tx, tenantId, personIds) {
      if (personIds.length === 0) return [];
      const rows = await tx
        .select(withEmployment)
        .from(person)
        .where(and(eq(person.tenantId, tenantId), inArray(person.id, [...personIds])));
      return rows.map(toRecord);
    },

    async page(tx, tenantId, after, limit, where, search, gaps, leavers, gapsIn, refine) {
      const order = orderOf(refine);
      // Both a keyset from the last one's place: by id unsorted, by the
      // order's own keys sorted (`seek`), so page n costs one page either way.
      const rows =
        order === undefined
          ? await tx
              .select(withEmployment)
              .from(person)
              .where(
                and(
                  matching(tenantId, where, search, gaps, leavers, gapsIn),
                  refined(tenantId, refine),
                  after === null ? undefined : gt(person.id, after),
                ),
              )
              .orderBy(asc(person.id))
              .limit(limit)
          : await tx
              .select(withEmployment)
              .from(person)
              .where(
                and(
                  matching(tenantId, where, search, gaps, leavers, gapsIn),
                  refined(tenantId, refine),
                  after === null ? undefined : seek(order, tenantId, after),
                ),
              )
              .orderBy(...orderBy(order))
              .limit(limit);
      return rows.map(toRecord);
    },

    async count(tx, tenantId, where, search, leavers, gaps, gapsIn, refine) {
      const rows = await tx
        .select({
          all: sql<number>`count(*)::int`,
          active: sql<number>`(count(*) FILTER (WHERE ${person.status} = 'active'))::int`,
          notStarted: sql<number>`(count(*) FILTER (WHERE ${person.status} IN ('provisional', 'pre_hire')))::int`,
        })
        .from(person)
        .where(
          and(matching(tenantId, where, search, gaps, leavers, gapsIn), refined(tenantId, refine)),
        );
      return {
        all: rows[0]?.all ?? 0,
        active: rows[0]?.active ?? 0,
        notStarted: rows[0]?.notStarted ?? 0,
      };
    },

    async personOf(tx, tenantId, accountId) {
      const rows = await tx
        .select({ id: person.id })
        .from(person)
        .where(and(eq(person.tenantId, tenantId), eq(person.identityAccountId, accountId)))
        .limit(1);
      return rows[0]?.id ?? null;
    },
  };
}

/** Pre-hires whose start date is on or before a day, earliest start first. */
export function drizzleArrivals(): Arrivals {
  return {
    async due(tx, tenantId, onOrBefore, limit) {
      const rows = await tx
        .select({ id: person.id })
        .from(person)
        .where(
          and(
            eq(person.tenantId, tenantId),
            eq(person.status, 'pre_hire'),
            lte(person.hireDate, onOrBefore),
          ),
        )
        .orderBy(asc(person.hireDate), asc(person.id))
        .limit(limit);
      return rows.map((r) => r.id);
    },
  };
}

/**
 * People on notice or terminated whose access has not ended and whose last
 * working day is before a
 * day, earliest first (PEO-109). `person_access_due_idx` answers it.
 */
export function drizzleLeavers(): Leavers {
  return {
    async due(tx, tenantId, before, limit) {
      const rows = await tx
        .select({ id: person.id })
        .from(person)
        .where(
          and(
            eq(person.tenantId, tenantId),
            inArray(person.status, ['notice', 'terminated']),
            isNull(person.accessEndedAt),
            lt(person.lastWorkingDay, before),
          ),
        )
        .orderBy(asc(person.lastWorkingDay), asc(person.id))
        .limit(limit);
      return rows.map((r) => r.id);
    },
  };
}

/**
 * People with a dated value scheduled ahead whose day may have come
 * somewhere, past their watermark, earliest first (PEO-124).
 * `person_history_scheduled_idx` holds only scheduled rows, and its predicate
 * is repeated here word for word so the planner can use it. Raw SQL, like the
 * watermark: `applied_through` is the job's alone, so `person` in `tables.ts`
 * does not name it and no other read selects it (20260924320000).
 */
export function drizzleScheduled(): Scheduled {
  return {
    async due(tx, tenantId, onOrBefore, limit) {
      const rows = await tx.execute<{ id: string }>(sql`
        SELECT h.person_id AS id
          FROM people.person_attribute_history h
          JOIN people.person p ON p.tenant_id = h.tenant_id AND p.id = h.person_id
         WHERE h.tenant_id = ${tenantId}::uuid
           AND h.effective_from > (h.recorded_at AT TIME ZONE 'Etc/GMT+12')::date
           AND h.effective_from <= ${onOrBefore}::date
           AND h.attribute_key NOT IN ('hire_date', 'last_working_day')
           AND (p.applied_through IS NULL OR h.effective_from > p.applied_through)
           AND p.status NOT IN ('terminated', 'discarded', 'merged')
         GROUP BY h.person_id
         ORDER BY min(h.effective_from), h.person_id
         LIMIT ${limit}`);
      return [...rows].map((r) => r.id);
    },

    async through(tx, tenantId, personId, day) {
      await tx.execute(sql`
        UPDATE people.person SET applied_through = ${day}::date
         WHERE tenant_id = ${tenantId}::uuid AND id = ${personId}::uuid`);
    },
  };
}

/** `people.scheduled_refusal` (20260924320000): one row per refused history row. */
export function drizzleScheduledRefusals(): ScheduledRefusals {
  return {
    async refused(tx, tenantId, personId) {
      const rows = await tx.execute<{ id: string }>(sql`
        SELECT history_id AS id FROM people.scheduled_refusal
         WHERE tenant_id = ${tenantId}::uuid AND person_id = ${personId}::uuid`);
      return [...rows].map((r) => r.id);
    },
    async record(tx, tenantId, r) {
      const rows = await tx.execute(sql`
        INSERT INTO people.scheduled_refusal
          (tenant_id, history_id, person_id, attribute_key, reason, refused_at)
        VALUES (${tenantId}::uuid, ${r.historyId}::uuid, ${r.personId}::uuid, ${r.attributeKey},
                ${r.reason}, ${r.refusedAt}::timestamptz)
        ON CONFLICT DO NOTHING
        RETURNING history_id`);
      return [...rows].length > 0;
    },
  };
}

function toVersion(row: typeof schemaVersion.$inferSelect): PublishedVersion {
  return {
    version: row.version,
    document: row.document as SchemaDocument,
    checksum: row.checksum,
    publishedAt: row.publishedAt.toISOString(),
    publishedBy: row.publishedBy,
    rolledBackFrom: row.rolledBackFrom,
    reason: row.reason,
  };
}

/** How many published versions one process keeps read: every tenant's current one, and then some. */
export const SCHEMA_VERSIONS_HELD = 512;

/**
 * Published versions, read through a cache keyed by tenant, number and
 * checksum.
 *
 * A published version cannot change (`schema_version_is_immutable` refuses
 * an UPDATE or a DELETE), so once read it is that version for good, in any
 * process. Which version is current is still asked every time, from the
 * index alone: a publish is served on the very next read, here or on any
 * other instance, and only the document — every field, every rule, the
 * largest thing a screen reads, and read several times a screen — is not
 * read and parsed again. Frozen, because every request shares it.
 */
export function drizzleSchemaVersions(): SchemaVersions {
  const held = new Map<string, PublishedVersion>();
  const keyOf = (tenantId: string, version: number, checksum: string): string =>
    `${tenantId}:${String(version)}:${checksum}`;
  const keep = (tenantId: string, row: typeof schemaVersion.$inferSelect): PublishedVersion => {
    const version = deepFreeze(toVersion(row));
    // The oldest goes first: a Map iterates in insertion order.
    if (held.size >= SCHEMA_VERSIONS_HELD) held.delete(held.keys().next().value ?? '');
    held.set(keyOf(tenantId, row.version, row.checksum), version);
    return version;
  };
  return {
    async current(tx, tenantId) {
      const [latest] = await tx
        .select({ version: schemaVersion.version, checksum: schemaVersion.checksum })
        .from(schemaVersion)
        .where(eq(schemaVersion.tenantId, tenantId))
        .orderBy(desc(schemaVersion.version))
        .limit(1);
      if (latest === undefined) return null;
      const known = held.get(keyOf(tenantId, latest.version, latest.checksum));
      if (known !== undefined) return known;
      const rows = await tx
        .select()
        .from(schemaVersion)
        .where(and(eq(schemaVersion.tenantId, tenantId), eq(schemaVersion.version, latest.version)))
        .limit(1);
      return rows[0] ? keep(tenantId, rows[0]) : null;
    },

    async byNumber(tx, tenantId, version) {
      const rows = await tx
        .select()
        .from(schemaVersion)
        .where(and(eq(schemaVersion.tenantId, tenantId), eq(schemaVersion.version, version)))
        .limit(1);
      return rows[0] ? toVersion(rows[0]) : null;
    },

    async list(tx, tenantId) {
      const rows = await tx
        .select()
        .from(schemaVersion)
        .where(eq(schemaVersion.tenantId, tenantId))
        .orderBy(desc(schemaVersion.version));
      return rows.map(toVersion);
    },
  };
}

/**
 * Who the viewer is to this person, from the org chart the rows describe.
 *
 * `self` and `manager` are one lookup each; `manager_chain` walks up from the
 * person's manager, bounded, so a cycle somebody typed cannot spin forever.
 * Tenant-wide relations come from the viewer's roles.
 *
 * ponytail: this stands in for OpenFGA, which has no client in the repository
 * yet. The port is the seam; the relations it answers are the ones §6.6 lists.
 */
export function drizzleRelations(): RelationsResolver {
  return {
    async relations(tx, tenantId, viewer, personId) {
      const rows = await tx.execute<{
        is_self: boolean;
        is_manager: boolean;
        in_chain: boolean;
      }>(sql`
        WITH RECURSIVE me AS (
          SELECT id FROM people.person
           WHERE tenant_id = ${tenantId}::uuid AND identity_account_id = ${viewer.accountId}::uuid
        ),
        target AS (
          SELECT id, manager_id, identity_account_id FROM people.person
           WHERE tenant_id = ${tenantId}::uuid AND id = ${personId}::uuid
        ),
        -- Each step is one key lookup, whatever the statistics think of the
        -- tenant. As a join, a tenant they have not seen looks empty, and
        -- the planner scanned all of it once per step (20260924340000); the
        -- LIMIT keeps the subquery from being flattened back into one. It
        -- names no \`manager_id\` condition, which would fit
        -- \`person_reports_idx\` as well as the key; the top of the chain
        -- yields one null, which matches nobody and looks nobody up.
        chain(id, depth) AS (
          SELECT manager_id, 1 FROM target WHERE manager_id IS NOT NULL
          UNION
          SELECT up.manager_id, c.depth + 1
            FROM chain c
           CROSS JOIN LATERAL (
                   SELECT p.manager_id FROM people.person p
                    WHERE p.tenant_id = ${tenantId}::uuid AND p.id = c.id
                    LIMIT 1
                 ) up
           WHERE c.depth < 32
        )
        SELECT
          coalesce((SELECT identity_account_id = ${viewer.accountId}::uuid FROM target), false) AS is_self,
          coalesce((SELECT manager_id IN (SELECT id FROM me) FROM target), false)               AS is_manager,
          EXISTS (SELECT 1 FROM chain WHERE id IN (SELECT id FROM me))                          AS in_chain
      `);
      const row = [...rows][0];

      return {
        isSelf: row?.is_self === true,
        isManager: row?.is_manager === true,
        isInManagerChain: row?.in_chain === true,
        isHr: viewer.roles.has('hr'),
        isFinance: viewer.roles.has('finance'),
        isAdmin: viewer.roles.has('people_admin'),
      };
    },

    /** Who they are, their reports and everybody below them, in one walk down, bounded like the walk up. */
    async reach(tx, tenantId, viewer) {
      const rows = await tx.execute<{ kind: 'self' | 'direct' | 'chain'; id: string }>(sql`
        WITH RECURSIVE me AS (
          SELECT id FROM people.person
           WHERE tenant_id = ${tenantId}::uuid AND identity_account_id = ${viewer.accountId}::uuid
        ),
        below(id, depth) AS (
          SELECT id, 1 FROM people.person
           WHERE tenant_id = ${tenantId}::uuid AND manager_id IN (SELECT id FROM me)
          UNION
          SELECT p.id, b.depth + 1
            FROM people.person p JOIN below b ON p.manager_id = b.id
           WHERE p.tenant_id = ${tenantId}::uuid AND b.depth < 32
        )
        SELECT 'self' AS kind, id FROM me
        UNION ALL
        SELECT 'direct', id FROM below WHERE depth = 1
        UNION ALL
        SELECT DISTINCT 'chain', id FROM below
      `);
      const of = (kind: string) =>
        new Set([...rows].filter((r) => r.kind === kind).map((r) => r.id));
      return { self: of('self'), direct: of('direct'), chain: of('chain'), complete: true };
    },
  };
}
