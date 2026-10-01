import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { outboxTable, publish } from '@kithena/db-kit';
import { err, failure, ok, type PendingEvent, type Result } from '@kithena/domain-kit';
import { ExportCompleted, type Actor, type AttributeDefinition } from '@kithena/contracts';

import {
  buildExport,
  type ExportDeps,
  type ExportFormat,
  type ExportRequest,
} from './export.js';
import type { ObjectStore } from './object-store.js';
import { userActor } from '../person/ports.js';
import { writable } from '../../domain/access/view-as.js';
import type { Asking } from '../person/person-access.js';
import { nameOf } from '../screens/record.js';

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
import { LINK_LIFETIME_MS, SHARED_LIFETIME_MS } from './object-store.js';

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
  /** The recipient's first open of a file sent to them; later opens change nothing. */
  opened(tx: PostgresJsDatabase, tenantId: string, exportId: string, at: string): Promise<void>;
}

export interface CompletedExport {
  readonly tenantId: string;
  readonly exportId: string;
  readonly requestedBy: string;
  readonly rowCount: number;
  readonly fileNames: readonly string[];
  readonly expiresAt: string;
  /**
   * What the history shows, as `people.export.completed` carries it. Null on
   * an export completed before the ledger kept them.
   */
  readonly format: ExportFormat | null;
  readonly reason: string | null;
  readonly attributeKeys: readonly string[] | null;
  /**
   * The account the file was sent to (design AI13): its files live under
   * `shared/` for a week, and only it and the requester are answered.
   */
  readonly sharedWith?: string | null;
  /** The file's date and its audience in the builder's words, as its About says them. */
  readonly asOf?: string | null;
  readonly audience?: string | null;
}

export type LedgerEntry =
  | { readonly status: 'queued'; readonly exportId: string; readonly requestedBy: string }
  | ({ readonly status: 'completed'; readonly openedAt?: string | null } & CompletedExport);

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
  /**
   * Who the audit event names, when it is not the viewer asking: a scheduled
   * report (PEO-069) is built as its recipient, and nobody asked for it.
   */
  readonly actor?: Actor;
  /** Built for somebody else to receive (design AI13): kept a week, opened only by them. */
  readonly sharedWith?: string;
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

/** Where a file lives: `shared/` for one sent to somebody, kept its week (`lifetimeOf`). */
const keyFor = (run: Pick<CompletedExport, 'tenantId' | 'exportId' | 'sharedWith'>, name: string) =>
  `${run.sharedWith == null ? 'exports' : 'shared'}/${run.tenantId}/${run.exportId}/${name}`;

/**
 * The links of a completed export, signed again: nothing stores a link.
 * `until` signs them for less than the file lives: a file sent to somebody
 * is opened signed in, and its links are good for minutes, not its week.
 */
export async function linksOf(
  store: ObjectStore,
  run: CompletedExport,
  until: string = run.expiresAt,
): Promise<{ name: string; url: string }[]> {
  const expires = Date.parse(until) < Date.parse(run.expiresAt) ? until : run.expiresAt;
  return Promise.all(
    run.fileNames.map(async (name) => ({
      name,
      url: await store.sign(keyFor(run, name), expires),
    })),
  );
}

/** Somebody's name as the asker may read it, from their account; null when People holds none. */
export async function accountName(
  tx: PostgresJsDatabase,
  deps: Pick<ExportDeps, 'records' | 'access'>,
  asking: Asking,
  accountId: string,
): Promise<string | null> {
  const personId = await deps.records.reader.personOf(tx, asking.tenantId, accountId);
  if (personId === null) return null;
  const read = await deps.access.read(tx, { ...asking, personId });
  return read.ok ? nameOf(read.value.attributes) : null;
}

export async function runExportJob(
  tx: PostgresJsDatabase,
  deps: ExportJobDeps,
  request: ExportJobRequest,
): Promise<Result<ExportJobResult>> {
  // A job is its requester's act, run later: never one an administrator
  // viewing as somebody asked for, however it reached the queue.
  const may = writable(request.viewer);
  if (!may.ok) return may;
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

  const exportId = request.exportId ?? deps.newId();
  const now = deps.clock.instant();
  const shared = request.sharedWith ?? null;
  const expiresAt = new Date(
    Date.parse(now) + (shared === null ? LINK_LIFETIME_MS : SHARED_LIFETIME_MS),
  ).toISOString();
  // A scheduled report was asked for by nobody: it is made for its recipient.
  const scheduled = request.actor?.kind === 'system';
  const reasonGiven = request.reason?.trim() ?? '';
  const built = await buildExport(tx, deps, {
    ...request,
    about: {
      exportId,
      expiresOn: expiresAt.slice(0, 10),
      madeBy: scheduled ? null : await accountName(tx, deps, request, request.viewer.accountId),
      recipient:
        shared !== null
          ? await accountName(tx, deps, request, shared)
          : scheduled
            ? await accountName(tx, deps, request, request.viewer.accountId)
            : null,
      reason: reasonGiven === '' ? null : reasonGiven,
    },
  });
  if (!built.ok) return built;

  const checked = await checkReason(tx, deps, request, built.value.attributeKeys);
  if (!checked.ok) return checked;
  const reason = checked.value;

  const located = { tenantId: request.tenantId, exportId, sharedWith: shared };
  // Stored before the ledger row, so a crash between the two leaves a file
  // the sweep deletes and a job that is retried, never a row naming nothing.
  for (const file of built.value.files) {
    await deps.store.put(keyFor(located, file.name), file.bytes, file.mediaType);
  }
  const run: CompletedExport = {
    tenantId: request.tenantId,
    exportId,
    requestedBy: request.viewer.accountId,
    rowCount: built.value.rowCount,
    fileNames: built.value.files.map((f) => f.name),
    expiresAt,
    format: request.format,
    reason: reason === '' ? null : reason,
    attributeKeys: built.value.attributeKeys,
    sharedWith: shared,
    asOf: built.value.asOf,
    audience: built.value.audience,
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
      actor: request.actor ?? userActor(request.viewer),
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
