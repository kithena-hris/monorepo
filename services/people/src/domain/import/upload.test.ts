import { describe, expect, it } from 'vitest';

import {
  MAX_UPLOAD_BYTES,
  UPLOAD_LIFETIME_MS,
  UPLOAD_URL_LIFETIME_MS,
  completeUpload,
  openUpload,
  usableUpload,
  type UploadIntent,
} from './upload.js';

/**
 * An import's file goes straight from the browser to object storage; People
 * records the intent to upload first, and checks what arrived against it.
 * The key is chosen here, never by the caller, and one intent is one file.
 */

const TENANT = '00000000-0000-4000-8000-00000000000a';
const PRIYA = '00000000-0000-4000-8000-0000000000b1';
const MARCO = '00000000-0000-4000-8000-0000000000b2';
const ID = '00000000-0000-4000-8000-0000000000c1';
const NOW = '2026-09-24T10:00:00.000Z';
const later = (ms: number) => new Date(Date.parse(NOW) + ms).toISOString();

function opened(overrides: Partial<Parameters<typeof openUpload>[0]> = {}): UploadIntent {
  const intent = openUpload({
    id: ID,
    tenantId: TENANT,
    actorId: PRIYA,
    name: 'people.csv',
    size: 5_000_000,
    now: NOW,
    ...overrides,
  });
  if (!intent.ok) throw new Error(intent.error.message);
  return intent.value;
}

const SHA = 'a'.repeat(64);

describe('opening an upload', () => {
  it('chooses the key under the tenant, and bounds the URL and the file', () => {
    expect(opened()).toEqual({
      id: ID,
      tenantId: TENANT,
      actorId: PRIYA,
      purpose: 'import',
      name: 'people.csv',
      size: 5_000_000,
      objectKey: `${TENANT}/import/${ID}`,
      createdAt: NOW,
      urlExpiresAt: later(UPLOAD_URL_LIFETIME_MS),
      expiresAt: later(UPLOAD_LIFETIME_MS),
      checksum: null,
    });
    expect(UPLOAD_URL_LIFETIME_MS).toBe(5 * 60 * 1000);
    expect(UPLOAD_LIFETIME_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('keeps only the file name a browser gave, never a path', () => {
    expect(opened({ name: '../../etc/people.csv' }).name).toBe('people.csv');
    expect(opened({ name: 'C:\\Users\\priya\\people.xlsx' }).name).toBe('people.xlsx');
  });

  it('takes a file up to 100 MB and refuses an empty one, a bigger one, or a size that is not one', () => {
    expect(openUpload({ id: ID, tenantId: TENANT, actorId: PRIYA, name: 'a.csv', size: MAX_UPLOAD_BYTES, now: NOW }).ok).toBe(true);
    const refusal = (size: number) =>
      openUpload({ id: ID, tenantId: TENANT, actorId: PRIYA, name: 'a.csv', size, now: NOW });
    expect(refusal(0)).toMatchObject({ ok: false, error: { code: 'FILE_EMPTY' } });
    expect(refusal(MAX_UPLOAD_BYTES + 1)).toMatchObject({ ok: false, error: { code: 'FILE_TOO_LARGE' } });
    expect(refusal(1.5)).toMatchObject({ ok: false, error: { code: 'FILE_EMPTY' } });
    expect(refusal(-1)).toMatchObject({ ok: false, error: { code: 'FILE_EMPTY' } });
  });

  it('refuses a nameless file or a name longer than a file system keeps', () => {
    for (const name of ['', '   ', 'a/', `${'x'.repeat(252)}.csv`]) {
      expect(
        openUpload({ id: ID, tenantId: TENANT, actorId: PRIYA, name, size: 1, now: NOW }),
      ).toMatchObject({ ok: false, error: { code: 'FILE_NAME_INVALID' } });
    }
  });
});

describe('completing an upload', () => {
  it('holds when what arrived is the size that was declared, before the upload expires', () => {
    expect(
      completeUpload(opened(), { actorId: PRIYA, now: later(60_000), stored: { size: 5_000_000, checksum: SHA } }),
    ).toEqual({ ok: true, value: { ...opened(), checksum: SHA } });
  });

  it('is somebody else’s upload to nobody but its owner: not found, never forbidden', () => {
    expect(
      completeUpload(opened(), { actorId: MARCO, now: NOW, stored: { size: 5_000_000, checksum: SHA } }),
    ).toMatchObject({ ok: false, error: { code: 'UPLOAD_NOT_FOUND' } });
  });

  it('refuses a file that never arrived, or one of another size', () => {
    expect(completeUpload(opened(), { actorId: PRIYA, now: NOW, stored: null })).toMatchObject({
      ok: false,
      error: { code: 'UPLOAD_MISSING' },
    });
    expect(
      completeUpload(opened(), { actorId: PRIYA, now: NOW, stored: { size: 4_999_999, checksum: SHA } }),
    ).toMatchObject({ ok: false, error: { code: 'UPLOAD_MISMATCH' } });
  });

  it('refuses once the upload has expired', () => {
    expect(
      completeUpload(opened(), {
        actorId: PRIYA,
        now: later(UPLOAD_LIFETIME_MS),
        stored: { size: 5_000_000, checksum: SHA },
      }),
    ).toMatchObject({ ok: false, error: { code: 'UPLOAD_EXPIRED' } });
  });

  it('completes once: a second completion must find the same bytes', () => {
    const done = { ...opened(), checksum: SHA };
    expect(
      completeUpload(done, { actorId: PRIYA, now: NOW, stored: { size: 5_000_000, checksum: SHA } }).ok,
    ).toBe(true);
    expect(
      completeUpload(done, { actorId: PRIYA, now: NOW, stored: { size: 5_000_000, checksum: 'b'.repeat(64) } }),
    ).toMatchObject({ ok: false, error: { code: 'UPLOAD_MISMATCH' } });
  });
});

describe('using a completed upload', () => {
  const done = { ...opened(), checksum: SHA };

  it('is the owner’s, completed and unexpired, with the bytes it completed with', () => {
    expect(usableUpload(done, { actorId: PRIYA, now: NOW, checksum: SHA })).toEqual({
      ok: true,
      value: done,
    });
  });

  it('refuses an upload not completed, not theirs, expired, or changed since', () => {
    expect(usableUpload(opened(), { actorId: PRIYA, now: NOW, checksum: SHA })).toMatchObject({
      ok: false,
      error: { code: 'UPLOAD_NOT_COMPLETED' },
    });
    expect(usableUpload(done, { actorId: MARCO, now: NOW, checksum: SHA })).toMatchObject({
      ok: false,
      error: { code: 'UPLOAD_NOT_FOUND' },
    });
    expect(
      usableUpload(done, { actorId: PRIYA, now: later(UPLOAD_LIFETIME_MS), checksum: SHA }),
    ).toMatchObject({ ok: false, error: { code: 'UPLOAD_EXPIRED' } });
    expect(
      usableUpload(done, { actorId: PRIYA, now: NOW, checksum: 'b'.repeat(64) }),
    ).toMatchObject({ ok: false, error: { code: 'UPLOAD_MISMATCH' } });
    expect(usableUpload(done, { actorId: PRIYA, now: NOW, checksum: null })).toMatchObject({
      ok: false,
      error: { code: 'UPLOAD_MISSING' },
    });
  });
});
