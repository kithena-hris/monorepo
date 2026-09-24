import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';

import { CORE_COLUMNS } from '../application/person/core.js';
import type {
  PersonReader,
  PersonRecord,
  PersonSearch,
  RelationsResolver,
  SchemaVersions,
} from '../application/person/ports.js';
import type { Arrivals, Leavers, Scheduled } from '../application/person/start.js';
import type { PersonState } from '../domain/person/person.js';
import type { PublishedVersion, SchemaDocument } from '../domain/schema/publish.js';
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
    },
    values,
    custom,
    schemaVersion: row.schemaVersion,
    legalEntityId: row.legalEntityId,
    employmentType: row.employmentType,
    workModel: row.workModel,
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
 * Containment is what `person_custom_idx` (GIN, jsonb_path_ops) answers, one
 * `@>` for every key at once. The search is `ILIKE` over at most four short
 * text columns and the two full names, which one tenant's rows answer inside
 * the 300 ms budget at 50,000 people (PEO-117's test).
 * ponytail: no trigram index; add `pg_trgm` GIN indexes on the name columns
 * when a tenant is large enough that the scan misses the budget.
 */
function matching(
  tenantId: string,
  where: Readonly<Record<string, string>> | undefined,
  search: PersonSearch | undefined,
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
  return and(
    eq(person.tenantId, tenantId),
    where === undefined || Object.keys(where).length === 0
      ? undefined
      : sql`${person.custom} @> ${JSON.stringify(where)}::jsonb`,
    text === '' ? undefined : matches.length === 0 ? sql`false` : or(...matches),
  );
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

    async page(tx, tenantId, after, limit, where, search) {
      const rows = await tx
        .select(withEmployment)
        .from(person)
        .where(
          and(matching(tenantId, where, search), after === null ? undefined : gt(person.id, after)),
        )
        .orderBy(asc(person.id))
        .limit(limit);
      return rows.map(toRecord);
    },

    async count(tx, tenantId, where, search) {
      const rows = await tx
        .select({
          all: sql<number>`count(*)::int`,
          active: sql<number>`(count(*) FILTER (WHERE ${person.status} = 'active'))::int`,
        })
        .from(person)
        .where(matching(tenantId, where, search));
      return { all: rows[0]?.all ?? 0, active: rows[0]?.active ?? 0 };
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
           AND p.status NOT IN ('terminated', 'discarded')
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

function toVersion(row: typeof schemaVersion.$inferSelect): PublishedVersion {
  return {
    version: row.version,
    document: row.document as SchemaDocument,
    checksum: row.checksum,
    publishedAt: row.publishedAt.toISOString(),
    publishedBy: row.publishedBy,
    rolledBackFrom: row.rolledBackFrom,
  };
}

export function drizzleSchemaVersions(): SchemaVersions {
  return {
    async current(tx, tenantId) {
      const rows = await tx
        .select()
        .from(schemaVersion)
        .where(eq(schemaVersion.tenantId, tenantId))
        .orderBy(desc(schemaVersion.version))
        .limit(1);
      return rows[0] ? toVersion(rows[0]) : null;
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
        chain(id, depth) AS (
          SELECT manager_id, 1 FROM target WHERE manager_id IS NOT NULL
          UNION
          SELECT p.manager_id, c.depth + 1
            FROM people.person p JOIN chain c ON p.id = c.id
           WHERE p.tenant_id = ${tenantId}::uuid AND p.manager_id IS NOT NULL AND c.depth < 32
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
      const of = (kind: string) => new Set([...rows].filter((r) => r.kind === kind).map((r) => r.id));
      return { self: of('self'), direct: of('direct'), chain: of('chain'), complete: true };
    },
  };
}
