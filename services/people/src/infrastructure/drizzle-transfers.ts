import { sql } from 'drizzle-orm';

import { formatOf } from '../application/export/ledger.js';
import type { ImportCounts } from '../application/import/commit.js';
import type { ImportRun } from '../domain/import/run.js';
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
    run_status: ImportRun['status'] | null;
    run_phase: ImportRun['phase'] | null;
    run_done: number | null;
    run_total: number | null;
  };
  return {
    async page(tx, tenantId, page) {
      const rows = await tx.execute<Row>(sql`
        WITH t AS (
          SELECT 'import'::text AS kind, i.id, COALESCE(ru.created_at, i.started_at) AS at,
                 i.actor_id AS actor, i.name,
                 i.counts, NULL::int AS row_count, NULL::text AS format, NULL::text AS reason,
                 NULL::text[] AS file_names, NULL::timestamptz AS expires_at,
                 i.checksum, r.expires_at AS report_expires_at,
                 ru.status AS run_status, ru.phase AS run_phase, ru.done AS run_done,
                 ru.total AS run_total
            FROM people.import i
            LEFT JOIN people.import_report r
                   ON r.tenant_id = i.tenant_id AND r.checksum = i.checksum
            LEFT JOIN people.import_run ru ON ru.tenant_id = i.tenant_id AND ru.id = i.id
           WHERE i.tenant_id = ${tenantId}::uuid
          UNION ALL
          -- A run that has not written its import yet: going, or stopped before the end.
          SELECT 'import', ru.id, ru.created_at, ru.actor_id, ru.name,
                 CASE WHEN ru.status = 'failed' THEN ru.counts END, NULL, NULL, NULL, NULL, NULL,
                 NULL, NULL, ru.status, ru.phase, ru.done, ru.total
            FROM people.import_run ru
           WHERE ru.tenant_id = ${tenantId}::uuid
             AND NOT EXISTS (SELECT 1 FROM people.import i
                              WHERE i.tenant_id = ru.tenant_id AND i.id = ru.id)
          UNION ALL
          SELECT 'export', e.id, e.requested_at, e.requested_by, NULL, NULL, e.row_count,
                 e.format, e.reason, e.file_names, e.expires_at, NULL, NULL,
                 NULL, NULL, NULL, NULL
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
          run:
            r.run_status === null || r.run_phase === null
              ? null
              : {
                  status: r.run_status,
                  phase: r.run_phase,
                  done: r.run_done ?? 0,
                  total: r.run_total,
                },
        }),
      );
    },
  };
}
