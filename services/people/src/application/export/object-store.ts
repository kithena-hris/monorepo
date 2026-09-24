import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { err, failure, ok, type Clock, type Result } from '@kithena/domain-kit';

import { LINK_LIFETIME_MS } from './job.js';

/**
 * Where an export's file lands (PRD §15.1): object storage, encrypted, behind
 * a signed link that stops working after 24 hours.
 *
 * Two layers, and only the bottom one changes between a laptop and
 * production. `sealedObjectStore` encrypts every object with AES-256-GCM
 * before it leaves the process and signs the link with an HMAC; `Blobs` is
 * where the ciphertext sits — memory for a test, an S3-compatible bucket
 * (`infrastructure/s3-blobs.ts`, with server-side encryption on top) for
 * anything shared.
 *
 * The link is this service's, not the bucket's. A presigned GET would hand
 * the requester ciphertext, so the bucket is never reachable from outside and
 * the link points at `GET /v1/exports/files/…`, which checks the signature and
 * the expiry, reads the object and opens it.
 */
export interface ObjectStore {
  /** Store the bytes, encrypted at rest. */
  put(key: string, bytes: Uint8Array, mediaType: string): Promise<void>;
  /** A link that opens `key` until `expiresAt`, and not after. */
  sign(key: string, expiresAt: string): Promise<string>;
  /** What a link opens, if it is genuine and has not expired. */
  open(link: string): Promise<Result<{ bytes: Uint8Array; mediaType: string }>>;
  /**
   * Delete up to `limit` objects whose lifetime (`lifetimeOf`) has run out by
   * `now`, returning how many. Bounded so one sweep over a backlog cannot run
   * for an hour; the next sweep takes the rest.
   */
  purge(now: string, limit: number): Promise<number>;
  /** Delete one object now, whatever its age. Absent is not an error. */
  remove(key: string): Promise<void>;
}

/** Where ciphertext sits. Knows nothing about keys, links or expiry. */
export interface Blobs {
  put(key: string, body: Uint8Array, mediaType: string): Promise<void>;
  get(key: string): Promise<{ body: Uint8Array; mediaType: string } | null>;
  /** Delete up to `limit` objects for which `expired(key, storedAtMs)` holds. */
  deleteExpired(expired: (key: string, storedAt: number) => boolean, limit: number): Promise<number>;
  delete(key: string): Promise<void>;
}

export interface SealingConfig {
  /** 32 bytes: the at-rest key. */
  readonly encryptionKey: Uint8Array;
  /** Signs links; separate from the at-rest key so neither does the other's job. */
  readonly signingKey: Uint8Array;
  readonly clock: Clock;
  /** Where `GET /v1/exports/files` is reachable, without a trailing slash. */
  readonly baseUrl: string;
}

/**
 * How long an import's blocked-row report is kept: 7 days.
 *
 * It holds employee values as uploaded, so it must not outlive the people in
 * it — an erasure deletes it early (`forgetImportReports`), and this bounds
 * everything else. A week is long enough to fix a file and re-upload it after
 * a weekend, and short enough that a report is a working copy rather than a
 * second register nobody reviews.
 */
export const REPORT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/** An import's report, by its key (`reportKey` in `import/commit.ts`). */
export const isImportReport = (key: string): boolean => key.includes('/imports/');

/** How long an object lives: a report its week, an export file its link's day. */
export const lifetimeOf = (key: string): number =>
  isImportReport(key) ? REPORT_LIFETIME_MS : LINK_LIFETIME_MS;

/** The object key a link names, or null when it is not a URL. */
export function keyOf(link: string): string | null {
  try {
    return decodeURIComponent(new URL(link).pathname.split('/').at(-1) ?? '') || null;
  } catch {
    return null;
  }
}

/** Each object is iv (12) ‖ tag (16) ‖ ciphertext. */
export function sealedObjectStore(config: SealingConfig, blobs: Blobs): ObjectStore {
  const signature = (key: string, expiresAt: string) =>
    createHmac('sha256', config.signingKey).update(`${key}\n${expiresAt}`).digest('base64url');

  return {
    async put(key, bytes, mediaType) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', config.encryptionKey, iv);
      const body = Buffer.concat([cipher.update(bytes), cipher.final()]);
      await blobs.put(key, Buffer.concat([iv, cipher.getAuthTag(), body]), mediaType);
    },

    sign(key, expiresAt) {
      const url = new URL(`${config.baseUrl}/${encodeURIComponent(key)}`);
      url.searchParams.set('expires', expiresAt);
      url.searchParams.set('sig', signature(key, expiresAt));
      return Promise.resolve(url.toString());
    },

    async open(link) {
      const refused = err(failure('LINK_INVALID', 'This link is not valid'));
      const key = keyOf(link);
      if (key === null) return refused;
      const url = new URL(link);
      const expiresAt = url.searchParams.get('expires') ?? '';
      const given = Buffer.from(url.searchParams.get('sig') ?? '');
      const expected = Buffer.from(signature(key, expiresAt));
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return refused;
      if (!(Date.parse(config.clock.instant()) < Date.parse(expiresAt))) {
        return err(failure('LINK_EXPIRED', 'This link has expired; run the export again'));
      }
      const sealed = await blobs.get(key);
      if (!sealed) return refused;

      const raw = Buffer.from(sealed.body);
      const decipher = createDecipheriv('aes-256-gcm', config.encryptionKey, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      const bytes = new Uint8Array(
        Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]),
      );
      return ok({ bytes, mediaType: sealed.mediaType });
    },

    purge: (now, limit) =>
      blobs.deleteExpired((key, at) => at + lifetimeOf(key) < Date.parse(now), limit),
    remove: (key) => blobs.delete(key),
  };
}

/**
 * ponytail: in-process and in-memory, so a restart loses every file. That is
 * the right lifetime for a test and a dev box; anything shared needs the
 * bucket adapter.
 */
export function memoryBlobs(
  clock: Clock,
): Blobs & { readonly raw: (key: string) => Uint8Array | undefined } {
  const objects = new Map<string, { body: Uint8Array; mediaType: string; at: string }>();
  return {
    put(key, body, mediaType) {
      objects.set(key, { body, mediaType, at: clock.instant() });
      return Promise.resolve();
    },
    get: (key) => Promise.resolve(objects.get(key) ?? null),
    deleteExpired(expired, limit) {
      let n = 0;
      for (const [key, o] of objects) {
        if (n >= limit) break;
        if (expired(key, Date.parse(o.at))) {
          objects.delete(key);
          n += 1;
        }
      }
      return Promise.resolve(n);
    },
    delete(key) {
      objects.delete(key);
      return Promise.resolve();
    },
    raw: (key) => objects.get(key)?.body,
  };
}

/** The in-memory store, sealed: what the tests and a single-node dev box use. */
export function localObjectStore(
  config: SealingConfig,
): ObjectStore & { readonly raw: (key: string) => Uint8Array | undefined } {
  const blobs = memoryBlobs(config.clock);
  return { ...sealedObjectStore(config, blobs), raw: blobs.raw };
}
