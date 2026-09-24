import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { logger } from '@kithena/telemetry';

import type { UploadStore } from '../application/import/upload.js';
import { s3ConfigFrom, type S3Config } from './s3-blobs.js';

/**
 * Import uploads in an S3-compatible bucket the browser writes to directly:
 * Cloudflare R2 in production, SeaweedFS (or whatever serves S3 locally) on
 * a laptop. Its own bucket, credentials and endpoint (`PEOPLE_UPLOAD_*`),
 * separate from the export store's, because the two are different trust
 * boundaries: this one takes bytes from a browser, the other only from People.
 *
 * **What storage enforces**, signed into the presigned PUT (SigV4, host plus
 * these headers) so a request that changes any of them fails the signature:
 *
 * - `content-length`: exactly the declared size. S3 has no length range on a
 *   presigned PUT and R2 has no POST policy, so the length is pinned instead.
 * - `content-type`: `application/octet-stream`, whatever the file claims.
 * - `if-none-match: *`: the key is written once. A second PUT with the same
 *   URL is refused (412), so the URL cannot replace a file after it is checked.
 * - the key, which People chose, under the tenant; and five minutes.
 *
 * **What People verifies** on completion and on every read after: the object
 * exists, is exactly the declared size (read stops one byte past it), and its
 * SHA-256 — streamed as it is read — is the one pinned when it completed.
 * What the file is, is decided by `parseUpload`, from the bytes.
 *
 * With `PEOPLE_UPLOAD_SSE=AES256` (the default) `x-amz-server-side-encryption`
 * is signed in too, so the browser must ask for SSE-S3; `none` leaves it out
 * for a provider that encrypts at rest on its own and refuses the header. A
 * browser cannot hold an application key, so nothing here is sealed by People.
 */

const CONTENT_TYPE = 'application/octet-stream';
const SSE_HEADER = 'x-amz-server-side-encryption';
const MAX_PAGES = 10;

export function s3Uploads(config: S3Config): UploadStore & { readonly client: S3Client } {
  const client = new S3Client({
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    forcePathStyle: config.forcePathStyle ?? true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // Otherwise SDK v3 presigns a PUT with `x-amz-checksum-crc32` of an EMPTY
    // body, and S3, R2 and SeaweedFS refuse the browser's real body with
    // BadDigest. Checksums only where an operation requires one.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  const Bucket = config.bucket;
  const sse = config.sse !== 'none';

  return {
    client,

    async presignPut(key, size, seconds) {
      const command = new PutObjectCommand({
        Bucket,
        Key: key,
        ContentLength: size,
        ContentType: CONTENT_TYPE,
        IfNoneMatch: '*',
        ...(sse ? { ServerSideEncryption: 'AES256' as const } : {}),
      });
      const signed = ['content-length', 'content-type', 'if-none-match', ...(sse ? [SSE_HEADER] : [])];
      const url = await getSignedUrl(client, command, {
        expiresIn: seconds,
        signableHeaders: new Set(signed),
        // Kept as headers, not hoisted into the query: a header the URL does
        // not carry is one the browser must send, and the signature covers it.
        unhoistableHeaders: new Set(['if-none-match', ...(sse ? [SSE_HEADER] : [])]),
      });
      return {
        url,
        method: 'PUT',
        // `content-length` is the browser's to send, from the file itself; it
        // is listed so a non-browser client knows it is signed.
        headers: {
          'content-type': CONTENT_TYPE,
          'content-length': String(size),
          'if-none-match': '*',
          ...(sse ? { [SSE_HEADER]: 'AES256' } : {}),
        },
      };
    },

    async read(key, max) {
      let body: Readable;
      try {
        const out = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        if (!out.Body) return null;
        if (out.ContentLength !== undefined && out.ContentLength > max) {
          (out.Body as Readable).destroy();
          return 'too_large';
        }
        body = out.Body as Readable;
      } catch (cause) {
        if (cause instanceof NoSuchKey) return null;
        throw cause;
      }
      // Streamed through the hash, and stopped one chunk past the limit.
      // ponytail: the bytes are gathered for `parseUpload`, which needs the
      // whole file (an XLSX's directory is at its end); a streaming parser is
      // the upgrade if 100 MB in memory per import ever matters.
      const hash = createHash('sha256');
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of body) {
        const buffer = chunk as Buffer;
        size += buffer.length;
        if (size > max) {
          body.destroy();
          return 'too_large';
        }
        hash.update(buffer);
        chunks.push(buffer);
      }
      return { bytes: new Uint8Array(Buffer.concat(chunks, size)), checksum: hash.digest('hex') };
    },

    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },

    /** Bounded both ways, as the export sweep is; the lifecycle rule is the backstop. */
    async purge(now, lifetimeMs, limit) {
      const cutoff = Date.parse(now) - lifetimeMs;
      let deleted = 0;
      let token: string | undefined;
      for (let page = 0; page < MAX_PAGES && deleted < limit; page += 1) {
        const listed = await client.send(
          new ListObjectsV2Command({ Bucket, MaxKeys: 1000, ContinuationToken: token }),
        );
        const stale = (listed.Contents ?? [])
          .filter((o) => o.Key !== undefined && (o.LastModified?.getTime() ?? Infinity) < cutoff)
          .slice(0, limit - deleted)
          .map((o) => ({ Key: o.Key ?? '' }));
        if (stale.length > 0) {
          await client.send(
            new DeleteObjectsCommand({ Bucket, Delete: { Objects: stale, Quiet: true } }),
          );
          deleted += stale.length;
        }
        token = listed.NextContinuationToken;
        if (!token) break;
      }
      return deleted;
    },
  };
}

/**
 * The upload store from `PEOPLE_UPLOAD_BUCKET` and `PEOPLE_UPLOAD_S3_*`, or
 * null — and imports then answer UNAVAILABLE — when no bucket is set. There is
 * no in-memory fallback: the browser has to be able to reach the store.
 */
export function uploadStoreFrom(env: NodeJS.ProcessEnv): UploadStore | null {
  const bucket = env['PEOPLE_UPLOAD_BUCKET'];
  if (!bucket) {
    logger.warn(
      { module: 'people' },
      'PEOPLE_UPLOAD_BUCKET is not set; imports are unavailable (no upload bucket)',
    );
    return null;
  }
  return s3Uploads(s3ConfigFrom(env, 'PEOPLE_UPLOAD', bucket));
}
