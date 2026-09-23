import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { publish } from '@kithena/db-kit';

import type { CompletenessStore, GridRow, Reminder } from '../application/completeness/store.js';
import type { SchemaDocument } from '../domain/schema/publish.js';
import { outbox, person, schemaVersion } from './tables.js';

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
    async definitionsAt(tx, tenantId, version) {
      const rows = await tx
        .select({ document: schemaVersion.document })
        .from(schemaVersion)
        .where(and(eq(schemaVersion.tenantId, tenantId), eq(schemaVersion.version, version)))
        .limit(1);
      const row = rows[0];
      return row ? (row.document as SchemaDocument).attributes : null;
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

    async claimReminders(tx, tenantId, now) {
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
        RETURNING g.person_id, p.work_email, g.employee_keys
      `);
      return [...rows].map((row): Reminder => ({
        personId: row['person_id'] as string,
        workEmail: row['work_email'] as string,
        keys: row['employee_keys'] as string[],
      }));
    },

    async staffGrid(tx, tenantId) {
      const rows = await tx.execute(sql`
        SELECT key, array_agg(g.person_id ORDER BY g.person_id) AS person_ids
          FROM people.completeness_gap g, unnest(g.staff_keys) AS key
         WHERE g.tenant_id = ${tenantId}::uuid
         GROUP BY key
         ORDER BY key
      `);
      return [...rows].map((row): GridRow => ({
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
