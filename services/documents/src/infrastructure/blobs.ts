import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { logger } from '@kithena/telemetry';

import type { Blobs } from '../application/ports.js';

/**
 * Where a document's bytes live (PRD §17): Amazon S3 in production,
 * SeaweedFS locally, sealed by Documents before they leave the process.
 *
 * Two layers, People's reasoning (`services/people/src/infrastructure/s3-blobs.ts`):
 * SSE-S3 protects a disk that leaves the data centre; AES-256-GCM under
 * `DOCUMENTS_ENCRYPTION_KEY` protects against a bucket policy one checkbox
 * too generous, which SSE does not. Each object is `iv(12) ‖ tag(16) ‖ ciphertext`.
 */

export function sealed(inner: Blobs, key: Uint8Array): Blobs {
  if (key.byteLength !== 32) throw new Error('DOCUMENTS_ENCRYPTION_KEY must be 32 bytes, base64');
  return {
    async put(name, bytes, mediaType) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      // The object's name is bound in, so a sealed object moved to another key will not open.
      cipher.setAAD(Buffer.from(name));
      const body = Buffer.concat([cipher.update(bytes), cipher.final()]);
      await inner.put(name, Buffer.concat([iv, cipher.getAuthTag(), body]), mediaType);
    },
    async get(name) {
      const stored = await inner.get(name);
      if (stored === null) return null;
      const all = Buffer.from(stored);
      const decipher = createDecipheriv('aes-256-gcm', key, all.subarray(0, 12));
      decipher.setAAD(Buffer.from(name));
      decipher.setAuthTag(all.subarray(12, 28));
      return new Uint8Array(Buffer.concat([decipher.update(all.subarray(28)), decipher.final()]));
    },
    delete: (name) => inner.delete(name),
  };
}

export function s3Blobs(env: NodeJS.ProcessEnv, bucket: string): Blobs {
  const get = (name: string) => env[`DOCUMENTS_S3_${name}`] ?? env[`S3_${name}`];
  const endpoint = get('ENDPOINT');
  const accessKeyId = get('ACCESS_KEY_ID');
  const secretAccessKey = get('SECRET_ACCESS_KEY');
  const client = new S3Client({
    region: get('REGION') ?? 'us-east-1',
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
  });
  const sse =
    (env['DOCUMENTS_SSE'] ?? 'AES256') === 'none'
      ? {}
      : { ServerSideEncryption: 'AES256' as const };
  return {
    async put(Key, Body, mediaType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key,
          Body,
          ContentType: 'application/octet-stream',
          Metadata: { 'media-type': mediaType },
          ...sse,
        }),
      );
    },
    async get(Key) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key }));
        return out.Body ? await out.Body.transformToByteArray() : null;
      } catch (cause) {
        if (cause instanceof NoSuchKey) return null;
        throw cause;
      }
    },
    async delete(Key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key }));
    },
  };
}

/** Bytes in this process only: a laptop with no store. Never production. */
export function memoryBlobs(): Blobs {
  const held = new Map<string, Uint8Array>();
  return {
    put: async (key, bytes) => void held.set(key, bytes),
    get: async (key) => held.get(key) ?? null,
    delete: async (key) => void held.delete(key),
  };
}

/**
 * `DOCUMENTS_BUCKET` and `DOCUMENTS_ENCRYPTION_KEY` together, or, outside
 * production, neither: bytes in memory, said so.
 */
export function blobsFrom(env: NodeJS.ProcessEnv): Blobs {
  const bucket = env['DOCUMENTS_BUCKET'];
  const key = env['DOCUMENTS_ENCRYPTION_KEY'];
  if (bucket && key) return sealed(s3Blobs(env, bucket), Buffer.from(key, 'base64'));
  if (env['NODE_ENV'] === 'production') {
    throw new Error('DOCUMENTS_BUCKET and DOCUMENTS_ENCRYPTION_KEY are required in production');
  }
  logger.warn({ module: 'documents' }, 'DOCUMENTS_BUCKET unset; files are kept in memory');
  return memoryBlobs();
}
