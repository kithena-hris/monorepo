import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { logger } from '@kithena/telemetry';

import { wirePeople } from './http/server.js';
import { consumerFrom } from './infrastructure/consumers/wire.js';
import { tenantTransaction } from './infrastructure/unit-of-work.js';

/**
 * `… | pnpm --filter @kithena/people seed [slug]`: a local company with People
 * set up and somebody in it. `pnpm db:seed` runs it after identity's seed,
 * with identity's events on stdin:
 *
 *     pnpm --silent --filter @kithena/identity events | pnpm --filter @kithena/people seed
 *
 * Nothing here writes People's tables by hand. Three steps, each the real
 * path:
 *
 * 1. **Deliver the events.** A deployment's Debezium tails each module's
 *    outbox into Redpanda and People's consumer applies what arrives; a
 *    laptop runs neither, so identity's company, Ada's account and her naming
 *    as People's administrator would never reach People. Identity's events
 *    arrive here one envelope a line on stdin, where its topic would be (People
 *    reads no identity table: `direction.test.ts`), and People's own come from
 *    its own outbox. Each goes to the same consumer a deployment runs
 *    (`consumerFrom`), which ignores what it does not read and applies the
 *    rest idempotently: the company and its first legal entity, Ada's
 *    provisional record, `people_admin` and `hr`, and the OpenFGA tuples
 *    People's own events then call for. People's outbox is read again until a
 *    pass finds nothing new, because applying one event raises the next (a
 *    role granted raises `people.role.granted`, whose tuples follow).
 * 2. **Act as the administrator.** People's own transports, in this process
 *    (`wirePeople` on a loopback port), called as whoever holds
 *    `people_admin`: version 1 is published through the setup wizard's own
 *    write, and a handful of employees are added through `POST /v1/people`,
 *    most hired from a start date, one starting later and one not hired yet.
 * 3. **Deliver again**, for what those writes raised.
 *
 * Idempotent: every handler is, publishing answers with the version in
 * force, and an employee already there is skipped. Reading People's outbox,
 * and finding the company by its slug before any tenant is set, use the
 * database owner, as Debezium's replication slot would; everything People
 * does uses `svc_people`, under row-level security.
 *
 * Local only. It refuses to run under NODE_ENV=production.
 */

if (process.env['NODE_ENV'] === 'production') {
  logger.error('seed-local is for a laptop, not a deployment');
  process.exit(1);
}

const slug = process.argv[2] ?? 'acme';
const port = process.env['POSTGRES_PORT'] ?? '5432';
const ownerUrl = process.env['DATABASE_URL'] ?? `postgres://kithena:kithena@localhost:${port}/kithena`;
const peopleUrl =
  process.env['PEOPLE_DATABASE_URL'] ?? `postgres://svc_people:kithena@localhost:${port}/kithena`;

const owner = postgres(ownerUrl, { max: 1, onnotice: () => {} });
const client = postgres(peopleUrl, { max: 4 });
const handle = consumerFrom(process.env, tenantTransaction(drizzle(client)));

/* ------------------------------------------------------------- relay -- */

const delivered = new Set<string>();

/** Another module's events, one JSON envelope a line on stdin; none from a terminal. */
async function piped(): Promise<number> {
  if (process.stdin.isTTY) return 0;
  let text = '';
  for await (const chunk of process.stdin) text += String(chunk);
  let count = 0;
  for (const line of text.split('\n')) {
    // pnpm may still print a banner; only envelopes are delivered.
    if (!line.startsWith('{')) continue;
    // eslint-disable-next-line no-await-in-loop -- in order, one at a time, as a partition is consumed
    await handle(JSON.parse(line));
    count += 1;
  }
  return count;
}

/** Every event in People's own outbox not yet handed to its consumer, until none is left. */
async function relay(): Promise<number> {
  let count = 0;
  for (;;) {
    const rows = await owner<{ event_id: string; envelope: unknown }[]>`
      SELECT event_id, envelope FROM people.outbox ORDER BY created_at, event_id`;
    const fresh = rows.filter((r) => !delivered.has(r.event_id));
    if (fresh.length === 0) return count;
    for (const row of fresh) {
      delivered.add(row.event_id);
      // eslint-disable-next-line no-await-in-loop -- in commit order, one at a time, as a partition is consumed
      await handle(row.envelope);
      count += 1;
    }
  }
}

logger.info({ delivered: await piped() }, 'events from stdin delivered to People');
logger.info({ delivered: await relay() }, 'People’s own events delivered to People');

const [company] = await owner<{ tenant_id: string }[]>`
  SELECT tenant_id FROM people.tenant_settings WHERE slug = ${slug}`;
const [admin] =
  company === undefined
    ? []
    : await owner<{ account_id: string }[]>`
        SELECT account_id FROM people.role_grant
         WHERE tenant_id = ${company.tenant_id} AND role = 'people_admin'
         ORDER BY account_id LIMIT 1`;
if (company === undefined || admin === undefined) {
  logger.error(
    { slug },
    'People has no such company or no administrator for it. Pipe identity’s events in (`pnpm db:seed`), on a fresh database (`just reset`).',
  );
  process.exit(1);
}
const tenantId = company.tenant_id;

/* --------------------------------------------- as the administrator -- */

const token = randomUUID();
process.env['PEOPLE_API_TOKEN'] = token;
process.env['PEOPLE_DATABASE_URL'] = peopleUrl;
// `.env`'s key when there is one. Otherwise a throwaway: nothing this seed
// writes is sealed, so no value is left that only this process could open.
process.env['PEOPLE_SECRET_KEYS'] ??= `seed:${randomBytes(32).toString('base64')}`;
const server = createServer((_request, response) => {
  response.statusCode = 404;
  response.end();
});
wirePeople(server);
await new Promise<void>((resolve) => {
  server.listen(0, '127.0.0.1', resolve);
});
const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

async function asAdmin(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'x-internal-token': token,
      'x-kithena-principal': JSON.stringify({
        userId: admin?.account_id,
        tenantId,
        roles: ['people_admin', 'hr'],
        entitlements: ['module.people'],
      }),
      'x-correlation-id': randomUUID(),
      ...(body === undefined
        ? {}
        : { 'content-type': 'application/json', 'idempotency-key': randomUUID() }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

// The setup wizard's publish, in the country of the company's first entity.
const [entity] = await owner<{ country: string }[]>`
  SELECT country FROM people.legal_entity WHERE tenant_id = ${tenantId} AND archived_at IS NULL ORDER BY id LIMIT 1`;
const published = await asAdmin('POST', '/v1/views/setup/publish', {
  country: entity?.country ?? '',
  sections: [],
});
if (published.status >= 300) {
  logger.error({ answer: published.body }, 'version 1 was not published');
  process.exit(1);
}
logger.info({ answer: published.body }, 'employee fields published');

/** A calendar date this many days from today, in UTC: seed data, not domain logic. */
const inDays = (days: number): string =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const SAMPLE: readonly {
  given: string;
  family: string;
  hireDate: string | null;
}[] = [
  { given: 'Grace', family: 'Hopper', hireDate: '2024-03-04' },
  { given: 'Alan', family: 'Turing', hireDate: '2024-09-02' },
  { given: 'Katherine', family: 'Johnson', hireDate: '2025-01-13' },
  { given: 'Tim', family: 'Berners-Lee', hireDate: '2025-06-02' },
  { given: 'Margaret', family: 'Hamilton', hireDate: '2025-11-03' },
  { given: 'Edsger', family: 'Dijkstra', hireDate: '2026-02-02' },
  // Hired, starting in a fortnight: pre-hire until then.
  { given: 'Barbara', family: 'Liskov', hireDate: inDays(14) },
  // Added and not hired yet: provisional.
  { given: 'Donald', family: 'Knuth', hireDate: null },
];

const there = new Set(
  (
    await owner<{ email: string }[]>`
      SELECT lower(work_email) AS email FROM people.person
       WHERE tenant_id = ${tenantId} AND work_email IS NOT NULL`
  ).map((r) => r.email),
);
let added = 0;
for (const person of SAMPLE) {
  const email = `${person.given}.${person.family}@${slug}.example`.toLowerCase();
  if (there.has(email)) continue;
  // eslint-disable-next-line no-await-in-loop -- a handful, in order
  const made = await asAdmin('POST', '/v1/people', {
    attributes: { given_name: person.given, family_name: person.family, work_email: email },
    ...(person.hireDate === null ? {} : { hireDate: person.hireDate }),
  });
  if (made.status >= 300) {
    logger.error({ email, answer: made.body }, 'employee not added');
    process.exit(1);
  }
  added += 1;
}
logger.info({ added }, 'sample employees added');

logger.info({ delivered: await relay() }, 'People’s own events delivered to People');

const people = await owner<{ status: string; n: number }[]>`
  SELECT status, count(*)::int AS n FROM people.person WHERE tenant_id = ${tenantId}
   GROUP BY status ORDER BY status`;
process.stdout.write(
  `\nPeople at ${slug}: ${people.map((r) => `${String(r.n)} ${r.status}`).join(', ')}\n\n`,
);

// The transports' pollers and pools stay open; this was a one-off.
process.exit(0);
