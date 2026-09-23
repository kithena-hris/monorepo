import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, sql } from 'drizzle-orm';

import { CORE_COLUMNS } from '../application/person/core.js';
import type {
  PersonReader,
  PersonRecord,
  RelationsResolver,
  SchemaVersions,
} from '../application/person/ports.js';
import type { Arrivals, Leavers } from '../application/person/start.js';
import type { PersonState } from '../domain/person/person.js';
import type { PublishedVersion, SchemaDocument } from '../domain/schema/publish.js';
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

function toRecord(row: Row): PersonRecord {
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
    },
    values,
    custom,
    schemaVersion: row.schemaVersion,
    legalEntityId: row.legalEntityId,
    employmentType: row.employmentType,
    workModel: row.workModel,
  };
}

export function drizzlePersonReader(): PersonReader {
  return {
    async record(tx, tenantId, personId, lock = false) {
      const query = tx
        .select()
        .from(person)
        .where(and(eq(person.tenantId, tenantId), eq(person.id, personId)))
        .limit(1);
      const rows = lock ? await query.for('update') : await query;
      const row = rows[0];
      return row ? toRecord(row) : null;
    },

    async page(tx, tenantId, after, limit, where) {
      const rows = await tx
        .select()
        .from(person)
        .where(
          and(
            eq(person.tenantId, tenantId),
            after === null ? undefined : gt(person.id, after),
            // Containment, which is what `person_custom_idx` (GIN,
            // jsonb_path_ops) answers. One `@>` for every key at once.
            where === undefined || Object.keys(where).length === 0
              ? undefined
              : sql`${person.custom} @> ${JSON.stringify(where)}::jsonb`,
          ),
        )
        .orderBy(asc(person.id))
        .limit(limit);
      return rows.map(toRecord);
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
  };
}
