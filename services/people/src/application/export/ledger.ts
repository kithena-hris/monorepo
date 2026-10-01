import { sql } from 'drizzle-orm';

import type { ExportFormat } from './export.js';
import type { CompletedExport, ExportLedger, LedgerEntry } from './job.js';

/** A text[] from a list, through JSON: no array literal to escape by hand. */
const texts = (list: readonly string[]) =>
  sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(list)}::jsonb))`;

/** A stored format, or null for a row written before the column (or one this build does not know). */
export const formatOf = (format: string | null): ExportFormat | null =>
  format === 'csv' || format === 'xlsx' || format === 'pdf' ? format : null;

/**
 * The export ledger, over `people.export`.
 *
 * Beside the use case rather than in `infrastructure/`, as the import ledger
 * is: export owns this table and nothing else reads it. Hand-written against
 * `migrations/20260923200000_people_export.sql`.
 */
export function drizzleExportLedger(): ExportLedger {
  return {
    async queue(tx, run) {
      await tx.execute(sql`
        INSERT INTO people.export (tenant_id, id, requested_by)
        VALUES (${run.tenantId}::uuid, ${run.exportId}::uuid, ${run.requestedBy}::uuid)
        ON CONFLICT (tenant_id, id) DO NOTHING`);
    },

    async complete(tx, run) {
      // The guard is the idempotency: a second completion matches no row.
      const rows = await tx.execute<{ id: string }>(sql`
        INSERT INTO people.export
               (tenant_id, id, requested_by, row_count, file_names, expires_at, completed_at,
                format, reason, attribute_keys, shared_with, as_of, audience)
        VALUES (${run.tenantId}::uuid, ${run.exportId}::uuid, ${run.requestedBy}::uuid,
                ${run.rowCount}, ${texts(run.fileNames)},
                ${run.expiresAt}::timestamptz, now(),
                ${run.format}, ${run.reason},
                ${run.attributeKeys === null ? null : texts(run.attributeKeys)},
                ${run.sharedWith ?? null}::uuid, ${run.asOf ?? null}::date, ${run.audience ?? null})
        ON CONFLICT (tenant_id, id) DO UPDATE
           SET row_count = EXCLUDED.row_count, file_names = EXCLUDED.file_names,
               expires_at = EXCLUDED.expires_at, completed_at = EXCLUDED.completed_at,
               format = EXCLUDED.format, reason = EXCLUDED.reason,
               attribute_keys = EXCLUDED.attribute_keys, shared_with = EXCLUDED.shared_with,
               as_of = EXCLUDED.as_of, audience = EXCLUDED.audience
         WHERE people.export.completed_at IS NULL
        RETURNING id`);
      return [...rows].length > 0;
    },

    async find(tx, tenantId, exportId) {
      const rows = await tx.execute<{
        requested_by: string;
        row_count: number | null;
        file_names: string[] | null;
        expires_at: string | Date | null;
        format: string | null;
        reason: string | null;
        attribute_keys: string[] | null;
        shared_with: string | null;
        opened_at: string | Date | null;
        as_of: string | null;
        audience: string | null;
      }>(sql`
        SELECT requested_by, row_count, file_names, expires_at, format, reason, attribute_keys,
               shared_with, opened_at, as_of::text AS as_of, audience
          FROM people.export
         WHERE tenant_id = ${tenantId}::uuid AND id = ${exportId}::uuid`);
      const row = [...rows][0];
      if (!row) return null;
      if (row.row_count === null || row.file_names === null || row.expires_at === null) {
        return { status: 'queued', exportId, requestedBy: row.requested_by };
      }
      return {
        status: 'completed',
        tenantId,
        exportId,
        requestedBy: row.requested_by,
        rowCount: row.row_count,
        fileNames: row.file_names,
        expiresAt: new Date(row.expires_at).toISOString(),
        format: formatOf(row.format),
        reason: row.reason,
        attributeKeys: row.attribute_keys,
        sharedWith: row.shared_with,
        openedAt: row.opened_at === null ? null : new Date(row.opened_at).toISOString(),
        asOf: row.as_of,
        audience: row.audience,
      };
    },

    async opened(tx, tenantId, exportId, at) {
      await tx.execute(sql`
        UPDATE people.export SET opened_at = ${at}::timestamptz
         WHERE tenant_id = ${tenantId}::uuid AND id = ${exportId}::uuid AND opened_at IS NULL`);
    },
  };
}

export function inMemoryExportLedger(): ExportLedger & { readonly rows: Map<string, LedgerEntry> } {
  const rows = new Map<string, LedgerEntry>();
  const id = (tenantId: string, exportId: string) => `${tenantId}/${exportId}`;
  return {
    rows,
    queue(_tx, run) {
      if (!rows.has(id(run.tenantId, run.exportId))) {
        rows.set(id(run.tenantId, run.exportId), {
          status: 'queued',
          exportId: run.exportId,
          requestedBy: run.requestedBy,
        });
      }
      return Promise.resolve();
    },
    complete(_tx, run: CompletedExport) {
      if (rows.get(id(run.tenantId, run.exportId))?.status === 'completed') {
        return Promise.resolve(false);
      }
      rows.set(id(run.tenantId, run.exportId), { status: 'completed', openedAt: null, ...run });
      return Promise.resolve(true);
    },
    find: (_tx, tenantId, exportId) => Promise.resolve(rows.get(id(tenantId, exportId)) ?? null),
    opened(_tx, tenantId, exportId, at) {
      const row = rows.get(id(tenantId, exportId));
      if (row?.status === 'completed' && (row.openedAt ?? null) === null) {
        rows.set(id(tenantId, exportId), { ...row, openedAt: at });
      }
      return Promise.resolve();
    },
  };
}
