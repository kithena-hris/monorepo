import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { createServer as httpServer } from 'node:http';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as httpsServer, type Server as HttpsServer } from 'node:https';
import { connect, createServer as netServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { startCosmoRouter, startObjectStore, startOpenFga, startPostgres } from '@kithena/testing';

/**
 * The tenant app as a person meets it, for the acceptance tests (PEO-098,
 * PEO-113).
 *
 * Real, all of it: Postgres with every migration, OpenFGA, identity (the
 * sessions, the tenant registry and the access token it issues the shell),
 * the Cosmo Router from `apps/gateway/config.yaml`, the People service, the
 * People remote from a production build, and the shell from a production
 * build (`next build`, `next start`). The shell reaches People only through
 * the router, with identity's token; it is given no address or token for
 * People, and People's internal token is not the shell's. Everything is
 * bounded and everything is stopped in `stop()`, whatever state the run
 * ended in.
 */

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const TENANT = '00000000-0000-4000-8000-00000000ac00';
export const ADMIN = {
  person: '00000000-0000-4000-8000-0000000000a1',
  account: '00000000-0000-4000-8000-0000000000b1',
  identity: '00000000-0000-4000-8000-0000000000c1',
  session: '00000000-0000-4000-8000-0000000000d1',
  email: 'priya@acme.example',
};
export const EMPLOYEE = {
  person: '00000000-0000-4000-8000-0000000000a2',
  account: '00000000-0000-4000-8000-0000000000b2',
  identity: '00000000-0000-4000-8000-0000000000c2',
  session: '00000000-0000-4000-8000-0000000000d2',
  email: 'adam@acme.example',
};
/** What the shell holds: identity's internal token, and nothing of People's. */
const SHELL_TOKEN = 'acceptance-shell-token';
/** What only the router holds for People (`PEOPLE_API_TOKEN`). */
const PEOPLE_TOKEN = 'acceptance-people-token';
/** What People presents to identity (`PEOPLE_IDENTITY_TOKEN`), and identity expects of it. */
const PEOPLE_IDENTITY_TOKEN = 'acceptance-people-identity-token';
const AUDIENCE = 'kithena-router';

export interface Stack {
  readonly shell: string;
  readonly sql: postgres.Sql;
  /** The shell's environment as it was started, for a test to read. */
  readonly shellEnv: Readonly<Record<string, string>>;
  /** The router, as the shell reaches it, put to sleep and woken: the VM asleep, then up. */
  readonly router: { readonly asleep: () => void; readonly awake: () => void };
  /** People's own address: for a test to show it refuses anybody but the router. */
  readonly peopleUrl: string;
  readonly shellToken: string;
  /** People's REST, as the router would call it: for a test to check a result without a screen. */
  asPeople(account: string, path: string): Promise<unknown>;
  /** OpenFGA tuples, as People's consumer writes them from its events; there is no Kafka here. */
  writeTuples(tuples: readonly { user: string; relation: string; object: string }[]): Promise<void>;
  /**
   * A company as the back office creates one: identity's admin route, then
   * identity's events and People's own delivered to People's consumer, as
   * Debezium and Redpanda would. Nothing is set up in People. The
   * administrator is then signed in, as their passkey would leave them.
   */
  provisionCompany(company: {
    readonly slug: string;
    readonly displayName: string;
    readonly admin: string;
    /** Where the company is: People's first legal entity and its zone. Spain when absent. */
    readonly address?: Readonly<Record<string, string>>;
    readonly timeZone?: string;
    readonly entitlements?: readonly string[];
    /** The name the administrator gives on enrolling, which identity then reports. */
    readonly name?: { readonly given: string; readonly family: string; readonly preferred?: string };
  }): Promise<{ tenantId: string; account: string; session: string; shell: string }>;
  /**
   * A webhook receiver on loopback, over HTTPS with a certificate made for this
   * run: what an endpoint points at, so a delivery or a replay never leaves
   * the machine. People trusts the certificate through `NODE_EXTRA_CA_CERTS`
   * and accepts loopback through `PEOPLE_WEBHOOKS_ALLOW_LOOPBACK`, a switch
   * `egressPolicyFrom` ignores in production.
   */
  readonly receiver: { readonly url: string; readonly received: readonly ReceivedHook[] };
  /** A keyed write to People's REST, as the router would send it, for a test's setup. */
  writeAsPeople(
    account: string,
    path: string,
    body: unknown,
  ): Promise<{ status: number; body: unknown }>;
  stop(): Promise<void>;
}

export interface ReceivedHook {
  readonly path: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: string;
}

/** A self-signed certificate for 127.0.0.1, by the openssl every runner has. */
async function loopbackCertificate(dir: string): Promise<{ key: string; cert: string }> {
  const key = join(dir, 'receiver.key');
  const cert = join(dir, 'receiver.crt');
  await run(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:prime256v1',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
    ],
    dir,
    30_000,
  );
  return { key, cert };
}

/** Answers 200 to anything, and keeps what it was sent. */
async function startReceiver(
  key: string,
  cert: string,
): Promise<{ server: HttpsServer; url: string; received: ReceivedHook[] }> {
  const received: ReceivedHook[] = [];
  const server = httpsServer(
    { key: await readFile(key), cert: await readFile(cert) },
    (request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        received.push({
          path: request.url ?? '/',
          headers: request.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        response.writeHead(200).end();
      });
    },
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address !== 'object' || address === null) throw new Error('no receiver port');
  return { server, url: `https://127.0.0.1:${String(address.port)}`, received };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = netServer();
    server.once('error', reject);
    server.listen(0, () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === 'object' && address !== null) resolve(address.port);
        else reject(new Error('no port'));
      });
    });
  });
}

/**
 * `target` again, `ms` further away each way: what the shell meets in
 * production, where People is a network hop from the function asking. For a
 * timing run (`ACCEPTANCE_ROUTER_LATENCY_MS`); nothing else uses it.
 */
async function distant(target: string, ms: number): Promise<string> {
  const { hostname, port } = new URL(target);
  // `ACCEPTANCE_SLOW_OPERATION=TransferHistory:400`: that operation takes
  // longer still, as one doing more work in People would.
  const [slowName = '', slowMs = '0'] = (process.env['ACCEPTANCE_SLOW_OPERATION'] ?? '').split(':');
  const later = (to: Socket) => (chunk: Buffer) => setTimeout(() => to.write(chunk), ms);
  const asked = (to: Socket) => (chunk: Buffer) =>
    setTimeout(
      () => to.write(chunk),
      slowName !== '' && chunk.includes(`"operationName":"${slowName}"`) ? ms + Number(slowMs) : ms,
    );
  const server = netServer((client) => {
    const upstream = connect(Number(port), hostname);
    client.on('data', asked(upstream));
    upstream.on('data', later(client));
    for (const [a, b] of [
      [client, upstream],
      [upstream, client],
    ] as const) {
      a.on('end', () => setTimeout(() => b.end(), ms));
      a.on('error', () => b.destroy());
    }
  });
  server.unref();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return `http://127.0.0.1:${String(address.port)}${new URL(target).pathname.replace(/\/$/, '')}`;
}

/**
 * The remote as Vercel serves it from `apps/web/people/vercel.json`, in front
 * of `vite preview`, which answers CORS and revalidation its own way.
 *
 * - `remoteEntry.js`, `routes.json` and `ssr/*` are `no-cache`; `assets/*` take
 *   Vercel's default, `public, max-age=0, must-revalidate`.
 * - `Access-Control-Allow-Origin` echoes a tenant origin, with `Vary: Origin`,
 *   on a 200.
 * - A conditional request that still matches gets a 304 with the ETag and
 *   `Vary`, and **no** `Access-Control-Allow-Origin`, which is what Vercel
 *   does and what broke a second company in one browser.
 */
async function asDeployed(target: string): Promise<string> {
  const tenant = /^http:\/\/[a-z0-9-]+\.app\.localhost:\d+$/;
  const server = httpServer((request, response) => {
    const path = request.url ?? '/';
    void fetch(`${target}${path}`)
      .then(async (upstream) => {
        const body = Buffer.from(await upstream.arrayBuffer());
        if (!upstream.ok) {
          response.writeHead(upstream.status).end(body);
          return;
        }
        const etag = `"${createHash('sha1').update(body).digest('hex')}"`;
        const vary = { etag, vary: 'Origin' };
        if (request.headers['if-none-match'] === etag) {
          response.writeHead(304, vary).end();
          return;
        }
        const origin = request.headers.origin;
        response
          .writeHead(200, {
            ...vary,
            'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
            'cache-control': path.startsWith('/assets/')
              ? 'public, max-age=0, must-revalidate'
              : 'no-cache',
            'x-content-type-options': 'nosniff',
            ...(origin !== undefined && tenant.test(origin)
              ? { 'access-control-allow-origin': origin }
              : {}),
          })
          .end(body);
      })
      .catch(() => {
        response.writeHead(502).end();
      });
  });
  server.unref();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return `http://127.0.0.1:${String(address.port)}`;
}

/**
 * `target` behind a switch: closed, every connection is refused and every
 * open one dropped, as the shell meets a VM asleep (nobody behind the tunnel).
 */
async function gated(target: string): Promise<{ url: string } & Stack['router']> {
  const { hostname, port } = new URL(target);
  let closed = false;
  const open = new Set<Socket>();
  const server = netServer((client) => {
    if (closed) {
      client.destroy();
      return;
    }
    const upstream = connect(Number(port), hostname);
    for (const socket of [client, upstream]) {
      open.add(socket);
      socket.on('close', () => open.delete(socket));
    }
    client.pipe(upstream).pipe(client);
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
  });
  server.unref();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return {
    url: `http://127.0.0.1:${String(address.port)}${new URL(target).pathname.replace(/\/$/, '')}`,
    asleep: () => {
      closed = true;
      for (const socket of open) socket.destroy();
    },
    awake: () => {
      closed = false;
    },
  };
}

async function until(what: string, ms: number, check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${what} did not come up within ${String(ms / 1000)}s`);
}

/** A process in its own group, so `stop` takes its children (next, vite) with it. */
function start(
  command: string,
  args: readonly string[],
  cwd: string,
  env: Record<string, string>,
  log: string[],
): ChildProcess {
  // Not the test runner's environment: `VITEST` and `NODE_ENV=test` make a
  // Vite build transform nothing and a Next build refuse to run. Nor a People
  // address or token from the caller's shell: each process is told its own.
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith('VITEST') &&
        !key.startsWith('PEOPLE_API') &&
        key !== 'NODE_ENV' &&
        key !== 'MODE',
    ),
  );
  const child = spawn(command, args, {
    cwd,
    env: { ...inherited, NODE_ENV: 'production', ...env },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const keep = (chunk: Buffer) => {
    log.push(chunk.toString());
    if (log.length > 200) log.shift();
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  return child;
}

/**
 * Stop a process group with SIGTERM, and wait for it to exit.
 *
 * Every server here exits on SIGTERM — People and identity drain and close
 * their pools (PEO-118), Next and Vite always have. One that is still running
 * after the wait is a bug this suite reports: it is SIGKILLed so no run
 * leaves a server behind, and the rejection fails the run.
 */
async function kill(child: ChildProcess | undefined, name = 'a process'): Promise<void> {
  if (child?.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  const signal = (s: NodeJS.Signals) => {
    try {
      process.kill(-pid, s);
    } catch {
      // Already gone.
    }
  };
  const exited = new Promise<boolean>((resolve) =>
    child.once('exit', () => {
      resolve(true);
    }),
  );
  signal('SIGTERM');
  const timeout = new Promise<boolean>((resolve) =>
    setTimeout(() => {
      resolve(false);
    }, 15_000),
  );
  if (await Promise.race([exited, timeout])) return;
  signal('SIGKILL');
  throw new Error(`${name} did not exit within 15s of SIGTERM`);
}

/** Run to completion, bounded. */
function run(
  command: string,
  args: readonly string[],
  cwd: string,
  ms: number,
  env: Record<string, string> = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const log: string[] = [];
    const child = start(command, args, cwd, env, log);
    const timer = setTimeout(() => {
      // The timeout is the failure reported; a stuck child is SIGKILLed either way.
      kill(child).catch(() => undefined);
      reject(new Error(`${command} ${args.join(' ')} took longer than ${String(ms / 1000)}s`));
    }, ms);
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `${command} ${args.join(' ')} exited ${String(code)}\n${log.join('').slice(-4000)}`,
          ),
        );
    });
  });
}

export async function startStack(): Promise<Stack> {
  const children: ChildProcess[] = [];
  const logs: Record<string, string[]> = {
    people: [],
    identity: [],
    remote: [],
    shell: [],
  };
  let router: Awaited<ReturnType<typeof startCosmoRouter>> | undefined;
  let dir = '';
  let receiver: Awaited<ReturnType<typeof startReceiver>> | undefined;
  const receiverDir = await mkdtemp(join(tmpdir(), 'kithena-receiver-'));
  // The bucket an import is uploaded to, straight from the browser (§14.2).
  const [pg, fga, storage] = await Promise.all([
    startPostgres(),
    startOpenFga(),
    startObjectStore(),
  ]);
  const sql = postgres(pg.url, { max: 2, onnotice: () => {} });

  const stop = async (): Promise<void> => {
    const stopped = await Promise.allSettled(
      children.map((child) => kill(child, child.spawnargs.join(' '))),
    );
    await router?.stop().catch(() => undefined);
    await sql.end({ timeout: 5 }).catch(() => undefined);
    await Promise.allSettled([pg.stop(), fga.stop(), storage.stop()]);
    await new Promise<void>((resolve) => {
      if (receiver)
        receiver.server.close(() => {
          resolve();
        });
      else resolve();
    });
    await rm(receiverDir, { recursive: true, force: true });
    if (dir !== '') await rm(dir, { recursive: true, force: true });
    // After everything else is down, so a failure still cleans up.
    const stuck = stopped.flatMap((s) => (s.status === 'rejected' ? [s.reason as Error] : []));
    if (stuck.length > 0) throw new AggregateError(stuck, 'a server did not stop');
  };

  try {
    // Every migration: identity runs against the same database, with the
    // service roles `tools/scripts/init-db.sql` creates first.
    for (const role of ['svc_identity', 'svc_messaging', 'svc_slack']) {
      await sql.unsafe(`CREATE ROLE ${role} NOLOGIN NOBYPASSRLS`);
    }
    const migrations = join(ROOT, 'migrations');
    for (const file of (await readdir(migrations)).filter((f) => f.endsWith('.sql')).sort()) {
      await sql.unsafe(await readFile(join(migrations, file), 'utf8'));
    }
    await sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`;
    const secretKeys = `k1:${randomBytes(32).toString('base64')}`;

    // What the back office leaves behind: the company, two accounts, and a
    // signed-in session for each — the rows a passkey sign-in writes.
    await sql`INSERT INTO platform.tenant (id, slug, display_name, address_line1, address_city, address_country)
              VALUES (${TENANT}, 'acme', 'Acme', 'Calle Mayor 1', 'Madrid', 'ES')`;
    for (const [who, given, family] of [
      [ADMIN, 'Priya', 'Shah'],
      [EMPLOYEE, 'Adam', 'Ruiz'],
    ] as const) {
      await sql`INSERT INTO platform.identity (id) VALUES (${who.identity})`;
      await sql`INSERT INTO platform.account (id, tenant_id, identity_id, status, work_email, time_zone,
                                             employment_start, session_limit, given_name, family_name)
                VALUES (${who.account}, ${TENANT}, ${who.identity}, 'active', ${who.email},
                        'Europe/Madrid', '2026-01-01', 4, ${given}, ${family})`;
      await sql`INSERT INTO platform.session (id, tenant_id, account_id, slot, expires_at, amr)
                VALUES (${who.session}, ${TENANT}, ${who.account}, 1, now() + interval '1 day', ARRAY['hwk'])`;
    }

    // What identity's provisioning would have left in People: two people, one
    // of them the administrator the operator invited first.
    await sql`INSERT INTO people.person (id, tenant_id, identity_account_id, status, work_email)
              VALUES (${ADMIN.person}, ${TENANT}, ${ADMIN.account}, 'provisional', ${ADMIN.email})`;
    await sql`INSERT INTO people.person (id, tenant_id, identity_account_id, status, work_email, created_at)
              VALUES (${EMPLOYEE.person}, ${TENANT}, ${EMPLOYEE.account}, 'provisional', ${EMPLOYEE.email},
                      now() + interval '1 second')`;
    // What the back office naming Priya People's administrator leaves behind
    // (PEO-112): the ledger rows; the tuples are written below.
    await sql`INSERT INTO people.role_grant (tenant_id, account_id, role)
              VALUES (${TENANT}, ${ADMIN.account}, 'people_admin'), (${TENANT}, ${ADMIN.account}, 'hr')`;

    const service = new URL(pg.url);
    service.username = 'svc_people';
    service.password = 'svc_people';

    const [peoplePort, identityPort, remotePort, shellPort] = await Promise.all([
      freePort(),
      freePort(),
      freePort(),
      freePort(),
    ]);
    const peopleUrl = `http://127.0.0.1:${String(peoplePort)}`;
    // The upload bucket, configured as an operator would: the People script,
    // over the S3 API, allowing PUT from the tenant app's origin alone.
    const uploads = {
      PEOPLE_UPLOAD_BUCKET: 'people-uploads',
      PEOPLE_UPLOAD_S3_ENDPOINT: storage.endpoint,
      PEOPLE_UPLOAD_S3_ACCESS_KEY_ID: storage.accessKeyId,
      PEOPLE_UPLOAD_S3_SECRET_ACCESS_KEY: storage.secretAccessKey,
    };
    await run(
      join(ROOT, 'node_modules/.bin/tsx'),
      ['services/people/src/configure-upload-bucket.ts'],
      ROOT,
      60_000,
      {
        ...uploads,
        // And the companies the acceptance tests make with `provisionCompany`, which import too.
        PEOPLE_UPLOAD_CORS_ORIGINS: ['acme', 'meridian-freight', 'harbour-logistics']
          .map((slug) => `http://${slug}.app.localhost:${String(shellPort)}`)
          .join(','),
      },
    );
    const certificate = await loopbackCertificate(receiverDir);
    receiver = await startReceiver(certificate.key, certificate.cert);
    children.push(
      start(
        join(ROOT, 'node_modules/.bin/tsx'),
        ['services/people/src/main.ts'],
        ROOT,
        {
          PEOPLE_PORT: String(peoplePort),
          PEOPLE_DATABASE_URL: service.toString(),
          PEOPLE_API_TOKEN: PEOPLE_TOKEN,
          PEOPLE_SECRET_KEYS: secretKeys,
          OPENFGA_URL: fga.apiUrl,
          // Where a signed download link points: People itself, for the test to fetch.
          PEOPLE_EXPORT_LINK_BASE: `${peopleUrl}/v1/exports/files`,
          ...uploads,
          // Off production, so the loopback switch below means anything —
          // `egressPolicyFrom` ignores it under NODE_ENV=production.
          NODE_ENV: 'test',
          PEOPLE_WEBHOOKS_ALLOW_LOOPBACK: '1',
          NODE_EXTRA_CA_CERTS: certificate.cert,
          LOG_LEVEL: 'warn',
        },
        logs['people'] ?? [],
      ),
    );

    // Identity, as `main.ts` runs it, signing access tokens for the router.
    const signingKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({
      format: 'jwk',
    });
    children.push(
      start(
        join(ROOT, 'node_modules/.bin/tsx'),
        ['platform/identity/src/main.ts'],
        ROOT,
        {
          NODE_ENV: 'test',
          IDENTITY_PORT: String(identityPort),
          IDENTITY_DATABASE_URL: pg.url,
          INTERNAL_API_TOKEN: SHELL_TOKEN,
          PEOPLE_IDENTITY_TOKEN,
          AUTH_SIGNING_KEY: JSON.stringify(signingKey),
          AUTH_ISSUER: `http://127.0.0.1:${String(identityPort)}`,
          AUTH_TOKEN_AUDIENCE: AUDIENCE,
          KITHENA_ENTITLEMENTS: '["module.people"]',
          LOG_LEVEL: 'warn',
        },
        logs['identity'] ?? [],
      ),
    );
    const identityUrl = `http://127.0.0.1:${String(identityPort)}`;
    await until('People', 60_000, async () => (await fetch(`${peopleUrl}/v1/openapi.json`)).ok);
    await until(
      'identity',
      60_000,
      async () => (await fetch(`${identityUrl}/.well-known/jwks.json`)).ok,
    );

    const principal = (account: string) => ({
      'x-internal-token': PEOPLE_TOKEN,
      'x-kithena-principal': JSON.stringify({
        userId: account,
        tenantId: TENANT,
        roles: [],
        entitlements: ['module.people'],
      }),
      'x-correlation-id': randomUUID(),
    });
    const writeAsPeople = async (account: string, path: string, body: unknown) => {
      const response = await fetch(`${peopleUrl}${path}`, {
        method: 'POST',
        headers: {
          ...principal(account),
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
        },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: (await response.json()) as unknown };
    };
    const asPeople = async (account: string, path: string): Promise<unknown> => {
      const response = await fetch(`${peopleUrl}${path}`, {
        headers: {
          'x-internal-token': PEOPLE_TOKEN,
          'x-kithena-principal': JSON.stringify({
            userId: account,
            tenantId: TENANT,
            roles: [],
            entitlements: ['module.people'],
          }),
          'x-correlation-id': randomUUID(),
        },
      });
      return response.json();
    };

    // People creates its OpenFGA store on first use; then the tuples its
    // consumer writes from `people.person.provisioned` and `people.role.*`
    // (PEO-092, PEO-112), which have no Kafka to arrive through here.
    await asPeople(ADMIN.account, '/v1/views/setup');
    const stores = (await (await fetch(`${fga.apiUrl}/stores`)).json()) as {
      stores: { id: string; name: string }[];
    };
    const store = stores.stores.find((s) => s.name === 'people');
    if (store === undefined) throw new Error('People did not create its OpenFGA store');
    const tuples = [
      { user: `user:${ADMIN.account}`, relation: 'account', object: `person:${ADMIN.person}` },
      {
        user: `user:${EMPLOYEE.account}`,
        relation: 'account',
        object: `person:${EMPLOYEE.person}`,
      },
      { user: `user:${ADMIN.account}`, relation: 'people_admin', object: `tenant:${TENANT}` },
      { user: `user:${ADMIN.account}`, relation: 'hr', object: `tenant:${TENANT}` },
    ];
    const writeTuples = async (
      keys: readonly { user: string; relation: string; object: string }[],
    ): Promise<void> => {
      const wrote = await fetch(`${fga.apiUrl}/stores/${store.id}/write`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ writes: { tuple_keys: keys } }),
      });
      if (!wrote.ok) throw new Error(`OpenFGA refused the tuples: ${await wrote.text()}`);
    };
    await writeTuples(tuples);

    /** Envelopes to People's consumer, through the same `consumerFrom` a deployment runs. */
    const deliver = (envelopes: readonly unknown[]): Promise<void> =>
      new Promise((resolve, reject) => {
        const log: string[] = [];
        const child = spawn(
          join(ROOT, 'node_modules/.bin/tsx'),
          ['services/people/src/seed-local.ts', '--events-only'],
          {
            cwd: ROOT,
            env: {
              PATH: process.env['PATH'] ?? '',
              NODE_ENV: 'test',
              DATABASE_URL: pg.url,
              PEOPLE_DATABASE_URL: service.toString(),
              PEOPLE_SECRET_KEYS: secretKeys,
              OPENFGA_URL: fga.apiUrl,
              IDENTITY_URL: identityUrl,
              PEOPLE_IDENTITY_TOKEN,
              LOG_LEVEL: 'warn',
            },
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        );
        child.stdout.on('data', (chunk: Buffer) => log.push(chunk.toString()));
        child.stderr.on('data', (chunk: Buffer) => log.push(chunk.toString()));
        const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
        child.once('exit', (code) => {
          clearTimeout(timer);
          logs['people']?.push(...log);
          if (code === 0) resolve();
          else reject(new Error(`delivering events exited ${String(code)}\n${log.join('')}`));
        });
        child.stdin.end(envelopes.map((e) => `${JSON.stringify(e)}\n`).join(''));
      });

    const provisionCompany: Stack['provisionCompany'] = async (company) => {
      const created = await fetch(`${identityUrl}/api/internal/admin/tenants`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-token': SHELL_TOKEN },
        // What the back office's company wizard sends (`apps/admin/.../companies/new`).
        body: JSON.stringify({
          slug: company.slug,
          displayName: company.displayName,
          themeId: 'indigo',
          admins: [company.admin],
          timeZone: company.timeZone ?? 'Europe/Madrid',
          address: company.address ?? {
            country: 'ES',
            line1: 'Calle de Alcalá 45',
            city: 'Madrid',
            subdivision: '28',
            postcode: '28014',
          },
          entitlements: company.entitlements ?? ['module.people'],
          administrators: Object.fromEntries(
            (company.entitlements ?? ['module.people']).map((e) => [e, company.admin]),
          ),
          operatorId: randomUUID(),
        }),
      });
      const body = (await created.json()) as { tenantId?: string };
      if (created.status !== 201 || body.tenantId === undefined) {
        throw new Error(`identity refused the company: ${JSON.stringify(body)}`);
      }
      const tenantId = body.tenantId;
      const envelopes = (
        await sql<{ envelope: Record<string, unknown> }[]>`
          SELECT envelope FROM platform.outbox WHERE tenant_id = ${tenantId}
           ORDER BY created_at, event_id`
      ).map((r) => r.envelope);
      const provisioned = envelopes.find((e) => e['eventName'] === 'identity.account.provisioned');
      if (company.name !== undefined && provisioned !== undefined) {
        // Enrolling: what identity's page captures, as identity's outbox would carry it.
        const payload = provisioned['payload'] as Record<string, unknown>;
        const now = new Date().toISOString();
        envelopes.push({
          ...provisioned,
          eventId: randomUUID(),
          eventName: 'identity.account.profile_captured',
          occurredAt: now,
          recordedAt: now,
          actor: { kind: 'user', userId: payload['accountId'] },
          payload: {
            name: company.name,
            timeZone: payload['timeZone'],
            accountId: payload['accountId'],
            capturedAt: now,
            identityId: payload['identityId'],
            mobilePresent: true,
          },
        });
      }
      await deliver(envelopes);
      // Signed in, as enrolling with a passkey leaves the invited administrator.
      const [account] = await sql<{ id: string }[]>`
        SELECT id::text FROM platform.account
         WHERE tenant_id = ${tenantId} AND work_email = ${company.admin}`;
      if (account === undefined) throw new Error('identity made no account for the administrator');
      const session = randomUUID();
      await sql`UPDATE platform.account SET status = 'active' WHERE id = ${account.id}`;
      await sql`INSERT INTO platform.session (id, tenant_id, account_id, slot, expires_at, amr)
                VALUES (${session}, ${tenantId}, ${account.id}, 1, now() + interval '1 day', ARRAY['hwk'])`;
      return {
        tenantId,
        account: account.id,
        session,
        shell: `http://${company.slug}.app.localhost:${String(shellPort)}`,
      };
    };

    // The router, from the file that ships, in front of People alone. The
    // production-only parts it cannot have here — the CDN, tracing — are
    // turned off by an override; the persisted-operation safelist stays on,
    // with the shell's operations as `apps/gateway` generates them.
    dir = await mkdtemp(join(tmpdir(), 'kithena-acceptance-'));
    await writeFile(
      join(dir, 'graph.yaml'),
      [
        'version: 1',
        'subgraphs:',
        '  - name: people',
        `    routing_url: http://host.docker.internal:${String(peoplePort)}/graphql`,
        '    schema:',
        `      file: ${join(ROOT, 'services/people/schemas/people.graphql')}`,
      ].join('\n'),
    );
    await run(
      join(ROOT, 'apps/gateway/node_modules/.bin/wgc'),
      ['router', 'compose', '-i', join(dir, 'graph.yaml'), '-o', join(dir, 'supergraph.json')],
      ROOT,
      120_000,
    );
    await writeFile(
      join(dir, 'override.yaml'),
      [
        'execution_config:',
        '  file:',
        '    path: /etc/router/supergraph.json',
        'telemetry:',
        '  tracing:',
        '    enabled: false',
        '  metrics:',
        '    otlp:',
        '      enabled: false',
        '    prometheus:',
        '      enabled: false',
      ].join('\n'),
    );
    // The shell's operations, as `pnpm --filter @kithena/gateway persist` wrote
    // them, where the config's `file_system` provider reads them.
    const persisted = join(ROOT, 'apps/gateway/persisted/operations');
    router = await startCosmoRouter({
      files: [
        { source: join(ROOT, 'apps/gateway/config.yaml'), target: '/etc/router/config.yaml' },
        { source: join(dir, 'override.yaml'), target: '/etc/router/override.yaml' },
        { source: join(dir, 'supergraph.json'), target: '/etc/router/supergraph.json' },
        ...(await readdir(persisted)).map((file) => ({
          source: join(persisted, file),
          target: `/persisted/operations/${file}`,
        })),
      ],
      env: {
        CONFIG_PATH: '/etc/router/config.yaml,/etc/router/override.yaml',
        AUTH_JWKS_URL: `http://host.docker.internal:${String(identityPort)}/.well-known/jwks.json`,
        AUTH_TOKEN_AUDIENCE: AUDIENCE,
        PEOPLE_API_TOKEN: PEOPLE_TOKEN,
        KITHENA_ENTITLEMENTS: '["module.people"]',
        // Verifies a config downloaded from the CDN; this one is a file.
        GRAPH_SIGN_KEY: 'x'.repeat(32),
      },
    });

    // The remote and the shell, as production builds. The remote's server
    // build signed as its deploy pipeline signs it, and the shell pinning the
    // public half (PEO-115).
    await run('pnpm', ['--filter', '@kithena/web-people', 'build'], ROOT, 240_000);
    const signing = generateKeyPairSync('ed25519');
    await run('pnpm', ['--filter', '@kithena/web-people', 'sign'], ROOT, 30_000, {
      PEOPLE_REMOTE_SSR_SIGNING_KEY: signing.privateKey
        .export({ format: 'der', type: 'pkcs8' })
        .toString('base64'),
    });
    children.push(
      start(
        join(ROOT, 'apps/web/people/node_modules/.bin/vite'),
        ['preview', '--port', String(remotePort), '--strictPort', '--host', '127.0.0.1'],
        join(ROOT, 'apps/web/people'),
        {},
        logs['remote'] ?? [],
      ),
    );
    const preview = `http://127.0.0.1:${String(remotePort)}`;
    await until('the remote', 30_000, async () => (await fetch(`${preview}/routes.json`)).ok);
    const remote = await asDeployed(preview);

    const gate = await gated(
      process.env['ACCEPTANCE_ROUTER_LATENCY_MS'] === undefined
        ? router.url
        : await distant(router.url, Number(process.env['ACCEPTANCE_ROUTER_LATENCY_MS'])),
    );
    const env = {
      INTERNAL_API_URL: identityUrl,
      INTERNAL_API_TOKEN: SHELL_TOKEN,
      ROUTER_URL: gate.url,
      TENANT_HOST_SUFFIX: 'app.localhost',
      PEOPLE_REMOTE_URL: remote,
      PEOPLE_REMOTE_SSR_PUBLIC_KEY: signing.publicKey
        .export({ format: 'der', type: 'spki' })
        .toString('base64'),
    };
    // The renderer process's bundle, which `next build` does not make.
    await run('node', ['scripts/build-renderer.mjs'], join(ROOT, 'apps/web'), 60_000);
    if (process.env['ACCEPTANCE_SKIP_SHELL_BUILD'] !== '1') {
      // `next build` rewrites `next-env.d.ts` for a production build; a test
      // run leaves the checkout as it found it.
      const nextEnv = join(ROOT, 'apps/web/next-env.d.ts');
      const committed = await readFile(nextEnv, 'utf8');
      try {
        await run(
          join(ROOT, 'apps/web/node_modules/.bin/next'),
          ['build'],
          join(ROOT, 'apps/web'),
          420_000,
          env,
        );
      } finally {
        await writeFile(nextEnv, committed);
      }
    }
    children.push(
      start(
        join(ROOT, 'apps/web/node_modules/.bin/next'),
        ['start', '-p', String(shellPort)],
        join(ROOT, 'apps/web'),
        env,
        logs['shell'] ?? [],
      ),
    );
    const shell = `http://acme.app.localhost:${String(shellPort)}`;
    await until('the shell', 60_000, async () => {
      const r = await fetch(`http://127.0.0.1:${String(shellPort)}/login`, {
        headers: { host: `acme.app.localhost:${String(shellPort)}` },
        redirect: 'manual',
      });
      return r.status < 500;
    });

    return {
      shell,
      sql,
      shellEnv: env,
      router: { asleep: gate.asleep, awake: gate.awake },
      peopleUrl,
      shellToken: SHELL_TOKEN,
      receiver: { url: receiver.url, received: receiver.received },
      asPeople,
      writeAsPeople,
      writeTuples,
      provisionCompany,
      stop: async () => {
        // A path: where to leave the servers' last output, for a failure to be read.
        const keep = process.env['ACCEPTANCE_LOGS'];
        if (keep !== undefined && keep !== '') {
          await writeFile(
            keep,
            Object.entries(logs)
              .map(([name, lines]) => `--- ${name}\n${lines.join('').slice(-20000)}`)
              .join('\n'),
          );
        }
        await stop();
      },
    };
  } catch (error) {
    for (const [name, lines] of Object.entries(logs))
      console.error(`--- ${name}\n${lines.join('').slice(-4000)}`);
    await stop();
    throw error;
  }
}
