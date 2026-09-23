import { and, asc, eq, getTableColumns } from 'drizzle-orm';
import { outboxTable } from '@kithena/db-kit';

import type { DsarSource } from '../application/dsar/export-dsar.js';
import { drizzleSchemaRepository } from './drizzle-schema-repository.js';
import { publishedDocument } from './policy-registry.js';
import { person } from './tables.js';

const outbox = outboxTable('people');

/**
 * What a subject access export reads, as Drizzle.
 *
 * The row comes back keyed by **column name**, because a core attribute's key
 * is its column's name (`hire_date`, `work_email`) and that is how the export
 * finds its value without a hand-kept map from one to the other.
 */
export function drizzleDsarSource(): DsarSource {
  const columnNames = Object.entries(getTableColumns(person)).map(([prop, column]) => [prop, column.name] as const);
  const schema = drizzleSchemaRepository();

  return {
    async record(tx, tenantId, personId) {
      const rows = await tx
        .select()
        .from(person)
        .where(and(eq(person.tenantId, tenantId), eq(person.id, personId)))
        .limit(1);
      const row = rows[0];
      if (!row) return null;

      const byProp = row as Record<string, unknown>;
      return {
        schemaVersion: row.schemaVersion,
        columns: Object.fromEntries(columnNames.map(([prop, name]) => [name, byProp[prop]])),
        custom: (row.custom ?? {}) as Record<string, unknown>,
      };
    },

    async document(tx, tenantId, version) {
      if (version === null) {
        const current = await schema.currentVersion(tx, tenantId);
        return current ? { version: current.version, document: current.document } : null;
      }
      const document = await publishedDocument(tx, tenantId, version);
      return document ? { version, document } : null;
    },

    async events(tx, tenantId, personId) {
      const rows = await tx
        .select({ envelope: outbox.envelope })
        .from(outbox)
        .where(
          and(
            eq(outbox.tenantId, tenantId),
            eq(outbox.aggregateType, 'Person'),
            eq(outbox.aggregateId, personId),
          ),
        )
        .orderBy(asc(outbox.createdAt));
      return rows.map((r) => r.envelope);
    },
  };
}
