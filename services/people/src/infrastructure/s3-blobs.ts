import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import type { Blobs } from '../application/export/object-store.js';

/**
 * Export files in an S3-compatible bucket: S3, R2, or MinIO locally.
 *
 * What arrives here is already AES-256-GCM ciphertext (`sealedObjectStore`);
 * the bucket encrypts it again with SSE-S3. Two layers because they fail
 * differently: SSE protects a disk that leaves the data centre, and the
 * application key protects against a bucket policy that was one checkbox too
 * generous, which SSE does not — the bucket decrypts SSE for anyone it lets
 * read.
 *
 * The bucket holds export files and imports' blocked-row reports; the sweep
 * deletes each by age against its own lifetime (`lifetimeOf`): a day for an
 * export file, a week for a report.
 *
 * The bucket is never linked to directly (see `object-store.ts`), so nothing
 * here presigns.
 */

export interface S3Config {
  readonly endpoint?: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** MinIO wants path-style; AWS accepts it. */
  readonly forcePathStyle?: boolean;
  /**
   * Whether to ask for SSE-S3 (`x-amz-server-side-encryption: AES256`) on
   * each write. `AES256` by default; `none` for a provider that encrypts at
   * rest on its own and refuses the header — Oracle Object Storage, whose S3
   * API takes only SSE-C (docs/environments.md).
   */
  readonly sse?: Sse;
}

export type Sse = 'AES256' | 'none';

/** `<prefix>_SSE`: `AES256` (the default) or `none`. Anything else is a mistake to stop on. */
export function sseFrom(env: NodeJS.ProcessEnv, prefix: string): Sse {
  const value = env[`${prefix}_SSE`] ?? 'AES256';
  if (value !== 'AES256' && value !== 'none') {
    throw new Error(`${prefix}_SSE must be AES256 or none, not ${value}`);
  }
  return value;
}

const MAX_PAGES = 10;

/**
 * One store's endpoint and credentials: `<prefix>_S3_ENDPOINT`, `_REGION`,
 * `_ACCESS_KEY_ID` and `_SECRET_ACCESS_KEY`, each falling back to the plain
 * `S3_*` — so a laptop's one MinIO serves both stores from one set, and
 * production gives each its own provider (uploads on R2, exports on Oracle).
 */
export function s3ConfigFrom(env: NodeJS.ProcessEnv, prefix: string, bucket: string): S3Config {
  const get = (name: string) => env[`${prefix}_S3_${name}`] ?? env[`S3_${name}`];
  const endpoint = get('ENDPOINT');
  return {
    bucket,
    region: get('REGION') ?? 'us-east-1',
    ...(endpoint ? { endpoint } : {}),
    accessKeyId: get('ACCESS_KEY_ID') ?? '',
    secretAccessKey: get('SECRET_ACCESS_KEY') ?? '',
    sse: sseFrom(env, prefix),
  };
}

export function s3Blobs(config: S3Config): Blobs & { readonly client: S3Client } {
  const client = new S3Client({
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    forcePathStyle: config.forcePathStyle ?? true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  const Bucket = config.bucket;

  return {
    client,

    async put(key, body, mediaType) {
      await client.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: body,
          ContentType: 'application/octet-stream',
          Metadata: { 'media-type': mediaType },
          ...(config.sse === 'none' ? {} : { ServerSideEncryption: 'AES256' as const }),
        }),
      );
    },

    async get(key) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        if (!out.Body) return null;
        return {
          body: await out.Body.transformToByteArray(),
          mediaType: out.Metadata?.['media-type'] ?? 'application/octet-stream',
        };
      } catch (cause) {
        if (cause instanceof NoSuchKey) return null;
        throw cause;
      }
    },

    /**
     * At most `limit` deletions, from at most `MAX_PAGES` listings: bounded
     * both ways, so a sweep over a huge backlog stops and the next sweep takes
     * the rest. `LastModified` is the upload time, which is what the link's
     * lifetime counts from.
     *
     * ponytail: S3 lists by key, not by age, so a bucket with more than
     * `MAX_PAGES` thousand live files could hide a stale one past the last
     * page until the live ones are swept. A bucket lifecycle rule is the
     * backstop worth adding in production.
     */
    async deleteExpired(expired, limit) {
      let deleted = 0;
      let token: string | undefined;
      for (let page = 0; page < MAX_PAGES && deleted < limit; page += 1) {
        const listed = await client.send(
          new ListObjectsV2Command({ Bucket, MaxKeys: 1000, ContinuationToken: token }),
        );
        const stale = (listed.Contents ?? [])
          .filter(
            (o) =>
              o.Key !== undefined &&
              o.LastModified !== undefined &&
              expired(o.Key, o.LastModified.getTime()),
          )
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

    async delete(key) {
      // S3 answers a delete of a missing key with success.
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
}
