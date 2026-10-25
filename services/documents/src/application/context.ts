import {
  err,
  failure,
  ok,
  type DomainFailure,
  type PendingEvent,
  type Result,
} from '@kithena/domain-kit';
import {
  DocumentsActivityRecorded,
  type CalendarDate,
  type DocumentId,
  type Instant,
} from '@kithena/contracts';

import type { AccessFacts, Viewer } from '../domain/access/access.js';
import type { Document } from '../domain/document/document.js';
import type { DocumentType } from '../domain/type/document-type.js';
import type { Caller, Deps, Member, Tx } from './ports.js';

/**
 * What every use case starts from: who is asking, as the domain's `Viewer`,
 * today, and the envelope its events share.
 *
 * ponytail: "today" is UTC's. A grant ending on a date ends at UTC midnight,
 * a few hours off at the far zones; take the member's location zone when a
 * customer notices.
 */
/** An email a transaction asks for: sent once it has committed (`deliver`), never inside it. */
export type Mail = Parameters<NonNullable<Deps['mailer']>['notice']>[0];

export interface Ctx {
  readonly deps: Deps;
  readonly tx: Tx;
  /** Emails to send after the commit: a failed one never undoes what was signed. */
  readonly mail: Mail[];
  readonly caller: Caller;
  readonly viewer: Viewer;
  readonly member: Member | null;
  readonly today: CalendarDate;
  readonly at: Instant;
}

export async function contextOf(
  deps: Deps,
  tx: Tx,
  caller: Caller,
  /** Where the transaction's emails collect, for its caller to send after the commit. */
  mail: Mail[] = [],
): Promise<Ctx> {
  const member = caller.personId === null ? null : await tx.members.get(caller.personId);
  return {
    deps,
    tx,
    mail,
    caller,
    member,
    viewer: {
      accountId: caller.accountId,
      personId: caller.personId,
      teamKey: member?.teamKey ?? null,
      hr: await tx.hr.has(caller.accountId),
    },
    today: deps.clock.date('UTC'),
    at: deps.clock.instant(),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * A member acts as their account; an outside signer by link (`signer`) and
 * the seal (`system`) have none, so Documents is the actor for them. Another
 * module reads the envelope against the shared contract and would skip a
 * user without an account id.
 */
const actorOf = (accountId: string) =>
  UUID.test(accountId)
    ? ({ kind: 'user', userId: accountId } as const)
    : ({
        kind: 'system',
        process: `documents.${accountId === '' ? 'system' : accountId}`,
      } as const);

export function event(
  ctx: Ctx,
  name: string,
  aggregate: { type: string; id: string },
  payload: unknown,
): PendingEvent {
  return {
    eventId: ctx.deps.newId(),
    eventName: name,
    eventVersion: 1,
    tenantId: ctx.caller.tenantId,
    occurredAt: ctx.at,
    effectiveFrom: ctx.today,
    aggregate: { ...aggregate, version: 0 },
    actor: actorOf(ctx.caller.accountId),
    correlationId: ctx.caller.correlationId,
    causationId: null,
    payload,
  };
}

/** Each act Documents records, as the company's activity log says it (`docs/audit.md`). */
const SAID: Readonly<Record<string, string>> = {
  requested: 'Asked somebody for a document',
  access_granted: 'Granted a request to open a document',
  access_refused: 'Turned down a request to open a document',
  hold_placed: 'Placed a legal hold',
  hold_lifted: 'Lifted a legal hold',
  retention_deleted: 'Deleted a document at the end of its retention',
  type_saved: 'Saved a document type',
  settings_changed: 'Changed settings',
  sent_for_signature: 'Sent a document for signature',
  sealed: 'Sealed a signed document',
  uploaded: 'Uploaded a document',
  versioned: 'Uploaded a new version of a document',
  made_private: 'Made a document private',
  shared: 'Shared a document',
  protected: 'Protected a document',
  unprotected: 'Took a document’s protection off',
  renamed: 'Renamed a document',
  expiry_set: 'Set when a document expires',
  deleted: 'Deleted a document',
  restored: 'Restored a document',
  sent_for_acknowledgement: 'Sent a document to be acknowledged',
};

/**
 * One act: a line of the document's own history (`documents.activity`), and
 * the same act for the company's activity log (`documents.activity.recorded`),
 * in the same transaction. The log's line names the document by id, never by
 * its title: a title can say what the document is about.
 */
export async function record(
  ctx: Ctx,
  action: string,
  documentId: DocumentId | null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await ctx.tx.activity.add({
    id: ctx.deps.newId(),
    documentId,
    accountId: ctx.caller.accountId,
    action,
    detail,
    at: ctx.at,
  });
  const keys = Array.isArray(detail['keys']) ? (detail['keys'] as unknown[]).map(String) : [];
  await ctx.tx.outbox.publish([
    event(
      ctx,
      DocumentsActivityRecorded.name,
      { type: 'activity', id: ctx.deps.newId() },
      {
        area:
          action === 'type_saved' || action === 'settings_changed'
            ? 'settings'
            : action.startsWith('access_')
              ? 'access'
              : 'records',
        action: SAID[action] ?? 'Changed a document',
        detail: keys.length === 0 ? null : `Fields: ${keys.join(', ')}.`.slice(0, 500),
        subjectKind: documentId === null ? null : 'document',
        subjectId: documentId,
        subjectLabel: null,
        reason: null,
        outcome: 'done',
        via: 'App',
        ai: false,
      },
    ),
  ]);
}

/** What the access rules need, from the document and its type. */
export function factsOf(doc: Document, type: DocumentType | null): AccessFacts {
  return {
    ownerAccount: doc.ownerAccount,
    subjectPersonId: doc.subjectPersonId,
    filed: doc.typeKey !== null,
    audience: type?.audience ?? null,
    level: doc.level,
    confidential: doc.confidential,
    confidentialBy: doc.confidentialBy,
    grants: doc.grants,
    deleted: doc.deletedAt !== null,
  };
}

/** A document and its type, or NOT_FOUND; the same answer whether it is missing or closed. */
export async function load(
  ctx: Ctx,
  id: DocumentId,
): Promise<Result<{ doc: Document; type: DocumentType | null }>> {
  const doc = await ctx.tx.documents.get(id);
  if (doc === null) return err(notFound());
  const type = doc.typeKey === null ? null : await ctx.tx.types.get(doc.typeKey);
  return ok({ doc, type });
}

export const notFound = (): DomainFailure => failure('NOT_FOUND', 'No such document');

export const hrOnly = (ctx: Ctx): Result<true> =>
  ctx.viewer.hr ? ok(true) : err(failure('FORBIDDEN', 'Only HR can do this'));
