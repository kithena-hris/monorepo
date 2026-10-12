import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type {
  CalendarDate,
  DocumentId,
  DocumentTypeKey,
  Grantee,
  Permission,
  PersonId,
} from '@kithena/contracts';

import {
  canDelete,
  canDownload,
  canEdit,
  canOpen,
  canSetConfidential,
  canShare,
} from '../domain/access/access.js';
import {
  addVersion as nextVersion,
  checkFile,
  fileDocument,
  remove,
  rename as renamed,
  restore as restored,
  setConfidential as protect,
  share as shared,
  type Document,
  type Version,
} from '../domain/document/document.js';
import { contextOf, event, factsOf, load, notFound, record, type Ctx } from './context.js';
import { pageCount, sha256, watermark, watermarkable } from './files.js';
import type { Caller, Deps } from './ports.js';

/**
 * The document use cases (PRD §6–§9, DOC-019). Each runs in one tenant
 * transaction as its caller, asks the domain whether it may, writes, raises
 * its event into the outbox and records the activity log.
 */

export interface UploadedFile {
  readonly name: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

export interface UploadInput {
  readonly title: string;
  readonly typeKey: DocumentTypeKey | null;
  readonly subjectPersonId: PersonId | null;
  readonly sectionId: string | null;
  readonly expiresOn: CalendarDate | null;
  /** HR's request this answers, when the upload says so. */
  readonly requestId: string | null;
  readonly file: UploadedFile;
}

/**
 * The bytes, checked and stored before the row's transaction, under a key of
 * their own so a version number need not be known yet. The caller deletes
 * them when its transaction refuses; a crash between the two leaves an object
 * nothing names (ponytail: the nightly sweep can list and drop those).
 */
async function storeBytes(
  deps: Deps,
  caller: Caller,
  id: string,
  file: UploadedFile,
): Promise<Result<Omit<Version, 'n' | 'uploadedAt' | 'uploadedBy' | 'note'>>> {
  const fit = checkFile({ mediaType: file.mediaType, size: file.bytes.byteLength });
  if (!fit.ok) return fit;
  const key = `${caller.tenantId}/${id}/${deps.newId()}`;
  await deps.blobs.put(key, file.bytes, file.mediaType);
  return ok({
    blobKey: key,
    fileName: file.name.slice(0, 255) || 'file',
    mediaType: file.mediaType,
    size: file.bytes.byteLength,
    pages: await pageCount(file.bytes, file.mediaType),
    checksum: sha256(file.bytes),
  });
}

/** Runs `write` with the stored bytes, and drops them when it refuses. */
async function withBytes<T>(
  deps: Deps,
  caller: Caller,
  id: string,
  file: UploadedFile,
  write: (stored: Omit<Version, 'n' | 'uploadedAt' | 'uploadedBy' | 'note'>) => Promise<Result<T>>,
): Promise<Result<T>> {
  const stored = await storeBytes(deps, caller, id, file);
  if (!stored.ok) return stored;
  let result: Result<T>;
  try {
    result = await write(stored.value);
  } catch (error) {
    await deps.blobs.delete(stored.value.blobKey);
    throw error;
  }
  if (!result.ok) await deps.blobs.delete(stored.value.blobKey);
  return result;
}

/**
 * Who may file what (PRD §8.1): anyone files their own document; a typed
 * document is HR's, or the person's own when the type is filed to them (an
 * upload answering HR's request, a required document in onboarding).
 */
async function mayFile(ctx: Ctx, input: UploadInput): Promise<Result<true>> {
  if (input.typeKey === null) {
    return input.subjectPersonId === null
      ? ok(true)
      : err(failure('NEEDS_TYPE', 'A document about somebody needs a type', ['typeKey']));
  }
  const type = await ctx.tx.types.get(input.typeKey);
  if (type === null || type.archived) {
    return err(failure('NO_SUCH_TYPE', 'No such document type', ['typeKey']));
  }
  if (type.filedTo === 'person' && input.subjectPersonId === null) {
    return err(failure('NEEDS_PERSON', `A ${type.name} is filed to a person`, ['subjectPersonId']));
  }
  if (type.filedTo === 'company' && input.subjectPersonId !== null) {
    return err(failure('COMPANY_DOCUMENT', `A ${type.name} is about nobody`, ['subjectPersonId']));
  }
  if (
    input.subjectPersonId !== null &&
    (await ctx.tx.members.get(input.subjectPersonId)) === null
  ) {
    return err(failure('NO_SUCH_PERSON', 'Nobody by that id works here', ['subjectPersonId']));
  }
  if (ctx.viewer.hr) return ok(true);
  if (type.filedTo === 'person' && input.subjectPersonId === ctx.viewer.personId) return ok(true);
  return err(failure('FORBIDDEN', 'Only HR files this type'));
}

export async function upload(
  deps: Deps,
  caller: Caller,
  input: UploadInput,
): Promise<Result<{ id: DocumentId }>> {
  const id = deps.newId() as DocumentId;
  return withBytes(deps, caller, id, input.file, (stored) =>
    deps.uow.run(caller.tenantId, async (tx) => {
      const ctx = await contextOf(deps, tx, caller);
      const allowed = await mayFile(ctx, input);
      if (!allowed.ok) return allowed;
      const type = input.typeKey === null ? null : await tx.types.get(input.typeKey);
      const version: Version = {
        ...stored,
        n: 1,
        note: null,
        uploadedAt: ctx.at,
        uploadedBy: caller.accountId,
      };
      const filed = fileDocument({
        id,
        title: input.title,
        typeKey: input.typeKey,
        kind: type?.kind ?? 'Personal',
        ownerAccount: caller.accountId,
        subjectPersonId: input.subjectPersonId,
        confidentialByType: type?.confidential ?? false,
        expiresOn: input.expiresOn,
        version,
        at: ctx.at,
      });
      if (!filed.ok) return filed;
      const doc = filed.value;
      await tx.documents.save(doc);
      await tx.versions.add(id, version);
      if (input.sectionId !== null) {
        const section = await tx.sections.get(input.sectionId);
        const mine = section?.kind === 'personal' && section.ownerAccount === caller.accountId;
        if (mine || (section?.kind === 'company' && ctx.viewer.hr)) {
          await tx.sections.add(input.sectionId, id);
        }
      }
      const events = [
        event(
          ctx,
          'documents.document.filed',
          { type: 'Document', id },
          {
            documentId: id,
            typeKey: doc.typeKey,
            kind: doc.kind,
            ownerAccountId: caller.accountId,
            subjectPersonId: doc.subjectPersonId,
            level: doc.level,
            confidential: doc.confidential,
            pages: version.pages,
            expiresOn: doc.expiresOn,
          },
        ),
      ];
      // An upload answers the open request for its type and person, named or not (§7.4).
      if (doc.typeKey !== null && doc.subjectPersonId !== null) {
        const open = (await tx.docRequests.forPerson(doc.subjectPersonId)).find(
          (r) =>
            r.status === 'open' &&
            (r.id === input.requestId || (input.requestId === null && r.typeKey === doc.typeKey)),
        );
        if (open !== undefined) {
          await tx.docRequests.save({ ...open, status: 'fulfilled', documentId: id });
          events.push(
            event(
              ctx,
              'documents.request.fulfilled',
              { type: 'DocumentRequest', id: open.id },
              {
                requestId: open.id,
                personId: open.personId,
                documentId: id,
              },
            ),
          );
        }
      }
      await tx.outbox.publish(events);
      await record(ctx, 'uploaded', id, { version: 1 });
      return ok({ id });
    }),
  );
}

export async function addVersion(
  deps: Deps,
  caller: Caller,
  id: DocumentId,
  file: UploadedFile,
  note: string | null,
): Promise<Result<{ version: number }>> {
  return withBytes(deps, caller, id, file, (stored) =>
    deps.uow.run(caller.tenantId, async (tx) => {
      const ctx = await contextOf(deps, tx, caller);
      const found = await load(ctx, id);
      if (!found.ok) return found;
      const facts = factsOf(found.value.doc, found.value.type);
      if (!canOpen(facts, ctx.viewer, ctx.today)) return err(notFound());
      if (!canEdit(facts, ctx.viewer, ctx.today)) {
        return err(failure('FORBIDDEN', 'You can view this document but not change it'));
      }
      const version: Version = {
        ...stored,
        n: found.value.doc.currentVersion + 1,
        note: note?.trim().slice(0, 500) || null,
        uploadedAt: ctx.at,
        uploadedBy: caller.accountId,
      };
      const doc = nextVersion(found.value.doc, version);
      if (!doc.ok) return doc;
      await tx.documents.save(doc.value);
      await tx.versions.add(id, version);
      await tx.outbox.publish([
        event(
          ctx,
          'documents.document.versioned',
          { type: 'Document', id },
          {
            documentId: id,
            version: version.n,
            subjectPersonId: doc.value.subjectPersonId,
          },
        ),
      ]);
      await record(ctx, 'versioned', id, { version: version.n });
      return ok({ version: version.n });
    }),
  );
}

/** A change to a document its controller makes: share, protect, rename, delete, restore. */
async function change(
  deps: Deps,
  caller: Caller,
  id: DocumentId,
  run: (ctx: Ctx, doc: Document, facts: ReturnType<typeof factsOf>) => Promise<Result<Document>>,
): Promise<Result<Document>> {
  return deps.uow.run(caller.tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, caller);
    const found = await load(ctx, id);
    if (!found.ok) return found;
    const facts = factsOf(found.value.doc, found.value.type);
    if (!canOpen(facts, ctx.viewer, ctx.today)) return err(notFound());
    const next = await run(ctx, found.value.doc, facts);
    if (next.ok && next.value !== found.value.doc) await tx.documents.save(next.value);
    return next;
  });
}

export interface GrantInput {
  readonly grantee: Grantee;
  readonly permission: Permission;
  readonly endsOn: CalendarDate | null;
}

/** Replaces who it is shared with (E1); an empty list makes it Private. */
export function share(
  deps: Deps,
  caller: Caller,
  id: DocumentId,
  grants: readonly GrantInput[],
): Promise<Result<Document>> {
  return change(deps, caller, id, async (ctx, doc, facts) => {
    const may = canShare(facts, ctx.viewer);
    if (!may.ok) return may;
    // Sharing outside the type's audience on a filed document is HR's call, and HR's only.
    const everyone = grants.some((g) => g.grantee.kind === 'everyone');
    if (everyone && !ctx.viewer.hr && (await ctx.tx.settings.get('everyoneShare')) !== 'anyone') {
      return err(failure('HR_ONLY_EVERYONE', 'Only HR shares with everyone at the company'));
    }
    const next = shared(doc, grants);
    if (!next.ok) return next;
    const before = new Set(doc.grants.map((g) => JSON.stringify(g.grantee)));
    await ctx.tx.outbox.publish([
      ...grants
        .filter((g) => !before.has(JSON.stringify(g.grantee)))
        .map((g) =>
          event(
            ctx,
            'documents.document.shared',
            { type: 'Document', id },
            {
              documentId: id,
              grantee: g.grantee,
              permission: g.permission,
              endsOn: g.endsOn,
            },
          ),
        ),
      ...(next.value.level === doc.level ? [] : [accessChanged(ctx, next.value)]),
    ]);
    await record(ctx, grants.length === 0 ? 'made_private' : 'shared', id, {
      count: grants.length,
    });
    return next;
  });
}

const accessChanged = (ctx: Ctx, doc: Document) =>
  event(
    ctx,
    'documents.document.access_changed',
    { type: 'Document', id: doc.id },
    {
      documentId: doc.id,
      level: doc.level,
      confidential: doc.confidential,
      confidentialBy: doc.confidentialBy,
    },
  );

export function setConfidential(
  deps: Deps,
  caller: Caller,
  id: DocumentId,
  on: boolean,
): Promise<Result<Document>> {
  return change(deps, caller, id, async (ctx, doc, facts) => {
    const may = canSetConfidential(facts, ctx.viewer, on);
    if (!may.ok) return may;
    const by = ctx.viewer.hr && doc.typeKey !== null ? 'hr' : 'owner';
    const next = protect(doc, on, by);
    if (!next.ok || next.value === doc) return next;
    await ctx.tx.outbox.publish([accessChanged(ctx, next.value)]);
    await record(ctx, on ? 'protected' : 'unprotected', id);
    return next;
  });
}

export function rename(
  deps: Deps,
  caller: Caller,
  id: DocumentId,
  title: string,
): Promise<Result<Document>> {
  return change(deps, caller, id, async (ctx, doc, facts) => {
    if (!canEdit(facts, ctx.viewer, ctx.today)) {
      return err(failure('FORBIDDEN', 'You can view this document but not change it'));
    }
    const next = renamed(doc, title);
    if (next.ok) await record(ctx, 'renamed', id);
    return next;
  });
}

export function setExpiry(
  deps: Deps,
  caller: Caller,
  id: DocumentId,
  on: CalendarDate | null,
): Promise<Result<Document>> {
  return change(deps, caller, id, async (ctx, doc, facts) => {
    if (!canEdit(facts, ctx.viewer, ctx.today)) {
      return err(failure('FORBIDDEN', 'You can view this document but not change it'));
    }
    await record(ctx, 'expiry_set', id, { expiresOn: on });
    return ok({ ...doc, expiresOn: on });
  });
}

export function deleteDocument(
  deps: Deps,
  caller: Caller,
  id: DocumentId,
): Promise<Result<Document>> {
  return change(deps, caller, id, async (ctx, doc, facts) => {
    const may = canDelete(facts, ctx.viewer);
    if (!may.ok) return may;
    const held = (await ctx.tx.holds.held()).has(id);
    const next = remove(doc, ctx.at, held);
    if (!next.ok || next.value === doc) return next;
    await ctx.tx.outbox.publish([
      event(
        ctx,
        'documents.document.deleted',
        { type: 'Document', id },
        {
          documentId: id,
          subjectPersonId: doc.subjectPersonId,
        },
      ),
    ]);
    await record(ctx, 'deleted', id);
    return next;
  });
}

export function restoreDocument(
  deps: Deps,
  caller: Caller,
  id: DocumentId,
): Promise<Result<Document>> {
  return change(deps, caller, id, async (ctx, doc, facts) => {
    const may = canDelete(facts, ctx.viewer);
    if (!may.ok) return may;
    const next = restored(doc);
    if (!next.ok || next.value === doc) return next;
    await ctx.tx.outbox.publish([
      event(ctx, 'documents.document.restored', { type: 'Document', id }, { documentId: id }),
    ]);
    await record(ctx, 'restored', id);
    return next;
  });
}

export interface FileBody {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly fileName: string;
  /** Whether this is the original, rather than a watermarked copy. */
  readonly original: boolean;
}

/**
 * A version's bytes for this viewer (PRD §9). `view` draws a Confidential
 * document watermarked with the viewer's name and logs the open; `download`
 * hands the original only to whoever may download it, and logs that too.
 */
export async function content(
  deps: Deps,
  caller: Caller,
  id: DocumentId,
  input: {
    readonly version: number | null;
    readonly mode: 'view' | 'download';
    readonly device: string | null;
  },
): Promise<Result<FileBody>> {
  const found = await deps.uow.run(caller.tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, caller);
    const loaded = await load(ctx, id);
    if (!loaded.ok) return loaded;
    const { doc } = loaded.value;
    const facts = factsOf(doc, loaded.value.type);
    if (!canOpen(facts, ctx.viewer, ctx.today) || doc.deletedAt !== null) return err(notFound());
    if (input.mode === 'download' && !canDownload(facts, ctx.viewer, ctx.today)) {
      return err(failure('CONFIDENTIAL', 'Confidential: this document cannot be downloaded'));
    }
    const version = await tx.versions.get(id, input.version ?? doc.currentVersion);
    if (version === null) return err(failure('NOT_FOUND', 'No such version'));
    if (doc.confidential || input.mode === 'download') {
      await tx.views.add({
        id: deps.newId(),
        documentId: id,
        accountId: caller.accountId,
        action: input.mode,
        device: input.device?.slice(0, 200) ?? null,
        at: ctx.at,
      });
      if (doc.confidential) {
        await tx.outbox.publish([
          event(
            ctx,
            'documents.document.viewed_confidential',
            { type: 'Document', id },
            {
              documentId: id,
              viewerAccountId: caller.accountId,
              action: input.mode,
            },
          ),
        ]);
      }
    }
    // Every view of a Confidential document carries the viewer's name, even its own person's (MR4).
    const marked = doc.confidential && input.mode === 'view';
    const mayHaveOriginal = canDownload(facts, ctx.viewer, ctx.today);
    return ok({
      version,
      marked,
      mayHaveOriginal,
      name: ctx.member?.displayName ?? 'Kithena',
      today: ctx.today,
    });
  });
  if (!found.ok) return found;
  const { version, marked, mayHaveOriginal, name, today } = found.value;
  const bytes = await deps.blobs.get(version.blobKey);
  if (bytes === null) return err(failure('GONE', 'This file is no longer stored'));
  if (!marked) {
    return ok({ bytes, mediaType: version.mediaType, fileName: version.fileName, original: true });
  }
  if (!watermarkable(version.mediaType)) {
    // A spreadsheet cannot carry a watermark: its own people get the file, nobody else does.
    return mayHaveOriginal
      ? ok({ bytes, mediaType: version.mediaType, fileName: version.fileName, original: true })
      : err(failure('CONFIDENTIAL', 'This confidential file can only be downloaded by its people'));
  }
  return ok({
    bytes: await watermark(bytes, version.mediaType, `${name} · ${today}`),
    mediaType: 'application/pdf',
    fileName: version.fileName.replace(/\.[^.]+$/u, '') + '.pdf',
    original: false,
  });
}
