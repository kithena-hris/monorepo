import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

import { CreateBucketCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { fixedClock, systemClock, type Clock, type PendingEvent } from '@kithena/domain-kit';
import { startMinio, startPostgres, startValkey } from '@kithena/testing';

import { ADA, asking, financeTenant, HR } from '../application/export/fixture.js';
import type { ExportJobDeps } from '../application/export/job.js';
import { drizzleFullValuesStore } from '../application/export/full-values-store.js';
import type { FullValuesRequest } from '../application/export/full-values.js';
import { drizzleExportLedger, inMemoryExportLedger } from '../application/export/ledger.js';
import { localObjectStore, sealedObjectStore } from '../application/export/object-store.js';
import { requestExport } from '../application/export/queue.js';
import { noTransaction } from '../application/person/in-memory.js';
import { personAccess } from '../application/person/person-access.js';
import { startExportRunner } from './export-queue.js';
import { s3Blobs } from './s3-blobs.js';
import { tenantTransaction } from './unit-of-work.js';
import { utcCalendars } from '../application/org/org.js';

/**
 * PEO-089 against the real things: MinIO with SSE, Postgres with RLS, and
 * BullMQ on Valkey — the three images `docker-compose.yml` runs.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const GLOBEX = '00000000-0000-4000-8000-00000000000b';
const migrations = new URL('../../../../migrations/', import.meta.url);

const stops: (() => Promise<void>)[] = [];
let minio: Awaited<ReturnType<typeof startMinio>>;
let valkeyUrl: string;
let serviceClient: ReturnType<typeof postgres>;
let asService: PostgresJsDatabase;

beforeAll(async () => {
  const [m, pg, valkey] = await Promise.all([startMinio(), startPostgres(), startValkey()]);
  minio = m;
  valkeyUrl = valkey.url;
  stops.push(m.stop, pg.stop, valkey.stop);

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

function bucket(name: string, sse: 'AES256' | 'none' = 'AES256') {
  const blobs = s3Blobs({
    sse,
    endpoint: minio.endpoint,
    region: 'us-east-1',
    bucket: name,
    accessKeyId: minio.accessKeyId,
    secretAccessKey: minio.secretAccessKey,
  });
  return blobs;
}

describe('the bucket adapter', () => {
  it('stores ciphertext under SSE, opens it through the signed link, and not after', async () => {
    const blobs = bucket('exports-a');
    await blobs.client.send(new CreateBucketCommand({ Bucket: 'exports-a' }));
    let current = fixedClock('2026-09-22T09:00:00.000Z');
    const clock: Clock = {
      now: () => current.now(),
      today: (tz) => current.today(tz),
      instant: () => current.instant(),
      date: (tz) => current.date(tz),
    };
    const store = sealedObjectStore(
      {
        encryptionKey: randomBytes(32),
        signingKey: randomBytes(32),
        clock,
        baseUrl: 'https://p.test/f',
      },
      blobs,
    );

    await store.put('t/exports/1/people.csv', new TextEncoder().encode('Grace,Hopper'), 'text/csv');
    const head = await blobs.client.send(
      new HeadObjectCommand({ Bucket: 'exports-a', Key: 't/exports/1/people.csv' }),
    );
    expect(head.ServerSideEncryption).toBe('AES256');
    const raw = await blobs.client.send(
      new GetObjectCommand({ Bucket: 'exports-a', Key: 't/exports/1/people.csv' }),
    );
    expect(new TextDecoder().decode(await raw.Body?.transformToByteArray())).not.toContain('Grace');

    const link = await store.sign('t/exports/1/people.csv', '2026-09-23T09:00:00.000Z');
    const opened = await store.open(link);
    expect(opened.ok && new TextDecoder().decode(opened.value.bytes)).toBe('Grace,Hopper');
    expect(opened.ok && opened.value.mediaType).toBe('text/csv');

    current = fixedClock('2026-09-23T09:00:00.000Z');
    const expired = await store.open(link);
    expect(!expired.ok && expired.error.code).toBe('LINK_EXPIRED');
  });

  it('asks for no SSE header when the store is set to none, as Oracle needs', async () => {
    const blobs = bucket('exports-none', 'none');
    await blobs.client.send(new CreateBucketCommand({ Bucket: 'exports-none' }));
    await blobs.put('t/exports/2/people.csv', new Uint8Array([1, 2, 3]), 'text/csv');
    const head = await blobs.client.send(
      new HeadObjectCommand({ Bucket: 'exports-none', Key: 't/exports/2/people.csv' }),
    );
    expect(head.ServerSideEncryption).toBeUndefined();
    expect((await blobs.get('t/exports/2/people.csv'))?.body).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('sweeps by upload time, bounded by the limit', async () => {
    const blobs = bucket('exports-b');
    await blobs.client.send(new CreateBucketCommand({ Bucket: 'exports-b' }));
    for (const k of ['a', 'b', 'c']) await blobs.put(k, new Uint8Array([1]), 'text/csv');

    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(await blobs.deleteExpired((_, at) => at < Date.parse(past), 10)).toBe(0);
    expect(await blobs.deleteExpired((_, at) => at < Date.parse(future), 2)).toBe(2);
    expect(await blobs.deleteExpired((_, at) => at < Date.parse(future), 10)).toBe(1);
    expect(await blobs.get('a')).toBeNull();
  });
});

describe('the ledger', () => {
  it('completes an export once, and another tenant cannot see it', async () => {
    const inTenant = tenantTransaction(asService);
    const ledger = drizzleExportLedger();
    const exportId = '00000000-0000-4000-9000-000000000001';
    const run = {
      tenantId: ACME,
      exportId,
      requestedBy: HR.accountId,
      rowCount: 3,
      fileNames: ['people.csv', "o'brien.csv"],
      expiresAt: '2026-09-23T09:00:00.000Z',
    };

    await inTenant(ACME, ({ tx }) => ledger.queue(tx, run));
    expect(await inTenant(ACME, ({ tx }) => ledger.find(tx, ACME, exportId))).toMatchObject({
      status: 'queued',
    });
    expect(await inTenant(ACME, ({ tx }) => ledger.complete(tx, run))).toBe(true);
    expect(await inTenant(ACME, ({ tx }) => ledger.complete(tx, run))).toBe(false);
    expect(await inTenant(ACME, ({ tx }) => ledger.find(tx, ACME, exportId))).toEqual({
      status: 'completed',
      ...run,
    });
    expect(await inTenant(GLOBEX, ({ tx }) => ledger.find(tx, ACME, exportId))).toBeNull();
  });
});

describe('the full-values table', () => {
  it('round-trips a request, lets each step win once, and hides it from another tenant', async () => {
    const inTenant = tenantTransaction(asService);
    const store = drizzleFullValuesStore();
    const pending: FullValuesRequest = {
      tenantId: ACME,
      approval: {
        id: '00000000-0000-4000-9000-0000000000f1',
        requestedBy: '00000000-0000-4000-8000-0000000000fe',
        requestedAt: '2026-09-22T09:00:00.000Z',
        reason: 'September payroll run',
        expiresAt: '2026-09-29T09:00:00.000Z',
        state: 'pending',
        decidedBy: null,
        decidedAt: null,
        note: null,
      },
      attributeKeys: ['iban'],
      asOf: '2026-09-01',
      personIds: ['00000000-0000-4000-8000-0000000000a1'],
      filter: null,
      exportId: null,
      fileName: null,
      grant: null,
    };
    await inTenant(ACME, ({ tx }) => store.insert(tx, pending));
    expect(await inTenant(ACME, ({ tx }) => store.find(tx, ACME, pending.approval.id))).toEqual(
      pending,
    );
    expect(
      await inTenant(GLOBEX, ({ tx }) => store.find(tx, ACME, pending.approval.id)),
    ).toBeNull();

    const approved: FullValuesRequest = {
      ...pending,
      approval: {
        ...pending.approval,
        state: 'approved',
        decidedBy: HR.accountId,
        decidedAt: '2026-09-22T10:00:00.000Z',
      },
    };
    expect(await inTenant(ACME, ({ tx }) => store.update(tx, pending, approved))).toBe(true);
    expect(await inTenant(ACME, ({ tx }) => store.update(tx, pending, approved))).toBe(false);

    const issued: FullValuesRequest = {
      ...approved,
      exportId: '00000000-0000-4000-9000-0000000000f2',
      fileName: 'people-2026-09-22.xlsx',
      grant: {
        issuedAt: '2026-09-22T10:01:00.000Z',
        expiresAt: '2026-09-23T10:01:00.000Z',
        usedAt: null,
      },
    };
    expect(await inTenant(ACME, ({ tx }) => store.update(tx, approved, issued))).toBe(true);
    const used = {
      ...issued,
      grant: {
        issuedAt: '2026-09-22T10:01:00.000Z',
        expiresAt: '2026-09-23T10:01:00.000Z',
        usedAt: '2026-09-22T11:00:00.000Z',
      },
    };
    expect(await inTenant(ACME, ({ tx }) => store.update(tx, issued, used))).toBe(true);
    // The second click finds the download spent.
    expect(await inTenant(ACME, ({ tx }) => store.update(tx, issued, used))).toBe(false);
    expect(await inTenant(ACME, ({ tx }) => store.find(tx, ACME, pending.approval.id))).toEqual(
      used,
    );
  });

  it('refuses, in the database too, a request decided by its own requester', async () => {
    const inTenant = tenantTransaction(asService);
    const store = drizzleFullValuesStore();
    const base: FullValuesRequest = {
      tenantId: ACME,
      approval: {
        id: '00000000-0000-4000-9000-0000000000f3',
        requestedBy: HR.accountId,
        requestedAt: '2026-09-22T09:00:00.000Z',
        reason: 'r',
        expiresAt: '2026-09-29T09:00:00.000Z',
        state: 'pending',
        decidedBy: null,
        decidedAt: null,
        note: null,
      },
      attributeKeys: ['iban'],
      asOf: null,
      personIds: null,
      filter: null,
      exportId: null,
      fileName: null,
      grant: null,
    };
    await inTenant(ACME, ({ tx }) => store.insert(tx, base));
    const self = {
      ...base,
      approval: {
        ...base.approval,
        state: 'approved' as const,
        decidedBy: HR.accountId,
        decidedAt: base.approval.requestedAt,
      },
    };
    await expect(inTenant(ACME, ({ tx }) => store.update(tx, base, self))).rejects.toThrow();
  });
});

describe('the queue', () => {
  it('runs a large export once on BullMQ, retrying a failed attempt', async () => {
    const people = financeTenant();
    const clock = fixedClock('2026-09-22T09:00:00.000Z');
    const events: PendingEvent[] = [];
    const sent: string[] = [];
    const objects = localObjectStore({
      encryptionKey: randomBytes(32),
      signingKey: randomBytes(32),
      clock,
      baseUrl: 'https://p.test/f',
    });
    let puts = 0;
    let ids = 0;
    const deps: ExportJobDeps = { calendars: utcCalendars,
      access: personAccess(people.deps),
      schemas: people.deps.schemas,
      relations: people.deps.relations,
      records: people.deps,
      clock,
      // The first attempt fails where a bucket would, before anything is recorded.
      store: {
        ...objects,
        put: (...args) =>
          (puts += 1) === 1
            ? Promise.reject(new Error('bucket unreachable'))
            : objects.put(...args),
      },
      notifier: { notify: (m) => (sent.push(m.exportId), Promise.resolve()) },
      audit: { publish: (_tx, e) => (events.push(...e), Promise.resolve()) },
      ledger: inMemoryExportLedger(),
      newId: () => `00000000-0000-4000-9000-${String((ids += 1)).padStart(12, '0')}`,
    };
    const inTenant = <R>(_t: string, fn: (s: { tx: typeof noTransaction }) => Promise<R>) =>
      fn({ tx: noTransaction });

    const runner = await startExportRunner({ VALKEY_URL: valkeyUrl }, inTenant, deps);
    try {
      const queued = await requestExport(noTransaction, deps, {
        ...asking(HR),
        format: 'csv',
        personIds: Array.from({ length: 2001 }, () => ADA),
        reason: 'audit',
      });
      if (!queued.ok || queued.value.status !== 'queued') throw new Error('not queued');
      await runner.enqueue(queued.value.job);
      await runner.enqueue(queued.value.job);

      const deadline = systemClock.instant();
      while (sent.length === 0 && Date.now() - Date.parse(deadline) < 60_000) {
        await new Promise((r) => setTimeout(r, 250));
      }
      expect(puts).toBeGreaterThan(1);
      expect(sent).toEqual([queued.value.exportId]);
      expect(events.map((e) => e.eventName)).toEqual(['people.export.completed']);
    } finally {
      await runner.close();
    }
  });
});
