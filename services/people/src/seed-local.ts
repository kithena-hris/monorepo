import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { logger } from '@kithena/telemetry';

import { wirePeople } from './http/server.js';
import { CHARACTERS, avatarFor, drawAvatar } from './seed-photos.js';
import { COMPANIES, PART_TIME, type SeedCompany } from './seed-companies.js';
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

// One company, or every local one (`seed-companies.ts`).
const slugs = process.argv[2] === undefined ? COMPANIES.map((c) => c.slug) : [process.argv[2]];
const port = process.env['POSTGRES_PORT'] ?? '5432';
const ownerUrl =
  process.env['DATABASE_URL'] ?? `postgres://kithena:kithena@localhost:${port}/kithena`;
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

for (const slug of slugs) {
  const company = COMPANIES.find((c) => c.slug === slug);
  if (company === undefined) {
    logger.warn({ slug }, 'no such local company in seed-companies.ts');
    continue;
  }
  // eslint-disable-next-line no-await-in-loop -- one company at a time
  await seedCompany(company);
}

logger.info({ delivered: await relay() }, 'People’s own events delivered to People');
// The transports' pollers and pools stay open; this was a one-off.
process.exit(0);

async function seedCompany(company: SeedCompany): Promise<void> {
  const { slug } = company;
  const [found] = await owner<{ tenant_id: string }[]>`
    SELECT tenant_id FROM people.tenant_settings WHERE slug = ${slug}`;
  const [admin] =
    found === undefined
      ? []
      : await owner<{ account_id: string }[]>`
          SELECT account_id FROM people.role_grant
           WHERE tenant_id = ${found.tenant_id} AND role = 'people_admin'
           ORDER BY account_id LIMIT 1`;
  if (found === undefined || admin === undefined) {
    logger.warn(
      { slug },
      'People has no such company or no administrator for it. Pipe identity’s events in (`pnpm db:seed`), on a fresh database (`just reset`).',
    );
    return;
  }
  const tenantId = found.tenant_id;

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
  const [entity] = await owner<{ id: string; country: string }[]>`
    SELECT id, country FROM people.legal_entity
     WHERE tenant_id = ${tenantId} AND archived_at IS NULL ORDER BY id LIMIT 1`;
  const published = await asAdmin('POST', '/v1/views/setup/publish', {
    country: entity?.country ?? '',
    sections: [],
  });
  if (published.status >= 300) {
    logger.error({ slug, answer: published.body }, 'version 1 was not published');
    return;
  }

  // Work locations, under the first legal entity, as Organisation adds them.
  const existing = new Map(
    (
      await owner<{ id: string; name: string }[]>`
        SELECT id, name FROM people.location WHERE tenant_id = ${tenantId}`
    ).map((r) => [r.name, r.id]),
  );
  const locationId = new Map<string, string>();
  for (const loc of company.locations) {
    const had = existing.get(loc.name);
    if (had !== undefined) {
      locationId.set(loc.key, had);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- a handful, in order
    const made = await asAdmin('POST', '/v1/locations', {
      legalEntityId: entity?.id,
      name: loc.name,
      country: company.country,
      timeZone: loc.timeZone,
    });
    if (made.status >= 300)
      logger.warn({ slug, location: loc.name, answer: made.body }, 'location not added');
    else locationId.set(loc.key, (made.body as { id: string }).id);
  }

  // The fields a company adds on its first day, through the registry and a
  // publish, as an administrator adds them.
  const everyone = ['self', 'manager', 'manager_chain', 'hr', 'directory'];
  const registry = (await asAdmin('GET', '/v1/views/registry')).body as {
    fields?: { key: string }[];
  } | null;
  const known = new Set((registry?.fields ?? []).map((f) => f.key));
  let fields = 0;
  for (const f of company.fields) {
    if (known.has(f.key)) continue;
    // eslint-disable-next-line no-await-in-loop -- a handful, in order
    const saved = await asAdmin('POST', '/v1/schema/draft/attributes', {
      input: {
        key: f.key,
        sectionKey: f.sectionKey,
        label: f.label,
        description: f.description ?? null,
        dataType: f.dataType,
        options: f.options ?? [],
        requiredness: f.requiredness ?? 'never',
        requiredWhen: null,
        ownership: f.ownership ?? ['hr'],
        collectAt: f.collectAt ?? 'hr_only',
        visibility: f.visibility ?? everyone,
        visibilityRules: [],
        classification: f.classification ?? 'internal',
        piiKind: f.piiKind ?? 'none',
        classificationSource: 'human',
        requiresApproval: null,
      },
      editing: null,
    });
    if (saved.status >= 300) {
      logger.warn({ slug, key: f.key, answer: saved.body }, 'sample field not added');
      continue;
    }
    fields += 1;
  }
  if (fields > 0) {
    const today = new Date().toISOString().slice(0, 10);
    const next = await asAdmin('POST', '/v1/schema/draft/publish', { requiredFrom: today });
    logger.info({ slug, fields, answer: next.body }, 'sample fields published');
  }

  // The employees, through `POST /v1/people`: most hired from a start date,
  // one starting later and one not hired yet. The administrator's own record
  // already exists (identity's account made it) and is completed below.
  const emailOf = (handle: string): string => `${handle}@${slug}.example`.toLowerCase();
  const there = new Set(
    (
      await owner<{ email: string }[]>`
        SELECT lower(work_email) AS email FROM people.person
         WHERE tenant_id = ${tenantId} AND work_email IS NOT NULL`
    ).map((r) => r.email),
  );
  let added = 0;
  for (const person of company.people) {
    if (person.handle === company.admin.handle || there.has(emailOf(person.handle))) continue;
    const location = person.location === undefined ? undefined : locationId.get(person.location);
    // eslint-disable-next-line no-await-in-loop -- a few dozen, in order
    const made = await asAdmin('POST', '/v1/people', {
      attributes: {
        given_name: person.given,
        family_name: person.family,
        work_email: emailOf(person.handle),
        ...(entity === undefined ? {} : { legal_entity_id: entity.id }),
        ...(location === undefined ? {} : { location_id: location }),
      },
      ...(person.hireDate === null ? {} : { hireDate: person.hireDate }),
    });
    if (made.status >= 300) {
      logger.warn({ slug, handle: person.handle, answer: made.body }, 'employee not added');
      continue;
    }
    added += 1;
  }
  logger.info({ slug, added }, 'sample employees added');

  // Who reports to whom, what each does, and the rest of what is known of
  // them. Set once: a record that already has a manager is left as it is.
  const rows = await owner<
    { id: string; email: string | null; account: string | null; manager: string | null }[]
  >`
    SELECT id, lower(work_email) AS email, identity_account_id AS account, manager_id AS manager
      FROM people.person WHERE tenant_id = ${tenantId}`;
  const byHandle = new Map(
    rows.flatMap((r) => (r.email === null ? [] : [[r.email.split('@')[0] ?? '', r] as const])),
  );
  const adminRow = rows.find((r) => r.account === admin.account_id);
  // A choice is stored as its option's key ("human_resources"), which is what
  // the registry makes of a label ("Human Resources").
  const optionKey = (label: string): string =>
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
  const choices = new Set(company.fields.filter((f) => f.dataType === 'select').map((f) => f.key));
  const detailsOf = (details: Readonly<Record<string, string | number>> = {}) =>
    Object.fromEntries(
      Object.entries(details).map(([key, value]) => [
        key,
        choices.has(key) && typeof value === 'string' ? optionKey(value) : value,
      ]),
    );
  let lined = 0;
  for (const person of company.people) {
    const row = person.handle === company.admin.handle ? adminRow : byHandle.get(person.handle);
    if (row === undefined || row.manager !== null) continue;
    const manager = person.manager === null ? null : (byHandle.get(person.manager)?.id ?? null);
    const location = person.location === undefined ? undefined : locationId.get(person.location);
    // eslint-disable-next-line no-await-in-loop -- a few dozen, in order
    const patched = await asAdmin('PATCH', `/v1/people/${row.id}`, {
      attributes: {
        ...(manager === null ? {} : { manager_id: manager }),
        job_title: person.title,
        department: optionKey(person.department),
        ...(row !== adminRow
          ? {}
          : {
              given_name: person.given,
              family_name: person.family,
              ...(entity === undefined ? {} : { legal_entity_id: entity.id }),
              ...(location === undefined ? {} : { location_id: location }),
            }),
        ...detailsOf(person.details),
      },
    });
    if (patched.status >= 300)
      logger.warn({ slug, handle: person.handle, answer: patched.body }, 'details not set');
    else lined += 1;
  }
  logger.info({ slug, lined }, 'reporting lines, jobs and details set');

  // Fields a company gained after its people were first seeded: filled in
  // where the record has nothing yet, so a re-seed brings older data along.
  const typed = new Set(
    (
      await owner<{ id: string }[]>`
        SELECT id FROM people.person
         WHERE tenant_id = ${tenantId} AND custom ? 'working_hours'`
    ).map((r) => r.id),
  );
  let backfilled = 0;
  for (const person of company.people) {
    const row = person.handle === company.admin.handle ? adminRow : byHandle.get(person.handle);
    if (row === undefined || typed.has(row.id)) continue;
    // eslint-disable-next-line no-await-in-loop -- a few dozen, in order
    const patched = await asAdmin('PATCH', `/v1/people/${row.id}`, {
      attributes: {
        working_hours: optionKey(PART_TIME.has(person.handle) ? 'Part time' : 'Full time'),
      },
    });
    if (patched.status < 300) backfilled += 1;
  }
  logger.info({ slug, backfilled }, 'working hours set');

  // A photo for each sample employee, uploaded the way the profile uploads
  // one: a presigned PUT to the upload bucket, then People checks and keeps
  // it. The administrator gets one only as a character (`seed-photos.ts`):
  // Acme's Ada is left to pick her own. Skipped, with a warning, without an
  // upload bucket.
  const photographed = new Set(
    (
      await owner<{ person_id: string }[]>`
        SELECT person_id FROM people.person_photo WHERE tenant_id = ${tenantId}`
    ).map((r) => r.person_id),
  );
  let photos = 0;
  for (const [index, person] of company.people.entries()) {
    const isAdmin = person.handle === company.admin.handle;
    if (isAdmin && CHARACTERS[person.handle] === undefined) continue;
    const row = isAdmin ? adminRow : byHandle.get(person.handle);
    if (row === undefined || photographed.has(row.id)) continue;
    const bytes = drawAvatar(avatarFor(person.handle, index));
    // eslint-disable-next-line no-await-in-loop -- in order
    const started = await asAdmin('POST', '/v1/views/photos/uploads', {
      personId: row.id,
      size: bytes.byteLength,
    });
    if (started.status >= 300) {
      logger.warn(
        { answer: started.body },
        'sample photos skipped: is the upload bucket there? (`pnpm --filter @kithena/people upload-bucket`)',
      );
      break;
    }
    const target = started.body as {
      uploadId: string;
      url: string;
      headers: Record<string, string>;
    };
    const { 'content-length': _length, ...signed } = target.headers;
    // eslint-disable-next-line no-await-in-loop -- as above
    const put = await fetch(target.url, {
      method: 'PUT',
      headers: signed,
      body: bytes as Uint8Array<ArrayBuffer>,
    }).catch(() => null);
    if (put === null || !put.ok) {
      logger.warn({ status: put?.status }, 'sample photo not uploaded');
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- as above
    const kept = await asAdmin('POST', `/v1/views/photos/uploads/${target.uploadId}/complete`, {
      personId: row.id,
    });
    if (kept.status >= 300)
      logger.warn({ handle: person.handle, answer: kept.body }, 'sample photo not kept');
    else photos += 1;
  }
  logger.info({ slug, photos }, 'sample photos added');

  logger.info({ delivered: await relay() }, 'People’s own events delivered to People');
  const people = await owner<{ status: string; n: number }[]>`
    SELECT status, count(*)::int AS n FROM people.person WHERE tenant_id = ${tenantId}
     GROUP BY status ORDER BY status`;
  process.stdout.write(
    `\nPeople at ${slug}: ${people.map((r) => `${String(r.n)} ${r.status}`).join(', ')}\n\n`,
  );
}
