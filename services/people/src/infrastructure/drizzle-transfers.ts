import { sql } from 'drizzle-orm';

import { formatOf } from '../application/export/ledger.js';
import type { ImportCounts } from '../application/import/commit.js';
import type { TransferHistory, TransferRow } from '../application/screens/transfers.js';

const iso = (at: Date | string | null) => (at === null ? null : new Date(at).toISOString());

/**
 * Import & export's one history, over the two ledgers `people.import` and
 * `people.export` (`migrations/20260929120000_people_transfer_history.sql`),
 * and `people.import_report` for whether an import's report is still kept.
 * Read in the caller's tenant transaction, so RLS scopes all three.
 *
 * ponytail: a keyset over a UNION of both tables, sorted in the query; the
 * ledgers hold one row per file a company moves, hundreds a year. An index on
 * `(tenant_id, at)` for each is the step if a tenant ever has hundreds of thousands.
 */
export function drizzleTransfers(): TransferHistory {
  type Row = {
    kind: 'import' | 'export';
    id: string;
    at: Date | string;
    actor: string;
    name: string | null;
    counts: ImportCounts | null;
    row_count: number | null;
    format: string | null;
    reason: string | null;
    file_names: string[] | null;
    expires_at: Date | string | null;
    checksum: string | null;
    report_expires_at: Date | string | null;
  };
  return {
    async page(tx, tenantId, page) {
      const rows = await tx.execute<Row>(sql`
        WITH t AS (
          SELECT 'import'::text AS kind, i.id, i.started_at AS at, i.actor_id AS actor, i.name,
                 i.counts, NULL::int AS row_count, NULL::text AS format, NULL::text AS reason,
                 NULL::text[] AS file_names, NULL::timestamptz AS expires_at,
                 i.checksum, r.expires_at AS report_expires_at
            FROM people.import i
            LEFT JOIN people.import_report r
                   ON r.tenant_id = i.tenant_id AND r.checksum = i.checksum
           WHERE i.tenant_id = ${tenantId}::uuid
          UNION ALL
          SELECT 'export', e.id, e.requested_at, e.requested_by, NULL, NULL, e.row_count,
                 e.format, e.reason, e.file_names, e.expires_at, NULL, NULL
            FROM people.export e
           WHERE e.tenant_id = ${tenantId}::uuid
        )
        SELECT * FROM t
         WHERE ${page.before}::uuid IS NULL
            OR (at, id) < (SELECT at, id FROM t WHERE id = ${page.before}::uuid)
         ORDER BY at DESC, id DESC
         LIMIT ${page.limit}`);
      return [...rows].map(
        (r): TransferRow => ({
          kind: r.kind,
          id: r.id,
          at: new Date(r.at).toISOString(),
          actor: r.actor,
          name: r.name,
          counts: r.counts,
          rowCount: r.row_count,
          format: formatOf(r.format),
          reason: r.reason,
          fileNames: r.file_names,
          expiresAt: iso(r.expires_at),
          checksum: r.checksum,
          reportExpiresAt: iso(r.report_expires_at),
        }),
      );
    },
  };
}
