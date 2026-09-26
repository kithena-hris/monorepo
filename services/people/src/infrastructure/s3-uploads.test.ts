import { describe, expect, it } from 'vitest';

import { clientConfig, s3ConfigFrom, sseFrom } from './s3-blobs.js';
import { s3Uploads } from './s3-uploads.js';

/**
 * The presigned PUT, as a browser receives it. Presigning is offline, so no
 * store is needed to see what is signed — and what must not be.
 */

const config = {
  endpoint: 'http://localhost:9000',
  region: 'us-east-1',
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

describe('a store on Amazon S3', () => {
  it('is S3 itself with no endpoint, virtual-hosted, and the default credential chain with no keys', () => {
    const aws = s3ConfigFrom({ PEOPLE_UPLOAD_S3_REGION: 'us-east-1' }, 'PEOPLE_UPLOAD', 'uploads');
    expect(aws).toEqual({ bucket: 'uploads', region: 'us-east-1', sse: 'AES256' });
    const options = clientConfig(aws);
    expect(options.forcePathStyle).toBe(false);
    expect(options).not.toHaveProperty('credentials');
    expect(options).not.toHaveProperty('endpoint');
  });

  it('presigns against the bucket’s own S3 host', async () => {
    const put = await s3Uploads({ region: 'us-east-1', bucket: 'uploads', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' }).presignPut(KEY, 10, 300);
    expect(new URL(put.url).host).toBe('uploads.s3.us-east-1.amazonaws.com');
    expect(new URL(put.url).pathname).toBe(`/${KEY}`);
  });

  it('takes an access key pair only whole', () => {
    expect(clientConfig(s3ConfigFrom({ S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 's' }, 'PEOPLE_UPLOAD', 'u')))
      .toHaveProperty('credentials', { accessKeyId: 'a', secretAccessKey: 's' });
    expect(() => s3ConfigFrom({ S3_ACCESS_KEY_ID: 'a' }, 'PEOPLE_UPLOAD', 'u')).toThrow(/go together/);
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
