import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok, type Clock, type Result } from '@kithena/domain-kit';

import {
  completeUpload,
  openUpload,
  usableUpload,
  type UploadIntent,
} from '../../domain/import/upload.js';

/**
 * Where an import's file waits between the steps (PRD §14.2), and the record
 * of who may put it there.
 *
 * Two ports. `UploadStore` is the bucket — an S3-compatible one the browser
 * reaches with a presigned PUT (`infrastructure/s3-uploads.ts`); nothing in it
 * is sealed by this service, because the browser writes it. `UploadIntents` is
 * `people.import_upload`, one row per intent, which is what makes a key
 * People's to choose and one file's to hold.
 */

export interface PresignedPut {
  readonly url: string;
  readonly method: 'PUT';
  /** Every one is signed: the browser sends exactly these, and a different one fails. */
  readonly headers: Readonly<Record<string, string>>;
}

export interface UploadStore {
  /**
   * A PUT that writes `size` bytes at `key`, once, for `seconds`: the length,
   * the type and "only if absent" are signed into it.
   */
  presignPut(key: string, size: number, seconds: number): Promise<PresignedPut>;
  /**
   * The object, streamed through SHA-256. Null when absent; `too_large` as
   * soon as more than `max` bytes have arrived, without reading the rest.
   */
  read(key: string, max: number): Promise<StoredUpload | null | 'too_large'>;
  /** Absent is not an error. */
  remove(key: string): Promise<void>;
  /** Delete up to `limit` objects stored more than `lifetimeMs` before `now`. */
  purge(now: string, lifetimeMs: number, limit: number): Promise<number>;
}

export interface StoredUpload {
  readonly bytes: Uint8Array;
  /** SHA-256, hex. */
  readonly checksum: string;
}

export interface UploadIntents {
  save(tx: PostgresJsDatabase, intent: UploadIntent): Promise<void>;
  find(tx: PostgresJsDatabase, tenantId: string, id: string): Promise<UploadIntent | null>;
  complete(tx: PostgresJsDatabase, tenantId: string, id: string, checksum: string): Promise<void>;
  /**
   * Delete this person's other uploads, and every upload of the tenant that
   * has expired; returns their object keys, for the bucket.
   */
  release(
    tx: PostgresJsDatabase,
    tenantId: string,
    actorId: string,
    now: string,
  ): Promise<readonly string[]>;
  remove(tx: PostgresJsDatabase, tenantId: string, id: string): Promise<void>;
}

export interface UploadDeps {
  /** Null when no upload bucket is configured: imports answer UNAVAILABLE. */
  readonly store: UploadStore | null;
  readonly intents: UploadIntents;
  readonly clock: Clock;
  readonly newId: () => string;
}

type InTx = <T>(fn: (tx: PostgresJsDatabase) => Promise<Result<T>>) => Promise<Result<T>>;

const unavailable = () =>
  err(failure('UNAVAILABLE', 'Imports are not available here: no upload bucket is configured'));

/**
 * Start an upload: the intent, then the PUT. The person's previous upload, if
 * any, is let go — one import at a time each — and expired ones with it.
 */
export async function startUpload(
  deps: UploadDeps,
  inTx: InTx,
  who: { readonly tenantId: string; readonly actorId: string },
  file: { readonly name: string; readonly size: number },
): Promise<Result<PresignedPut & { readonly uploadId: string; readonly expiresAt: string }>> {
  const store = deps.store;
  if (store === null) return unavailable();
  const now = deps.clock.instant();
  const opened = openUpload({ id: deps.newId(), ...who, ...file, now });
  if (!opened.ok) return opened;
  const intent = opened.value;
  const released = await inTx(async (tx) => {
    const keys = await deps.intents.release(tx, who.tenantId, who.actorId, now);
    await deps.intents.save(tx, intent);
    return ok(keys);
  });
  if (!released.ok) return released;
  await removeAll(store, released.value);
  const seconds = Math.round((Date.parse(intent.urlExpiresAt) - Date.parse(now)) / 1000);
  const put = await store.presignPut(intent.objectKey, intent.size, seconds);
  return ok({ ...put, uploadId: intent.id, expiresAt: intent.urlExpiresAt });
}

/**
 * The browser says the file is there: check it is the file declared, and pin
 * its SHA-256. A refusal lets the upload go — object and row — because the
 * PUT was one-shot and cannot be repeated; the answer is to upload again.
 */
export async function finishUpload(
  deps: UploadDeps,
  inTx: InTx,
  who: { readonly tenantId: string; readonly actorId: string },
  uploadId: string,
): Promise<Result<{ readonly intent: UploadIntent; readonly bytes: Uint8Array }>> {
  const store = deps.store;
  if (store === null) return unavailable();
  const found = await inTx(async (tx) => known(await deps.intents.find(tx, who.tenantId, uploadId), who.actorId));
  if (!found.ok) return found;
  const intent = found.value;
  const read = await store.read(intent.objectKey, intent.size);
  // More than was declared is a mismatch, whatever the rest of it holds.
  const stored =
    read === null
      ? null
      : read === 'too_large'
        ? { size: intent.size + 1, checksum: '' }
        : { size: read.bytes.byteLength, checksum: read.checksum };
  const completed = completeUpload(intent, {
    actorId: who.actorId,
    now: deps.clock.instant(),
    stored,
  });
  if (!completed.ok) {
    if (completed.error.code !== 'UPLOAD_NOT_FOUND') await discard(deps, inTx, intent);
    return completed;
  }
  const saved = await inTx(async (tx) => {
    await deps.intents.complete(tx, who.tenantId, uploadId, completed.value.checksum ?? '');
    return ok(completed.value);
  });
  if (!saved.ok) return saved;
  return ok({ intent: saved.value, bytes: bytesOf(read) });
}

/** A completed upload's bytes, for the dry run and the commit: still the same file. */
export async function readUpload(
  deps: UploadDeps,
  inTx: InTx,
  who: { readonly tenantId: string; readonly actorId: string },
  uploadId: string,
): Promise<Result<{ readonly intent: UploadIntent; readonly bytes: Uint8Array }>> {
  const store = deps.store;
  if (store === null) return unavailable();
  const found = await inTx(async (tx) => known(await deps.intents.find(tx, who.tenantId, uploadId), who.actorId));
  if (!found.ok) return found;
  const read = await store.read(found.value.objectKey, found.value.size);
  const checksum = read === null ? null : read === 'too_large' ? '' : read.checksum;
  const usable = usableUpload(found.value, {
    actorId: who.actorId,
    now: deps.clock.instant(),
    checksum,
  });
  if (!usable.ok) return usable;
  return ok({ intent: usable.value, bytes: bytesOf(read) });
}

/** Let an upload go: its row, then its object. */
export async function discard(deps: UploadDeps, inTx: InTx, intent: UploadIntent): Promise<void> {
  await inTx(async (tx) => {
    await deps.intents.remove(tx, intent.tenantId, intent.id);
    return ok(null);
  });
  if (deps.store !== null) await deps.store.remove(intent.objectKey);
}

/** Somebody else's upload is not found, never forbidden, and never read. */
const known = (intent: UploadIntent | null, actorId: string): Result<UploadIntent> =>
  intent === null || intent.actorId !== actorId
    ? err(failure('UPLOAD_NOT_FOUND', 'No such upload; upload the file again'))
    : ok(intent);

/** Only reached once the checks passed, so the read was the file. */
const bytesOf = (read: StoredUpload | null | 'too_large'): Uint8Array =>
  read === null || read === 'too_large' ? new Uint8Array() : read.bytes;

async function removeAll(store: UploadStore, keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    // eslint-disable-next-line no-await-in-loop -- one or two keys: the person's last upload
    await store.remove(key);
  }
}
