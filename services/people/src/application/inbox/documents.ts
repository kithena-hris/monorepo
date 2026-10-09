import { createHash } from 'node:crypto';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { readFieldFile, type FileMediaType } from '../../domain/person/file.js';
import { discard, finishUpload, startUpload, type UploadDeps } from '../import/upload.js';
import type { Asking } from '../person/person-access.js';
import { run } from '../person/service.js';
import type { ImportUploadView } from '../screens/operations.js';
import type { FileView } from '../screens/files.js';
import type { ScreenDeps, Tx } from '../screens/record.js';

/**
 * A document sent to somebody (H3, C3, C4, D2, F1). Whoever sends it decides
 * what the person does with it, and so whether it reaches them as a task or
 * an update: keep it (filed, news), read and acknowledge it, or sign it, and
 * then whoever countersigns it does. It stays the person's, under Documents.
 *
 * Only HR sends one. It is read by the person, whoever sent it, whoever
 * countersigns it, and HR; anybody else is told it is not found.
 *
 * ponytail: a signature is recorded beside the file (who, how, when, where),
 * not stamped into it; stamping the PDF is the upgrade if a signed copy has to
 * travel on its own.
 */

export type DocumentMode = 'keep' | 'acknowledge' | 'sign';
export type DocumentState =
  'open' | 'kept' | 'acknowledged' | 'signed' | 'countersigned' | 'declined' | 'cancelled';

export interface Signature {
  readonly name: string;
  readonly how: 'typed' | 'drawn';
  /** The typed name, or the drawn strokes as an SVG path. */
  readonly mark: string;
  readonly at: string;
  readonly place: string | null;
}

export interface SentDocument {
  readonly id: string;
  readonly personId: string;
  readonly name: string;
  readonly mediaType: FileMediaType;
  readonly size: number;
  readonly mode: DocumentMode;
  readonly message: string | null;
  readonly dueOn: string | null;
  readonly sentBy: string;
  readonly sentAt: string;
  readonly countersigner: string | null;
  readonly state: DocumentState;
  readonly signature: Signature | null;
  readonly countersignedBy: string | null;
  readonly countersignedName: string | null;
  readonly countersignedAt: string | null;
  readonly note: string | null;
  readonly closedAt: string | null;
}

export interface DocumentStore {
  insert(
    tx: Tx,
    tenantId: string,
    document: SentDocument,
    file: { readonly bytes: Uint8Array; readonly checksum: string },
  ): Promise<void>;
  find(tx: Tx, tenantId: string, id: string): Promise<SentDocument | null>;
  bytes(tx: Tx, tenantId: string, id: string): Promise<Uint8Array | null>;
  /** One person's documents, newest first. */
  forPerson(tx: Tx, tenantId: string, personId: string): Promise<readonly SentDocument[]>;
  /** What an account sent, or has to countersign, since an instant, newest first. */
  involving(
    tx: Tx,
    tenantId: string,
    accountId: string,
    since: string,
  ): Promise<readonly SentDocument[]>;
  /** Move it on from `from`; false when somebody moved it first. */
  move(
    tx: Tx,
    tenantId: string,
    id: string,
    from: DocumentState,
    to: Pick<SentDocument, 'state' | 'note' | 'closedAt'> & {
      readonly signature?: Signature;
      readonly countersigned?: { readonly by: string; readonly name: string; readonly at: string };
    },
  ): Promise<boolean>;
}

export interface DocumentDeps {
  readonly store: DocumentStore;
  readonly uploads: Pick<UploadDeps, 'store' | 'intents'>;
  readonly newId: () => string;
}

/** What a document may be: a PDF or a photo of one, up to 25 MB. */
const RULES = {
  kind: 'document_ref' as const,
  accepts: ['application/pdf', 'image/png', 'image/jpeg'],
  maxBytes: 25 * 1024 * 1024,
};

const unavailable = () => err(failure('UNAVAILABLE', 'Documents are not available here'));
const missing = () => err(failure('NOT_FOUND', 'No such document'));
const words = (s: string | null | undefined, max: number): string | null => {
  const t = (s ?? '').trim();
  return t === '' ? null : t.slice(0, max);
};

const uploadDeps = (deps: ScreenDeps, d: DocumentDeps): UploadDeps => ({
  ...d.uploads,
  clock: deps.clock,
  newId: d.newId,
});
const inTx =
  (deps: ScreenDeps, asking: Asking) =>
  <T>(fn: (tx: Tx) => Promise<Result<T>>): Promise<Result<T>> =>
    run(deps.service, asking.tenantId, fn);
const who = (asking: Asking) => ({ tenantId: asking.tenantId, actorId: asking.viewer.accountId });

/** HR may send a document to somebody they may read. */
async function maySend(deps: ScreenDeps, tx: Tx, asking: Asking, personId: string) {
  const read = await deps.service.access.read(tx, { ...asking, personId });
  if (!read.ok) return read;
  const relations = await deps.relations.relations(tx, asking.tenantId, asking.viewer, personId);
  return relations.isHr || relations.isAdmin
    ? ok(undefined)
    : err(failure('FORBIDDEN', 'Only HR sends documents'));
}

/** Where to put the document's file: a presigned PUT, once (H3's upload). */
export async function startDocumentUpload(
  deps: ScreenDeps,
  asking: Asking,
  input: { readonly personId: string; readonly name: string; readonly size: number },
): Promise<Result<ImportUploadView>> {
  const d = deps.documents;
  if (d === undefined) return unavailable();
  const allowed = await run(deps.service, asking.tenantId, (tx) =>
    maySend(deps, tx, asking, input.personId),
  );
  if (!allowed.ok) return allowed;
  if (input.size > RULES.maxBytes) {
    return err(failure('FILE_TOO_LARGE', 'Documents are up to 25 MB', ['size']));
  }
  return startUpload(uploadDeps(deps, d), inTx(deps, asking), who(asking), {
    name: input.name,
    size: input.size,
    purpose: 'document',
  });
}

/**
 * Send it (H3): the uploaded file, kept with what the person is to do with
 * it. "Just keep it" is filed at once and reaches them as news.
 */
export async function sendDocument(
  deps: ScreenDeps,
  asking: Asking,
  input: {
    readonly personId: string;
    readonly uploadId: string;
    readonly mode: DocumentMode;
    readonly message?: string | null;
    readonly dueOn?: string | null;
    /** Whoever sends it countersigns it after them (a signed one only). */
    readonly countersign?: boolean;
  },
): Promise<Result<{ readonly id: string }>> {
  const d = deps.documents;
  if (d === undefined) return unavailable();
  const allowed = await run(deps.service, asking.tenantId, (tx) =>
    maySend(deps, tx, asking, input.personId),
  );
  if (!allowed.ok) return allowed;
  const finished = await finishUpload(
    uploadDeps(deps, d),
    inTx(deps, asking),
    who(asking),
    input.uploadId,
    'document',
  );
  if (!finished.ok) return finished;
  await discard(uploadDeps(deps, d), inTx(deps, asking), finished.value.intent);
  const file = readFieldFile(finished.value.bytes, RULES);
  if (!file.ok) return file;
  const now = deps.clock.instant();
  const keep = input.mode === 'keep';
  const document: SentDocument = {
    id: d.newId(),
    personId: input.personId,
    name: finished.value.intent.name,
    mediaType: file.value.mediaType,
    size: file.value.bytes.byteLength,
    mode: input.mode,
    message: words(input.message, 2000),
    dueOn: keep ? null : (input.dueOn ?? null),
    sentBy: asking.viewer.accountId,
    sentAt: now,
    countersigner: input.mode === 'sign' && input.countersign === true ? asking.viewer.accountId : null,
    state: keep ? 'kept' : 'open',
    signature: null,
    countersignedBy: null,
    countersignedName: null,
    countersignedAt: null,
    note: null,
    closedAt: keep ? now : null,
  };
  return run(deps.service, asking.tenantId, async (tx) => {
    await d.store.insert(tx, asking.tenantId, document, {
      bytes: file.value.bytes,
      checksum: createHash('sha256').update(file.value.bytes).digest('hex'),
    });
    return ok({ id: document.id });
  });
}

/** The document and how the viewer stands to it, or not found. */
async function standing(deps: ScreenDeps, tx: Tx, asking: Asking, id: string) {
  const d = deps.documents;
  if (d === undefined) return unavailable();
  const document = await d.store.find(tx, asking.tenantId, id);
  if (document === null) return missing();
  const me = asking.viewer.accountId;
  const self = await deps.personOf(tx, asking.tenantId, me);
  const mine = self !== null && self === document.personId;
  const sent = document.sentBy === me;
  const counter = document.countersigner === me;
  const hr =
    !mine && !sent && !counter
      ? (await deps.relations.relations(tx, asking.tenantId, asking.viewer, document.personId)).isHr
      : false;
  if (!mine && !sent && !counter && !hr) return missing();
  return ok({ document, mine, sent, counter, store: d.store });
}

/** The file itself, for whoever may read it (C3's preview, F1's download). */
export async function documentFile(
  deps: ScreenDeps,
  asking: Asking,
  id: string,
): Promise<Result<FileView>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const found = await standing(deps, tx, asking, id);
    if (!found.ok) return found;
    const bytes = await found.value.store.bytes(tx, asking.tenantId, id);
    if (bytes === null) return missing();
    return ok({
      name: found.value.document.name,
      mediaType: found.value.document.mediaType,
      data: Buffer.from(bytes).toString('base64'),
    });
  });
}

/** A person's documents, for their profile's Documents: for whoever may read them. */
export async function documentsOf(
  deps: ScreenDeps,
  asking: Asking,
  personId: string | null,
): Promise<Result<readonly SentDocument[]>> {
  const d = deps.documents;
  if (d === undefined) return ok([]);
  return run(deps.service, asking.tenantId, async (tx) => {
    const self = await deps.personOf(tx, asking.tenantId, asking.viewer.accountId);
    const id = personId ?? self;
    if (id === null) return ok([]);
    const read = await deps.service.access.read(tx, { ...asking, personId: id });
    if (!read.ok) return read;
    const relations = await deps.relations.relations(tx, asking.tenantId, asking.viewer, id);
    if (!relations.isSelf && !relations.isHr) return ok([]);
    const all = await d.store.forPerson(tx, asking.tenantId, id);
    return ok(all.filter((x) => x.state !== 'cancelled'));
  });
}

/** Where the signer is, as their company's calendar names it: "Madrid". */
async function placeOf(deps: ScreenDeps, tx: Tx, tenantId: string): Promise<string | null> {
  const zone = (await deps.calendars.load(tx, tenantId)).defaultZone;
  const city = zone.split('/').at(-1);
  return city === undefined || city === '' ? null : city.replaceAll('_', ' ');
}

/** C3's Acknowledge: the person confirms they read it. */
export async function acknowledgeDocument(
  deps: ScreenDeps,
  asking: Asking,
  id: string,
): Promise<Result<{ readonly state: DocumentState }>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const found = await standing(deps, tx, asking, id);
    if (!found.ok) return found;
    const { document, mine, store } = found.value;
    if (!mine || document.mode !== 'acknowledge') {
      return err(failure('FORBIDDEN', 'This is not yours to acknowledge'));
    }
    const moved = await store.move(tx, asking.tenantId, id, 'open', {
      state: 'acknowledged',
      note: null,
      closedAt: deps.clock.instant(),
    });
    return moved ? ok({ state: 'acknowledged' as const }) : err(failure('CLOSED', 'It is closed'));
  });
}

const SignatureInput = (input: {
  readonly name: string;
  readonly how: 'typed' | 'drawn';
  readonly mark: string;
}): Result<{ name: string; how: 'typed' | 'drawn'; mark: string }> => {
  const name = words(input.name, 200);
  const mark = input.how === 'typed' ? name : words(input.mark, 20_000);
  if (name === null) return err(failure('NAME_REQUIRED', 'Type your full name', ['name']));
  if (mark === null) return err(failure('SIGNATURE_REQUIRED', 'Draw your signature', ['mark']));
  return ok({ name, how: input.how, mark });
};

/**
 * C4: the person signs, typed or drawn; the time, place and name are kept.
 * With a countersigner it then waits on them as their task.
 */
export async function signDocument(
  deps: ScreenDeps,
  asking: Asking,
  id: string,
  input: { readonly name: string; readonly how: 'typed' | 'drawn'; readonly mark: string },
): Promise<Result<{ readonly state: DocumentState }>> {
  const signed = SignatureInput(input);
  if (!signed.ok) return signed;
  return run(deps.service, asking.tenantId, async (tx) => {
    const found = await standing(deps, tx, asking, id);
    if (!found.ok) return found;
    const { document, mine, store } = found.value;
    if (!mine || document.mode !== 'sign') {
      return err(failure('FORBIDDEN', 'This is not yours to sign'));
    }
    const at = deps.clock.instant();
    const moved = await store.move(tx, asking.tenantId, id, 'open', {
      state: 'signed',
      note: null,
      // Done for the person either way; the countersigner's task is the rest.
      closedAt: at,
      signature: { ...signed.value, at, place: await placeOf(deps, tx, asking.tenantId) },
    });
    return moved ? ok({ state: 'signed' as const }) : err(failure('CLOSED', 'It is closed'));
  });
}

/** F1's "Countersigned": whoever was named signs after the person. */
export async function countersignDocument(
  deps: ScreenDeps,
  asking: Asking,
  id: string,
  input: { readonly name: string },
): Promise<Result<{ readonly state: DocumentState }>> {
  const name = words(input.name, 200);
  if (name === null) return err(failure('NAME_REQUIRED', 'Type your full name', ['name']));
  return run(deps.service, asking.tenantId, async (tx) => {
    const found = await standing(deps, tx, asking, id);
    if (!found.ok) return found;
    const { counter, store } = found.value;
    if (!counter) return err(failure('FORBIDDEN', 'This is not yours to countersign'));
    const at = deps.clock.instant();
    const moved = await store.move(tx, asking.tenantId, id, 'signed', {
      state: 'countersigned',
      note: null,
      closedAt: at,
      countersigned: { by: asking.viewer.accountId, name, at },
    });
    return moved
      ? ok({ state: 'countersigned' as const })
      : err(failure('NOT_SIGNED', 'It is not signed yet'));
  });
}

/** "I can't sign this": the person sends it back, with a note. */
export async function declineDocument(
  deps: ScreenDeps,
  asking: Asking,
  id: string,
  note: string,
): Promise<Result<{ readonly state: DocumentState }>> {
  const why = words(note, 2000);
  if (why === null) return err(failure('REASON_REQUIRED', 'Say what stops you', ['note']));
  return run(deps.service, asking.tenantId, async (tx) => {
    const found = await standing(deps, tx, asking, id);
    if (!found.ok) return found;
    if (!found.value.mine) return err(failure('FORBIDDEN', 'This is not yours to send back'));
    const moved = await found.value.store.move(tx, asking.tenantId, id, 'open', {
      state: 'declined',
      note: why,
      closedAt: deps.clock.instant(),
    });
    return moved ? ok({ state: 'declined' as const }) : err(failure('CLOSED', 'It is closed'));
  });
}

/** Whoever sent it takes it back while it is still with the person. */
export async function cancelDocument(
  deps: ScreenDeps,
  asking: Asking,
  id: string,
): Promise<Result<{ readonly state: DocumentState }>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const found = await standing(deps, tx, asking, id);
    if (!found.ok) return found;
    if (!found.value.sent) return err(failure('FORBIDDEN', 'Only whoever sent it can cancel it'));
    const moved = await found.value.store.move(tx, asking.tenantId, id, 'open', {
      state: 'cancelled',
      note: null,
      closedAt: deps.clock.instant(),
    });
    return moved ? ok({ state: 'cancelled' as const }) : err(failure('CLOSED', 'It is closed'));
  });
}
