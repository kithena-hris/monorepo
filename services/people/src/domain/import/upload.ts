import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * An import's upload, straight from the browser to object storage (PRD §14.2).
 *
 * The file never passes through the tenant app or the router: People records
 * an intent to upload — who, for which tenant, what for, how big, until when —
 * chooses the object's key itself, and hands the browser a presigned PUT for
 * exactly that key and that length. When the browser says it is done, what
 * arrived is checked against the intent, and every later step (the mapping,
 * the dry run, the commit) reads the file from storage and checks it is still
 * the file that completed.
 *
 * Pure: the storage and the rows are the application's.
 */

/** PRD §14.5: 100 MB per file. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
/** How long the presigned PUT works: long enough to start a 100 MB upload, no longer. */
export const UPLOAD_URL_LIFETIME_MS = 5 * 60 * 1000;
/**
 * How long an upload is kept for its import: a working day's mapping and
 * reviewing, and the lifecycle rule's one-day granularity. Deleted sooner on
 * commit or when the same person starts another upload.
 */
export const UPLOAD_LIFETIME_MS = 24 * 60 * 60 * 1000;

export type UploadPurpose = 'import';

export interface UploadIntent {
  readonly id: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly purpose: UploadPurpose;
  /** The browser's file name, path stripped; shown back, never used as a key. */
  readonly name: string;
  /** Bytes, as declared; the presigned PUT is signed for exactly this length. */
  readonly size: number;
  /** Server-chosen, under the tenant. */
  readonly objectKey: string;
  readonly createdAt: string;
  readonly urlExpiresAt: string;
  readonly expiresAt: string;
  /** SHA-256 of what arrived, hex, once completed; the import key (PEO-090). */
  readonly checksum: string | null;
}

const NAME_MAX = 255;

const notFound = () => err(failure('UPLOAD_NOT_FOUND', 'No such upload; upload the file again'));
const expired = () =>
  err(failure('UPLOAD_EXPIRED', 'This upload has expired; upload the file again'));
const mismatch = () =>
  err(failure('UPLOAD_MISMATCH', 'What arrived is not the file that was declared; upload it again'));
const missing = () => err(failure('UPLOAD_MISSING', 'The file did not arrive; upload it again'));

const after = (at: string, ms: number) => new Date(Date.parse(at) + ms).toISOString();
const isPast = (at: string, now: string) => Date.parse(now) >= Date.parse(at);

export function openUpload(input: {
  readonly id: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly name: string;
  readonly size: number;
  readonly now: string;
}): Result<UploadIntent> {
  const name = (input.name.split(/[\\/]/u).pop() ?? '').trim();
  if (name === '' || name.length > NAME_MAX) {
    return err(failure('FILE_NAME_INVALID', 'A file needs a name of up to 255 characters', ['name']));
  }
  if (!Number.isSafeInteger(input.size) || input.size < 1) {
    return err(failure('FILE_EMPTY', 'The file is empty', ['size']));
  }
  if (input.size > MAX_UPLOAD_BYTES) {
    return err(failure('FILE_TOO_LARGE', 'A file is at most 100 MB; split it into several', ['size']));
  }
  return ok({
    id: input.id,
    tenantId: input.tenantId,
    actorId: input.actorId,
    purpose: 'import',
    name,
    size: input.size,
    objectKey: `${input.tenantId}/import/${input.id}`,
    createdAt: input.now,
    urlExpiresAt: after(input.now, UPLOAD_URL_LIFETIME_MS),
    expiresAt: after(input.now, UPLOAD_LIFETIME_MS),
    checksum: null,
  });
}

/**
 * What arrived, checked against the intent. Completing twice is completing
 * once, provided the bytes are the same bytes.
 */
export function completeUpload(
  intent: UploadIntent,
  at: {
    readonly actorId: string;
    readonly now: string;
    readonly stored: { readonly size: number; readonly checksum: string } | null;
  },
): Result<UploadIntent> {
  if (intent.actorId !== at.actorId) return notFound();
  if (isPast(intent.expiresAt, at.now)) return expired();
  if (at.stored === null) return missing();
  if (at.stored.size !== intent.size) return mismatch();
  if (intent.checksum !== null && intent.checksum !== at.stored.checksum) return mismatch();
  return ok({ ...intent, checksum: at.stored.checksum });
}

/**
 * A completed upload, for a step that reads it again: the owner's, still
 * kept, and still the bytes it completed with (`checksum` is what storage
 * holds now; null when it holds nothing).
 */
export function usableUpload(
  intent: UploadIntent,
  at: { readonly actorId: string; readonly now: string; readonly checksum: string | null },
): Result<UploadIntent & { readonly checksum: string }> {
  if (intent.actorId !== at.actorId) return notFound();
  if (isPast(intent.expiresAt, at.now)) return expired();
  const completed = intent.checksum;
  if (completed === null) {
    return err(failure('UPLOAD_NOT_COMPLETED', 'The upload has not finished; upload the file again'));
  }
  if (at.checksum === null) return missing();
  if (at.checksum !== completed) return mismatch();
  return ok({ ...intent, checksum: completed });
}
