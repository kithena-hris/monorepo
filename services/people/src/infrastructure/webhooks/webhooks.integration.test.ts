import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixedClock, type Clock } from '@kithena/domain-kit';
import { startPostgres } from '@kithena/testing';

import { define, versionOf } from '../../application/person/in-memory.js';
import { inTenantResult, personAccess } from '../../application/person/person-access.js';
import { Person } from '../../domain/person/person.js';
import { drizzlePersonRepository } from '../drizzle-person-repository.js';
import {
  drizzlePersonReader,
  drizzleRelations,
  drizzleSchemaVersions,
} from '../drizzle-person-reader.js';
import { drizzleSchemaRepository } from '../drizzle-schema-repository.js';
import { staticKeyRing } from '../envelope.js';
import { drizzleSecretStore } from '../secret-store.js';
import { drizzleUniqueClaims } from '../unique.js';
import { tenantTransaction } from '../unit-of-work.js';
import { verifySignature } from './payload.js';
import type { Poster } from './egress.js';
import { webhooks } from './webhooks.js';

/**
 * Webhooks over Postgres: the outbox trigger enqueues, the dispatcher sends,
 * and a replay is filtered against the allowlist as it is now.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const ADA = '00000000-0000-4000-8000-0000000000a1';
const BEA = '00000000-0000-4000-8000-0000000000a2';

let stopPg: (() => Promise<void>) | undefined;
const clients: ReturnType<typeof postgres>[] = [];
let admin: ReturnType<typeof drizzle>;
let inTenant: ReturnType<typeof tenantTransaction>;

/*
 * A clock the test moves. Set in the future, because a delivery's first
 * `next_attempt_at` is the database's `now()` and must already be due.
 */
let current = fixedClock('2030-01-01T09:00:00.000Z');
const clock: Clock = {
  now: () => current.now(),
  today: (zone) => current.today(zone),
  instant: () => current.instant(),
  date: (zone) => current.date(zone),
};
const advance = (ms: number) => {
  current = fixedClock(new Date(current.now().getTime() + ms).toISOString());
};

let ids = 0;
const newId = () => {
  ids += 1;
  return `01890000-0000-7000-8000-${String(ids).padStart(12, '0')}`;
};

const ring = staticKeyRing([{ id: 'k1', key: randomBytes(32) }]);

const sent: { url: string; headers: Record<string, string>; body: string }[] = [];
let answer = 200;
const post: Poster = (url, request) => {
  sent.push({ url, ...request });
  return Promise.resolve({ status: answer });
};
const notified: string[] = [];

const hooks = () =>
  webhooks({
    inTenant,
    ring,
    post,
    // Every name answers a public documentation-free address; the egress
    // rules themselves are tested in egress.test.ts.
    egress: { resolve: () => Promise.resolve([{ address: '93.184.215.14', family: 4 }]) },
    clock,
    newId,
    notify: (_t, id) => notified.push(id),
  });

const people = () =>
  personAccess({
    people: drizzlePersonRepository(),
    reader: drizzlePersonReader(),
    schemas: drizzleSchemaVersions(),
    relations: drizzleRelations(),
    secrets: drizzleSecretStore(ring),
    uniques: drizzleUniqueClaims(ring),
    clock,
    newId,
  });

const hr = { accountId: '00000000-0000-4000-8000-0000000000ff', roles: new Set(['hr']) };

const write = (personId: string, changes: Record<string, unknown>) =>
  inTenantResult(inTenant, ACME, (tx) =>
    people().update(tx, {
      tenantId: ACME,
      viewer: hr,
      correlationId: '00000000-0000-4000-8000-0000000000c1',
      personId,
      changes,
    }),
  );

const migration = (file: string): Promise<string> =>
  readFile(new URL(`../../../../../migrations/${file}`, import.meta.url), 'utf8');

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;
  const adminClient = postgres(pg.url, { max: 1 });
  clients.push(adminClient);
  admin = drizzle(adminClient);
  for (const file of [
    '20260821120000_tenant_registry.sql',
    '20260922140000_people_bootstrap.sql',
    '20260922160000_people_registry.sql',
    '20260922170000_people_person.sql',
    '20260923110000_people_completeness.sql',
    '20260923120000_people_webhooks.sql',
  ]) {
    await admin.execute(sql.raw(await migration(file)));
  }
  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);
  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  const serviceClient = postgres(asService.toString(), { max: 4 });
  clients.push(serviceClient);
  inTenant = tenantTransaction(drizzle(serviceClient));

  const repo = drizzlePersonRepository();
  for (const id of [ADA, BEA]) {
    await inTenant(ACME, ({ tx }) =>
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
      ),
    );
  }
  await inTenant(ACME, ({ tx }) =>
    drizzleSchemaRepository().appendVersion(
      tx,
      ACME,
      versionOf(1, [define({ key: 'job_title' }), define({ key: 'department' })]),
      [],
      '2026-09-01',
    ),
  );
});

afterAll(async () => {
  for (const c of clients) await c.end();
  await stopPg?.();
});

beforeEach(async () => {
  sent.length = 0;
  notified.length = 0;
  answer = 200;
  await admin.execute(sql`DELETE FROM people.webhook_delivery`);
  await admin.execute(sql`DELETE FROM people.webhook_endpoint`);
});

async function endpoint(allowlist: string[]) {
  const created = await hooks().createEndpoint(ACME, {
    url: 'https://hooks.example.com/people',
    events: ['people.person.profile_updated'],
    allowlist,
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

const keysIn = (body: string) =>
  (JSON.parse(body) as { payload: { changed: { key: string }[] } }).payload.changed.map(
    (c) => c.key,
  );

describe('a replay after the allowlist was narrowed', () => {
  it('does not resend the removed field', async () => {
    const { id, secret } = await endpoint(['job_title', 'department']);
    expect((await write(ADA, { job_title: 'Engineer', department: 'Platform' })).ok).toBe(true);

    expect(await hooks().deliverDue(ACME)).toMatchObject({ delivered: 1 });
    const [first] = sent;
    expect(keysIn(first?.body ?? '')).toEqual(['job_title', 'department']);
    expect(
      verifySignature(first?.body ?? '', first?.headers['kithena-signature'] ?? '', secret),
    ).toBe(true);

    expect((await hooks().updateEndpoint(ACME, id, { allowlist: ['job_title'] })).ok).toBe(true);

    const delivered = await admin.execute(sql`SELECT id FROM people.webhook_delivery`);
    const deliveryId = String([...delivered][0]?.['id']);
    expect((await hooks().replay(ACME, deliveryId)).ok).toBe(true);
    expect(await hooks().deliverDue(ACME)).toMatchObject({ delivered: 1 });

    const replayed = sent[1];
    expect(keysIn(replayed?.body ?? '')).toEqual(['job_title']);
    expect(replayed?.body).not.toContain('department');
    expect(replayed?.body).not.toContain('Platform');
    // The same event, so the receiver can recognise it.
    expect(replayed?.headers['kithena-event-id']).toBe(first?.headers['kithena-event-id']);
  });
});

describe('delivery', () => {
  it('is enqueued by the outbox, once per subscribed endpoint, and not for others', async () => {
    await endpoint(['job_title']);
    await hooks().createEndpoint(ACME, {
      url: 'https://elsewhere.example.com/',
      events: ['people.person.terminated'],
      allowlist: [],
    });
    await write(ADA, { job_title: 'Engineer' });
    const rows = await admin.execute(sql`SELECT count(*)::int AS n FROM people.webhook_delivery`);
    expect([...rows][0]?.['n']).toBe(1);
  });

  it('sends nothing for a change to fields the endpoint may not receive', async () => {
    await endpoint(['department']);
    await write(ADA, { job_title: 'Engineer' });
    expect(await hooks().deliverDue(ACME)).toMatchObject({ skipped: 1, delivered: 0 });
    expect(sent).toHaveLength(0);
  });

  it('holds a person’s later change until the earlier one is settled', async () => {
    await endpoint(['job_title']);
    await write(ADA, { job_title: 'One' });
    await write(ADA, { job_title: 'Two' });
    await write(BEA, { job_title: 'Other' });

    answer = 500;
    const failing = await hooks().deliverDue(ACME);
    // Ada's first and Bea's only were tried; Ada's second waited behind hers.
    expect(failing).toMatchObject({ retrying: 2, delivered: 0 });
    expect(sent).toHaveLength(2);

    answer = 200;
    advance(31_000);
    await hooks().deliverDue(ACME);
    const titles = sent
      .filter((s) => s.body.includes(ADA))
      .map(
        (s) =>
          (JSON.parse(s.body) as { payload: { changed: { value: string }[] } }).payload.changed[0]
            ?.value,
      );
    expect(titles).toEqual(['One', 'One', 'Two']);
  });

  it('gives up after 24 hours, disables the endpoint and tells the tenant', async () => {
    const { id } = await endpoint(['job_title']);
    await write(ADA, { job_title: 'Engineer' });
    answer = 503;

    await hooks().deliverDue(ACME);
    for (let hour = 0; hour < 30 && notified.length === 0; hour += 1) {
      advance(6 * 60 * 60 * 1000);
      await hooks().deliverDue(ACME);
    }

    expect(notified).toEqual([id]);
    const rows = await admin.execute(sql`
      SELECT e.disabled_at IS NOT NULL AS disabled, d.status
        FROM people.webhook_endpoint e JOIN people.webhook_delivery d ON d.endpoint_id = e.id`);
    expect([...rows][0]).toMatchObject({ disabled: true, status: 'failed' });
  });

  it('signs with both secrets during a rotation overlap, and only the new one after', async () => {
    const { id, secret: old } = await endpoint(['job_title']);
    const rotated = await hooks().rotateSecret(ACME, id, 1);
    if (!rotated.ok) throw new Error('rotation failed');

    await write(ADA, { job_title: 'During' });
    await hooks().deliverDue(ACME);
    const during = sent[0];
    expect(
      verifySignature(during?.body ?? '', during?.headers['kithena-signature'] ?? '', old),
    ).toBe(true);
    expect(
      verifySignature(
        during?.body ?? '',
        during?.headers['kithena-signature'] ?? '',
        rotated.value.secret,
      ),
    ).toBe(true);

    advance(2 * 60 * 60 * 1000);
    await write(ADA, { job_title: 'After' });
    await hooks().deliverDue(ACME);
    const after = sent[1];
    expect(verifySignature(after?.body ?? '', after?.headers['kithena-signature'] ?? '', old)).toBe(
      false,
    );
  });
});
