import { and, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import { outboxTable, publish } from '@kithena/db-kit';

import type { RetentionAttribute, RetentionStore } from '../application/retention/anonymise.js';
import { publishedAttributes } from './policy-registry.js';
import { person, personSecret } from './tables.js';

const outbox = outboxTable('people');

/**
 * Columns retention never clears: identity of the row, the state machine's
 * own dates, and bookkeeping. A leaver's hire date and last day are what an
 * aggregate headcount for 2019 is counted from, and must survive.
 */
const STRUCTURAL = new Set([
  'id',
  'tenant_id',
  'identity_account_id',
  'status',
  'hire_date',
  'last_working_day',
  'custom',
  'schema_version',
  'completeness',
  'source_of_record',
  'created_at',
  'updated_at',
]);

/** Property name by column name, for the typed columns a retention policy may clear. */
const clearable = new Map(
  Object.entries(getTableColumns(person))
    .filter(([, column]) => !STRUCTURAL.has(column.name))
    .map(([prop, column]) => [column.name, prop] as const),
);

export function drizzleRetentionStore(): RetentionStore {
  return {
    async leaver(tx, tenantId, personId) {
      const rows = await tx
        .select()
        .from(person)
        .where(and(eq(person.tenantId, tenantId), eq(person.id, personId)))
        .limit(1);
      const row = rows[0];
      if (!row) return null;

      const byProp = row as Record<string, unknown>;
      const held = new Set(Object.keys(row.custom ?? {}));
      for (const [name, prop] of clearable) {
        if (byProp[prop] !== null && byProp[prop] !== undefined) held.add(name);
      }

      // A value can outlive the row: in a secret, or in a history row the
      // projection has since moved past. Both count as held until erased.
      const [secrets, history] = await Promise.all([
        tx
          .select({ key: personSecret.attributeKey })
          .from(personSecret)
          .where(and(eq(personSecret.tenantId, tenantId), eq(personSecret.personId, personId))),
        tx.execute(sql`
          SELECT DISTINCT attribute_key AS key FROM people.person_attribute_history
           WHERE tenant_id = ${tenantId}::uuid AND person_id = ${personId}::uuid
             AND redacted_at IS NULL AND value IS NOT NULL
        `),
      ]);
      for (const s of secrets) held.add(s.key);
      for (const h of history) held.add(String(h['key']));
      return { status: row.status, lastWorkingDay: row.lastWorkingDay, held };
    },

    async policies(tx, tenantId) {
      // Later versions overwrite earlier ones, so each key carries its latest
      // policy — and a key a rollback dropped still carries its last one.
      const latest = new Map<string, RetentionAttribute>();
      for (const a of await publishedAttributes(tx, tenantId)) {
        latest.set(a.key, { key: a.key, policy: a.classification });
      }
      return [...latest.values()];
    },

    async clear(tx, tenantId, personId, keys, events) {
      const columns = Object.fromEntries(
        keys.flatMap((k) => {
          const prop = clearable.get(k);
          return prop ? [[prop, null]] : [];
        }),
      );
      const customKeys = keys.filter((k) => !clearable.has(k));

      await tx
        .update(person)
        .set({
          ...columns,
          custom: sql`${person.custom} - ${sql.param(customKeys)}::text[]`,
          updatedAt: new Date(),
        })
        .where(and(eq(person.tenantId, tenantId), eq(person.id, personId)));

      await tx
        .delete(personSecret)
        .where(
          and(
            eq(personSecret.tenantId, tenantId),
            eq(personSecret.personId, personId),
            inArray(personSecret.attributeKey, [...keys]),
          ),
        );

      /*
       * Every row for the key, corrections included: a correction supersedes a
       * value, it does not remove it, so redacting only the latest row would
       * leave the original in the timeline. Raw SQL because the redaction
       * columns belong to this job alone and the shared table definition does
       * not need to know them. The trigger admits exactly this shape.
       */
      await tx.execute(sql`
        UPDATE people.person_attribute_history
           SET value = NULL, redacted_at = now(), redaction_reason = 'retention'
         WHERE tenant_id = ${tenantId}::uuid AND person_id = ${personId}::uuid
           AND attribute_key = ANY(${sql.param([...keys])}::text[])
           AND redacted_at IS NULL
      `);

      // Same transaction as the write, like every other person write here.
      await publish(tx, outbox, events);
    },
  };
}
