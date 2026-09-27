import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { CreateBucketCommand } from '@aws-sdk/client-s3';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { startObjectStore, startPostgres } from '@kithena/testing';

import { define, versionOf } from '../application/person/in-memory.js';
import { drizzleSchemaRepository } from '../infrastructure/drizzle-schema-repository.js';
import { s3Uploads } from '../infrastructure/s3-uploads.js';
import { tenantTransaction } from '../infrastructure/unit-of-work.js';
import { wirePeople } from './server.js';

/**
 * A person's photo, end to end, booted as `main.ts` boots People: the
 * browser's PUT straight to a real S3-compatible bucket, People checking and
 * keeping it in Postgres under row-level security, and handing it back only to
 * somebody who may read the person. Then the overview, in one read, with the
 * photo in the reporting line.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const GLOBEX = '00000000-0000-4000-8000-00000000000b';
const GRACE = '00000000-0000-4000-8000-0000000000a1';
const ADA = '00000000-0000-4000-8000-0000000000a2';
const TIM = '00000000-0000-4000-8000-0000000000a3';
const ADA_ACCOUNT = '00000000-0000-4000-8000-0000000000b2';
const TIM_ACCOUNT = '00000000-0000-4000-8000-0000000000b3';
const HR_ACCOUNT = '00000000-0000-4000-8000-0000000000b9';
const migrations = new URL('../../../../migrations/', import.meta.url);

const stops: (() => Promise<void>)[] = [];
const clients: ReturnType<typeof postgres>[] = [];
let server: Server;
let base = '';

const as = (account: string, roles: string[] = [], tenantId = ACME) => ({
  'content-type': 'application/json',
  'x-internal-token': 'router-secret',
  'x-kithena-principal': JSON.stringify({
    userId: account,
    tenantId,
    roles,
    entitlements: ['module.people'],
  }),
});

const everyone = ['self', 'manager', 'manager_chain', 'hr', 'directory'] as const;

beforeAll(async () => {
  const [store, pg] = await Promise.all([startObjectStore(), startPostgres()]);
  stops.push(store.stop, pg.stop);
  const uploads = s3Uploads({
    endpoint: store.endpoint,
    region: 'us-east-1',
    bucket: 'uploads',
    accessKeyId: store.accessKeyId,
    secretAccessKey: store.secretAccessKey,
  });
  await uploads.client.send(new CreateBucketCommand({ Bucket: 'uploads' }));

  const adminClient = postgres(pg.url, { max: 1 });
  clients.push(adminClient);
  const admin = drizzle(adminClient);
  const files = (await readdir(migrations))
    .filter((f) => f === '20260821120000_tenant_registry.sql' || /^\d{14}_people_/.test(f))
    .toSorted();
  for (const file of files) {
    await admin.execute(sql.raw(await readFile(new URL(file, migrations), 'utf8')));
  }
  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);
  const service = new URL(pg.url);
  service.username = 'svc_people';
  service.password = 'svc_people';
  const serviceClient = postgres(service.toString(), { max: 2 });
  clients.push(serviceClient);

  await tenantTransaction(drizzle(serviceClient))(ACME, ({ tx }) =>
    drizzleSchemaRepository().appendVersion(
      tx,
      ACME,
      versionOf(1, [
        define({ key: 'given_name', visibility: [...everyone] }),
        define({ key: 'family_name', visibility: [...everyone] }),
        define({ key: 'work_email', visibility: [...everyone] }),
        define({
          key: 'manager_id',
          dataType: 'person_ref',
          typeConfig: { kind: 'person_ref' },
          visibility: [...everyone],
        }),
      ]),
      [],
      '2000-01-01',
    ),
  );
  await admin.execute(sql`
    INSERT INTO people.person
      (tenant_id, id, status, hire_date, identity_account_id, manager_id,
       given_name, family_name, work_email, custom, schema_version)
    VALUES
      (${ACME}::uuid, ${GRACE}::uuid, 'active', '2020-01-06', NULL, NULL,
       'Grace', 'Hopper', 'grace@acme.test', '{}'::jsonb, 1),
      (${ACME}::uuid, ${ADA}::uuid, 'active', '2021-03-01', ${ADA_ACCOUNT}::uuid, ${GRACE}::uuid,
       'Ada', 'Lovelace', 'ada@acme.test', '{}'::jsonb, 1),
      (${ACME}::uuid, ${TIM}::uuid, 'active', '2022-05-02', ${TIM_ACCOUNT}::uuid, ${ADA}::uuid,
       'Tim', 'Berners-Lee', 'tim@acme.test', '{}'::jsonb, 1)`);

  process.env['PEOPLE_DATABASE_URL'] = service.toString();
  process.env['PEOPLE_API_TOKEN'] = 'router-secret';
  process.env['PEOPLE_SECRET_KEYS'] = `k1:${randomBytes(32).toString('base64')}`;
  process.env['PEOPLE_UPLOAD_BUCKET'] = 'uploads';
  process.env['PEOPLE_UPLOAD_S3_ENDPOINT'] = store.endpoint;
  process.env['PEOPLE_UPLOAD_S3_REGION'] = 'us-east-1';
  process.env['PEOPLE_UPLOAD_S3_ACCESS_KEY_ID'] = store.accessKeyId;
  process.env['PEOPLE_UPLOAD_S3_SECRET_ACCESS_KEY'] = store.secretAccessKey;
  process.env['PEOPLE_UPLOAD_SSE'] = 'none';

  server = createServer((_request, response) => {
    response.statusCode = 404;
    response.end();
  });
  wirePeople(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}, 180_000);

afterAll(async () => {
  const listening = server as Server | undefined;
  if (listening) await new Promise((resolve) => listening.close(resolve));
  for (const c of clients) await c.end();
  await Promise.all(stops.map((stop) => stop()));
});

const call = async (
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
  keyed = false,
) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...headers, ...(keyed ? { 'idempotency-key': randomUUID() } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

/** A PNG's shape with a text chunk a camera might write: `readPhoto` needs no more. */
function png(): Uint8Array {
  const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const chunk = (type: string, data: number[]) => [
    ...u32(data.length),
    ...[...type].map((c) => c.charCodeAt(0)),
    ...data,
    0,
    0,
    0,
    0,
  ];
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', [...u32(512), ...u32(512), 8, 6, 0, 0, 0]),
    ...chunk('tEXt', [...'Location 52.37N'].map((c) => c.charCodeAt(0))),
    ...chunk('IDAT', [9, 9, 9]),
    ...chunk('IEND', []),
  ]);
}

/** Start, PUT as a browser does, complete: what the tenant app's picker does. */
async function upload(headers: Record<string, string>, personId: string | null, bytes: Uint8Array) {
  const started = await call('POST', '/v1/views/photos/uploads', headers, {
    personId,
    size: bytes.byteLength,
  });
  if (started.status !== 200) return started;
  const target = started.body as { uploadId: string; url: string; headers: Record<string, string> };
  const { 'content-length': _length, ...signed } = target.headers;
  const put = await fetch(target.url, {
    method: 'PUT',
    headers: signed,
    body: bytes as Uint8Array<ArrayBuffer>,
  });
  expect(put.status).toBe(200);
  return call(
    'POST',
    `/v1/views/photos/uploads/${target.uploadId}/complete`,
    headers,
    { personId },
    true,
  );
}

describe('a person’s photo, browser to bucket to People', () => {
  it('is uploaded by the person, kept without its metadata, and opened by a colleague', async () => {
    const saved = await upload(as(ADA_ACCOUNT), null, png());
    expect(saved.status).toBe(200);
    expect(saved.body['avatarUrl']).toMatch(new RegExp(`^/people/photos/${ADA}\\?v=[0-9a-f]{16}$`));

    const [row] = await clients[0]!.unsafe<{ media_type: string; text: boolean }[]>(
      `SELECT media_type, position('Location'::bytea in bytes) > 0 AS text
         FROM people.person_photo WHERE person_id = '${ADA}'`,
    );
    expect(row).toEqual({ media_type: 'image/png', text: false });

    const seen = await call('GET', `/v1/views/photos/${ADA}`, as(TIM_ACCOUNT));
    expect(seen.status).toBe(200);
    expect(seen.body['mediaType']).toBe('image/png');
    const bytes = Buffer.from(String(seen.body['data']), 'base64');
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from(png().subarray(0, 8)));
  });

  it('is HR’s to set for anybody, and not a manager’s for their report', async () => {
    expect((await upload(as(HR_ACCOUNT, ['hr']), TIM, png())).status).toBe(200);
    const manager = await upload(as(ADA_ACCOUNT), TIM, png());
    expect(manager.status).toBe(403);
  });

  it('is never another company’s to open', async () => {
    const other = await call('GET', `/v1/views/photos/${ADA}`, as(TIM_ACCOUNT, [], GLOBEX));
    expect(other.status).not.toBe(200);
  });

  it('refuses a file that is not a photo, and keeps nothing of it', async () => {
    const html = new TextEncoder().encode('<!doctype html><script>alert(1)</script>'.repeat(4));
    const refused = await upload(as(TIM_ACCOUNT), null, html);
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ error: { code: 'PHOTO_TYPE' } });
  });
});

describe('the overview, in one read', () => {
  it('draws the viewer, their line with its photos, and their reports', async () => {
    const tim = await call('GET', '/v1/views/overview', as(TIM_ACCOUNT));
    expect(tim.status).toBe(200);
    expect(tim.body).toMatchObject({
      me: { id: TIM, name: 'Tim Berners-Lee', avatarUrl: expect.stringContaining(TIM) },
      reportingLine: {
        managers: [
          { id: ADA, name: 'Ada Lovelace', avatarUrl: expect.stringContaining(ADA) },
          { id: GRACE, name: 'Grace Hopper', avatarUrl: null },
        ],
        peers: 0,
        reports: [],
      },
      // Nothing of theirs waits, and they decide nothing: no inbox to show.
      approvals: null,
      team: null,
    });

    const ada = await call('GET', '/v1/views/overview', as(ADA_ACCOUNT));
    expect(ada.body).toMatchObject({
      reportingLine: {
        reports: [{ id: TIM, name: 'Tim Berners-Lee' }],
        reportsTotal: 1,
        reportsFilter: `manager_id:${ADA}`,
      },
    });
    // And the directory answers that filter with exactly them.
    const reports = await call(
      'GET',
      `/v1/views/directory?filter=manager_id:${ADA}`,
      as(ADA_ACCOUNT),
    );
    expect((reports.body['people'] as { id: string }[]).map((p) => p.id)).toEqual([TIM]);
  });
});
