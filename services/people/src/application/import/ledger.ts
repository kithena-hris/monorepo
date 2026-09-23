import { sql } from 'drizzle-orm';
import { outboxTable, publish } from '@kithena/db-kit';
import { err, type DomainFailure } from '@kithena/domain-kit';

import type { ImportLedger, RowScope } from './commit.js';

/**
 * The import ledger, over `people.import`.
 *
 * Here beside the use case rather than in `infrastructure/`, as analytics
 * keeps its own tables: import owns this table and nothing else reads it.
 * Hand-written against `migrations/20260923130000_people_import_export.sql`;
 * the integration test applies that migration and runs through this.
 */

const outbox = outboxTable('people');

export function drizzleImportLedger(): ImportLedger {
  return {
    async claim(tx, entry) {
      // The constraint decides, not a read before the insert. A concurrent
      // upload of the same file blocks on the index until this transaction
      // ends, then finds the row and does nothing.
      const inserted = await tx.execute<{ id: string }>(sql`
        INSERT INTO people.import (tenant_id, id, checksum, actor_id, row_count)
        VALUES (${entry.tenantId}::uuid, ${entry.importId}::uuid, ${entry.checksum},
                ${entry.actorId}::uuid, ${entry.rowCount})
        ON CONFLICT (tenant_id, checksum) DO NOTHING
        RETURNING id`);
      if ([...inserted].length > 0) return { claimed: true };

      const existing = await tx.execute<{ id: string }>(sql`
        SELECT id FROM people.import
         WHERE tenant_id = ${entry.tenantId}::uuid AND checksum = ${entry.checksum}`);
      const id = [...existing][0]?.id;
      if (id === undefined) throw new Error('import key conflicted and then vanished');
      return { claimed: false, importId: id };
    },

    async complete(tx, tenantId, importId, counts) {
      await tx.execute(sql`
        UPDATE people.import
           SET counts = ${JSON.stringify(counts)}::jsonb, completed_at = now()
         WHERE tenant_id = ${tenantId}::uuid AND id = ${importId}::uuid`);
    },

    publish: (tx, events) => publish(tx, outbox, events),
  };
}

/**
 * A savepoint per row. Drizzle runs a nested `transaction` as one, and
 * throwing out of it is how it is told to roll back to it; the refusal comes
 * back out as the `Result` it was.
 */
export const drizzleRowScope: RowScope = async (tx, fn) => {
  try {
    return await tx.transaction(async (sp) => {
      const result = await fn(sp);
      if (!result.ok) throw new RowRefused(result.error);
      return result;
    });
  } catch (cause) {
    if (cause instanceof RowRefused) return err(cause.failure);
    throw cause;
  }
};

class RowRefused extends Error {
  readonly failure: DomainFailure;
  constructor(failure: DomainFailure) {
    super(failure.message);
    this.failure = failure;
  }
}
