import { createHash, randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

import { CreateBucketCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { ok, type Clock, type Result } from '@kithena/domain-kit';
import { startObjectStore, startPostgres } from '@kithena/testing';

import { drizzleUploadIntents } from '../application/import/ledger.js';
import { finishUpload, readUpload, startUpload, type UploadDeps } from '../application/import/upload.js';
import { UPLOAD_LIFETIME_MS } from '../domain/import/upload.js';
import { s3Uploads } from './s3-uploads.js';
import { configureUploadBucket } from './upload-bucket.js';
import { tenantTransaction } from './unit-of-work.js';

/**
 * An import's file, from a browser straight into an S3-compatible bucket
 * (PRD §14.2), against the real things: the bucket, and Postgres with RLS.
 *
 * The PUTs here are plain `fetch`, as a browser sends one: what the bucket
 * refuses is what storage enforces, and what `finishUpload` refuses is what
 * People verifies. Only the S3 API is used, so any S3-compatible server can
 * stand in for the one `startObjectStore` starts.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const GLOBEX = '00000000-0000-4000-8000-00000000000b';
const PRIYA = '00000000-0000-4000-8000-0000000000b1';
const MARCO = '00000000-0000-4000-8000-0000000000b2';
const migrations = new URL('../../../../migrations/', import.meta.url);

const stops: (() => Promise<void>)[] = [];
let serviceClient: ReturnType<typeof postgres>;
let asService: PostgresJsDatabase;
let store: ReturnType<typeof s3Uploads>;
let endpoint = '';
let credentials = { accessKeyId: '', secretAccessKey: '' };

let now = Date.parse('2026-09-24T10:00:00.000Z');
const clock: Clock = { instant: () => new Date(now).toISOString() } as Clock;
let ids = 0;
const deps = (): UploadDeps => ({
  store,
  intents: drizzleUploadIntents(),
  clock,
  newId: () => `00000000-0000-4000-8000-${String((ids += 1)).padStart(12, '0')}`,
});
const inTx =
  (tenantId: string) =>
  <T>(fn: (tx: PostgresJsDatabase) => Promise<Result<T>>): Promise<Result<T>> =>
    tenantTransaction(asService)(tenantId, ({ tx }) => fn(tx));

beforeAll(async () => {
  const [m, pg] = await Promise.all([startObjectStore(), startPostgres()]);
  stops.push(m.stop, pg.stop);
  endpoint = m.endpoint;
  credentials = { accessKeyId: m.accessKeyId, secretAccessKey: m.secretAccessKey };
  store = s3Uploads({
    endpoint: m.endpoint,
    region: 'us-east-1',
    bucket: 'uploads',
    accessKeyId: m.accessKeyId,
    secretAccessKey: m.secretAccessKey,
  });
  await store.client.send(new CreateBucketCommand({ Bucket: 'uploads' }));

  const adminClient = postgres(pg.url, { max: 1 });
  const admin = drizzle(adminClient);
  const files = (await readdir(migrations))
    .filter((f) => f === '20260821120000_tenant_registry.sql' || /^\d{14}_people_/.test(f))
    .toSorted();
  for (const file of files) {
    await admin.execute(sql.raw(await readFile(new URL(file, migrations), 'utf8')));
  }
  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);
  await adminClient.end();
  const url = new URL(pg.url);
  url.username = 'svc_people';
  url.password = 'svc_people';
  serviceClient = postgres(url.toString(), { max: 2 });
  asService = drizzle(serviceClient);
});

afterAll(async () => {
  await serviceClient.end();
  await Promise.all(stops.map((stop) => stop()));
});

async function started(tenantId: string, actorId: string, bytes: Uint8Array, name = 'people.csv') {
  const put = await startUpload(deps(), inTx(tenantId), { tenantId, actorId }, { name, size: bytes.byteLength });
  if (!put.ok) throw new Error(put.error.message);
  return put.value;
}

/** What a browser sends: the signed headers, and the bytes; the length is the body's own. */
const send = (put: { url: string; headers: Readonly<Record<string, string>> }, body: Uint8Array, headers: Record<string, string> = {}) => {
  const { 'content-length': _length, ...rest } = put.headers;
  return fetch(put.url, { method: 'PUT', headers: { ...rest, ...headers }, body: body as Uint8Array<ArrayBuffer> });
};

describe('an import upload, browser to bucket', () => {
  it('takes a file larger than a Vercel function would, once, and hands People its checksum', async () => {
    // Six megabytes: past the 4.5 MB a Vercel function accepts.
    const bytes = new TextEncoder().encode(`work_email\n${'a@acme.example\n'.repeat(420_000)}`);
    expect(bytes.byteLength).toBeGreaterThan(4.5 * 1024 * 1024);
    const put = await started(ACME, PRIYA, bytes);
    expect(put.url).toContain(`/uploads/${ACME}/import/`);

    expect((await send(put, bytes)).status).toBe(200);
    // Once: the same URL cannot replace what was checked.
    expect((await send(put, bytes)).status).toBe(412);

    const done = await finishUpload(deps(), inTx(ACME), { tenantId: ACME, actorId: PRIYA }, put.uploadId);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.intent.checksum).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(done.value.bytes.byteLength).toBe(bytes.byteLength);

    const again = await readUpload(deps(), inTx(ACME), { tenantId: ACME, actorId: PRIYA }, put.uploadId);
    expect(again.ok && again.value.intent.checksum).toBe(done.value.intent.checksum);
    // SSE-S3 was signed in, so the browser's PUT asked for it (the default).
    const head = await store.client.send(
      new HeadObjectCommand({ Bucket: 'uploads', Key: `${ACME}/import/${put.uploadId}` }),
    );
    expect(head.ServerSideEncryption).toBe('AES256');
  });

  it('refuses at the bucket a length, a type or a key other than the signed ones', async () => {
    const bytes = randomBytes(1000);
    const put = await started(ACME, PRIYA, bytes);
    expect((await send(put, randomBytes(1001))).status).toBe(403);
    expect((await send(put, bytes, { 'content-type': 'text/html' })).status).toBe(403);
    const elsewhere = put.url.replace(`/import/${put.uploadId}`, `/import/${ACME}`);
    expect((await send({ ...put, url: elsewhere }, bytes)).status).toBe(403);
    // Without the once-only header: a signed header missing (400) or a
    // signature that does not match (403), by provider; refused either way.
    const { 'if-none-match': _once, ...lax } = put.headers;
    expect([400, 403]).toContain((await send({ ...put, headers: lax }, bytes)).status);
  });

  it('refuses to complete a file that never arrived, and lets the upload go', async () => {
    const put = await started(ACME, PRIYA, randomBytes(10));
    const done = await finishUpload(deps(), inTx(ACME), { tenantId: ACME, actorId: PRIYA }, put.uploadId);
    expect(done).toMatchObject({ ok: false, error: { code: 'UPLOAD_MISSING' } });
    const gone = await inTx(ACME)(async (tx) => ok(await drizzleUploadIntents().find(tx, ACME, put.uploadId)));
    expect(gone).toEqual({ ok: true, value: null });
  });

  it('is nobody else’s: not another person’s, and not another tenant’s', async () => {
    const bytes = randomBytes(10);
    const put = await started(ACME, PRIYA, bytes);
    expect((await send(put, bytes)).status).toBe(200);
    expect(
      await finishUpload(deps(), inTx(ACME), { tenantId: ACME, actorId: MARCO }, put.uploadId),
    ).toMatchObject({ ok: false, error: { code: 'UPLOAD_NOT_FOUND' } });
    expect(
      await finishUpload(deps(), inTx(GLOBEX), { tenantId: GLOBEX, actorId: PRIYA }, put.uploadId),
    ).toMatchObject({ ok: false, error: { code: 'UPLOAD_NOT_FOUND' } });
    // Still Priya's to complete: neither refusal let it go.
    expect(
      (await finishUpload(deps(), inTx(ACME), { tenantId: ACME, actorId: PRIYA }, put.uploadId)).ok,
    ).toBe(true);
  });

  it('lets a person’s previous upload go when they start another, and expired ones with it', async () => {
    const first = randomBytes(10);
    const put = await started(ACME, MARCO, first);
    expect((await send(put, first)).status).toBe(200);
    const second = randomBytes(20);
    const next = await started(ACME, MARCO, second);
    expect(await store.read(`${ACME}/import/${put.uploadId}`, 10)).toBeNull();
    // The second upload's object exists, so the sweep below has something of
    // this test's own to remove, whatever other tests left in the bucket.
    expect((await send(next, second)).status).toBe(200);

    now += UPLOAD_LIFETIME_MS;
    const expired = await readUpload(deps(), inTx(ACME), { tenantId: ACME, actorId: PRIYA }, put.uploadId);
    expect(expired.ok).toBe(false);
    // The bucket stamps LastModified with the wall clock, not the test's clock,
    // so the sweep's cutoff is taken from the wall clock too: two lifetimes
    // from now, every object this test wrote is stale.
    expect(await store.purge(new Date(Date.now() + UPLOAD_LIFETIME_MS * 2).toISOString(), UPLOAD_LIFETIME_MS, 100)).toBeGreaterThan(0);
    expect(await store.read(`${ACME}/import/${next.uploadId}`, 20)).toBeNull();
  });

  it('configures the bucket for the app origins alone, over the S3 API', async () => {
    await configureUploadBucket(store.client, 'configured', [
      'https://*.app.kithena.com',
      'http://acme.app.localhost:3000',
    ]);
    // A PUT preflight from a tenant is answered; one from anywhere else is not.
    const preflight = (origin: string) =>
      fetch(`${endpoint}/configured/x`, {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'PUT',
          'access-control-request-headers': 'content-type,if-none-match,x-amz-server-side-encryption',
        },
      });
    const tenant = await preflight('https://acme.app.kithena.com');
    expect(tenant.headers.get('access-control-allow-origin')).toBe('https://acme.app.kithena.com');
    const stranger = await preflight('https://evil.example');
    expect(stranger.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('uploads without the SSE header when the store is set to none', async () => {
    const plain = s3Uploads({
      endpoint,
      region: 'us-east-1',
      bucket: 'uploads',
      ...credentials,
      sse: 'none',
    });
    const bytes = randomBytes(64);
    const key = `${ACME}/import/00000000-0000-4000-8000-00000000ffff`;
    const put = await plain.presignPut(key, bytes.byteLength, 300);
    expect(put.headers).not.toHaveProperty('x-amz-server-side-encryption');
    expect((await send(put, bytes)).status).toBe(200);
    const head = await plain.client.send(new HeadObjectCommand({ Bucket: 'uploads', Key: key }));
    expect(head.ServerSideEncryption).toBeUndefined();
  });
});
