import { describe, expect, it } from 'vitest';

import { s3ConfigFrom, sseFrom } from './s3-blobs.js';
import { s3Uploads } from './s3-uploads.js';

/**
 * The presigned PUT, as a browser receives it. Presigning is offline, so no
 * store is needed to see what is signed — and what must not be.
 */

const config = {
  endpoint: 'https://acct.r2.cloudflarestorage.com',
  region: 'auto',
  bucket: 'uploads',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'secret',
};
const KEY = '00000000-0000-4000-8000-00000000000a/import/00000000-0000-4000-8000-0000000000c1';

const signedHeaders = (url: string) =>
  new URL(url).searchParams.get('X-Amz-SignedHeaders')?.split(';') ?? [];

describe('the presigned PUT', () => {
  it('carries no checksum: SDK v3 would sign one of an empty body, and the store would refuse the file', async () => {
    const put = await s3Uploads(config).presignPut(KEY, 5_000_000, 300);
    const query = [...new URL(put.url).searchParams.keys()].map((k) => k.toLowerCase());
    expect(query.filter((k) => k.includes('checksum'))).toEqual([]);
    expect(Object.keys(put.headers).filter((h) => h.includes('checksum'))).toEqual([]);
    expect(signedHeaders(put.url).filter((h) => h.includes('checksum'))).toEqual([]);
  });

  it('signs the length, the type, write-once and SSE-S3 by default, for five minutes', async () => {
    const put = await s3Uploads(config).presignPut(KEY, 5_000_000, 300);
    expect(new URL(put.url).pathname).toBe(`/uploads/${KEY}`);
    expect(new URL(put.url).searchParams.get('X-Amz-Expires')).toBe('300');
    expect(signedHeaders(put.url).toSorted()).toEqual([
      'content-length',
      'content-type',
      'host',
      'if-none-match',
      'x-amz-server-side-encryption',
    ]);
    expect(put.headers).toEqual({
      'content-type': 'application/octet-stream',
      'content-length': '5000000',
      'if-none-match': '*',
      'x-amz-server-side-encryption': 'AES256',
    });
  });

  it('asks for no SSE header when the store is set to none', async () => {
    const put = await s3Uploads({ ...config, sse: 'none' }).presignPut(KEY, 10, 300);
    expect(signedHeaders(put.url)).not.toContain('x-amz-server-side-encryption');
    expect(put.headers).not.toHaveProperty('x-amz-server-side-encryption');
    expect(new URL(put.url).searchParams.has('x-amz-server-side-encryption')).toBe(false);
  });
});

describe('a store’s server-side encryption setting', () => {
  it('is AES256 unless the store says none, per store, and refuses anything else', () => {
    expect(sseFrom({}, 'PEOPLE_EXPORT')).toBe('AES256');
    const env = { PEOPLE_EXPORT_SSE: 'none', PEOPLE_UPLOAD_SSE: 'AES256' };
    expect(s3ConfigFrom(env, 'PEOPLE_EXPORT', 'exports').sse).toBe('none');
    expect(s3ConfigFrom(env, 'PEOPLE_UPLOAD', 'uploads').sse).toBe('AES256');
    expect(() => sseFrom({ PEOPLE_UPLOAD_SSE: 'aws:kms' }, 'PEOPLE_UPLOAD')).toThrow(
      /PEOPLE_UPLOAD_SSE must be AES256 or none/,
    );
  });
});
