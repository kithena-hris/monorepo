import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { CalendarDate, DocumentId, DocumentTypeKey, PersonId } from '@kithena/contracts';

import { canOpen, canShare } from '../domain/access/access.js';
import { remove, type Document } from '../domain/document/document.js';
import { dueForDeletion, trashOver } from '../domain/queues/queues.js';
import { checkType, SEEDED_TYPES } from '../domain/type/document-type.js';
import { contextOf, event, factsOf, hrOnly, load, notFound, record, type Ctx } from './context.js';
import type { Caller, Deps, Section } from './ports.js';

/**
 * Sections, requests, holds, retention, types and settings (PRD §7, §12).
 */

const inCtx = <T>(deps: Deps, caller: Caller, fn: (ctx: Ctx) => Promise<Result<T>>) =>
  deps.uow.run(caller.tenantId, async (tx) => fn(await contextOf(deps, tx, caller)));

/* --------------------------------------------------------------- sections -- */

/** A personal section is anyone's; a company section is HR's (PRD §7.2). */
export function createSection(
  deps: Deps,
  caller: Caller,
  input: { name: string; kind: 'personal' | 'company'; documentIds: readonly DocumentId[] },
): Promise<Result<{ id: string }>> {
  return inCtx(deps, caller, async (ctx) => {
    const name = input.name.trim();
    if (name.length === 0 || name.length > 60) {
      return err(failure('BAD_NAME', 'A name of 1 to 60 characters', ['name']));
    }
    if (input.kind === 'company') {
      const hr = hrOnly(ctx);
      if (!hr.ok) return hr;
    } else if ((await ctx.tx.settings.get('personalSections')) === false) {
      return err(failure('SECTIONS_OFF', 'Personal sections are switched off here'));
    }
    const section: Section = {
      id: deps.newId(),
      kind: input.kind,
      ownerAccount: input.kind === 'personal' ? caller.accountId : null,
      name,
    };
    await ctx.tx.sections.save(section);
    for (const id of input.documentIds) {
      // A shortcut, never a copy, and only to what this person can open.
      const added = await addEntry(ctx, section, id);
      if (!added.ok) return added;
    }
    return ok({ id: section.id });
  });
}

async function addEntry(ctx: Ctx, section: Section, id: DocumentId): Promise<Result<true>> {
  const found = await load(ctx, id);
  if (!found.ok || !canOpen(factsOf(found.value.doc, found.value.type), ctx.viewer, ctx.today)) {
    return err(notFound());
  }
  await ctx.tx.sections.add(section.id, id);
  return ok(true);
}

async function ownSection(ctx: Ctx, id: string): Promise<Result<Section>> {
  const section = await ctx.tx.sections.get(id);
  if (section === null) return err(failure('NOT_FOUND', 'No such section'));
  const mine = section.kind === 'personal' && section.ownerAccount === ctx.caller.accountId;
  if (section.kind === 'personal' && !mine) return err(failure('NOT_FOUND', 'No such section'));
  if (section.kind === 'company' && !ctx.viewer.hr) {
    return err(failure('FORBIDDEN', 'Only HR changes company sections'));
  }
  return ok(section);
}

export function changeSection(
  deps: Deps,
  caller: Caller,
  id: string,
  input: {
    name?: string | undefined;
    add?: readonly DocumentId[] | undefined;
    remove?: readonly DocumentId[] | undefined;
    delete?: boolean | undefined;
  },
): Promise<Result<{ id: string }>> {
  return inCtx(deps, caller, async (ctx) => {
    const found = await ownSection(ctx, id);
    if (!found.ok) return found;
    if (input.delete === true) {
      await ctx.tx.sections.remove(id);
      return ok({ id });
    }
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (name.length === 0 || name.length > 60) {
        return err(failure('BAD_NAME', 'A name of 1 to 60 characters', ['name']));
      }
      await ctx.tx.sections.save({ ...found.value, name });
    }
    for (const doc of input.add ?? []) {
      const added = await addEntry(ctx, found.value, doc);
      if (!added.ok) return added;
    }
    for (const doc of input.remove ?? []) await ctx.tx.sections.removeEntry(id, doc);
    return ok({ id });
  });
}

/* ------------------------------------------------------- document requests -- */

/** HR asks a person for a document (H2): a task in their Inbox until an upload answers it. */
export function askForDocument(
  deps: Deps,
  caller: Caller,
  input: {
    personId: PersonId;
    typeKey: DocumentTypeKey;
    dueOn: CalendarDate | null;
    message: string;
  },
): Promise<Result<{ id: string }>> {
  return inCtx(deps, caller, async (ctx) => {
    const hr = hrOnly(ctx);
    if (!hr.ok) return hr;
    const type = await ctx.tx.types.get(input.typeKey);
    if (type === null || type.filedTo !== 'person') {
      return err(failure('NO_SUCH_TYPE', 'Ask for a type filed to a person', ['typeKey']));
    }
    if ((await ctx.tx.members.get(input.personId)) === null) {
      return err(failure('NO_SUCH_PERSON', 'Nobody by that id works here', ['personId']));
    }
    const already = (await ctx.tx.docRequests.forPerson(input.personId)).find(
      (r) => r.status === 'open' && r.typeKey === input.typeKey,
    );
    if (already !== undefined) return ok({ id: already.id });
    const id = deps.newId();
    await ctx.tx.docRequests.save({
      id,
      personId: input.personId,
      typeKey: input.typeKey,
      dueOn: input.dueOn,
      message: input.message.trim().slice(0, 2000),
      status: 'open',
      createdBy: caller.accountId,
      createdAt: ctx.at,
      remindedAt: null,
      documentId: null,
    });
    await ctx.tx.outbox.publish([
      event(
        ctx,
        'documents.request.created',
        { type: 'DocumentRequest', id },
        {
          requestId: id,
          personId: input.personId,
          typeKey: input.typeKey,
          dueOn: input.dueOn,
        },
      ),
    ]);
    await record(ctx, 'requested', null, { requestId: id });
    return ok({ id });
  });
}

export function remindRequest(
  deps: Deps,
  caller: Caller,
  id: string,
): Promise<Result<{ id: string }>> {
  return inCtx(deps, caller, async (ctx) => {
    const hr = hrOnly(ctx);
    if (!hr.ok) return hr;
    const request = await ctx.tx.docRequests.get(id);
    if (request === null || request.status !== 'open') {
      return err(failure('NOT_FOUND', 'No open request'));
    }
    await ctx.tx.docRequests.save({ ...request, remindedAt: ctx.at });
    return ok({ id });
  });
}

export function cancelRequest(
  deps: Deps,
  caller: Caller,
  id: string,
): Promise<Result<{ id: string }>> {
  return inCtx(deps, caller, async (ctx) => {
    const hr = hrOnly(ctx);
    if (!hr.ok) return hr;
    const request = await ctx.tx.docRequests.get(id);
    if (request === null || request.status !== 'open') {
      return err(failure('NOT_FOUND', 'No open request'));
    }
    await ctx.tx.docRequests.save({ ...request, status: 'cancelled' });
    await ctx.tx.outbox.publish([
      event(
        ctx,
        'documents.request.cancelled',
        { type: 'DocumentRequest', id },
        {
          requestId: id,
          personId: request.personId,
        },
      ),
    ]);
    return ok({ id });
  });
}

/* --------------------------------------------------------- access requests -- */

/** E3: a request for a document you cannot open; its owner gets a task. */
export function requestAccess(
  deps: Deps,
  caller: Caller,
  documentId: DocumentId,
  reason: string,
): Promise<Result<{ id: string }>> {
  return inCtx(deps, caller, async (ctx) => {
    const found = await load(ctx, documentId);
    if (!found.ok || found.value.doc.deletedAt !== null) return err(notFound());
    if (canOpen(factsOf(found.value.doc, found.value.type), ctx.viewer, ctx.today)) {
      return err(failure('ALREADY_OPEN', 'You can already open this'));
    }
    const text = reason.trim();
    if (text.length === 0 || text.length > 1000) {
      return err(failure('BAD_REASON', 'Say why, in up to 1,000 characters', ['reason']));
    }
    const open = (await ctx.tx.accessRequests.open()).find(
      (r) => r.documentId === documentId && r.requesterAccount === caller.accountId,
    );
    if (open !== undefined) return ok({ id: open.id });
    const id = deps.newId();
    await ctx.tx.accessRequests.save({
      id,
      documentId,
      requesterAccount: caller.accountId,
      reason: text,
      status: 'open',
      createdAt: ctx.at,
      decidedAt: null,
      decidedBy: null,
    });
    await ctx.tx.outbox.publish([
      event(
        ctx,
        'documents.access.requested',
        { type: 'AccessRequest', id },
        {
          requestId: id,
          documentId,
          requesterAccountId: caller.accountId,
        },
      ),
    ]);
    return ok({ id });
  });
}

export function decideAccess(
  deps: Deps,
  caller: Caller,
  id: string,
  grant: boolean,
): Promise<Result<{ id: string }>> {
  return inCtx(deps, caller, async (ctx) => {
    const request = await ctx.tx.accessRequests.get(id);
    if (request === null || request.status !== 'open') {
      return err(failure('NOT_FOUND', 'No open access request'));
    }
    const found = await load(ctx, request.documentId);
    if (!found.ok) return found;
    const { doc } = found.value;
    const may = canShare(factsOf(doc, found.value.type), ctx.viewer);
    if (!may.ok) return may;
    if (grant) {
      const member = await ctx.tx.members.byAccount(request.requesterAccount);
      if (member === null) return err(failure('NO_SUCH_PERSON', 'They no longer work here'));
      const grantee = { kind: 'member' as const, personId: member.personId };
      const others = doc.grants.filter(
        (g) => JSON.stringify(g.grantee) !== JSON.stringify(grantee),
      );
      await ctx.tx.documents.save({
        ...doc,
        level: 'shared',
        grants: [...others, { grantee, permission: 'view', endsOn: null }],
      });
    }
    await ctx.tx.accessRequests.save({
      ...request,
      status: grant ? 'granted' : 'refused',
      decidedAt: ctx.at,
      decidedBy: caller.accountId,
    });
    await ctx.tx.outbox.publish([
      event(
        ctx,
        'documents.access.decided',
        { type: 'AccessRequest', id },
        {
          requestId: id,
          documentId: doc.id,
          granted: grant,
        },
      ),
    ]);
    await record(ctx, grant ? 'access_granted' : 'access_refused', doc.id);
    return ok({ id });
  });
}

/* ------------------------------------------------- holds and retention (H3) -- */

export function placeHold(
  deps: Deps,
  caller: Caller,
  input: { name: string; documentIds: readonly DocumentId[] },
): Promise<Result<{ id: string }>> {
  return inCtx(deps, caller, async (ctx) => {
    const hr = hrOnly(ctx);
    if (!hr.ok) return hr;
    const name = input.name.trim();
    if (name.length === 0 || name.length > 80) {
      return err(failure('BAD_NAME', 'Name the case, in up to 80 characters', ['name']));
    }
    if (input.documentIds.length === 0) {
      return err(failure('NO_DOCUMENTS', 'A hold keeps at least one document', ['documentIds']));
    }
    const id = deps.newId();
    await ctx.tx.holds.save({
      id,
      name,
      setBy: caller.accountId,
      setAt: ctx.at,
      liftedAt: null,
      documentIds: [...new Set(input.documentIds)],
    });
    await ctx.tx.outbox.publish([
      event(
        ctx,
        'documents.hold.placed',
        { type: 'LegalHold', id },
        {
          holdId: id,
          documentIds: [...new Set(input.documentIds)],
        },
      ),
    ]);
    await record(ctx, 'hold_placed', null, { holdId: id });
    return ok({ id });
  });
}

export function liftHold(deps: Deps, caller: Caller, id: string): Promise<Result<{ id: string }>> {
  return inCtx(deps, caller, async (ctx) => {
    const hr = hrOnly(ctx);
    if (!hr.ok) return hr;
    const hold = await ctx.tx.holds.get(id);
    if (hold === null || hold.liftedAt !== null) return err(failure('NOT_FOUND', 'No such hold'));
    await ctx.tx.holds.save({ ...hold, liftedAt: ctx.at });
    await ctx.tx.outbox.publish([
      event(ctx, 'documents.hold.lifted', { type: 'LegalHold', id }, { holdId: id }),
    ]);
    await record(ctx, 'hold_lifted', null, { holdId: id });
    return ok({ id });
  });
}

/** HR confirms the documents whose retention ended (PRD §12.3): they go to Deleted. */
export function confirmRetention(
  deps: Deps,
  caller: Caller,
  documentIds: readonly DocumentId[],
): Promise<Result<{ deleted: number }>> {
  return inCtx(deps, caller, async (ctx) => {
    const hr = hrOnly(ctx);
    if (!hr.ok) return hr;
    const due = await retentionDue(ctx);
    const ids = new Set(documentIds);
    let deleted = 0;
    for (const doc of due.filter((d) => ids.has(d.id))) {
      const next = remove(doc, ctx.at, false);
      if (!next.ok) continue;
      await ctx.tx.documents.save(next.value);
      await ctx.tx.outbox.publish([
        event(
          ctx,
          'documents.document.deleted',
          { type: 'Document', id: doc.id },
          {
            documentId: doc.id,
            subjectPersonId: doc.subjectPersonId,
          },
        ),
      ]);
      await record(ctx, 'retention_deleted', doc.id);
      deleted += 1;
    }
    return ok({ deleted });
  });
}

/** Filed documents whose retention has ended, with the date it did. */
export async function retentionDue(
  ctx: Ctx,
): Promise<(Document & { held: boolean; retentionEnded: CalendarDate })[]> {
  const [docs, types, held, members] = await Promise.all([
    ctx.tx.documents.filed(),
    ctx.tx.types.list(),
    ctx.tx.holds.held(),
    ctx.tx.members.list(),
  ]);
  const left = new Map(members.map((m) => [m.personId as string, m.terminationDate]));
  return dueForDeletion(
    docs.map((d) => ({ ...d, held: held.has(d.id) })),
    new Map(types.map((t) => [t.key as string, t])),
    (p) => left.get(p) ?? null,
    ctx.today,
  );
}

/**
 * The nightly sweep: deleted documents past their 30 days lose their bytes.
 * The row stays, with its activity, so the log can still say what was there.
 */
export async function sweepTrash(
  deps: Deps,
  tenantId: Caller['tenantId'],
): Promise<{ destroyed: number }> {
  const system: Caller = {
    tenantId,
    accountId: 'system',
    personId: null,
    correlationId: deps.newId(),
  };
  const doomed = await deps.uow.run(tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, system);
    const held = await tx.holds.held();
    const docs = await tx.documents.candidates({
      accountId: '',
      personId: null,
      teamKey: null,
      hr: true,
    });
    const over = trashOver(
      docs.map((d) => ({ ...d, held: held.has(d.id) })),
      ctx.today,
    );
    return Promise.all(
      over.map(async (d) => ({ doc: d, versions: await tx.versions.list(d.id), ctx })),
    );
  });
  for (const { doc, versions, ctx } of doomed) {
    for (const v of versions) await deps.blobs.delete(v.blobKey);
    await deps.uow.run(tenantId, async (tx) => {
      await tx.outbox.publish([
        event(
          { ...ctx, tx },
          'documents.document.destroyed',
          { type: 'Document', id: doc.id },
          {
            documentId: doc.id,
            reason: 'trash',
          },
        ),
      ]);
    });
  }
  return { destroyed: doomed.length };
}

/* ------------------------------------------------------------------ types -- */

export function saveType(
  deps: Deps,
  caller: Caller,
  input: unknown,
  archived = false,
): Promise<Result<{ key: string }>> {
  return inCtx(deps, caller, async (ctx) => {
    const hr = hrOnly(ctx);
    if (!hr.ok) return hr;
    const type = checkType(input);
    if (!type.ok) return type;
    await ctx.tx.types.save(type.value, archived);
    await ctx.tx.outbox.publish([
      event(
        ctx,
        'documents.type.changed',
        { type: 'DocumentType', id: type.value.key },
        {
          typeKey: type.value.key,
          archived,
        },
      ),
    ]);
    await record(ctx, 'type_saved', null, { typeKey: type.value.key });
    return ok({ key: type.value.key });
  });
}

/** The fourteen types, for a company that has none yet. Idempotent. */
export async function seedTypes(deps: Deps, tenantId: Caller['tenantId']): Promise<void> {
  await deps.uow.run(tenantId, async (tx) => {
    const have = new Set((await tx.types.list()).map((t) => t.key as string));
    for (const type of SEEDED_TYPES) if (!have.has(type.key)) await tx.types.save(type, false);
  });
}

/* --------------------------------------------------------------- settings -- */

/** The company's access defaults (S5): HR's to change. */
export const ACCESS_SETTINGS = {
  askAfterUpload: true,
  peopleMayTurnOffQuestion: true,
  everyoneShare: 'hr',
  companyLinks: true,
  outsideSharing: false,
  watermark: true,
  blockDownload: true,
  personalSections: true,
} as const;

export type AccessSettings = {
  -readonly [K in keyof typeof ACCESS_SETTINGS]: (typeof ACCESS_SETTINGS)[K] extends boolean
    ? boolean
    : 'hr' | 'anyone';
};

export async function accessSettings(ctx: Ctx): Promise<AccessSettings> {
  const out: Record<string, unknown> = { ...ACCESS_SETTINGS };
  for (const key of Object.keys(ACCESS_SETTINGS)) {
    const value = await ctx.tx.settings.get(key);
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out as AccessSettings;
}

export function setAccessSettings(
  deps: Deps,
  caller: Caller,
  input: Partial<AccessSettings>,
): Promise<Result<AccessSettings>> {
  return inCtx(deps, caller, async (ctx) => {
    const hr = hrOnly(ctx);
    if (!hr.ok) return hr;
    for (const [key, value] of Object.entries(input)) {
      if (key in ACCESS_SETTINGS) await ctx.tx.settings.set(key, value);
    }
    await record(ctx, 'settings_changed', null, { keys: Object.keys(input) });
    return ok(await accessSettings(ctx));
  });
}

/** One person's own choice: no share question after their uploads (C3). */
export function setAskAfterUpload(
  deps: Deps,
  caller: Caller,
  ask: boolean,
): Promise<Result<{ ask: boolean }>> {
  return inCtx(deps, caller, async (ctx) => {
    await ctx.tx.settings.set(`ask:${caller.accountId}`, ask);
    return ok({ ask });
  });
}
