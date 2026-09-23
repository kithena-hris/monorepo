import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { createServer as netServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { startOpenFga, startPostgres } from '@kithena/testing';

/**
 * The tenant app as a person meets it, for the acceptance tests (PEO-098).
 *
 * Real: Postgres with every People migration, OpenFGA, the People service,
 * the People remote from a production build, and the shell from a production
 * build (`next build`, `next start`). Stubbed: identity, and only its two
 * internal routes the shell reads — the session and the tenant registry —
 * the method PEO-046 used. Everything is bounded and everything is stopped in
 * `stop()`, whatever state the run ended in.
 */

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const TENANT = '00000000-0000-4000-8000-00000000ac00';
export const ADMIN = {
  person: '00000000-0000-4000-8000-0000000000a1',
  account: '00000000-0000-4000-8000-0000000000b1',
  session: 'admin-session',
  email: 'priya@acme.example',
};
export const EMPLOYEE = {
  person: '00000000-0000-4000-8000-0000000000a2',
  account: '00000000-0000-4000-8000-0000000000b2',
  session: 'employee-session',
  email: 'adam@acme.example',
};
const TOKEN = 'acceptance-internal-token';

export interface Stack {
  readonly shell: string;
  readonly sql: postgres.Sql;
  /** People's REST, as a principal: for a test to check a result without a screen. */
  asPeople(account: string, path: string): Promise<unknown>;
  stop(): Promise<void>;
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
  // Vite build transform nothing and a Next build refuse to run.
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith('VITEST') && key !== 'NODE_ENV' && key !== 'MODE',
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
 * Stop a process group: politely, then not. People keeps its event loop open
 * on SIGTERM (its pollers are `unref`'d, its database pool is not), and a
 * test run must never leave a server behind.
 */
async function kill(child: ChildProcess | undefined): Promise<void> {
  if (child?.pid === undefined || child.exitCode !== null) return;
  const pid = child.pid;
  const signal = (s: NodeJS.Signals) => {
    try {
      process.kill(-pid, s);
    } catch {
      // Already gone.
    }
  };
  signal('SIGTERM');
  const exited = new Promise<boolean>((resolve) =>
    child.once('exit', () => {
      resolve(true);
    }),
  );
  const timeout = new Promise<boolean>((resolve) =>
    setTimeout(() => {
      resolve(false);
    }, 3000),
  );
  if (!(await Promise.race([exited, timeout]))) signal('SIGKILL');
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
      void kill(child);
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
  const servers: Server[] = [];
  const logs: Record<string, string[]> = { people: [], remote: [], shell: [] };
  const [pg, fga] = await Promise.all([startPostgres(), startOpenFga()]);
  const sql = postgres(pg.url, { max: 2, onnotice: () => {} });

  const stop = async (): Promise<void> => {
    await Promise.all(children.map((child) => kill(child)));
    for (const server of servers) server.close();
    await sql.end({ timeout: 5 }).catch(() => undefined);
    await Promise.allSettled([pg.stop(), fga.stop()]);
  };

  try {
    // Every People migration, and the tenant registry the first one names.
    const migrations = join(ROOT, 'migrations');
    for (const file of (await readdir(migrations))
      .filter(
        (f) =>
          f.endsWith('.sql') &&
          ((f.includes('_people_') && !f.includes('identity')) || f.includes('tenant_registry')),
      )
      .sort()) {
      await sql.unsafe(await readFile(join(migrations, file), 'utf8'));
    }
    await sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`;

    // What identity's provisioning would have left behind: two people, one
    // of them the administrator the operator invited first.
    await sql`INSERT INTO people.person (id, tenant_id, identity_account_id, status, work_email)
              VALUES (${ADMIN.person}, ${TENANT}, ${ADMIN.account}, 'provisional', ${ADMIN.email})`;
    await sql`INSERT INTO people.person (id, tenant_id, identity_account_id, status, work_email, created_at)
              VALUES (${EMPLOYEE.person}, ${TENANT}, ${EMPLOYEE.account}, 'provisional', ${EMPLOYEE.email},
                      now() + interval '1 second')`;

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
    children.push(
      start(
        join(ROOT, 'node_modules/.bin/tsx'),
        ['services/people/src/main.ts'],
        ROOT,
        {
          PEOPLE_PORT: String(peoplePort),
          PEOPLE_DATABASE_URL: service.toString(),
          PEOPLE_API_TOKEN: TOKEN,
          PEOPLE_SECRET_KEYS: `k1:${randomBytes(32).toString('base64')}`,
          OPENFGA_URL: fga.apiUrl,
          LOG_LEVEL: 'warn',
        },
        logs['people'] ?? [],
      ),
    );
    await until('People', 60_000, async () => (await fetch(`${peopleUrl}/v1/openapi.json`)).ok);

    const asPeople = async (account: string, path: string): Promise<unknown> => {
      const response = await fetch(`${peopleUrl}${path}`, {
        headers: {
          'x-internal-token': TOKEN,
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
    // consumer writes from `people.person.provisioned` (PEO-092), which has
    // no Kafka to arrive through here.
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
    const wrote = await fetch(`${fga.apiUrl}/stores/${store.id}/write`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ writes: { tuple_keys: tuples } }),
    });
    if (!wrote.ok) throw new Error(`OpenFGA refused the tuples: ${await wrote.text()}`);

    // Identity, as far as the shell reads it.
    const sessions: Record<
      string,
      { account: string; email: string; name: { given: string; family: string } }
    > = {
      [ADMIN.session]: {
        account: ADMIN.account,
        email: ADMIN.email,
        name: { given: 'Priya', family: 'Shah' },
      },
      [EMPLOYEE.session]: {
        account: EMPLOYEE.account,
        email: EMPLOYEE.email,
        name: { given: 'Adam', family: 'Ruiz' },
      },
    };
    const identity = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (c: Buffer) => chunks.push(c));
      request.on('end', () => {
        const json = (status: number, body: unknown) => {
          response.writeHead(status, { 'content-type': 'application/json' });
          response.end(JSON.stringify(body));
        };
        if (request.headers['x-internal-token'] !== TOKEN) {
          json(401, {});
          return;
        }
        if (request.url === '/api/internal/session' && request.method === 'POST') {
          const body = JSON.parse(Buffer.concat(chunks).toString() || '{}') as {
            sessionId?: string;
            tenantId?: string;
          };
          const found = sessions[body.sessionId ?? ''];
          if (found === undefined || body.tenantId !== TENANT) {
            json(401, {});
            return;
          }
          json(200, {
            accountId: found.account,
            identityId: randomUUID(),
            workEmail: found.email,
            name: { ...found.name, preferred: null },
            timeZone: 'Europe/Madrid',
            amr: ['hwk'],
            // The company's modules, as identity answers them (PEO-114).
            entitlements: ['module.people'],
          });
          return;
        }
        if (request.url === '/api/internal/tenant/acme') {
          json(200, {
            id: TENANT,
            slug: 'acme',
            status: 'active',
            branding: { displayName: 'Acme' },
            location: { city: 'Madrid', country: 'ES' },
          });
          return;
        }
        json(404, {});
      });
    });
    servers.push(identity);
    await new Promise<void>((resolve) => {
      identity.listen(identityPort, '127.0.0.1', resolve);
    });

    // The remote and the shell, as production builds.
    await run('pnpm', ['--filter', '@kithena/web-people', 'build'], ROOT, 240_000);
    children.push(
      start(
        join(ROOT, 'apps/web/people/node_modules/.bin/vite'),
        ['preview', '--port', String(remotePort), '--strictPort', '--host', '127.0.0.1'],
        join(ROOT, 'apps/web/people'),
        {},
        logs['remote'] ?? [],
      ),
    );
    const remote = `http://127.0.0.1:${String(remotePort)}`;
    await until('the remote', 30_000, async () => (await fetch(`${remote}/routes.json`)).ok);

    const env = {
      INTERNAL_API_URL: `http://127.0.0.1:${String(identityPort)}`,
      INTERNAL_API_TOKEN: TOKEN,
      TENANT_HOST_SUFFIX: 'app.localhost',
      PEOPLE_REMOTE_URL: remote,
      PEOPLE_API_URL: peopleUrl,
      PEOPLE_API_TOKEN: TOKEN,
    };
    if (process.env['ACCEPTANCE_SKIP_SHELL_BUILD'] !== '1') {
      await run(
        join(ROOT, 'apps/web/node_modules/.bin/next'),
        ['build'],
        join(ROOT, 'apps/web'),
        420_000,
        env,
      );
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
      asPeople,
      stop: async () => {
        if (process.env['ACCEPTANCE_LOGS'] === '1') {
          for (const [name, lines] of Object.entries(logs))
            console.log(`--- ${name}\n${lines.join('').slice(-6000)}`);
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
