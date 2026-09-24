import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { outboxTable, publish } from '@kithena/db-kit';
import { err, failure, ok, type PendingEvent, type Result } from '@kithena/domain-kit';
import { ExportCompleted, type AttributeDefinition } from '@kithena/contracts';

import { buildExport, type ExportDeps, type ExportRequest } from './export.js';
import type { ObjectStore } from './object-store.js';

/**
 * An export, run to the end: built, stored, linked, audited, announced
 * (PRD §15.1).
 *
 * **Never an email attachment.** The file lands encrypted in object storage
 * and the requester is sent a signed link that expires in 24 hours, through a
 * notification. An attachment is a copy of the employee register in a
 * mailbox nobody controls, forwarded, backed up and searchable for years; a
 * link that stops working is the only version of "sending the file" that can
 * be taken back.
 *
 * **Every export is an event.** `people.export.completed` carries the actor
 * (on the envelope), the attribute keys, the row count, the format and — for
 * a financial export — the stated reason. No value and no link.
 *
 * **A financial export needs a reason**, stated before anything is stored. A
 * special-category field never reaches here: `buildExport` refuses it by
 * name, reason or no reason, because §15.2 sends it through the DSAR path.
 *
 * This is the job's body. `requestExport` (queue.ts) decides whether it runs
 * while the requester waits or on the queue; the delivery is the same link
 * either way.
 *
 * **Idempotent on the export id.** A queued job can be retried after it
 * stored the files, or after it committed; the ledger's completion is guarded
 * by `completed_at IS NULL`, so a second completion announces nothing and
 * notifies nobody, and answers with the export as the first run left it.
 */

export { LINK_LIFETIME_MS } from './object-store.js';
import { LINK_LIFETIME_MS } from './object-store.js';

/** How the requester hears the file is ready. A link and when it dies; never the file. */
export interface ExportNotifier {
  notify(message: {
    readonly tenantId: string;
    readonly recipientAccountId: string;
    readonly exportId: string;
    readonly links: readonly { readonly name: string; readonly url: string }[];
    readonly expiresAt: string;
  }): Promise<void>;
}

export interface ExportAudit {
  /** Into the outbox, in the caller's transaction. */
  publish(tx: PostgresJsDatabase, events: readonly PendingEvent[]): Promise<void>;
}

export const outboxExportAudit: ExportAudit = {
  publish: (tx, events) => publish(tx, outboxTable('people'), events),
};

/** One row per export, in the caller's transaction. Holds no value and no link. */
export interface ExportLedger {
  /** A queued export, recorded before the job is handed over. */
  queue(
    tx: PostgresJsDatabase,
    run: { tenantId: string; exportId: string; requestedBy: string },
  ): Promise<void>;
  /** False when this export was already complete: the caller then does nothing more. */
  complete(tx: PostgresJsDatabase, run: CompletedExport): Promise<boolean>;
  find(tx: PostgresJsDatabase, tenantId: string, exportId: string): Promise<LedgerEntry | null>;
}

export interface CompletedExport {
  readonly tenantId: string;
  readonly exportId: string;
  readonly requestedBy: string;
  readonly rowCount: number;
  readonly fileNames: readonly string[];
  readonly expiresAt: string;
}

export type LedgerEntry =
  | { readonly status: 'queued'; readonly exportId: string; readonly requestedBy: string }
  | ({ readonly status: 'completed' } & CompletedExport);

export interface ExportJobDeps extends ExportDeps {
  readonly store: ObjectStore;
  readonly notifier: ExportNotifier;
  readonly audit: ExportAudit;
  readonly ledger: ExportLedger;
  readonly newId: () => string;
}

export interface ExportJobRequest extends ExportRequest {
  /** Required when the file would carry a financial attribute. */
  readonly reason?: string | null;
  /** Given when the export was queued, so a retry is the same export. */
  readonly exportId?: string;
}

export interface ExportJobResult {
  readonly exportId: string;
  readonly links: readonly { readonly name: string; readonly url: string }[];
  readonly expiresAt: string;
  readonly rowCount: number;
}

/** Money, a bank account, or anything classified as financial. */
export const isFinancial = (d: AttributeDefinition): boolean =>
  d.classification.piiKind === 'financial' ||
  d.dataType === 'money' ||
  d.dataType === 'bank_account';

/** Refused when a financial key is in the file and no reason was given. */
export async function checkReason(
  tx: PostgresJsDatabase,
  deps: Pick<ExportDeps, 'schemas'>,
  request: ExportJobRequest,
  attributeKeys: readonly string[],
): Promise<Result<string>> {
  const version = await deps.schemas.current(tx, request.tenantId);
  const byKey = new Map<string, AttributeDefinition>(
    version?.document.attributes.map((d) => [d.key, d]),
  );
  const financial = attributeKeys.filter((k) => {
    const d = byKey.get(k);
    return d !== undefined && isFinancial(d);
  });
  const reason = request.reason?.trim() ?? '';
  if (financial.length > 0 && reason === '') {
    return err(
      failure(
        'EXPORT_REASON_REQUIRED',
        `Say why you are exporting ${financial.join(', ')}; it is recorded with the export`,
        ['reason'],
      ),
    );
  }
  if (reason.length > 500) {
    return err(failure('VALUE_INVALID', 'A reason is at most 500 characters', ['reason']));
  }
  return ok(reason);
}

const keyFor = (tenantId: string, exportId: string, name: string) =>
  `${tenantId}/exports/${exportId}/${name}`;

/** The links of a completed export, signed again: nothing stores a link. */
export async function linksOf(
  store: ObjectStore,
  run: CompletedExport,
): Promise<{ name: string; url: string }[]> {
  return Promise.all(
    run.fileNames.map(async (name) => ({
      name,
      url: await store.sign(keyFor(run.tenantId, run.exportId, name), run.expiresAt),
    })),
  );
}

export async function runExportJob(
  tx: PostgresJsDatabase,
  deps: ExportJobDeps,
  request: ExportJobRequest,
): Promise<Result<ExportJobResult>> {
  const done = async (run: CompletedExport): Promise<Result<ExportJobResult>> =>
    ok({
      exportId: run.exportId,
      links: await linksOf(deps.store, run),
      expiresAt: run.expiresAt,
      rowCount: run.rowCount,
    });

  if (request.exportId !== undefined) {
    const prior = await deps.ledger.find(tx, request.tenantId, request.exportId);
    if (prior?.status === 'completed') return done(prior);
  }

  const built = await buildExport(tx, deps, request);
  if (!built.ok) return built;

  const checked = await checkReason(tx, deps, request, built.value.attributeKeys);
  if (!checked.ok) return checked;
  const reason = checked.value;

  const exportId = request.exportId ?? deps.newId();
  const now = deps.clock.instant();
  const expiresAt = new Date(Date.parse(now) + LINK_LIFETIME_MS).toISOString();

  // Stored before the ledger row, so a crash between the two leaves a file
  // the sweep deletes and a job that is retried, never a row naming nothing.
  for (const file of built.value.files) {
    await deps.store.put(keyFor(request.tenantId, exportId, file.name), file.bytes, file.mediaType);
  }
  const run: CompletedExport = {
    tenantId: request.tenantId,
    exportId,
    requestedBy: request.viewer.accountId,
    rowCount: built.value.rowCount,
    fileNames: built.value.files.map((f) => f.name),
    expiresAt,
  };
  if (!(await deps.ledger.complete(tx, run))) {
    const prior = await deps.ledger.find(tx, request.tenantId, exportId);
    if (prior?.status === 'completed') return done(prior);
    throw new Error(`export ${exportId} would not complete and is not complete`);
  }
  const links = await linksOf(deps.store, run);

  await deps.audit.publish(tx, [
    {
      eventId: deps.newId(),
      eventName: 'people.export.completed',
      eventVersion: 1,
      tenantId: request.tenantId as PendingEvent['tenantId'],
      occurredAt: now,
      effectiveFrom: null,
      aggregate: { type: 'Export', id: exportId, version: 1 },
      actor: { kind: 'user', userId: request.viewer.accountId },
      correlationId: request.correlationId,
      causationId: null,
      payload: ExportCompleted.payload.parse({
        exportId,
        attributeKeys: built.value.attributeKeys,
        rowCount: built.value.rowCount,
        format: request.format,
        reason: reason === '' ? null : reason,
      }),
    },
  ]);

  await deps.notifier.notify({
    tenantId: request.tenantId,
    recipientAccountId: request.viewer.accountId,
    exportId,
    links,
    expiresAt,
  });

  return ok({ exportId, links, expiresAt, rowCount: built.value.rowCount });
}
