import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { fixedClock, ok } from '@kithena/domain-kit';
import { startPostgres } from '@kithena/testing';

import { utcCalendars } from '../../application/org/org.js';
import { define, versionOf } from '../../application/person/in-memory.js';
import {
  drizzlePendingChangeStore,
  outboxPendingChanges,
} from '../../application/person/pending-store.js';
import { personAccess } from '../../application/person/person-access.js';
import { enterAsSelf } from '../../application/person/self-entry.js';
import { drizzlePersonRepository } from '../drizzle-person-repository.js';
import {
  drizzlePersonReader,
  drizzleRelations,
  drizzleSchemaVersions,
} from '../drizzle-person-reader.js';
import { drizzleSchemaRepository } from '../drizzle-schema-repository.js';
import { open, seal, staticKeyRing } from '../envelope.js';
import { drizzleSecretStore } from '../secret-store.js';
import { drizzleUniqueClaims } from '../unique.js';
import { httpSignupReport } from '../signup-report.js';
import { tenantTransaction } from '../unit-of-work.js';
import { peopleConsumer } from './handle.js';
import { drizzleProvisionalPeople } from './identity.js';

/**
 * What a person types on identity's page reaches their record as their own
 * entry (bug of 2026-09-27: a name updated there never reached the profile).
 *
 * Driven through the consumer with the envelopes identity's outbox writes,
 * over Postgres as `svc_people`, with the real write path behind it: history,
 * `profile_updated`, approvals.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
// A fresh person for each test: history is append-only, even for a test.
let ACCOUNT = '';
let PERSON = '';
const clock = fixedClock('2026-09-27T09:00:00.000Z');

let stopPg: (() => Promise<void>) | undefined;
const clients: ReturnType<typeof postgres>[] = [];
let admin: PostgresJsDatabase;
let handle: ReturnType<typeof peopleConsumer>;
let inTenant: ReturnType<typeof tenantTransaction>;

let ids = 0;
const newId = () => {
  ids += 1;
  return `01890000-0000-7000-8000-${String(ids).padStart(12, '0')}`;
};
const ring = staticKeyRing([{ id: 'k1', key: randomBytes(32) }]);

const employee = (key: string, over: Parameters<typeof define>[0] = { key }) =>
  define({ ownership: ['employee', 'hr'], visibility: ['self', 'hr'], ...over, key });

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;
  const adminClient = postgres(pg.url, { max: 1, onnotice: () => {} });
  clients.push(adminClient);
  admin = drizzle(adminClient);
  const dir = fileURLToPath(new URL('../../../../../migrations/', import.meta.url));
  const files = (await readdir(dir))
    .filter((f) => f.includes('_people_') && !f.includes('identity'))
    .sort();
  for (const file of ['20260821120000_tenant_registry.sql', ...files]) {
    await admin.execute(sql.raw(await readFile(`${dir}${file}`, 'utf8')));
  }
  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);
  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  const serviceClient = postgres(asService.toString(), { max: 4, onnotice: () => {} });
  clients.push(serviceClient);
  inTenant = tenantTransaction(drizzle(serviceClient));

  const reader = drizzlePersonReader();
  const access = personAccess({
    people: drizzlePersonRepository(),
    reader,
    schemas: drizzleSchemaVersions(),
    relations: drizzleRelations(),
    secrets: drizzleSecretStore(ring),
    uniques: drizzleUniqueClaims(ring),
    approvals: {
      store: drizzlePendingChangeStore({
        seal: (plaintext) => seal(plaintext, ring),
        open: (sealed) => open(sealed, ring),
      }),
      publish: outboxPendingChanges,
      clock,
      newId,
    },
    clock,
    newId,
    calendars: utcCalendars,
  });
  handle = peopleConsumer({
    inTenant,
    provisional: drizzleProvisionalPeople({ clock, newEventId: newId }),
    recompute: () =>
      Promise.resolve(
        ok({ evaluated: 0, becameIncomplete: 0, becameComplete: 0, superseded: false }),
      ),
    enterAsSelf: enterAsSelf(access, reader),
  });

  await inTenant(ACME, ({ tx }) =>
    drizzleSchemaRepository().appendVersion(
      tx,
      ACME,
      versionOf(1, [
        employee('given_name'),
        employee('family_name'),
        employee('preferred_name'),
        employee('t_shirt', {
          key: 't_shirt',
          collectAt: 'signup',
          dataType: 'select',
          typeConfig: {
            kind: 'select',
            options: [
              { value: 's', label: { default: 'Small' } },
              { value: 'm', label: { default: 'Medium' } },
            ],
          },
        }),
        employee('badge_name', { key: 'badge_name', collectAt: 'signup', requiresApproval: true }),
        define({ key: 'cost_centre', ownership: ['hr'], collectAt: 'signup' }),
      ]),
      [],
      '2026-01-01',
    ),
  );
});

afterAll(async () => {
  for (const c of clients) await c.end();
  await stopPg?.();
});

beforeEach(async () => {
  ACCOUNT = randomUUID();
  PERSON = randomUUID();
  await admin.execute(sql`
    INSERT INTO people.person
      (tenant_id, id, status, identity_account_id, hire_date, given_name, family_name, work_email, schema_version)
    VALUES (${ACME}::uuid, ${PERSON}::uuid, 'active', ${ACCOUNT}::uuid, '2026-01-05',
            'Inés', 'García', ${`${PERSON}@acme.test`}, 1)`);
});

function envelope(eventName: string, payload: object) {
  return {
    eventId: newId(),
    eventName,
    eventVersion: 1,
    tenantId: ACME,
    occurredAt: '2026-09-27T08:59:00.000Z',
    recordedAt: '2026-09-27T08:59:00.000Z',
    effectiveFrom: null,
    aggregate: { type: 'Account', id: ACCOUNT, version: 3 },
    actor: { kind: 'user', userId: ACCOUNT },
    correlationId: '00000000-0000-4000-8000-0000000000c1',
    causationId: null,
    payload,
  };
}

const captured = (name: { given: string; family: string; preferred: string | null }) =>
  envelope('identity.account.profile_captured', {
    accountId: ACCOUNT,
    identityId: '00000000-0000-4000-8000-0000000000d1',
    name,
    timeZone: 'Europe/Madrid',
    mobilePresent: false,
    capturedAt: '2026-09-27T09:00:00.000Z',
  });

const answered = (answers: Record<string, string | number | boolean>) =>
  envelope('identity.account.signup_answered', {
    accountId: ACCOUNT,
    schemaVersion: 1,
    answers,
    answeredAt: '2026-09-27T09:00:00.000Z',
  });

const record = async () =>
  [
    ...(await admin.execute(
      sql`SELECT given_name, family_name, preferred_name, custom FROM people.person WHERE id = ${PERSON}::uuid`,
    )),
  ][0];
const history = async () => [
  ...(await admin.execute(sql`
      SELECT attribute_key, value, actor FROM people.person_attribute_history
       WHERE person_id = ${PERSON}::uuid ORDER BY attribute_key`)),
];
const outbox = async (name: string) => [
  ...(await admin.execute(
    sql`SELECT envelope FROM people.outbox
           WHERE event_name = ${name}
             AND (aggregate_id = ${PERSON} OR envelope -> 'payload' ->> 'personId' = ${PERSON})
           ORDER BY created_at, event_id`,
  )),
];

describe('a name typed on identity’s page', () => {
  it('updates the record as the person’s own edit, audited and announced', async () => {
    expect(
      await handle(captured({ given: 'Inés', family: 'García López', preferred: 'Nes' })),
    ).toBe('applied');

    expect(await record()).toMatchObject({
      given_name: 'Inés',
      family_name: 'García López',
      preferred_name: 'Nes',
    });
    // Only what changed, and by whom: the person's own account.
    expect(await history()).toEqual([
      {
        attribute_key: 'family_name',
        value: 'García López',
        actor: { kind: 'user', userId: ACCOUNT },
      },
      { attribute_key: 'preferred_name', value: 'Nes', actor: { kind: 'user', userId: ACCOUNT } },
    ]);
    expect(await outbox('people.person.profile_updated')).toHaveLength(1);
  });

  it('changes nothing and records nothing when it matches the record', async () => {
    // Applied only in the sense that the zone, identity's, is projected again.
    await handle(captured({ given: 'Inés', family: 'García', preferred: null }));
    expect(await history()).toEqual([]);
    expect(await outbox('people.person.profile_updated')).toEqual([]);
  });
});

describe('sign-up answers', () => {
  it('are entered as the person’s own, and one that needs approval is held', async () => {
    expect(await handle(answered({ t_shirt: 'm', badge_name: 'Nes' }))).toBe('applied');

    expect((await record())?.['custom']).toMatchObject({ t_shirt: 'm' });
    expect((await record())?.['custom']).not.toHaveProperty('badge_name');
    const held = [
      ...(await admin.execute(
        sql`SELECT attribute_key FROM people.pending_change WHERE person_id = ${PERSON}::uuid`,
      )),
    ];
    expect(held).toEqual([{ attribute_key: 'badge_name' }]);
    expect(await outbox('people.person.change_requested')).toHaveLength(1);
  });

  it('are refused, and nothing written, for a field the employee may not write', async () => {
    expect(await handle(answered({ t_shirt: 's', cost_centre: 'CC-1' }))).toBe('rejected');
    expect(await history()).toEqual([]);
  });
});

describe('the sign-up questions People reports to identity', () => {
  it('are the employee’s own sign-up fields from the schema in force, and nothing else', async () => {
    const received: { path: string; token: string; body: Record<string, unknown> }[] = [];
    const server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      request.on('end', () => {
        received.push({
          path: request.url ?? '',
          token: String(request.headers['x-internal-token']),
          body: JSON.parse(body) as Record<string, unknown>,
        });
        response.writeHead(204).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await httpSignupReport({
        baseUrl: `http://127.0.0.1:${String(port)}`,
        token: 'people-token',
        inTenant,
        clock,
      })(ACME);
    } finally {
      server.close();
    }

    expect(received).toHaveLength(1);
    expect(received[0]?.path).toBe(`/api/internal/tenants/${ACME}/signup-questions`);
    expect(received[0]?.token).toBe('people-token');
    // `cost_centre` is placed at sign-up but only HR writes it.
    expect(received[0]?.body).toMatchObject({
      asOf: '2026-09-27T09:00:00.000Z',
      schemaVersion: 1,
      questions: [
        { key: 't_shirt', dataType: 'select', options: [{ value: 's' }, { value: 'm' }] },
        { key: 'badge_name', dataType: 'text' },
      ],
    });
    expect((received[0]?.body['questions'] as unknown[]).length).toBe(2);
  });
});
