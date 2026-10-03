import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { createYoga } from 'graphql-yoga';
import { startPostgres } from '@kithena/testing';

import { define, versionOf } from '../application/person/in-memory.js';
import { Person } from '../domain/person/person.js';
import { yogaOptions } from '../graphql/schema.js';
import { drizzlePersonRepository } from '../infrastructure/drizzle-person-repository.js';
import {
  drizzleDraftWriter,
  drizzleSchemaRepository,
} from '../infrastructure/drizzle-schema-repository.js';
import { tenantTransaction } from '../infrastructure/unit-of-work.js';
import { wirePeople } from './server.js';

/**
 * A text field becoming a date, over Postgres, as `main.ts` boots People:
 * the review writes nothing, the ordinary publish refuses the change, and the
 * reviewed publish writes the new version, a correction for each value that
 * converts or was fixed by hand, a cleared value and a request for the one
 * the employee is asked for, with every old value still in history.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const ADA = '00000000-0000-4000-8000-0000000000a1';
const MARCO = '00000000-0000-4000-8000-0000000000a2';
const GRACE = '00000000-0000-4000-8000-0000000000a3';
const ALAN = '00000000-0000-4000-8000-0000000000a4';
const ADMIN_ACCOUNT = '00000000-0000-4000-8000-0000000000b3';

let stopPg: (() => Promise<void>) | undefined;
const clients: ReturnType<typeof postgres>[] = [];
let server: Server;
let base = '';

const admin = {
  'content-type': 'application/json',
  'x-internal-token': 'router-secret',
  'x-kithena-principal': JSON.stringify({
    userId: ADMIN_ACCOUNT,
    tenantId: ACME,
    roles: ['hr', 'people_admin'],
    entitlements: ['module.people'],
  }),
};

const start = define({
  key: 'start_day',
  label: { default: 'Start day' },
  ownership: ['employee', 'hr'],
  visibility: ['self', 'hr'],
});

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;
  const owner = postgres(pg.url, { max: 1, onnotice: () => {} });
  clients.push(owner);
  for (const role of ['svc_identity', 'svc_messaging', 'svc_slack']) {
    await owner.unsafe(`CREATE ROLE ${role} NOLOGIN NOBYPASSRLS`);
  }
  const migrations = new URL('../../../../migrations/', import.meta.url);
  for (const file of (await readdir(migrations)).filter((f) => f.endsWith('.sql')).sort()) {
    await drizzle(owner).execute(sql.raw(await readFile(new URL(file, migrations), 'utf8')));
  }
  await owner`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`;
  await owner`
    INSERT INTO people.role_grant (tenant_id, account_id, role)
    VALUES (${ACME}::uuid, ${ADMIN_ACCOUNT}::uuid, 'people_admin')`;
  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  const serviceClient = postgres(asService.toString(), { max: 2 });
  clients.push(serviceClient);
  const inTenant = tenantTransaction(drizzle(serviceClient));
  const repo = drizzlePersonRepository();
  const seed = (id: string, givenName: string) =>
    inTenant(ACME, ({ tx }) =>
      repo.create(
        tx,
        Person.rehydrate({
          id,
          tenantId: ACME,
          status: 'active',
          identityAccountId: null,
          hireDate: '2026-01-01',
          lastWorkingDay: null,
        }),
        { givenName, familyName: 'Test' },
      ),
    );
  await seed(ADA, 'Ada');
  await seed(MARCO, 'Marco');
  await seed(GRACE, 'Grace');
  await seed(ALAN, 'Alan');
  const version = versionOf(1, [start]);
  await inTenant(ACME, async ({ tx }) => {
    await drizzleSchemaRepository().appendVersion(tx, ACME, version, [], '2026-09-01');
    const draft = drizzleDraftWriter();
    for (const s of version.document.sections) await draft.saveSection(tx, ACME, s);
    await draft.saveAttribute(tx, ACME, start);
  });

  process.env['PEOPLE_DATABASE_URL'] = asService.toString();
  process.env['PEOPLE_API_TOKEN'] = 'router-secret';
  process.env['PEOPLE_SECRET_KEYS'] = `k1:${randomBytes(32).toString('base64')}`;
  const yoga = createYoga(yogaOptions);
  server = createServer((request, response) => {
    void yoga(request, response);
  });
  wirePeople(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  const listening = server as Server | undefined;
  if (listening) await new Promise((resolve) => listening.close(resolve));
  for (const c of clients) await c.end();
  await stopPg?.();
});

let keys = 0;
const call = async (method: string, path: string, body?: unknown) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...admin,
      ...(method === 'GET' ? {} : { 'idempotency-key': `k-${String(++keys)}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

const superuser = () => clients[0] as ReturnType<typeof postgres>;

const asDate = {
  key: 'start_day',
  sectionKey: 'hr_information',
  label: 'Start day',
  description: null,
  dataType: 'date',
  options: [],
  requiredness: 'never',
  requiredWhen: null,
  ownership: ['employee', 'hr'],
  collectAt: 'hr_only',
  visibility: ['self', 'hr'],
  visibilityRules: [],
  classification: 'internal',
  piiKind: 'none',
  classificationSource: 'human',
  requiresApproval: null,
};

describe('changing a text field to a date', () => {
  it('reviews, refuses the plain publish, and publishes every value with the change', async () => {
    for (const [id, value] of [
      [ADA, '12/03/2024'],
      [MARCO, 'when he starts'],
      [GRACE, 'n/a'],
      [ALAN, '2024-01-05'],
    ] as const) {
      expect(
        (await call('PATCH', `/v1/people/${id}`, { attributes: { start_day: value } })).status,
      ).toBe(200);
    }

    const saved = await call('POST', '/v1/schema/draft/attributes', {
      input: asDate,
      editing: 'start_day',
    });
    expect(saved.status).toBe(200);

    const plain = await call('POST', '/v1/schema/draft/publish', { requiredFrom: '2026-01-01' });
    expect(plain.body).toMatchObject({ error: { code: 'VALUES_NEED_REVIEW' } });

    const outbox = async () =>
      Number(
        (await superuser().unsafe<{ n: string }[]>('SELECT count(*) AS n FROM people.outbox'))[0]
          ?.n,
      );
    const before = await outbox();
    const review = await call('GET', '/v1/views/registry/fields/start_day/change?to=date');
    expect(review.status).toBe(200);
    expect(review.body).toMatchObject({
      needsReview: true,
      withValue: 4,
      dateOrder: 'dmy',
      converted: { count: 1, samples: [{ before: '12/03/2024', after: '12 Mar 2024' }] },
      unchanged: 1,
      defaultAction: 'request',
      hidden: false,
      alsoPublished: 0,
    });
    expect(
      (review.body['unfit'] as { name: string; before: string }[]).map((u) => [u.name, u.before]),
    ).toEqual(
      expect.arrayContaining([
        ['Marco Test', 'when he starts'],
        ['Grace Test', 'n/a'],
      ]),
    );
    expect(await outbox()).toBe(before);

    // Refused after the new version is written inside the transaction: it
    // rolls back, and the schema this process keeps by version and checksum
    // must not serve the version that never was.
    const refused = await call('POST', '/v1/schema/draft/attributes/start_day/change', {
      to: 'date',
      decisions: [{ personId: GRACE, action: 'edit', value: 'not a date' }],
    });
    expect(refused.status).toBe(422);
    // `/v1/schema` is the published version as this process keeps it.
    const published = async () =>
      (await call('GET', '/v1/schema')).body as {
        version: number;
        attributes: { key: string; dataType: string }[];
      };
    const typeOf = (v: Awaited<ReturnType<typeof published>>) =>
      v.attributes.find((a) => a.key === 'start_day')?.dataType;
    const stillOne = await published();
    expect([stillOne.version, typeOf(stillOne)]).toEqual([1, 'text']);
    expect(await outbox()).toBe(before);

    const applied = await call('POST', '/v1/schema/draft/attributes/start_day/change', {
      to: 'date',
      decisions: [
        { personId: GRACE, action: 'edit', value: '2024-05-01' },
        // Marco's is left to the default: asked of him.
      ],
    });
    expect(applied.status).toBe(201);
    expect(applied.body).toMatchObject({
      version: 2,
      converted: 1,
      edited: 1,
      cleared: 1,
      requested: 1,
      notAsked: 0,
    });

    const read = async (id: string) =>
      ((await call('GET', `/v1/people/${id}`)).body['attributes'] as Record<string, unknown>)[
        'start_day'
      ];
    expect(await read(ADA)).toBe('2024-03-12');
    expect(await read(GRACE)).toBe('2024-05-01');
    expect(await read(ALAN)).toBe('2024-01-05');
    expect((await read(MARCO)) ?? null).toBeNull();

    // The same process serves the new version on the next read, as a date.
    const two = await published();
    expect([two.version, typeOf(two)]).toEqual([2, 'date']);

    // Corrections carrying `supersedes`, and the old text kept in history.
    const corrected = await superuser().unsafe<{ aggregate_id: string; supersedes: string }[]>(
      `SELECT aggregate_id, envelope->'payload'->>'supersedes' AS supersedes FROM people.outbox
        WHERE event_name = 'people.person.attribute_corrected'`,
    );
    expect(corrected.map((c) => c.aggregate_id).toSorted()).toEqual([ADA, MARCO, GRACE].toSorted());
    expect(corrected.every((c) => c.supersedes.length > 0)).toBe(true);
    const history = (await call('GET', `/v1/people/${MARCO}/history`)).body['items'] as {
      value: unknown;
      supersedes: string | null;
    }[];
    expect(history.map((h) => h.value)).toEqual(expect.arrayContaining(['when he starts', null]));

    const requests = await superuser().unsafe<{ person_id: string; attribute_key: string }[]>(
      'SELECT person_id, attribute_key FROM people.detail_request',
    );
    expect(requests).toEqual([{ person_id: MARCO, attribute_key: 'start_day' }]);

    const versions = await superuser().unsafe<{ n: string }[]>(
      'SELECT count(*) AS n FROM people.schema_version',
    );
    expect(Number(versions[0]?.n)).toBe(2);
  });
});
