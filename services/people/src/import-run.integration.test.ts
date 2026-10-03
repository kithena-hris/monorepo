import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startObjectStore, startPostgres } from '@kithena/testing';

/**
 * An approved import outlives the process that started it (docs/ai-settings.md,
 * "Approve and run"): the real `main.ts`, killed with SIGKILL half-way
 * through the people, as a crash or the VM's stop would; a second People
 * picks the run up at boot and finishes it, nobody created twice. And while
 * one import runs, another is refused, at the upload and at the approval.
 *
 * Without `TEMPORAL_ADDRESS`, so the in-process runner drives it: the run's
 * row and its sealed working copies are what make it resumable either way.
 */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const migrations = new URL('../../../migrations/', import.meta.url);
const TENANT = '00000000-0000-4000-8000-0000000000d0';
const OWNER = '00000000-0000-4000-8000-0000000000d9';
const OTHER = '00000000-0000-4000-8000-0000000000d8';

let env: Record<string, string>;
let pgUrl = '';
let stopPg: (() => Promise<void>) | undefined;
let stopObjects: (() => Promise<void>) | undefined;
const children: ChildProcess[] = [];

beforeAll(async () => {
  const [pg, objects] = await Promise.all([startPostgres(), startObjectStore()]);
  stopPg = pg.stop;
  stopObjects = objects.stop;
  pgUrl = pg.url;
  const s3 = new S3Client({
    endpoint: objects.endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: objects.accessKeyId, secretAccessKey: objects.secretAccessKey },
  });
  await s3.send(new CreateBucketCommand({ Bucket: 'uploads' }));
  await s3.send(new CreateBucketCommand({ Bucket: 'exports' }));
  const admin = postgres(pg.url, { max: 1, onnotice: () => {} });
  for (const role of ['svc_identity', 'svc_messaging', 'svc_slack']) {
    await admin.unsafe(`CREATE ROLE ${role} NOLOGIN NOBYPASSRLS`);
  }
  for (const file of (await readdir(migrations)).filter((f) => f.endsWith('.sql')).toSorted()) {
    await admin.unsafe(await readFile(new URL(file, migrations), 'utf8'));
  }
  await admin`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`;
  await admin.end();
  const service = new URL(pg.url);
  service.username = 'svc_people';
  service.password = 'svc_people';
  const key = () => randomBytes(32).toString('base64');
  env = {
    PEOPLE_DATABASE_URL: service.toString(),
    PEOPLE_API_TOKEN: 'router-secret',
    PEOPLE_SECRET_KEYS: `k1:${key()}`,
    // Both buckets on the one object store: the run's working copies are
    // sealed in the export bucket, which is what a second process reads.
    S3_ENDPOINT: objects.endpoint,
    S3_ACCESS_KEY_ID: objects.accessKeyId,
    S3_SECRET_ACCESS_KEY: objects.secretAccessKey,
    PEOPLE_UPLOAD_BUCKET: 'uploads',
    PEOPLE_EXPORT_BUCKET: 'exports',
    PEOPLE_EXPORT_ENCRYPTION_KEY: key(),
    PEOPLE_EXPORT_SIGNING_KEY: key(),
  };
});

afterAll(async () => {
  for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
  await Promise.all([stopPg?.(), stopObjects?.()]);
});

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer().listen(0, () => {
      const { port } = server.address() as { port: number };
      server.close(() => {
        resolve(port);
      });
    });
  });
}

/** `main.ts`, as a deployment starts it, listening once it answers. */
async function boot(): Promise<{ child: ChildProcess; port: number; log: () => string }> {
  const port = await freePort();
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !k.startsWith('VITEST') && k !== 'NODE_ENV' && k !== 'TEMPORAL_ADDRESS',
    ),
  );
  const child = spawn(`${ROOT}node_modules/.bin/tsx`, ['services/people/src/main.ts'], {
    cwd: ROOT,
    env: { ...inherited, ...env, PEOPLE_PORT: String(port), LOG_LEVEL: 'warn' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let log = '';
  const keep = (chunk: Buffer): void => {
    log = (log + chunk.toString()).slice(-6000);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  const deadline = Date.now() + 60_000;
  for (;;) {
    const up = await fetch(`http://127.0.0.1:${String(port)}/v1/openapi.json`)
      .then((r) => r.ok)
      .catch(() => false);
    if (up) break;
    if (child.exitCode !== null) throw new Error(`People exited while booting:\n${log}`);
    if (Date.now() > deadline) throw new Error(`People did not come up:\n${log}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { child, port, log: () => log };
}

interface Answered {
  data?: Record<string, unknown>;
  errors?: { message: string; extensions?: { code?: string } }[];
}

const as = (port: () => number, account: string) => {
  const graph = async (query: string, variables: Record<string, unknown> = {}) =>
    (await (
      await fetch(`http://127.0.0.1:${String(port())}/graphql`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-token': 'router-secret',
          'x-kithena-principal': JSON.stringify({
            userId: account,
            tenantId: TENANT,
            roles: ['people_admin', 'hr'],
            entitlements: ['module.people'],
          }),
        },
        body: JSON.stringify({ query, variables }),
      })
    ).json()) as Answered;
  const startUpload = (name: string, size: number) =>
    graph(
      `mutation ($name: String!, $size: Int!) {
        startImportUpload(name: $name, size: $size) { uploadId url method headers { name value } }
      }`,
      { name, size },
    );
  const upload = async (name: string, file: Uint8Array<ArrayBuffer>) => {
    const started = await startUpload(name, file.byteLength);
    expect(started.errors?.[0]?.message).toBeUndefined();
    const target = started.data?.['startImportUpload'] as {
      uploadId: string;
      url: string;
      method: string;
      headers: { name: string; value: string }[];
    };
    await fetch(target.url, {
      method: target.method,
      headers: Object.fromEntries(
        target.headers.filter((h) => h.name !== 'content-length').map((h) => [h.name, h.value]),
      ),
      body: file,
    });
    const completed = await graph(
      `mutation ($id: ID!) { completeImportUpload(uploadId: $id) {
        __typename ... on ImportMapStage { columns { index status key } }
      } }`,
      { id: target.uploadId },
    );
    expect(completed.errors?.[0]?.message).toBeUndefined();
    const stage = completed.data?.['completeImportUpload'] as {
      columns: { index: number; status: string; key: string | null }[];
    };
    const columns = stage.columns;
    const mapping = Object.fromEntries(
      columns.map((c) => [c.index, c.status === 'mapped' ? c.key : null]),
    );
    return { uploadId: target.uploadId, mapping };
  };
  const approve = (input: unknown, key: string) =>
    graph(
      `mutation ($input: String!, $key: String!) { runImport(input: $input, idempotencyKey: $key) }`,
      { input: JSON.stringify(input), key },
    );
  const run = async (id: string) => {
    const seen = await graph(`query ($id: ID!) { importRun(id: $id) }`, { id });
    expect(seen.errors?.[0]?.message).toBeUndefined();
    return JSON.parse(seen.data?.['importRun'] as string) as {
      status: string;
      label: string;
      phase: string;
      step: string;
      people: { done: number; total: number | null };
      result: { created: number; blocked: number } | null;
      failure: string | null;
    };
  };
  return { graph, startUpload, upload, approve, run };
};

const fixture = (name: string) =>
  readFile(new URL(`./http/${name}`, import.meta.url)).then((b) => new Uint8Array(b));

describe('an approved import, run in the background', () => {
  it('survives its process being killed half-way, and is never run twice at once', async () => {
    let port = 0;
    let a = await boot();
    port = a.port;
    const owner = as(() => port, OWNER);
    const other = as(() => port, OTHER);
    const entity = await owner.graph(
      `mutation { confirmSetupEntity(name: "Meridian Freight", country: "US", idempotencyKey: "mf-entity") { __typename } }`,
    );
    expect(entity.errors?.[0]?.message).toBeUndefined();

    // Two files, two people: the owner's 105 columns, and somebody else's.
    const mine = await owner.upload('meridian.csv', await fixture('meridian-freight.fixture.csv'));
    const theirs = await other.upload('dev.csv', await fixture('dev-export.fixture.csv'));
    const proposed = await owner.graph(
      `mutation ($step: String!) { proposeImportFields(step: $step) }`,
      { step: JSON.stringify(mine) },
    );
    expect(proposed.errors?.[0]?.message).toBeUndefined();
    const proposals = (
      JSON.parse(proposed.data?.['proposeImportFields'] as string) as {
        proposals: { counts: unknown; sensitive: unknown }[];
      }
    ).proposals.map(({ counts: _c, sensitive: _s, ...p }) => p);

    const asked = Date.now();
    const approved = await owner.approve({ ...mine, proposals }, 'mf-run');
    expect(approved.errors?.[0]?.message).toBeUndefined();
    expect(Date.now() - asked).toBeLessThan(2_000);
    const { runId } = JSON.parse(approved.data?.['runImport'] as string) as { runId: string };

    // One at a time: the other file is refused, at the approval and at a new upload.
    const second = await other.approve({ ...theirs, proposals: [] }, 'dev-run');
    expect(second.errors?.[0]?.extensions?.code).toBe('IMPORT_RUNNING');
    expect(second.errors?.[0]?.message).toMatch(/already running/u);
    const again = await other.startUpload('dev.csv', 100);
    expect(again.errors?.[0]?.extensions?.code).toBe('IMPORT_RUNNING');
    const active = await other.graph(`{ activeImportRun }`);
    expect(JSON.parse(active.data?.['activeImportRun'] as string)).toMatchObject({
      id: runId,
      label: 'Importing',
      startedBy: { you: false },
    });

    // Half-way through the people: killed, as a crash or the VM's stop would.
    for (const deadline = Date.now() + 90_000; ;) {
      const seen = await owner.run(runId);
      expect(seen.status).not.toBe('failed');
      if (seen.phase === 'people' && seen.people.done > 0) {
        expect(seen).toMatchObject({ label: 'Importing', step: 'Adding people' });
        expect(seen.people.done).toBeLessThan(seen.people.total ?? 0);
        break;
      }
      if (Date.now() > deadline) throw new Error(`the run did not get going:\n${a.log()}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    a.child.kill('SIGKILL');
    await new Promise((resolve) => a.child.once('exit', resolve));

    // A new People picks it up at boot and finishes it.
    a = await boot();
    port = a.port;
    let done: Awaited<ReturnType<typeof owner.run>> | undefined;
    for (const deadline = Date.now() + 120_000; ;) {
      const seen = await owner.run(runId);
      if (seen.status === 'succeeded' || seen.status === 'failed') {
        done = seen;
        break;
      }
      if (Date.now() > deadline) throw new Error(`the run did not finish:\n${a.log()}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(done.failure).toBeNull();
    expect(done).toMatchObject({ status: 'succeeded', label: 'Imported' });
    expect(done.result).toMatchObject({ created: 100, blocked: 0 });

    // Everybody once: a hundred rows, a hundred people, a hundred work emails.
    const db = postgres(pgUrl, { max: 1 });
    try {
      const [people] = (await db.unsafe(
        `SELECT count(*)::int AS n, count(DISTINCT work_email)::int AS emails
           FROM people.person WHERE tenant_id = $1::uuid`,
        [TENANT],
      )) as unknown as { n: number; emails: number }[];
      expect(people).toEqual({ n: 100, emails: 100 });
      // And each person's events once: a hundred hires, one import started and completed.
      const events = (await db.unsafe(
        `SELECT event_name AS name, count(*)::int AS n FROM people.outbox
          WHERE tenant_id = $1::uuid GROUP BY 1`,
        [TENANT],
      )) as unknown as { name: string; n: number }[];
      const counted = Object.fromEntries(events.map((e) => [e.name, e.n]));
      expect(counted).toMatchObject({
        'people.person.hired': 100,
        'people.import.started': 1,
        'people.import.completed': 1,
      });
      const [ledger] = (await db.unsafe(
        `SELECT counts->>'created' AS created FROM people.import WHERE tenant_id = $1::uuid AND id = $2::uuid`,
        [TENANT, runId],
      )) as unknown as { created: string }[];
      expect(ledger?.created).toBe('100');
    } finally {
      await db.end();
    }

    // Over: the other file may go now.
    const free = await other.graph(`{ activeImportRun }`);
    expect(JSON.parse(free.data?.['activeImportRun'] as string)).toBeNull();
  });
});
