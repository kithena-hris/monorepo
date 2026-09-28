import { createHash } from 'node:crypto';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { mayChangePhoto, readPhoto, type PhotoMediaType } from '../../domain/person/photo.js';
import { discard, finishUpload, startUpload, type UploadDeps } from '../import/upload.js';
import type { Asking } from '../person/person-access.js';
import { run } from '../person/service.js';
import type { ImportUploadView } from './operations.js';
import type { PhotoStore } from './photo-store.js';
import { personOfViewer, type ScreenDeps, type Tx } from './record.js';

/**
 * A person's photo (People overview): chosen by them or by HR, uploaded the
 * way an import's file is, kept in `people.person_photo`, and shown only to
 * somebody who may read the person.
 *
 * The browser shrinks the picked image and PUTs it straight to the upload
 * bucket; `completePhotoUpload` reads it back, lets `readPhoto` decide from
 * the bytes whether it is a photo and strip what a camera wrote beside it,
 * keeps what is left, and lets the upload go. Nothing about a photo is sent to
 * another module: nobody else needs a face.
 */

export type { PhotoStore, StoredPhoto } from './photo-store.js';

export interface PhotoDeps extends ScreenDeps {
  readonly photos?: PhotoStore;
  readonly uploads: Pick<UploadDeps, 'store' | 'intents'>;
  readonly newId: () => string;
}

/**
 * Where the tenant app serves a photo: its People route, by version, so a
 * browser may keep one as long as it likes and a new photo is a new URL. The
 * route asks People for the bytes as the person looking (`photoView`); the URL
 * itself opens nothing.
 */
export const avatarUrl = (personId: string, checksum: string): string =>
  `/people/photos/${personId}?v=${checksum.slice(0, 16)}`;

/** These people's photo URLs, in one read. Only for people the caller has already read. */
export async function avatarsOf(
  deps: Pick<ScreenDeps, 'photos'>,
  tx: Tx,
  tenantId: string,
  personIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (deps.photos === undefined || personIds.length === 0) return new Map();
  const versions = await deps.photos.versions(tx, tenantId, [...new Set(personIds)]);
  return new Map([...versions].map(([id, checksum]) => [id, avatarUrl(id, checksum)]));
}

const unavailable = () =>
  err(failure('UNAVAILABLE', 'Photos are not available here: no upload bucket is configured'));
const refused = () =>
  err(failure('FORBIDDEN', 'Only the person and HR change a person’s photo'));

/** The person, and whether this viewer may change their photo: themselves, or HR. */
async function subject(
  deps: PhotoDeps,
  tx: Tx,
  asking: Asking,
  personId: string | null,
): Promise<Result<string>> {
  const id = personId === null ? await personOfViewer(deps, tx, asking) : ok(personId);
  if (!id.ok) return id;
  // Somebody the viewer may not read is not found, as everywhere else.
  const read = await deps.service.access.read(tx, { ...asking, personId: id.value });
  if (!read.ok) return read;
  const relations = await deps.relations.relations(tx, asking.tenantId, asking.viewer, id.value);
  return mayChangePhoto(relations) ? id : refused();
}

const inTx =
  (deps: PhotoDeps, asking: Asking) =>
  <T>(fn: (tx: Tx) => Promise<Result<T>>): Promise<Result<T>> =>
    run(deps.service, asking.tenantId, fn);

const uploadDeps = (deps: PhotoDeps): UploadDeps => ({
  ...deps.uploads,
  clock: deps.clock,
  newId: deps.newId,
});

const who = (asking: Asking) => ({ tenantId: asking.tenantId, actorId: asking.viewer.accountId });

/** Where to put a photo: a presigned PUT for exactly this many bytes, once, for five minutes. */
export async function startPhotoUpload(
  deps: PhotoDeps,
  asking: Asking,
  personId: string | null,
  size: number,
): Promise<Result<ImportUploadView>> {
  if (deps.photos === undefined) return unavailable();
  const allowed = await run(deps.service, asking.tenantId, (tx) =>
    subject(deps, tx, asking, personId),
  );
  if (!allowed.ok) return allowed;
  return startUpload(uploadDeps(deps), inTx(deps, asking), who(asking), {
    name: 'photo',
    size,
    purpose: 'photo',
  });
}

/**
 * The photo is uploaded: check it is the file declared and a photo, keep it
 * without its metadata, and let the upload go whatever the answer, since the
 * PUT was one-shot. Answers with the new URL.
 */
export async function completePhotoUpload(
  deps: PhotoDeps,
  asking: Asking,
  personId: string | null,
  uploadId: string,
): Promise<Result<{ readonly avatarUrl: string }>> {
  const photos = deps.photos;
  if (photos === undefined) return unavailable();
  const allowed = await run(deps.service, asking.tenantId, (tx) =>
    subject(deps, tx, asking, personId),
  );
  if (!allowed.ok) return allowed;
  const finished = await finishUpload(
    uploadDeps(deps),
    inTx(deps, asking),
    who(asking),
    uploadId,
    'photo',
  );
  if (!finished.ok) return finished;
  await discard(uploadDeps(deps), inTx(deps, asking), finished.value.intent);
  const photo = readPhoto(finished.value.bytes);
  if (!photo.ok) return photo;
  const checksum = createHash('sha256').update(photo.value.bytes).digest('hex');
  return run(deps.service, asking.tenantId, async (tx) => {
    await photos.put(tx, {
      tenantId: asking.tenantId,
      personId: allowed.value,
      mediaType: photo.value.mediaType,
      bytes: photo.value.bytes,
      checksum,
      updatedAt: deps.clock.instant(),
      updatedBy: asking.viewer.accountId,
    });
    return ok({ avatarUrl: avatarUrl(allowed.value, checksum) });
  });
}

/** Take a photo down: the person's own, or HR's to do. */
export async function removePhoto(
  deps: PhotoDeps,
  asking: Asking,
  personId: string | null,
): Promise<Result<{ readonly ok: true }>> {
  const photos = deps.photos;
  if (photos === undefined) return unavailable();
  return run(deps.service, asking.tenantId, async (tx) => {
    const allowed = await subject(deps, tx, asking, personId);
    if (!allowed.ok) return allowed;
    await photos.remove(tx, asking.tenantId, allowed.value);
    return ok({ ok: true as const });
  });
}

export interface PhotoView {
  readonly mediaType: PhotoMediaType;
  /** The file, base64: a view model is JSON. */
  readonly data: string;
  readonly checksum: string;
}

/**
 * A person's photo, for somebody who may read the person. Whoever may not is
 * told it is not found, exactly as they are about the person.
 */
export async function photoView(
  deps: Pick<ScreenDeps, 'service' | 'photos'>,
  asking: Asking,
  personId: string,
): Promise<Result<PhotoView>> {
  const photos = deps.photos;
  return run(deps.service, asking.tenantId, async (tx) => {
    const read = await deps.service.access.read(tx, { ...asking, personId });
    if (!read.ok) return read;
    const photo = photos === undefined ? null : await photos.get(tx, asking.tenantId, personId);
    if (photo === null) return err(failure('NOT_FOUND', 'This person has no photo'));
    return ok({
      mediaType: photo.mediaType,
      data: Buffer.from(photo.bytes).toString('base64'),
      checksum: photo.checksum,
    });
  });
}
