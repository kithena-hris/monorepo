import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { publish } from '@kithena/db-kit';
import { CalendarDate } from '@kithena/contracts';

import type { CompletenessStore, GridRow, Reminder } from '../application/completeness/store.js';
import type { SchemaDocument } from '../domain/schema/publish.js';
import { outbox, person, schemaVersionEvaluated } from './tables.js';

/**
 * `people.completeness_gap` and the `completeness` column, as SQL.
 *
 * Raw SQL for the gap table rather than a Drizzle definition: every statement
 * against it is a bulk upsert or a conditional update, and those read more
 * plainly as the SQL they are. The integration tests run them against the real
 * migration, which is what keeps the two honest.
 */
export function drizzleCompletenessStore(): CompletenessStore {
  return {
    async versionAt(tx, tenantId, version) {
      const rows = await tx
        .select({
          document: schemaVersionEvaluated.document,
          evaluatedOn: schemaVersionEvaluated.evaluatedOn,
          evaluatedAt: schemaVersionEvaluated.evaluatedAt,
        })
        .from(schemaVersionEvaluated)
        .where(
          and(
            eq(schemaVersionEvaluated.tenantId, tenantId),
            eq(schemaVersionEvaluated.version, version),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return {
        attributes: (row.document as SchemaDocument).attributes,
        evaluatedOn: row.evaluatedOn === null ? null : CalendarDate.parse(row.evaluatedOn),
        evaluatedAt: row.evaluatedAt?.toISOString() ?? null,
      };
    },

    async setState(tx, tenantId, state, personIds) {
      if (personIds.length === 0) return new Set();
      const rows = await tx
        .update(person)
        .set({ completeness: state })
        .where(
          and(
            eq(person.tenantId, tenantId),
            inArray(person.id, [...personIds]),
            ne(person.completeness, state),
          ),
        )
        .returning({ id: person.id });
      return new Set(rows.map((r) => r.id));
    },

    async saveGaps(tx, tenantId, version, gaps) {
      if (gaps.length === 0) return;
      /*
       * `reminded_at` and `reminders_sent` are deliberately absent from the
       * update. A republish that adds a field must not reset the clock the
       * weekly cap reads, or every publish would be a fresh email to everyone.
       */
      await tx.execute(sql`
        INSERT INTO people.completeness_gap (tenant_id, person_id, schema_version, employee_keys, staff_keys)
        SELECT ${tenantId}::uuid, g.person_id, ${version}, g.employee_keys, g.staff_keys
        FROM jsonb_to_recordset(${JSON.stringify(gaps.map(toRecord))}::jsonb)
          AS g(person_id uuid, employee_keys text[], staff_keys text[])
        ON CONFLICT (tenant_id, person_id) DO UPDATE
          SET schema_version = EXCLUDED.schema_version,
              employee_keys  = EXCLUDED.employee_keys,
              staff_keys     = EXCLUDED.staff_keys,
              updated_at     = now()
      `);
    },

    async publish(tx, events) {
      await publish(tx, outbox, events);
    },

    async dueReminders(tx, tenantId, now) {
      const rows = await tx.execute(sql`
        SELECT g.person_id, p.legal_entity_id, p.location_id, p.custom ->> 'time_zone' AS own_zone
          FROM people.completeness_gap g
          JOIN people.person p ON p.tenant_id = g.tenant_id AND p.id = g.person_id
         WHERE g.tenant_id = ${tenantId}::uuid
           AND p.work_email IS NOT NULL
           AND cardinality(g.employee_keys) > 0
           AND (g.reminded_at IS NULL
                OR g.reminded_at <= ${now.toISOString()}::timestamptz - interval '168 hours')
      `);
      return [...rows].map((row) => ({
        personId: row['person_id'] as string,
        placement: {
          legalEntityId: row['legal_entity_id'] as string | null,
          locationId: row['location_id'] as string | null,
          ownZone: row['own_zone'] as string | null,
        },
      }));
    },

    async claimReminders(tx, tenantId, now, only) {
      /*
       * One statement, so the cap is a property of the row lock rather than of
       * this process. A second sweep blocked on the same row re-reads it after
       * the first commits, finds `reminded_at` is now, and claims nothing.
       */
      const rows = await tx.execute(sql`
        UPDATE people.completeness_gap g
           SET reminded_at = ${now.toISOString()}::timestamptz,
               reminders_sent = g.reminders_sent + 1
          FROM people.person p
         WHERE g.tenant_id = ${tenantId}::uuid
           AND p.tenant_id = g.tenant_id
           AND p.id = g.person_id
           AND p.work_email IS NOT NULL
           AND cardinality(g.employee_keys) > 0
           AND (g.reminded_at IS NULL
                OR g.reminded_at <= ${now.toISOString()}::timestamptz - interval '168 hours')
           AND (${only === undefined} OR g.person_id = ANY(${`{${(only ?? []).join(',')}}`}::uuid[]))
        RETURNING g.person_id, p.work_email, g.employee_keys
      `);
      return [...rows].map((row): Reminder => ({
        personId: row['person_id'] as string,
        workEmail: row['work_email'] as string,
        keys: row['employee_keys'] as string[],
      }));
    },

    async staffGrid(tx, tenantId, today) {
      /*
       * The termination row is the status and the date, not a stored task:
       * `people.person` already says both, and a stored copy would need
       * clearing by every path that terminates or corrects.
       */
      const rows = await tx.execute(sql`
        SELECT task, key, array_agg(DISTINCT person_id ORDER BY person_id) AS person_ids
          FROM (
            SELECT 'missing' AS task, key, g.person_id
              FROM people.completeness_gap g, unnest(g.staff_keys) AS key
             WHERE g.tenant_id = ${tenantId}::uuid
            UNION ALL
            SELECT 'confirm_termination', 'last_working_day', p.id
              FROM people.person p
             WHERE p.tenant_id = ${tenantId}::uuid
               AND p.status = 'notice'
               AND p.last_working_day < ${today}::date
            UNION ALL
            -- Marked by the claim rotation (PEO-082), both people of each pair.
            SELECT 'unique_conflict', u.attribute_key, pair.person_id
              FROM people.attribute_unique u,
                   unnest(ARRAY[u.person_id, u.conflict_with]) AS pair(person_id)
             WHERE u.tenant_id = ${tenantId}::uuid
               AND u.conflict_with IS NOT NULL
          ) AS work
         GROUP BY task, key
         ORDER BY task DESC, key
      `);
      return [...rows].map((row): GridRow => ({
        task: row['task'] as GridRow['task'],
        key: row['key'] as string,
        personIds: row['person_ids'] as string[],
      }));
    },
  };
}

function toRecord(gap: {
  personId: string;
  employeeKeys: readonly string[];
  staffKeys: readonly string[];
}) {
  return { person_id: gap.personId, employee_keys: gap.employeeKeys, staff_keys: gap.staffKeys };
}
