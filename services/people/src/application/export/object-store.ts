import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { err, failure, ok, type Clock, type Result } from '@kithena/domain-kit';

/**
 * Where an export's file lands (PRD §15.1): object storage, encrypted, behind
 * a signed link that stops working after 24 hours.
 *
 * A port, because the repository has no object-storage adapter yet. The one
 * implementation here is local — in memory, AES-256-GCM at rest and an
 * HMAC-signed link — which is what the tests run and what a single-node dev
 * box can use. A production adapter (S3 or R2 with SSE-KMS and a presigned
 * GET) implements the same three methods and nothing above it changes.
 */
export interface ObjectStore {
  /** Store the bytes, encrypted at rest. */
  put(key: string, bytes: Uint8Array, mediaType: string): Promise<void>;
  /** A link that opens `key` until `expiresAt`, and not after. */
  sign(key: string, expiresAt: string): Promise<string>;
  /** What a link opens, if it is genuine and has not expired. */
  open(link: string): Promise<Result<{ bytes: Uint8Array; mediaType: string }>>;
}

interface Sealed {
  readonly iv: Buffer;
  readonly tag: Buffer;
  readonly body: Buffer;
  readonly mediaType: string;
}

/**
 * ponytail: in-process and in-memory, so a restart loses every file. That is
 * the right lifetime for a test and a dev box; anything shared needs the
 * bucket adapter.
 */
export function localObjectStore(config: {
  /** 32 bytes: the at-rest key. */
  readonly encryptionKey: Uint8Array;
  /** Signs links; separate from the at-rest key so neither does the other's job. */
  readonly signingKey: Uint8Array;
  readonly clock: Clock;
  readonly baseUrl: string;
}): ObjectStore & { readonly raw: (key: string) => Uint8Array | undefined } {
  const objects = new Map<string, Sealed>();
  const signature = (key: string, expiresAt: string) =>
    createHmac('sha256', config.signingKey).update(`${key}\n${expiresAt}`).digest('base64url');

  return {
    put(key, bytes, mediaType) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', config.encryptionKey, iv);
      const body = Buffer.concat([cipher.update(bytes), cipher.final()]);
      objects.set(key, { iv, tag: cipher.getAuthTag(), body, mediaType });
      return Promise.resolve();
    },

    sign(key, expiresAt) {
      const url = new URL(`${config.baseUrl}/${encodeURIComponent(key)}`);
      url.searchParams.set('expires', expiresAt);
      url.searchParams.set('sig', signature(key, expiresAt));
      return Promise.resolve(url.toString());
    },

    open(link) {
      const refused = err(failure('LINK_INVALID', 'This link is not valid'));
      let url: URL;
      try {
        url = new URL(link);
      } catch {
        return Promise.resolve(refused);
      }
      const key = decodeURIComponent(url.pathname.split('/').at(-1) ?? '');
      const expiresAt = url.searchParams.get('expires') ?? '';
      const given = Buffer.from(url.searchParams.get('sig') ?? '');
      const expected = Buffer.from(signature(key, expiresAt));
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
        return Promise.resolve(refused);
      }
      if (!(Date.parse(config.clock.instant()) < Date.parse(expiresAt))) {
        return Promise.resolve(
          err(failure('LINK_EXPIRED', 'This link has expired; run the export again')),
        );
      }
      const sealed = objects.get(key);
      if (!sealed) return Promise.resolve(refused);

      const decipher = createDecipheriv('aes-256-gcm', config.encryptionKey, sealed.iv);
      decipher.setAuthTag(sealed.tag);
      const bytes = new Uint8Array(Buffer.concat([decipher.update(sealed.body), decipher.final()]));
      return Promise.resolve(ok({ bytes, mediaType: sealed.mediaType }));
    },

    raw: (key) => objects.get(key)?.body,
  };
}
