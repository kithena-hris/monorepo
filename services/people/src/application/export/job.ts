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
 * This is the job's body. Whether a transport awaits it (a small export) or
 * queues it (over 2,000 rows) is the transport's decision, and no transport
 * or queue exists in this module yet; the delivery is the same link either
 * way.
 */

export const LINK_LIFETIME_MS = 24 * 60 * 60 * 1000;

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

export interface ExportJobDeps extends ExportDeps {
  readonly store: ObjectStore;
  readonly notifier: ExportNotifier;
  readonly audit: ExportAudit;
  readonly newId: () => string;
}

export interface ExportJobRequest extends ExportRequest {
  /** Required when the file would carry a financial attribute. */
  readonly reason?: string | null;
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

export async function runExportJob(
  tx: PostgresJsDatabase,
  deps: ExportJobDeps,
  request: ExportJobRequest,
): Promise<Result<ExportJobResult>> {
  const built = await buildExport(tx, deps, request);
  if (!built.ok) return built;

  const version = await deps.schemas.current(tx, request.tenantId);
  const byKey = new Map<string, AttributeDefinition>(
    version?.document.attributes.map((d) => [d.key, d]),
  );
  const financial = built.value.attributeKeys.filter((k) => {
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

  const exportId = deps.newId();
  const now = deps.clock.instant();
  const expiresAt = new Date(Date.parse(now) + LINK_LIFETIME_MS).toISOString();

  const links: { name: string; url: string }[] = [];
  for (const file of built.value.files) {
    const key = `${request.tenantId}/exports/${exportId}/${file.name}`;
    await deps.store.put(key, file.bytes, file.mediaType);
    links.push({ name: file.name, url: await deps.store.sign(key, expiresAt) });
  }

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
