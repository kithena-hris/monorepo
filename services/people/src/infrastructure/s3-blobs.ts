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
 * Export files in an S3-compatible bucket: Oracle Object Storage, R2, or
 * SeaweedFS locally.
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
  /** A local store wants path-style; AWS accepts it. */
  readonly forcePathStyle?: boolean;
}

const MAX_PAGES = 10;

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
          ServerSideEncryption: 'AES256',
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
