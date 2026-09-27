import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { Secrets } from '../application/person/ports.js';

/**
 * A field's values sealed after the fact: what publishing a version that
 * encrypts it does, in that version's transaction.
 *
 * Each person's value moves into `people.person_secret` (the store keeps the
 * ciphertext and the last four) and leaves `people.person.custom`; history's
 * earlier values of it are redacted, reason `encrypted`. What a sealed field
 * has always looked like, from here on, for rows written before it was one.
 */
export function sealExisting(secrets: Secrets) {
  return async (tx: PostgresJsDatabase, tenantId: string, keys: readonly string[]): Promise<void> => {
    for (const key of keys) {
      const rows = await tx.execute<{ id: string; value: unknown }>(sql`
        SELECT id, custom -> ${key} AS value FROM people.person
         WHERE tenant_id = ${tenantId}::uuid AND custom ? ${key}`);
      for (const row of rows) {
        if (row.value === null || row.value === undefined) continue;
        // eslint-disable-next-line no-await-in-loop -- one transaction, one person at a time
        await secrets.put(
          tx,
          { tenantId, personId: row.id, attributeKey: key },
          typeof row.value === 'string' ? row.value : JSON.stringify(row.value),
        );
      }
      await tx.execute(sql`
        UPDATE people.person SET custom = custom - ${key}
         WHERE tenant_id = ${tenantId}::uuid AND custom ? ${key}`);
      await tx.execute(sql`
        UPDATE people.person_attribute_history
           SET value = NULL, redacted_at = now(), redaction_reason = 'encrypted'
         WHERE tenant_id = ${tenantId}::uuid AND attribute_key = ${key}
           AND redacted_at IS NULL AND value IS NOT NULL`);
    }
  };
}
