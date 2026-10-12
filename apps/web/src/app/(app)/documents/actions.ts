'use server';

import { headers } from 'next/headers';

import { currentTenant } from '../../../lib/branding';
import { documents, people, timeOff } from '../../../lib/people';
import { requestExport } from '../people/actions';

/**
 * What the Documents screens' buttons do: server actions, each one operation
 * sent to Documents through the router as the person signed in (DOC-030), as
 * Time Off's are. The browser chooses the arguments, never the operation;
 * Documents validates every one again and decides whether this person may.
 * Files never pass through here: the browser PUTs them to the bucket with the
 * link `startUpload` answers (Documents PRD §8.1).
 */

export type Outcome = { readonly ok: true } | { readonly ok: false; readonly message: string };
export type Created =
  { readonly ok: true; readonly id: string } | { readonly ok: false; readonly message: string };

const outcome = (a: { ok: boolean; message?: string }): Outcome =>
  a.ok ? { ok: true } : { ok: false, message: a.message ?? 'Documents refused' };

export interface PresignedPut {
  readonly uploadId: string;
  readonly url: string;
  readonly method: 'PUT';
  readonly headers: Readonly<Record<string, string>>;
}

/** Where the browser puts a file before filing it. */
export async function startUpload(file: {
  name: string;
  mediaType: string;
  size: number;
}): Promise<{ ok: true; put: PresignedPut } | { ok: false; message: string }> {
  const a = await documents<PresignedPut>('StartDocumentsUpload', { input: file });
  return a.ok ? { ok: true, put: a.data } : { ok: false, message: a.message };
}

export interface FileRef {
  readonly uploadId: string;
  readonly name: string;
  readonly mediaType: string;
}

export interface UploadInput {
  readonly title: string;
  readonly typeKey: string | null;
  readonly subjectPersonId: string | null;
  readonly sectionId: string | null;
  readonly expiresOn: string | null;
  readonly requestId: string | null;
  readonly upload: FileRef;
}

export async function uploadDocument(input: UploadInput): Promise<Created> {
  const a = await documents<{ id: string }>('UploadDocument', { input });
  return a.ok ? { ok: true, id: a.data.id } : { ok: false, message: a.message };
}

export async function addVersion(
  documentId: string,
  upload: FileRef,
  note: string | null,
): Promise<Outcome> {
  return outcome(await documents('AddDocumentVersion', { documentId, input: { upload, note } }));
}

export interface GrantInput {
  readonly grantee:
    | { readonly kind: 'member'; readonly personId: string }
    | { readonly kind: 'team'; readonly teamKey: string }
    | { readonly kind: 'everyone' };
  readonly permission: 'view' | 'edit';
  readonly endsOn: string | null;
}

export async function shareDocument(
  documentId: string,
  grants: readonly GrantInput[],
): Promise<Outcome> {
  return outcome(await documents('ShareDocument', { documentId, input: { grants } }));
}

export async function setConfidential(documentId: string, on: boolean): Promise<Outcome> {
  return outcome(await documents('SetDocumentConfidential', { documentId, input: { on } }));
}

export async function renameDocument(documentId: string, title: string): Promise<Outcome> {
  return outcome(await documents('RenameDocument', { documentId, input: { title } }));
}

export async function setExpiry(documentId: string, expiresOn: string | null): Promise<Outcome> {
  return outcome(await documents('SetDocumentExpiry', { documentId, input: { expiresOn } }));
}

export async function deleteDocument(documentId: string): Promise<Outcome> {
  return outcome(await documents('DeleteDocument', { documentId }));
}

export async function restoreDocument(documentId: string): Promise<Outcome> {
  return outcome(await documents('RestoreDocument', { documentId }));
}

export async function requestAccess(documentId: string, reason: string): Promise<Outcome> {
  return outcome(await documents('RequestDocumentAccess', { documentId, input: { reason } }));
}

export async function decideAccess(requestId: string, grant: boolean): Promise<Outcome> {
  return outcome(await documents('DecideDocumentAccess', { requestId, input: { grant } }));
}

export async function createSection(input: {
  name: string;
  kind: 'personal' | 'company';
  documentIds: readonly string[];
}): Promise<Created> {
  const a = await documents<{ id: string }>('CreateDocumentSection', { input });
  return a.ok ? { ok: true, id: a.data.id } : { ok: false, message: a.message };
}

export async function changeSection(
  sectionId: string,
  input: { name?: string; add?: readonly string[]; remove?: readonly string[]; delete?: boolean },
): Promise<Outcome> {
  return outcome(await documents('ChangeDocumentSection', { sectionId, input }));
}

export async function askForDocument(input: {
  personId: string;
  typeKey: string;
  dueOn: string | null;
  message: string;
}): Promise<Outcome> {
  return outcome(await documents('AskForDocument', { input }));
}

export async function remindRequest(requestId: string): Promise<Outcome> {
  return outcome(await documents('RemindDocumentRequest', { requestId }));
}

export async function cancelRequest(requestId: string): Promise<Outcome> {
  return outcome(await documents('CancelDocumentRequest', { requestId }));
}

export async function placeHold(name: string, documentIds: readonly string[]): Promise<Outcome> {
  return outcome(await documents('PlaceLegalHold', { input: { name, documentIds } }));
}

export async function liftHold(holdId: string): Promise<Outcome> {
  return outcome(await documents('LiftLegalHold', { holdId }));
}

export async function confirmDeletion(documentIds: readonly string[]): Promise<Outcome> {
  return outcome(await documents('ConfirmDocumentDeletion', { input: { documentIds } }));
}

export async function saveType(type: Record<string, unknown>, archived: boolean): Promise<Outcome> {
  return outcome(
    await documents('SaveDocumentType', { typeKey: type['key'], input: { type, archived } }),
  );
}

export async function setAccessSettings(input: Record<string, unknown>): Promise<Outcome> {
  return outcome(await documents('SetDocumentAccessSettings', { input }));
}

export async function setAskAfterUpload(ask: boolean): Promise<Outcome> {
  return outcome(await documents('SetAskAfterUpload', { input: { ask } }));
}

/** A link to a version's copy for ten minutes: watermarked when Confidential. */
export async function fileLink(
  documentId: string,
  mode: 'view' | 'download',
  version: number | null = null,
): Promise<
  | {
      readonly ok: true;
      readonly url: string;
      readonly fileName: string;
      readonly mediaType: string;
    }
  | { readonly ok: false; readonly message: string }
> {
  const a = await documents<{
    fileName: string;
    mediaType: string;
    url: string | null;
    base64: string | null;
  }>('DocumentsFile', { documentId, mode, version, device: 'web' });
  if (!a.ok) return { ok: false, message: a.message };
  const url = a.data.url ?? `data:${a.data.mediaType};base64,${a.data.base64 ?? ''}`;
  return { ok: true, url, fileName: a.data.fileName, mediaType: a.data.mediaType };
}

/* ------------------------------------------------- signatures (K1–K10) -- */

/** Where a signing link points and whose name is on the email: this company's own host. */
async function origin(): Promise<{ origin: string; companyName: string }> {
  const inbound = await headers();
  const host = inbound.get('x-forwarded-host') ?? inbound.get('host') ?? 'localhost:3000';
  const proto =
    inbound.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const tenant = await currentTenant();
  return {
    origin: `${proto}://${host}`,
    companyName: tenant?.branding.displayName ?? tenant?.slug ?? host,
  };
}

export interface SignerInput {
  readonly personId: string | null;
  readonly email: string | null;
  readonly name: string | null;
  readonly order: number;
  readonly allowDelegate: boolean;
}

export interface FieldInput {
  readonly id: string;
  readonly signerId: string;
  readonly kind: 'signature' | 'initials' | 'date' | 'name' | 'title' | 'checkbox' | 'text';
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly required: boolean;
  readonly label: string | null;
}

export async function sendForSignature(
  documentId: string,
  input: {
    signers: readonly SignerInput[];
    fields: readonly FieldInput[];
    message: string;
    dueOn: string | null;
  },
): Promise<Created> {
  const a = await documents<{ id: string }>('SendForSignature', {
    documentId,
    input: { ...input, ...(await origin()) },
  });
  return a.ok ? { ok: true, id: a.data.id } : { ok: false, message: a.message };
}

export type Mark =
  | { readonly kind: 'typed'; readonly text: string }
  | { readonly kind: 'drawn'; readonly path: string };

export async function signEnvelope(
  envelopeId: string,
  signature: Mark,
  values: Readonly<Record<string, string>>,
): Promise<{ ok: true; completed: boolean } | { ok: false; message: string }> {
  const a = await documents<{ completed: boolean }>('SignEnvelope', {
    envelopeId,
    input: { signature, values, ...(await origin()) },
  });
  return a.ok ? { ok: true, completed: a.data.completed } : { ok: false, message: a.message };
}

export async function declineEnvelope(envelopeId: string, reason: string): Promise<Outcome> {
  return outcome(await documents('DeclineEnvelope', { envelopeId, input: { reason } }));
}

export async function askEnvelopeSender(envelopeId: string, question: string): Promise<Outcome> {
  return outcome(await documents('AskEnvelopeSender', { envelopeId, input: { question } }));
}

export async function voidEnvelope(envelopeId: string, reason: string): Promise<Outcome> {
  return outcome(await documents('VoidEnvelope', { envelopeId, input: { reason } }));
}

export async function remindEnvelope(envelopeId: string): Promise<Outcome> {
  return outcome(await documents('RemindEnvelope', { envelopeId }));
}

export async function reassignSigner(
  envelopeId: string,
  signerId: string,
  personId: string,
): Promise<Outcome> {
  return outcome(
    await documents('ReassignEnvelopeSigner', { envelopeId, input: { signerId, personId } }),
  );
}

export async function sealEnvelope(envelopeId: string): Promise<Outcome> {
  const { companyName } = await origin();
  return outcome(await documents('SealEnvelope', { envelopeId, input: { companyName } }));
}

/** The version being signed, as a link that lasts minutes. */
export async function envelopeFileLink(
  envelopeId: string,
): Promise<
  { readonly ok: true; readonly url: string } | { readonly ok: false; readonly message: string }
> {
  const a = await documents<{ mediaType: string; url: string | null; base64: string | null }>(
    'DocumentsEnvelopeFile',
    { envelopeId },
  );
  if (!a.ok) return { ok: false, message: a.message };
  return { ok: true, url: a.data.url ?? `data:${a.data.mediaType};base64,${a.data.base64 ?? ''}` };
}

/* ---------------------------------------------- acknowledgements (F2, F3) -- */

export async function sendForAcknowledgement(
  documentId: string,
  audience:
    | { kind: 'everyone' }
    | { kind: 'teams'; teamKeys: readonly string[] }
    | { kind: 'people'; personIds: readonly string[] },
  dueOn: string | null,
): Promise<Created> {
  const a = await documents<{ id: string }>('SendForAcknowledgement', {
    documentId,
    input: { audience, dueOn },
  });
  return a.ok ? { ok: true, id: a.data.id } : { ok: false, message: a.message };
}

export async function acknowledgeDocument(campaignId: string): Promise<Outcome> {
  return outcome(await documents('AcknowledgeDocument', { campaignId }));
}

/* ------------------------------------- Kithena reading (DOC-050 to 056) -- */

/** An answer read, or why not: its shape is the remote's (`types.ts`). */
export type Read<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly message: string };

const read = <T>(a: { ok: true; data: T } | { ok: false; message: string }): Read<T> =>
  a.ok ? { ok: true, data: a.data } : { ok: false, message: a.message };

/** D1: asked for after the page shows, so a slow model never holds it up. */
export async function summarizeDocument(documentId: string): Promise<Read<unknown>> {
  return read(await documents('DocumentSummary', { documentId }));
}

export async function askDocument(documentId: string, question: string): Promise<Read<unknown>> {
  return read(await documents('AskDocument', { documentId, input: { question } }));
}

export async function askDocuments(question: string): Promise<Read<unknown>> {
  return read(await documents('AskDocuments', { input: { question } }));
}

export async function compareVersions(
  documentId: string,
  from: number,
  to: number,
): Promise<Read<unknown>> {
  return read(await documents('CompareDocumentVersions', { documentId, from, to }));
}

export async function suggestFiling(uploadId: string, name: string): Promise<Read<unknown>> {
  return read(await documents('SuggestDocumentFiling', { uploadId, input: { name } }));
}

export async function describeType(text: string): Promise<Read<unknown>> {
  return read(await documents('DescribeDocumentType', { input: { text } }));
}

export async function setAiSettings(input: Record<string, boolean>): Promise<Outcome> {
  return outcome(await documents('SetDocumentsAiSettings', { input }));
}

/* ------------------------------------------- with People (DOC-057 to 064) -- */

const EXPORT_TYPES: Readonly<Record<string, string>> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/** Inside a request: the bytes Documents takes without a bucket, as tests do. */
const MAX_INLINE = 25 * 1024 * 1024;

/**
 * G2: People's export kept as a document rather than a download: People
 * builds it as the person, Documents files it as "Export from People",
 * Confidential to HR and deleted after 90 days by its type.
 */
export async function keepExport(choice: Parameters<typeof requestExport>[0]): Promise<Created> {
  // People's export is run here, never handed in: the link fetched is People's own.
  const exported = await requestExport(choice);
  if (!exported.ok) return exported;
  const link = exported.links[0];
  if (link === undefined) return { ok: false, message: 'People made no file' };
  const response = await fetch(link.url).catch(() => null);
  if (response === null || !response.ok)
    return { ok: false, message: 'The export could not be read' };
  const bytes = Buffer.from(await response.arrayBuffer());
  // ponytail: inline up to 25 MB; a presigned PUT from here when exports grow past it.
  if (bytes.length > MAX_INLINE) return { ok: false, message: 'Exports over 25 MB are downloaded' };
  const a = await documents<{ id: string }>('UploadDocument', {
    input: {
      title: link.name.replace(/\.[^.]+$/u, ''),
      typeKey: 'people_export',
      file: {
        name: link.name,
        mediaType: EXPORT_TYPES[link.name.split('.').pop() ?? ''] ?? 'application/octet-stream',
        base64: bytes.toString('base64'),
      },
    },
  });
  return a.ok ? { ok: true, id: a.data.id } : { ok: false, message: a.message };
}

const SPREADSHEETS = new Set(['text/csv', EXPORT_TYPES['xlsx']]);

/** G4: the spreadsheets this person may open in Documents, for People's import to offer. */
export async function importableDocuments(): Promise<
  readonly { readonly id: string; readonly name: string; readonly detail: string }[]
> {
  const a = await documents<{
    rows: readonly {
      id: string;
      title: string;
      typeName: string | null;
      mediaType: string | null;
      updatedAt: string;
      deletedAt: string | null;
    }[];
  }>('DocumentsLibrary', { show: 'all' });
  if (!a.ok) return [];
  return a.data.rows
    .filter((r) => r.deletedAt === null && SPREADSHEETS.has(r.mediaType ?? ''))
    .slice(0, 20)
    .map((r) => ({
      id: r.id,
      name: r.title,
      detail: `${r.typeName ?? 'Your document'} · ${new Date(r.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`,
    }));
}

/**
 * G4: a spreadsheet in Documents handed to People's import as its upload:
 * read from Documents as the person (who must be able to download it) and
 * put where People's import expects a file. The bytes never reach a browser.
 */
export async function importFromDocuments(
  documentId: string,
): Promise<
  | { readonly ok: true; readonly uploadId: string }
  | { readonly ok: false; readonly message: string }
> {
  const file = await documents<{
    fileName: string;
    url: string | null;
    base64: string | null;
  }>('DocumentsFile', { documentId, mode: 'download', version: null, device: 'web' });
  if (!file.ok) return file;
  let bytes: Buffer;
  if (file.data.url !== null) {
    const response = await fetch(file.data.url).catch(() => null);
    if (response === null || !response.ok) {
      return { ok: false, message: 'The file could not be read from Documents' };
    }
    bytes = Buffer.from(await response.arrayBuffer());
  } else {
    bytes = Buffer.from(file.data.base64 ?? '', 'base64');
  }
  const target = await people<{
    uploadId: string;
    url: string;
    method: string;
    headers: { name: string; value: string }[];
  }>('StartImportUpload', { name: file.data.fileName.slice(0, 255), size: bytes.length });
  if (!target.ok) return target;
  const put = await fetch(target.data.url, {
    method: target.data.method,
    headers: Object.fromEntries(target.data.headers.map((h) => [h.name, h.value])),
    body: new Uint8Array(bytes),
  }).catch(() => null);
  if (put === null || !put.ok)
    return { ok: false, message: 'The file could not be handed to People' };
  return { ok: true, uploadId: target.data.uploadId };
}

/* ------------------------------------------ with Time Off (DOC-063, J3–J5) -- */

const NOTE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

interface NoteRow {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly typeKey: string | null;
  readonly mediaType: string | null;
  readonly updatedAt: string;
  readonly mine: boolean;
  readonly aboutMe: boolean;
  readonly deletedAt: string | null;
}

/**
 * J5: what this person already has in Documents that could be the note a
 * request asks for: their sick notes first, then their own PDFs and photos,
 * newest first. Documents decides what they may open.
 */
export async function notesToAttach(): Promise<
  readonly { readonly id: string; readonly name: string; readonly detail: string }[]
> {
  const a = await documents<{ rows: readonly NoteRow[] }>('DocumentsLibrary', { show: 'all' });
  if (!a.ok) return [];
  const usable = a.data.rows.filter(
    (r) =>
      r.deletedAt === null &&
      (r.mine || r.aboutMe) &&
      (r.kind === 'Medical' || (r.typeKey === null && NOTE_TYPES.has(r.mediaType ?? ''))),
  );
  return usable
    .toSorted((x, y) => Number(y.kind === 'Medical') - Number(x.kind === 'Medical'))
    .slice(0, 10)
    .map((r) => ({
      id: r.id,
      name: r.title,
      detail: `${r.kind === 'Medical' ? 'Sick note' : 'Your document'} · ${new Date(r.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
    }));
}

/** J3, J5: the note is the document's id; Time Off says only that one arrived. */
export async function attachNoteFromDocuments(
  requestId: string,
  documentId: string,
): Promise<Outcome> {
  return outcome(await timeOff('AttachTimeOffNote', { requestId, input: { fileId: documentId } }));
}

/**
 * J3: a note photographed or chosen now: filed in Documents as the person's
 * sick note (HR only, read for its dates alone), then attached to the request.
 */
export async function attachNewNote(requestId: string, file: File): Promise<Outcome> {
  if (file.size > MAX_INLINE) return { ok: false, message: 'Notes are up to 25 MB' };
  const library = await documents<{ viewer: { personId: string | null } }>('DocumentsLibrary', {
    show: 'all',
  });
  if (!library.ok) return library;
  const filed = await documents<{ id: string }>('UploadDocument', {
    input: {
      title: 'Sick note',
      typeKey: 'sick_note',
      subjectPersonId: library.data.viewer.personId,
      file: {
        name: file.name,
        mediaType: file.type,
        base64: Buffer.from(await file.arrayBuffer()).toString('base64'),
      },
    },
  });
  if (!filed.ok) return filed;
  return attachNoteFromDocuments(requestId, filed.data.id);
}

/* --------------------------------------------- record from a document (G5) -- */

/** People's kinds of value a document states in words a person checks. */
const FILLABLE = new Set(['text', 'number', 'decimal', 'date', 'email', 'phone', 'url']);

interface ProfileField {
  readonly key: string;
  readonly label: string;
  readonly dataType: string;
  readonly readOnly: boolean;
}
type ProfileEntry = { readonly key: string } & Readonly<Record<string, unknown>>;

/** One field as G5 lists it: People's value beside the document's, with its page. */
export interface RecordRow {
  readonly key: string;
  readonly label: string;
  readonly current: string | null;
  readonly found: { readonly value: string; readonly page: number } | null;
}

const shown = (e: ProfileEntry | undefined): string | null => {
  if (e === undefined) return null;
  if (typeof e['text'] === 'string') return e['text'];
  if (typeof e['flag'] === 'boolean') return e['flag'] ? 'Yes' : 'No';
  if (Array.isArray(e['items'])) return e['items'].join(', ');
  return null;
};

/**
 * G5, MP3, K9: what a document says beside what People holds for the person
 * it is about. People says which fields this viewer may change and what they
 * hold; Documents reads the document for those names, each with its page.
 * Nothing is written here.
 */
export async function recordFromDocument(documentId: string): Promise<
  Read<{
    readonly personId: string;
    readonly name: string;
    readonly rows: readonly RecordRow[];
  }>
> {
  const doc = await documents<{
    document: { row: { subject: { personId: string; name: string } | null } } | null;
  }>('DocumentsDocument', { documentId });
  if (!doc.ok) return doc;
  const subject = doc.data.document?.row.subject ?? null;
  if (subject === null) return { ok: false, message: 'This document is about nobody' };
  const profile = await people<{
    sections: readonly { fields: readonly ProfileField[] }[];
    values: readonly ProfileEntry[];
  }>('Profile', { personId: subject.personId });
  if (!profile.ok) return profile;
  const fields = profile.data.sections
    .flatMap((s) => s.fields)
    .filter((f) => !f.readOnly && FILLABLE.has(f.dataType))
    .slice(0, 40);
  if (fields.length === 0) return { ok: false, message: 'There is nothing here you can change' };
  const read = await documents<{
    available: boolean;
    fields: readonly { name: string; value: string; page: number }[];
  }>('ReadDocumentFields', { documentId, input: { names: fields.map((f) => f.label) } });
  if (!read.ok) return read;
  const values = new Map(profile.data.values.map((v) => [v.key, v]));
  const found = new Map(read.data.fields.map((f) => [f.name, f]));
  return {
    ok: true,
    data: {
      personId: subject.personId,
      name: subject.name,
      rows: fields.map((f) => {
        const hit = found.get(f.label);
        return {
          key: f.key,
          label: f.label,
          current: shown(values.get(f.key)),
          found: hit === undefined ? null : { value: hit.value, page: hit.page },
        };
      }),
    },
  };
}

/* ------------------------------------------------- splitting a scan (C2) -- */

export async function proposeSplit(upload: FileRef): Promise<Read<unknown>> {
  return read(await documents('ProposeDocumentSplit', { input: { upload } }));
}

export async function fileSplit(
  upload: FileRef,
  parts: readonly Record<string, unknown>[],
): Promise<Outcome> {
  return outcome(await documents('FileDocumentSplit', { input: { upload, parts } }));
}

/* --------------------------------------- a letter that changes a record (J7) -- */

/**
 * J7: what a letter about somebody says that People would act on: the last
 * working day, with its page. Nothing is written here.
 */
export async function letterOutcome(documentId: string): Promise<
  Read<{
    readonly personId: string;
    readonly name: string;
    readonly lastWorkingDay: { readonly value: string; readonly page: number } | null;
  }>
> {
  const doc = await documents<{
    document: { row: { subject: { personId: string; name: string } | null } } | null;
  }>('DocumentsDocument', { documentId });
  if (!doc.ok) return doc;
  const subject = doc.data.document?.row.subject ?? null;
  if (subject === null) return { ok: false, message: 'This letter is about nobody' };
  const read = await documents<{
    fields: readonly { name: string; value: string; page: number }[];
  }>('ReadDocumentFields', { documentId, input: { names: ['Last working day'] } });
  if (!read.ok) return read;
  const day = read.data.fields.find((f) => /^\d{4}-\d{2}-\d{2}$/u.test(f.value));
  return {
    ok: true,
    data: {
      personId: subject.personId,
      name: subject.name,
      lastWorkingDay: day === undefined ? null : { value: day.value, page: day.page },
    },
  };
}

/* ---------------------------------- documents that answer HR (J1, J2, J6) -- */

/** A detail People is waiting for from the person signed in: asked for by HR, or missing. */
export interface Waiting {
  readonly key: string;
  readonly label: string;
  readonly asked: boolean;
}

/** J1, J2, J6: what People is waiting for from the viewer that a document could say. */
export async function waitingFor(): Promise<readonly Waiting[]> {
  const profile = await people<{
    sections: readonly { fields: readonly (ProfileField & { missing: boolean })[] }[];
    requests: readonly { key: string; label: string }[];
  }>('Profile', { personId: null });
  if (!profile.ok) return [];
  const asked = new Set(profile.data.requests.map((r) => r.key));
  return profile.data.sections
    .flatMap((s) => s.fields)
    .filter((f) => !f.readOnly && FILLABLE.has(f.dataType) && (asked.has(f.key) || f.missing))
    .slice(0, 40)
    .map((f) => ({ key: f.key, label: f.label, asked: asked.has(f.key) }));
}

/** One answer found: the detail, its value, and the document and page it is on. */
export interface Found {
  readonly key: string;
  readonly label: string;
  readonly asked: boolean;
  readonly value: string;
  readonly page: number;
  readonly documentId: string;
}

/**
 * J1, J2: the viewer's own documents read for what People is waiting for,
 * the first value found for each. Read for the viewer alone; nothing is sent
 * to People until they save it.
 */
export async function lookFor(documentIds: readonly string[]): Promise<Read<readonly Found[]>> {
  const waiting = await waitingFor();
  if (waiting.length === 0) return { ok: true, data: [] };
  const found = new Map<string, Found>();
  // ponytail: five documents, one after another; a job when people keep more.
  for (const documentId of documentIds.slice(0, 5)) {
    const left = waiting.filter((w) => !found.has(w.key));
    if (left.length === 0) break;
    const read = await documents<{ fields: readonly { name: string; value: string; page: number }[] }>(
      'ReadDocumentFields',
      { documentId, input: { names: left.map((w) => w.label) } },
    );
    if (!read.ok) continue;
    for (const f of read.data.fields) {
      const w = left.find((x) => x.label === f.name);
      if (w !== undefined && !found.has(w.key)) {
        found.set(w.key, { ...w, value: f.value, page: f.page, documentId });
      }
    }
  }
  return { ok: true, data: [...found.values()] };
}
