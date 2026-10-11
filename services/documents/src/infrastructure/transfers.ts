import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';

import type { Transfers } from '../application/ports.js';

/**
 * Presigned transfers in the documents bucket (PRD §8.1), People's
 * `s3-uploads.ts` in small: `incoming/` holds what a browser PUT, read once and
 * deleted; `outgoing/` holds a copy handed out, watermarked when Confidential.
 * Neither is sealed — the browser writes one and reads the other — and a
 * bucket lifecycle rule deletes both after a day (`docs/environments.md`).
 *
 * The content type, length and `If-None-Match` are signed into the PUT, so the
 * browser can store exactly the bytes it declared, once.
 */
export function s3Transfers(env: NodeJS.ProcessEnv, bucket: string): Transfers {
  const get = (name: string) => env[`DOCUMENTS_S3_${name}`] ?? env[`S3_${name}`];
  // The address a browser reaches the store at, when the service reaches it at another.
  const endpoint = env['DOCUMENTS_S3_PUBLIC_ENDPOINT'] ?? get('ENDPOINT');
  const accessKeyId = get('ACCESS_KEY_ID');
  const secretAccessKey = get('SECRET_ACCESS_KEY');
  const config = {
    region: get('REGION') ?? 'us-east-1',
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    requestChecksumCalculation: 'WHEN_REQUIRED' as const,
    responseChecksumValidation: 'WHEN_REQUIRED' as const,
  };
  const inner = get('ENDPOINT');
  const client = new S3Client({ ...config, ...(inner ? { endpoint: inner, forcePathStyle: true } : {}) });
  const signer = new S3Client({ ...config, ...(endpoint ? { endpoint, forcePathStyle: true } : {}) });
  return {
    async presignPut(Key, size, seconds) {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key,
        ContentLength: size,
        ContentType: 'application/octet-stream',
        IfNoneMatch: '*',
      });
      const url = await getSignedUrl(signer, command, {
        expiresIn: seconds,
        signableHeaders: new Set(['content-length', 'content-type', 'if-none-match']),
        unhoistableHeaders: new Set(['if-none-match']),
      });
      return {
        url,
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream', 'if-none-match': '*' },
      };
    },
    async readIncoming(Key, max) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key }));
        if (!out.Body) return null;
        if (out.ContentLength !== undefined && out.ContentLength > max) {
          (out.Body as Readable).destroy();
          return 'too_large';
        }
        return await out.Body.transformToByteArray();
      } catch (cause) {
        if (cause instanceof NoSuchKey) return null;
        throw cause;
      }
    },
    async remove(Key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key }));
    },
    async handOut(Key, bytes, file, seconds) {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key, Body: bytes, ContentType: file.mediaType }),
      );
      const name = encodeURIComponent(file.fileName);
      return getSignedUrl(
        signer,
        new GetObjectCommand({
          Bucket: bucket,
          Key,
          ResponseContentType: file.mediaType,
          ResponseContentDisposition: `${file.download ? 'attachment' : 'inline'}; filename*=UTF-8''${name}`,
          ResponseCacheControl: 'private, no-store',
        }),
        { expiresIn: seconds },
      );
    },
  };
}
