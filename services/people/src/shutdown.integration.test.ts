import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPostgres, startRedpanda } from '@kithena/testing';

/**
 * PEO-118: the real `main.ts`, with its database, its broker and its
 * background work, stopped the way an orchestrator stops it.
 *
 * SIGTERM with a request half sent: the listener closes to new connections,
 * the request in flight still gets its answer, and then the process exits 0
 * on its own — the pools, the consumers and the pollers all let go of the
 * event loop. A request that never finishes holds the drain until the
 * deadline, which exits 1.
 */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const migrations = new URL('../../../migrations/', import.meta.url);

let env: Record<string, string>;
let stopPg: (() => Promise<void>) | undefined;
let stopKafka: (() => Promise<void>) | undefined;
const children: ChildProcess[] = [];

beforeAll(async () => {
  const [pg, kafka] = await Promise.all([startPostgres(), startRedpanda()]);
  stopPg = pg.stop;
  stopKafka = kafka.stop;
  const admin = postgres(pg.url, { max: 1, onnotice: () => {} });
  const files = (await readdir(migrations))
    .filter((f) => f === '20260821120000_tenant_registry.sql' || /^\d{14}_people_/.test(f))
    .toSorted();
  for (const file of files) {
    await admin.unsafe(await readFile(new URL(file, migrations), 'utf8'));
  }
  await admin`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`;
  await admin.end();
  const service = new URL(pg.url);
  service.username = 'svc_people';
  service.password = 'svc_people';
  env = {
    PEOPLE_DATABASE_URL: service.toString(),
    KAFKA_BROKERS: kafka.brokers,
    PEOPLE_SECRET_KEYS: `k1:${randomBytes(32).toString('base64')}`,
  };
});

afterAll(async () => {
  for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
  await Promise.all([stopPg?.(), stopKafka?.()]);
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

async function boot(extra: Record<string, string> = {}): Promise<{
  child: ChildProcess;
  port: number;
  exited: Promise<number | null>;
  log: () => string;
}> {
  const port = await freePort();
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('VITEST') && k !== 'NODE_ENV'),
  );
  const child = spawn(`${ROOT}node_modules/.bin/tsx`, ['services/people/src/main.ts'], {
    cwd: ROOT,
    env: { ...inherited, ...env, PEOPLE_PORT: String(port), LOG_LEVEL: 'warn', ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let log = '';
  const keep = (chunk: Buffer): void => {
    log = (log + chunk.toString()).slice(-4000);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => {
      resolve(code);
    });
  });
  const deadline = Date.now() + 60_000;
  for (;;) {
    const ok = await fetch(`http://127.0.0.1:${String(port)}/v1/openapi.json`)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) break;
    if (child.exitCode !== null) throw new Error(`People exited while booting:\n${log}`);
    if (Date.now() > deadline) throw new Error(`People did not come up:\n${log}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  // Long enough for the consumers to join and the first background tick to run.
  await new Promise((resolve) => setTimeout(resolve, 2000));
  return { child, port, exited, log: () => log };
}

/** A GraphQL request whose body is sent in two halves, the second on demand. */
function halfSent(port: number): {
  finish: () => void;
  answer: Promise<{ status: number; body: string }>;
} {
  const body = JSON.stringify({ query: '{ __typename }' });
  const at = Math.floor(body.length / 2);
  let finish = (): void => {};
  const answer = new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: '/graphql',
        method: 'POST',
        agent: false,
        headers: { 'content-type': 'application/json', 'content-length': String(body.length) },
      },
      (res) => {
        let text = '';
        res.on('data', (chunk: Buffer) => {
          text += chunk.toString();
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: text });
        });
      },
    );
    req.on('error', reject);
    req.write(body.slice(0, at));
    finish = () => {
      req.end(body.slice(at));
    };
  });
  return {
    finish: () => {
      finish();
    },
    answer,
  };
}

const within = <T>(ms: number, p: Promise<T>): Promise<T | 'timeout'> =>
  Promise.race([
    p,
    new Promise<'timeout'>((r) => {
      setTimeout(() => {
        r('timeout');
      }, ms);
    }),
  ]);

describe('SIGTERM (PEO-118)', () => {
  it('answers the request in flight, refuses new ones, and exits 0', async () => {
    const { child, port, exited, log } = await boot();
    const inFlight = halfSent(port);
    await new Promise((resolve) => setTimeout(resolve, 200));

    child.kill('SIGTERM');
    // Not a fixed sleep: on a loaded runner the listener may still be open
    // 500 ms after the signal. Poll until a new connection is refused, within a
    // bound; the half-sent request keeps the process alive meanwhile.
    const until = async (done: () => Promise<boolean> | boolean, ms: number) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        // eslint-disable-next-line no-await-in-loop -- polling one condition, in order
        if (await done()) return true;
        // eslint-disable-next-line no-await-in-loop -- as above
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return false;
    };
    const refuses = () =>
      fetch(`http://127.0.0.1:${String(port)}/v1/openapi.json`).then(
        () => false,
        () => true,
      );
    expect(await until(refuses, 10_000), log()).toBe(true);
    // Still running: the half-sent request holds the drain open.
    expect(child.exitCode).toBeNull();

    inFlight.finish();
    const answer = await inFlight.answer;
    expect(answer.status).toBe(200);
    expect(answer.body).toContain('__typename');
    expect(await within(10_000, exited), log()).toBe(0);
  });

  it('exits 1 when the drain outlives the deadline', async () => {
    const { child, port, exited } = await boot({ SHUTDOWN_DEADLINE_MS: '1500' });
    const inFlight = halfSent(port);
    inFlight.answer.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 200));
    child.kill('SIGTERM');
    expect(await within(10_000, exited)).toBe(1);
  });
});
