import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { exportableColumns } from './export.js';
import {
  checkReason,
  runExportJob,
  type ExportJobDeps,
  type ExportJobRequest,
  type ExportJobResult,
} from './job.js';

/**
 * Whether an export runs while the requester waits or on the queue (PRD
 * §15.1: "anything over 2,000 rows runs as a job").
 *
 * The answer is the row count, and the count is what the requester may list —
 * the same read the export is — so a manager with a team of eight is never
 * queued because the company has ten thousand people.
 *
 * **Queued is still checked.** A missing reason is refused here, before the
 * job exists, rather than discovered by a worker nobody is watching. It is
 * checked against the columns asked for, which is stricter than the job's
 * check against the columns that turned out readable: a viewer who asks for
 * salary on a queued export states a reason even if they could read none.
 *
 * The job is handed to the queue by the caller **after** this transaction
 * commits, so a rolled-back request never leaves a job behind.
 */

export const QUEUE_THRESHOLD = 2000;

/** What goes on the queue: JSON, so the viewer's roles are an array. */
export interface QueuedExport {
  readonly exportId: string;
  readonly request: Omit<ExportJobRequest, 'viewer' | 'exportId'> & {
    readonly viewer: { readonly accountId: string; readonly roles: readonly string[] };
  };
}

export interface ExportQueue {
  /** Idempotent on `exportId`: the same id twice is one job. */
  enqueue(job: QueuedExport): Promise<void>;
}

export type RequestedExport =
  | ({ readonly status: 'completed' } & ExportJobResult)
  | { readonly status: 'queued'; readonly exportId: string; readonly job: QueuedExport };

const COUNT_PAGE = 500;

export async function requestExport(
  tx: PostgresJsDatabase,
  deps: ExportJobDeps,
  request: ExportJobRequest,
): Promise<Result<RequestedExport>> {
  const rows = await countUpTo(tx, deps, request, QUEUE_THRESHOLD + 1);
  if (!rows.ok) return rows;

  if (rows.value <= QUEUE_THRESHOLD) {
    const done = await runExportJob(tx, deps, request);
    return done.ok ? ok({ status: 'completed', ...done.value }) : done;
  }

  const version = await deps.schemas.current(tx, request.tenantId);
  if (!version) return err(failure('SCHEMA_NOT_PUBLISHED', 'Nothing is published to export'));
  const asked =
    request.fields ?? exportableColumns(version, request.includeArchived).map((d) => d.key);
  const reason = await checkReason(tx, deps, request, asked);
  if (!reason.ok) return reason;

  const exportId = request.exportId ?? deps.newId();
  await deps.ledger.queue(tx, {
    tenantId: request.tenantId,
    exportId,
    requestedBy: request.viewer.accountId,
  });
  // A stray `exportId` in `rest` is harmless: the job's own is the one used.
  const { viewer, ...rest } = request;
  return ok({
    status: 'queued',
    exportId,
    job: {
      exportId,
      request: { ...rest, viewer: { accountId: viewer.accountId, roles: [...viewer.roles] } },
    },
  });
}

/** The queued job, run: the same body, the same export id on every attempt. */
export function runQueuedExport(
  tx: PostgresJsDatabase,
  deps: ExportJobDeps,
  job: QueuedExport,
): Promise<Result<ExportJobResult>> {
  return runExportJob(tx, deps, {
    ...job.request,
    exportId: job.exportId,
    viewer: { accountId: job.request.viewer.accountId, roles: new Set(job.request.viewer.roles) },
  });
}

/**
 * ponytail: counts by paging the read path until it passes the threshold, so
 * deciding costs at most five pages. A count on the reader is the upgrade if
 * that shows up in a profile.
 */
async function countUpTo(
  tx: PostgresJsDatabase,
  deps: ExportJobDeps,
  request: ExportJobRequest,
  limit: number,
): Promise<Result<number>> {
  if (request.recordOf !== undefined) return ok(1);
  if (request.personIds) return ok(Math.min(request.personIds.length, limit));
  let n = 0;
  let after: string | null = null;
  do {
    const page = await deps.access.list(tx, {
      ...request,
      after,
      limit: COUNT_PAGE,
      ...(request.asOf ? { asOf: request.asOf } : {}),
    });
    if (!page.ok) return page;
    n += page.value.items.length;
    after = page.value.next;
  } while (after !== null && n < limit);
  return ok(n);
}
