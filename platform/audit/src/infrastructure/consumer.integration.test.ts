import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { Kafka } from 'kafkajs';
import postgres, { type Sql } from 'postgres';
import { SettingsActivityRecorded, SupportSessionStarted } from '@kithena/contracts';
import { startPostgres, startRedpanda } from '@kithena/testing';

import { recordEvent } from '../application/record.js';
import { startConsumer } from './consumer.js';
import { drizzleEntryStore } from './drizzle-entry-store.js';

/**
 * The topics to the table: an envelope as the relay publishes it — the outbox
 * row's `envelope`, unchanged, keyed `tenant:aggregate` — becomes one entry,
 * however many times it is delivered, from either module's topic.
 */

const TENANT = '00000000-0000-4000-8000-000000000001';
const ADA = '00000000-0000-4000-8000-0000000000a1';
const SUPPORT = '00000000-0000-4000-8000-0000000000a9';
const OPERATOR = '00000000-0000-4000-8000-0000000000f1';

let stops: (() => Promise<void>)[] = [];
let brokers = '';
let db: PostgresJsDatabase;
let clients: Sql[] = [];

beforeAll(async () => {
  const [pg, rp] = await Promise.all([startPostgres(), startRedpanda()]);
  stops = [pg.stop, rp.stop];
  brokers = rp.brokers;
  const admin = postgres(pg.url, { max: 1 });
  await drizzle(admin).execute(sql`CREATE ROLE svc_audit LOGIN PASSWORD 'svc_audit' NOBYPASSRLS`);
  const path = new URL('../../../../migrations/20260929160000_audit.sql', import.meta.url);
  await drizzle(admin).execute(sql.raw(await readFile(path, 'utf8')));
  const asService = new URL(pg.url);
  asService.username = 'svc_audit';
  asService.password = 'svc_audit';
  const service = postgres(asService.toString(), { max: 4 });
  clients = [admin, service];
  db = drizzle(service);
}, 240_000);

afterAll(async () => {
  for (const c of clients) await c.end();
  for (const stop of stops) await stop();
});

const inTenant = <T>(tenantId: string, fn: (tx: PostgresJsDatabase) => Promise<T>) =>
  db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });

const envelope = (eventId: string, eventName: string, actor: unknown, payload: unknown) => ({
  eventId,
  eventName,
  eventVersion: 1,
  tenantId: TENANT,
  occurredAt: '2026-09-29T10:00:00.000Z',
  recordedAt: '2026-09-29T10:00:01.000Z',
  effectiveFrom: null,
  aggregate: { type: 'Test', id: eventId, version: 1 },
  actor,
  correlationId: '00000000-0000-4000-8000-0000000000c1',
  causationId: null,
  payload,
});

describe('the audit consumer', () => {
  it('turns both modules’ topics into entries, once each', async () => {
    const store = drizzleEntryStore(inTenant);
    const consumer = await startConsumer(
      { clientId: 'audit-test', brokers: [brokers] },
      recordEvent({ store }),
    );
    const producer = new Kafka({ clientId: 'relay', brokers: [brokers] }).producer();
    await producer.connect();
    const setting = envelope(
      '01890000-0000-7000-8000-000000000001',
      'people.settings.activity_recorded',
      { kind: 'user', userId: SUPPORT, onBehalfOf: OPERATOR },
      { area: 'roles', action: 'Granted a role', subject: 'HR', detail: null, reason: null },
    );
    const signIn = envelope(
      '01890000-0000-7000-8000-000000000002',
      'identity.support.session_started',
      { kind: 'user', userId: SUPPORT, onBehalfOf: OPERATOR },
      {
        sessionId: '00000000-0000-4000-8000-0000000000b1',
        accountId: SUPPORT,
        operatorId: OPERATOR,
        reason: 'Ticket 4411',
        expiresAt: '2026-09-29T10:30:00.000Z',
      },
    );
    const ignored = envelope(
      '01890000-0000-7000-8000-000000000003',
      'people.person.hired',
      { kind: 'user', userId: ADA },
      {},
    );
    await producer.send({
      topic: SettingsActivityRecorded.topic,
      messages: [setting, setting, ignored].map((e) => ({
        key: `${TENANT}:${e.aggregate.id}`,
        value: JSON.stringify(e),
      })),
    });
    await producer.send({
      topic: SupportSessionStarted.topic,
      messages: [{ key: `${TENANT}:x`, value: JSON.stringify(signIn) }],
    });
    await producer.disconnect();

    const deadline = Date.now() + 60_000;
    let rows: Awaited<ReturnType<typeof store.page>> = [];
    while (Date.now() < deadline && rows.length < 2) {
      await new Promise((r) => setTimeout(r, 500));
      rows = await store.page(TENANT, {
        filter: {
          areas: [],
          actorKind: null,
          actor: null,
          subject: null,
          from: null,
          until: null,
          search: null,
        },
        before: null,
        limit: 10,
      });
    }
    await consumer.stop();
    expect(rows.map((r) => r.action).toSorted()).toEqual([
      'Granted a role',
      'Kithena support signed in',
    ]);
    expect(rows.find((r) => r.action === 'Granted a role')?.supportSignIn?.reason).toBe(
      'Ticket 4411',
    );
  });
});
