import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type {
  AccessLevel,
  CalendarDate,
  ConfidentialBy,
  DocumentId,
  DocumentKind,
  DocumentTypeKey,
  Instant,
  PersonId,
} from '@kithena/contracts';

import type { Grant } from '../access/access.js';
import { addDays, dateOf } from '../dates.js';

/**
 * A document and its versions (PRD §6, §8). A plain record and the
 * transitions on it: each returns the next record or the reason it refuses.
 * Events are raised by the application from what changed, so a transition
 * stays a function of its inputs.
 */

export interface Version {
  readonly n: number;
  readonly blobKey: string;
  readonly fileName: string;
  readonly mediaType: string;
  readonly size: number;
  readonly pages: number | null;
  readonly checksum: string;
  readonly note: string | null;
  readonly uploadedAt: Instant;
  readonly uploadedBy: string;
}

export interface Document {
  readonly id: DocumentId;
  readonly title: string;
  readonly typeKey: DocumentTypeKey | null;
  readonly kind: DocumentKind;
  readonly ownerAccount: string;
  readonly subjectPersonId: PersonId | null;
  readonly level: AccessLevel;
  readonly confidential: boolean;
  readonly confidentialBy: ConfidentialBy | null;
  readonly grants: readonly Grant[];
  readonly currentVersion: number;
  readonly expiresOn: CalendarDate | null;
  readonly deletedAt: Instant | null;
  readonly createdAt: Instant;
}

/** 100 MB (PRD §8.1). */
export const MAX_BYTES = 100 * 1024 * 1024;

/** What may be uploaded: PDF, images, Office documents, CSV (PRD §8.1). */
export const MEDIA_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;

export function checkFile(file: { mediaType: string; size: number }): Result<true> {
  if (!(MEDIA_TYPES as readonly string[]).includes(file.mediaType)) {
    return err(failure('UNSUPPORTED_FILE', 'PDF, images, Office documents and CSV only', ['file']));
  }
  if (file.size === 0) return err(failure('EMPTY_FILE', 'The file is empty', ['file']));
  if (file.size > MAX_BYTES) return err(failure('TOO_LARGE', 'Files are up to 100 MB', ['file']));
  return ok(true);
}

export interface FileInput {
  readonly id: DocumentId;
  readonly title: string;
  readonly typeKey: DocumentTypeKey | null;
  readonly kind: DocumentKind;
  readonly ownerAccount: string;
  readonly subjectPersonId: PersonId | null;
  /** The type's Confidential; for one's own document, false. */
  readonly confidentialByType: boolean;
  readonly expiresOn: CalendarDate | null;
  readonly version: Version;
  readonly at: Instant;
}

/** Every new document starts Private (PRD §8.1); the type may make it Confidential. */
export function fileDocument(input: FileInput): Result<Document> {
  const title = input.title.trim();
  if (title.length === 0 || title.length > 200) {
    return err(failure('BAD_TITLE', 'A name of 1 to 200 characters', ['title']));
  }
  if (input.version.n !== 1) return err(failure('BAD_VERSION', 'A new document is version 1'));
  return ok({
    id: input.id,
    title,
    typeKey: input.typeKey,
    kind: input.kind,
    ownerAccount: input.ownerAccount,
    subjectPersonId: input.subjectPersonId,
    level: 'private',
    confidential: input.confidentialByType,
    confidentialBy: input.confidentialByType ? 'type' : null,
    grants: [],
    currentVersion: 1,
    expiresOn: input.expiresOn,
    deletedAt: null,
    createdAt: input.at,
  });
}

const live = (doc: Document): Result<true> =>
  doc.deletedAt === null ? ok(true) : err(failure('DELETED', 'This document is in Deleted'));

export function addVersion(doc: Document, version: Version): Result<Document> {
  const alive = live(doc);
  if (!alive.ok) return alive;
  if (version.n !== doc.currentVersion + 1) {
    return err(failure('VERSION_CONFLICT', 'Somebody added a version first; reload'));
  }
  return ok({ ...doc, currentVersion: version.n });
}

/** Replaces who it is shared with; none left is Private (PRD §6.3). */
export function share(doc: Document, grants: readonly Grant[]): Result<Document> {
  const alive = live(doc);
  if (!alive.ok) return alive;
  const keys = grants.map((g) => JSON.stringify(g.grantee));
  if (new Set(keys).size !== keys.length) {
    return err(failure('DUPLICATE_GRANT', 'Somebody is listed twice', ['grants']));
  }
  if (grants.length > 200) return err(failure('TOO_MANY_GRANTS', 'Up to 200 at once', ['grants']));
  return ok({ ...doc, grants, level: grants.length === 0 ? 'private' : 'shared' });
}

/** Private ends everyone's access at once (E1). */
export const makePrivate = (doc: Document): Result<Document> => share(doc, []);

export function setConfidential(
  doc: Document,
  on: boolean,
  by: Exclude<ConfidentialBy, 'type'>,
): Result<Document> {
  const alive = live(doc);
  if (!alive.ok) return alive;
  if (on === doc.confidential) return ok(doc);
  return ok({ ...doc, confidential: on, confidentialBy: on ? by : null });
}

export function rename(doc: Document, title: string): Result<Document> {
  const trimmed = title.trim();
  if (trimmed.length === 0 || trimmed.length > 200) {
    return err(failure('BAD_TITLE', 'A name of 1 to 200 characters', ['title']));
  }
  return ok({ ...doc, title: trimmed });
}

export function remove(doc: Document, at: Instant, held: boolean): Result<Document> {
  if (doc.deletedAt !== null) return ok(doc);
  if (held) return err(failure('LEGAL_HOLD', 'A legal hold keeps this document'));
  return ok({ ...doc, deletedAt: at });
}

export function restore(doc: Document): Result<Document> {
  return ok(doc.deletedAt === null ? doc : { ...doc, deletedAt: null });
}

/** Deleted documents wait 30 days, then their bytes are destroyed (PRD §12.3). */
export const TRASH_DAYS = 30;

export const trashEnds = (deletedAt: Instant): CalendarDate =>
  addDays(dateOf(deletedAt), TRASH_DAYS);
