import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';

import { ask, useRead, type Answer, type Load, type Signed } from '../people/api';
import { blobOf } from '../people/media';

/**
 * Documents on the phone (DOC-037 to DOC-040): the web's operations, through
 * the company's `/api/mobile/people` as `documents`. Files never pass through
 * the company host: the phone PUTs to the bucket and opens a link that lasts
 * minutes, as the web does (PRD §8.1).
 */

export const askDocuments = <T>(
  signed: Signed,
  operation: string,
  variables: Record<string, unknown> = {},
): Promise<Answer<T>> => ask<T>(signed, operation, variables, 'documents');

export const useDocuments = <T>(
  operation: string,
  variables: Record<string, unknown> = {},
): { load: Load<T>; reload: () => void } => useRead<T>(operation, variables, 'documents');

export type Kind =
  | 'Contract'
  | 'Policy'
  | 'Payslip'
  | 'Letter'
  | 'ID'
  | 'Personal'
  | 'Medical'
  | 'Sheet'
  | 'Template'
  | 'Permit'
  | 'Form';
export type Tone = 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface PersonRef {
  readonly personId: string;
  readonly name: string;
  readonly teamName: string | null;
}

export interface Row {
  readonly id: string;
  readonly title: string;
  readonly kind: Kind;
  readonly typeName: string | null;
  readonly level: 'private' | 'shared';
  readonly confidential: boolean;
  readonly everyone: boolean;
  readonly who: { readonly label: string };
  readonly subject: PersonRef | null;
  readonly pages: number | null;
  readonly updatedAt: string;
  readonly status: { readonly label: string; readonly tone: Tone } | null;
  readonly mine: boolean;
  readonly aboutMe: boolean;
  readonly deletedAt: string | null;
}

export interface TypeOption {
  readonly key: string;
  readonly name: string;
  readonly filedTo: 'person' | 'company';
}

/** "Contract · 6 pages", what a row says under its name. */
export const meta = (row: Pick<Row, 'typeName' | 'pages' | 'subject'>): string =>
  [
    row.typeName ?? 'Your document',
    row.pages === null ? null : `${String(row.pages)} page${row.pages === 1 ? '' : 's'}`,
    row.subject?.name ?? null,
  ]
    .filter(Boolean)
    .join(' · ');

/** The access badge's words and tone (A1). */
export const access = (row: Pick<Row, 'level' | 'confidential' | 'everyone'>) =>
  row.confidential
    ? ({ label: 'Confidential', tone: 'warning' } as const)
    : row.everyone
      ? ({ label: 'Everyone', tone: 'info' } as const)
      : row.level === 'shared'
        ? ({ label: 'Shared', tone: 'info' } as const)
        : ({ label: 'Private', tone: 'neutral' } as const);

export interface Picked {
  readonly name: string;
  readonly mediaType: string;
  readonly body: Blob;
}

/** A paper document, photographed and cropped on the phone (MD2, MD3). */
export async function scan(): Promise<Picked | null> {
  const allowed = await ImagePicker.requestCameraPermissionsAsync();
  if (!allowed.granted) return null;
  const shot = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    quality: 0.8,
  });
  const asset = shot.canceled ? undefined : shot.assets[0];
  if (asset === undefined) return null;
  return {
    name: `Scan ${new Date().toISOString().slice(0, 10)}.jpg`,
    mediaType: 'image/jpeg',
    body: await blobOf(asset.uri),
  };
}

/** A file from the phone or its cloud (MD2). */
export async function chooseFile(): Promise<Picked | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', 'image/jpeg', 'image/png', 'text/csv'],
    copyToCacheDirectory: true,
  });
  const asset = picked.canceled ? undefined : picked.assets[0];
  if (asset === undefined) return null;
  return {
    name: asset.name,
    mediaType: asset.mimeType ?? 'application/octet-stream',
    body: await blobOf(asset.uri),
  };
}

export interface FileRef {
  readonly uploadId: string;
  readonly name: string;
  readonly mediaType: string;
}

/** Ask Documents where, then PUT the bytes there. */
export async function putFile(signed: Signed, file: Picked): Promise<Answer<FileRef>> {
  const started = await askDocuments<{
    uploadId: string;
    url: string;
    method: string;
    headers: Record<string, string>;
  }>(signed, 'StartDocumentsUpload', {
    input: { name: file.name, mediaType: file.mediaType, size: file.body.size },
  });
  if (!started.ok) return started;
  const sent = await fetch(started.data.url, {
    method: started.data.method,
    headers: started.data.headers,
    body: file.body,
  }).catch(() => null);
  if (sent?.ok !== true) {
    return { ok: false, code: 'UPLOAD', message: 'The file did not go through; try again.' };
  }
  return {
    ok: true,
    data: { uploadId: started.data.uploadId, name: file.name, mediaType: file.mediaType },
  };
}

/** Open a version in the phone's own viewer, from a link that lasts minutes. */
export async function openFile(
  signed: Signed,
  documentId: string,
  mode: 'view' | 'download',
): Promise<string | null> {
  const link = await askDocuments<{ url: string | null }>(signed, 'DocumentsFile', {
    documentId,
    mode,
    version: null,
    device: 'phone',
  });
  if (!link.ok) return link.message;
  if (link.data.url === null) return 'Documents has no file store set up here.';
  await WebBrowser.openBrowserAsync(link.data.url);
  return null;
}
