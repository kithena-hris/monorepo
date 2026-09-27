import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { logger } from '@kithena/telemetry';

import { wirePeople } from './http/server.js';
import { samplePhoto } from './seed-photos.js';
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
  method: 'GET' | 'POST' | 'PATCH',
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

/* ----------------------------------------- what the overview draws -- */

// A handful of the fields a company adds on its first day, through the
// registry and a publish, as an administrator adds them: a job title and a
// department to say what somebody does, a work phone, the start date, and one
// detail each employee is asked for themselves, so there is something missing.
const everyone = ['self', 'manager', 'manager_chain', 'hr', 'directory'];
const FIELDS = [
  { key: 'job_title', sectionKey: 'employment', label: 'Job title', dataType: 'text' },
  {
    key: 'department',
    sectionKey: 'employment',
    label: 'Department',
    dataType: 'select',
    options: ['Leadership', 'Engineering', 'Research', 'People'],
  },
  {
    key: 'work_phone',
    sectionKey: 'employment',
    label: 'Work phone',
    dataType: 'phone',
    ownership: ['employee', 'hr'],
    collectAt: 'onboarding',
    piiKind: 'contact',
  },
  {
    key: 'hire_date',
    sectionKey: 'employment',
    label: 'Start date',
    dataType: 'date',
    visibility: ['self', 'manager', 'hr'],
  },
  {
    key: 'emergency_contact',
    sectionKey: 'personal',
    label: 'Emergency contact',
    dataType: 'text',
    visibility: ['self', 'hr'],
    ownership: ['employee', 'hr'],
    collectAt: 'onboarding',
    requiredness: 'always',
    classification: 'confidential',
    piiKind: 'contact',
  },
] as const;
const registry = (await asAdmin('GET', '/v1/views/registry')).body as {
  fields?: { key: string }[];
} | null;
const known = new Set((registry?.fields ?? []).map((f) => f.key));
let fields = 0;
for (const f of FIELDS) {
  if (known.has(f.key)) continue;
  // eslint-disable-next-line no-await-in-loop -- a handful, in order
  const saved = await asAdmin('POST', '/v1/schema/draft/attributes', {
    input: {
      key: f.key,
      sectionKey: f.sectionKey,
      label: f.label,
      description: null,
      dataType: f.dataType,
      options: 'options' in f ? f.options : [],
      requiredness: 'requiredness' in f ? f.requiredness : 'never',
      requiredWhen: null,
      ownership: 'ownership' in f ? f.ownership : ['hr'],
      collectAt: 'collectAt' in f ? f.collectAt : 'hr_only',
      visibility: 'visibility' in f ? f.visibility : everyone,
      visibilityRules: [],
      classification: 'classification' in f ? f.classification : 'internal',
      piiKind: 'piiKind' in f ? f.piiKind : 'none',
      classificationSource: 'human',
      requiresApproval: null,
    },
    editing: null,
  });
  if (saved.status >= 300) {
    logger.warn({ key: f.key, answer: saved.body }, 'sample field not added');
    continue;
  }
  fields += 1;
}
if (fields > 0) {
  const today = new Date().toISOString().slice(0, 10);
  const next = await asAdmin('POST', '/v1/schema/draft/publish', { requiredFrom: today });
  logger.info({ fields, answer: next.body }, 'sample fields published');
}

// Who reports to whom, and what each does: the reporting line the overview
// draws. Ada, People's administrator, reports to Grace. Set once: a record
// that already has a manager is left as it is.
const LINE: Readonly<Record<string, { manager: string | null; title: string; department: string }>> = {
  'grace.hopper': { manager: null, title: 'Chief Executive', department: 'leadership' },
  'alan.turing': { manager: 'grace.hopper', title: 'VP Engineering', department: 'engineering' },
  'katherine.johnson': { manager: 'grace.hopper', title: 'Head of Research', department: 'research' },
  'tim.berners-lee': { manager: 'alan.turing', title: 'Staff Engineer', department: 'engineering' },
  'margaret.hamilton': { manager: 'alan.turing', title: 'Engineering Manager', department: 'engineering' },
  'edsger.dijkstra': { manager: 'margaret.hamilton', title: 'Engineer', department: 'engineering' },
  'barbara.liskov': { manager: 'margaret.hamilton', title: 'Engineer', department: 'engineering' },
  'donald.knuth': { manager: 'katherine.johnson', title: 'Researcher', department: 'research' },
};
const rows = await owner<{ id: string; email: string | null; account: string | null; manager: string | null }[]>`
  SELECT id, lower(work_email) AS email, identity_account_id AS account, manager_id AS manager
    FROM people.person WHERE tenant_id = ${tenantId}`;
const byHandle = new Map(
  rows.flatMap((r) => (r.email === null ? [] : [[r.email.split('@')[0] ?? '', r] as const])),
);
const ada = rows.find((r) => r.account === admin.account_id);
const placed: [string, { manager: string | null; title: string; department: string }][] = [
  ...Object.entries(LINE),
  ...(ada === undefined
    ? []
    : [[`@${ada.id}`, { manager: 'grace.hopper', title: 'Head of People', department: 'people' }] as [string, { manager: string | null; title: string; department: string }]]),
];
let lined = 0;
for (const [handle, line] of placed) {
  const row = handle.startsWith('@') ? ada : byHandle.get(handle);
  if (row === undefined || row.manager !== null) continue;
  const manager = line.manager === null ? null : (byHandle.get(line.manager)?.id ?? null);
  // eslint-disable-next-line no-await-in-loop -- a handful, in order
  const patched = await asAdmin('PATCH', `/v1/people/${row.id}`, {
    attributes: {
      ...(manager === null ? {} : { manager_id: manager }),
      job_title: line.title,
      department: line.department,
    },
  });
  if (patched.status >= 300) logger.warn({ handle, answer: patched.body }, 'reporting line not set');
  else lined += 1;
}
logger.info({ lined }, 'reporting lines and job titles set');

// A photo for each sample employee, uploaded the way the profile uploads one:
// a presigned PUT to the upload bucket, then People checks and keeps it. Ada
// is left without one, to add her own. Skipped, with a warning, when there is
// no upload bucket to put them in.
const photographed = new Set(
  (
    await owner<{ person_id: string }[]>`
      SELECT person_id FROM people.person_photo WHERE tenant_id = ${tenantId}`
  ).map((r) => r.person_id),
);
let photos = 0;
for (const [index, handle] of Object.keys(LINE).entries()) {
  const row = byHandle.get(handle);
  if (row === undefined || photographed.has(row.id)) continue;
  const bytes = samplePhoto(index);
  // eslint-disable-next-line no-await-in-loop -- a handful, in order
  const started = await asAdmin('POST', '/v1/views/photos/uploads', {
    personId: row.id,
    size: bytes.byteLength,
  });
  if (started.status >= 300) {
    logger.warn({ answer: started.body }, 'sample photos skipped: is the upload bucket there? (`pnpm --filter @kithena/people upload-bucket`)');
    break;
  }
  const target = started.body as { uploadId: string; url: string; headers: Record<string, string> };
  const { 'content-length': _length, ...signed } = target.headers;
  // eslint-disable-next-line no-await-in-loop -- as above
  const put = await fetch(target.url, { method: 'PUT', headers: signed, body: bytes as Uint8Array<ArrayBuffer> }).catch(() => null);
  if (put === null || !put.ok) {
    logger.warn({ status: put?.status }, 'sample photo not uploaded');
    continue;
  }
  // eslint-disable-next-line no-await-in-loop -- as above
  const kept = await asAdmin('POST', `/v1/views/photos/uploads/${target.uploadId}/complete`, {
    personId: row.id,
  });
  if (kept.status >= 300) logger.warn({ handle, answer: kept.body }, 'sample photo not kept');
  else photos += 1;
}
logger.info({ photos }, 'sample photos added');

logger.info({ delivered: await relay() }, 'People’s own events delivered to People');

const people = await owner<{ status: string; n: number }[]>`
  SELECT status, count(*)::int AS n FROM people.person WHERE tenant_id = ${tenantId}
   GROUP BY status ORDER BY status`;
process.stdout.write(
  `\nPeople at ${slug}: ${people.map((r) => `${String(r.n)} ${r.status}`).join(', ')}\n\n`,
);

// The transports' pollers and pools stay open; this was a one-off.
process.exit(0);
