import { sql } from 'drizzle-orm';

import type { DetailRequest, DetailRequestStore } from '../application/screens/record.js';

/**
 * Requests for a detail, over `people.detail_request`
 * (`migrations/20260927170000_people_detail_request.sql`), in the caller's
 * tenant transaction.
 */
export function drizzleDetailRequests(): DetailRequestStore {
  return {
    async record(tx, r) {
      // A row asked for within the day is left alone and not returned: no email.
      const rows = await tx.execute<{ attribute_key: string }>(sql`
        INSERT INTO people.detail_request
          (tenant_id, person_id, attribute_key, requested_by, requested_at)
        SELECT ${r.tenantId}::uuid, ${r.personId}::uuid, key, ${r.requestedBy}::uuid,
               ${r.requestedAt}::timestamptz
          FROM unnest(${`{${r.keys.join(',')}}`}::text[]) AS key
        ON CONFLICT (tenant_id, person_id, attribute_key) DO UPDATE
           SET requested_by = excluded.requested_by, requested_at = excluded.requested_at
         WHERE people.detail_request.requested_at <= ${r.resendBefore}::timestamptz
        RETURNING attribute_key`);
      return [...rows].map((row) => row.attribute_key);
    },

    async of(tx, tenantId, personId) {
      const rows = await tx.execute<{
        attribute_key: string;
        requested_by: string;
        requested_at: Date | string;
      }>(sql`
        SELECT attribute_key, requested_by, requested_at FROM people.detail_request
         WHERE tenant_id = ${tenantId}::uuid AND person_id = ${personId}::uuid
         ORDER BY requested_at DESC`);
      return [...rows].map((row): DetailRequest => ({
        key: row.attribute_key,
        requestedBy: row.requested_by,
        requestedAt: new Date(row.requested_at).toISOString(),
      }));
    },
  };
}
