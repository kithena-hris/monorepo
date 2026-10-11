'use server';

import { documents } from '../../../lib/people';

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
  const a = await documents<PresignedPut>('StartDocumentUpload', { input: file });
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
