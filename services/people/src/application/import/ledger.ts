import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { outboxTable, publish } from '@kithena/db-kit';
import { err, type DomainFailure } from '@kithena/domain-kit';

import { NO_COUNTS, type ImportRun, type RunCounts } from '../../domain/import/run.js';
import type { UploadIntent } from '../../domain/import/upload.js';
import { rowRefusal, type ImportLedger, type ReportIndex, type RowScope } from './commit.js';
import type { RunStore, StoredRun } from './run-store.js';
import type { UploadIntents } from './upload.js';

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
        INSERT INTO people.import (tenant_id, id, checksum, actor_id, row_count, name)
        VALUES (${entry.tenantId}::uuid, ${entry.importId}::uuid, ${entry.checksum},
                ${entry.actorId}::uuid, ${entry.rowCount}, ${entry.name})
        ON CONFLICT (tenant_id, checksum) DO NOTHING
        RETURNING id`);
      if ([...inserted].length > 0) {
        await planForKeyLookups(tx);
        return { claimed: true };
      }

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
 * Plan the rest of the import for what it is: thousands of key lookups.
 *
 * A plan cached while `people.person` or `people.attribute_unique` had been
 * analyzed at a page or two is a sequential scan, and no index shape changes
 * that: the statistics say the table is tiny, and the density they imply
 * keeps saying so as it grows. The foreign-key checks and the claim lookups
 * then each read every row the import has written, until the next ANALYZE —
 * which cannot come while the import's one transaction is open. That is a
 * deployment with a few dozen people importing its first thousands.
 *
 * Every statement the import runs per row is a lookup by key, so a sequential
 * scan is never the right plan for one. `DISCARD PLANS` drops the plans this
 * connection cached before, the foreign-key checks' included, so they are
 * made again under the setting. `SET LOCAL` ends with the transaction; plans
 * made during it last until the ANALYZE the import triggers, and are the
 * index plans the grown table wants. Neither needs a privilege.
 *
 * Replanning each time the table grows fourfold (the other option) needs a
 * counter in the row loop and still scans: the tiny table's density keeps the
 * estimate low until a replan lands past ~1,000 rows, and by then the import
 * has read 2.6 million rows it did not need.
 */
export async function planForKeyLookups(tx: PostgresJsDatabase): Promise<void> {
  await tx.execute(sql`SET LOCAL enable_seqscan = off`);
  await tx.execute(sql`DISCARD PLANS`);
}

/**
 * Which people each stored report contains, over `people.import_report`
 * (`migrations/20260924250000_people_import_report.sql`). Ids only.
 */
export function drizzleReportIndex(): ReportIndex {
  const ids = (list: readonly string[]) =>
    sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(list)}::jsonb))::uuid[]`;
  return {
    async save(tx, entry) {
      // ponytail: expired rows are cleared a tenant at a time, here, rather
      // than by a sweep of its own; they hold ids and nothing else.
      await tx.execute(sql`
        DELETE FROM people.import_report
         WHERE tenant_id = ${entry.tenantId}::uuid AND expires_at <= ${entry.storedAt}::timestamptz`);
      await tx.execute(sql`
        INSERT INTO people.import_report (tenant_id, checksum, person_ids, stored_at, expires_at)
        VALUES (${entry.tenantId}::uuid, ${entry.checksum}, ${ids(entry.personIds)},
                ${entry.storedAt}::timestamptz, ${entry.expiresAt}::timestamptz)
        ON CONFLICT (tenant_id, checksum) DO UPDATE
           SET person_ids = EXCLUDED.person_ids, stored_at = EXCLUDED.stored_at,
               expires_at = EXCLUDED.expires_at`);
    },

    async expiresAt(tx, tenantId, checksum) {
      const rows = await tx.execute<{ expires_at: string | Date }>(sql`
        SELECT expires_at FROM people.import_report
         WHERE tenant_id = ${tenantId}::uuid AND checksum = ${checksum}`);
      const at = [...rows][0]?.expires_at;
      return at === undefined ? null : new Date(at).toISOString();
    },

    async containing(tx, tenantId, personId) {
      const rows = await tx.execute<{ checksum: string }>(sql`
        SELECT checksum FROM people.import_report
         WHERE tenant_id = ${tenantId}::uuid AND person_ids @> ARRAY[${personId}::uuid]`);
      return [...rows].map((r) => r.checksum);
    },

    async remove(tx, tenantId, checksums) {
      if (checksums.length === 0) return;
      await tx.execute(sql`
        DELETE FROM people.import_report
         WHERE tenant_id = ${tenantId}::uuid
           AND checksum IN (SELECT jsonb_array_elements_text(${JSON.stringify(checksums)}::jsonb))`);
    },
  };
}

/**
 * Upload intents, over `people.import_upload`
 * (`migrations/20260924360000_people_import_upload.sql`). Never the file.
 */
export function drizzleUploadIntents(): UploadIntents {
  type Row = {
    tenant_id: string;
    id: string;
    actor_id: string;
    purpose: string;
    name: string;
    size: string | number;
    object_key: string;
    created_at: string | Date;
    url_expires_at: string | Date;
    expires_at: string | Date;
    checksum: string | null;
  };
  const iso = (at: string | Date) => new Date(at).toISOString();
  const intent = (r: Row): UploadIntent => ({
    id: r.id,
    tenantId: r.tenant_id,
    actorId: r.actor_id,
    purpose: r.purpose === 'photo' || r.purpose === 'file' ? r.purpose : 'import',
    name: r.name,
    size: Number(r.size),
    objectKey: r.object_key,
    createdAt: iso(r.created_at),
    urlExpiresAt: iso(r.url_expires_at),
    expiresAt: iso(r.expires_at),
    checksum: r.checksum,
  });
  return {
    async save(tx, u) {
      await tx.execute(sql`
        INSERT INTO people.import_upload
          (tenant_id, id, actor_id, purpose, name, size, object_key,
           created_at, url_expires_at, expires_at)
        VALUES (${u.tenantId}::uuid, ${u.id}::uuid, ${u.actorId}::uuid, ${u.purpose}, ${u.name},
                ${u.size}, ${u.objectKey}, ${u.createdAt}::timestamptz,
                ${u.urlExpiresAt}::timestamptz, ${u.expiresAt}::timestamptz)`);
    },

    async find(tx, tenantId, id) {
      const rows = await tx.execute<Row>(sql`
        SELECT tenant_id, id, actor_id, purpose, name, size, object_key,
               created_at, url_expires_at, expires_at, checksum
          FROM people.import_upload
         WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
      const row = [...rows][0];
      return row === undefined ? null : intent(row);
    },

    async complete(tx, tenantId, id, checksum) {
      await tx.execute(sql`
        UPDATE people.import_upload SET checksum = ${checksum}
         WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
    },

    async release(tx, tenantId, actorId, now, purpose = 'import') {
      const rows = await tx.execute<{ object_key: string }>(sql`
        DELETE FROM people.import_upload
         WHERE tenant_id = ${tenantId}::uuid
           AND ((actor_id = ${actorId}::uuid AND purpose = ${purpose})
                OR expires_at <= ${now}::timestamptz)
        RETURNING object_key`);
      return [...rows].map((r) => r.object_key);
    },

    async remove(tx, tenantId, id) {
      await tx.execute(sql`
        DELETE FROM people.import_upload WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
    },
  };
}

/**
 * A savepoint per row. Drizzle runs a nested `transaction` as one, and
 * throwing out of it is how it is told to roll back to it; the refusal comes
 * back out as the `Result` it was.
 *
 * A row the database itself refuses — a constraint the checks before it did
 * not foresee — rolls back to its savepoint the same way and is reported as
 * that row's reason, naming the column. It never takes the rest of the file,
 * or the request, down with it. Anything else (the connection, a deadlock)
 * still throws: it is not about the row.
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
    const refused = rowRefusal(cause);
    if (refused !== null) return err(refused);
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

/**
 * Import runs, over `people.import_run`
 * (`migrations/20261003120000_people_import_run.sql`), with the checksum of
 * the `people.import` row a finished run wrote. Counts and words only.
 */
export function drizzleRunStore(): RunStore {
  type Row = {
    tenant_id: string;
    id: string;
    upload_id: string;
    actor_id: string;
    name: string | null;
    status: ImportRun['status'];
    phase: ImportRun['phase'];
    done: number;
    total: number | null;
    counts: Partial<RunCounts> | null;
    fields: number | null;
    failure: string | null;
    created_at: string | Date;
    started_at: string | Date | null;
    finished_at: string | Date | null;
    checksum: string | null;
  };
  const iso = (at: string | Date | null) => (at === null ? null : new Date(at).toISOString());
  const stored = (r: Row): StoredRun => ({
    tenantId: r.tenant_id,
    id: r.id,
    uploadId: r.upload_id,
    actorId: r.actor_id,
    name: r.name,
    status: r.status,
    phase: r.phase,
    done: r.done,
    total: r.total,
    counts: { ...NO_COUNTS, ...r.counts },
    fields: r.fields,
    failure: r.failure,
    createdAt: iso(r.created_at) ?? '',
    startedAt: iso(r.started_at),
    finishedAt: iso(r.finished_at),
    checksum: r.checksum,
  });
  const select = sql`
    SELECT r.tenant_id, r.id, r.upload_id, r.actor_id, r.name, r.status, r.phase, r.done,
           r.total, r.counts, r.fields, r.failure, r.created_at, r.started_at, r.finished_at,
           i.checksum
      FROM people.import_run r
      LEFT JOIN people.import i ON i.tenant_id = r.tenant_id AND i.id = r.id`;
  return {
    async insert(tx, run) {
      // The partial unique index decides: a second active run is no row, not an error.
      const rows = await tx.execute<{ id: string }>(sql`
        INSERT INTO people.import_run (tenant_id, id, upload_id, actor_id, name, created_at)
        VALUES (${run.tenantId}::uuid, ${run.id}::uuid, ${run.uploadId}::uuid,
                ${run.actorId}::uuid, ${run.name}, ${run.createdAt}::timestamptz)
        ON CONFLICT (tenant_id) WHERE status IN ('queued', 'running') DO NOTHING
        RETURNING id`);
      return [...rows].length > 0;
    },

    async find(tx, tenantId, id, lock = false) {
      if (lock) {
        await tx.execute(sql`
          SELECT 1 FROM people.import_run
           WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`);
      }
      const rows = await tx.execute<Row>(sql`${select}
         WHERE r.tenant_id = ${tenantId}::uuid AND r.id = ${id}::uuid`);
      const row = [...rows][0];
      return row === undefined ? null : stored(row);
    },

    async save(tx, tenantId, run) {
      await tx.execute(sql`
        UPDATE people.import_run
           SET status = ${run.status}, phase = ${run.phase}, done = ${run.done},
               total = ${run.total}, counts = ${JSON.stringify(run.counts)}::jsonb,
               fields = ${run.fields}, failure = ${run.failure},
               started_at = ${run.startedAt}::timestamptz,
               finished_at = ${run.finishedAt}::timestamptz
         WHERE tenant_id = ${tenantId}::uuid AND id = ${run.id}::uuid`);
    },

    async active(tx, tenantId) {
      const rows = await tx.execute<Row>(sql`${select}
         WHERE r.tenant_id = ${tenantId}::uuid AND r.status IN ('queued', 'running')`);
      const row = [...rows][0];
      return row === undefined ? null : stored(row);
    },

    async finished(tx, tenantId, actorId, since) {
      const rows = await tx.execute<Row>(sql`${select}
         WHERE r.tenant_id = ${tenantId}::uuid AND r.actor_id = ${actorId}::uuid
           AND r.finished_at >= ${since}::timestamptz
         ORDER BY r.finished_at DESC
         LIMIT 20`);
      return [...rows].map(stored);
    },

    async imported(tx, tenantId, checksum) {
      const rows = await tx.execute<{ id: string }>(sql`
        SELECT id FROM people.import
         WHERE tenant_id = ${tenantId}::uuid AND checksum = ${checksum}`);
      return [...rows].length > 0;
    },
  };
}
