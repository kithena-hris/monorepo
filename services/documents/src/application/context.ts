import { err, failure, ok, type PendingEvent, type Result } from '@kithena/domain-kit';
import type { CalendarDate, DocumentId, Instant } from '@kithena/contracts';

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
export interface Ctx {
  readonly deps: Deps;
  readonly tx: Tx;
  readonly caller: Caller;
  readonly viewer: Viewer;
  readonly member: Member | null;
  readonly today: CalendarDate;
  readonly at: Instant;
}

export async function contextOf(deps: Deps, tx: Tx, caller: Caller): Promise<Ctx> {
  const member = caller.personId === null ? null : await tx.members.get(caller.personId);
  return {
    deps,
    tx,
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
    actor: { kind: 'user', userId: ctx.caller.accountId },
    correlationId: ctx.caller.correlationId,
    causationId: null,
    payload,
  };
}

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

export const notFound = () => failure('NOT_FOUND', 'No such document');

export const hrOnly = (ctx: Ctx): Result<true> =>
  ctx.viewer.hr ? ok(true) : err(failure('FORBIDDEN', 'Only HR can do this'));
