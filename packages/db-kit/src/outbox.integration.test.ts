import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import type { PendingEvent } from '@kithena/domain-kit';
import { CalendarDate, Instant, TenantId } from '@kithena/contracts';
import { startPostgres } from '@kithena/testing';

import { outboxTable, publish } from './outbox.js';

/**
 * The transactional outbox, against a real database.
 *
 * The claim in CLAUDE.md is "no dual writes": the row and the event it produces
 * land in one transaction, Debezium tails the WAL, and nothing is lost if the
 * process dies between the two. The only part of that worth testing here is the
 * atomicity, and atomicity is precisely what a mock cannot have — an in-memory
 * double will happily "roll back" a write it never made durable.
 */

// Parsed rather than cast. The brands exist so a raw string cannot be mistaken
// for a validated one, and a test that reached for `as` to get past them would
// be the first place that guarantee stopped applying.
const TENANT = TenantId.parse('00000000-0000-4000-8000-00000000000a');
const outbox = outboxTable('platform');

// Declared possibly-undefined on purpose: if `beforeAll` throws part way
// through, `afterAll` still runs and has to clean up whatever was created.
let stop: (() => Promise<void>) | undefined;
let client: ReturnType<typeof postgres> | undefined;
let db: PostgresJsDatabase;

function pendingEvent(overrides: Partial<PendingEvent> = {}): PendingEvent {
  return {
    eventId: '01890000-0000-7000-8000-000000000001',
    eventName: 'people.person.hired',
    eventVersion: 1,
    tenantId: TENANT,
    occurredAt: Instant.parse('2026-01-15T09:00:00.000Z'),
    // Entered on the 15th, effective on the 1st. Both dates survive into the
    // outbox or payroll cannot compute a retroactive delta.
    effectiveFrom: CalendarDate.parse('2026-01-01'),
    aggregate: { type: 'Person', id: 'person-1', version: 1 },
    actor: { kind: 'system', process: 'integration-test' },
    correlationId: '00000000-0000-4000-8000-000000000002',
    causationId: null,
    payload: { workEmail: 'a@example.com' },
    ...overrides,
  };
}

beforeAll(async () => {
  const started = await startPostgres();
  stop = started.stop;
  client = postgres(started.url, { max: 1 });
  db = drizzle(client);

  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS platform`);
  await db.execute(sql`
    CREATE TABLE platform.outbox (
      event_id        uuid PRIMARY KEY,
      tenant_id       uuid NOT NULL,
      event_name      text NOT NULL,
      event_version   text NOT NULL,
      aggregate_type  text NOT NULL,
      aggregate_id    text NOT NULL,
      partition_key   text NOT NULL,
      envelope        jsonb NOT NULL,
      created_at      timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE platform.person (
      id         text PRIMARY KEY,
      tenant_id  uuid NOT NULL
    )
  `);
});

afterAll(async () => {
  await client?.end();
  await stop?.();
});

async function outboxRows(): Promise<readonly Record<string, unknown>[]> {
  return [...(await db.execute(sql`SELECT * FROM platform.outbox ORDER BY created_at`))];
}

async function personRows(): Promise<readonly Record<string, unknown>[]> {
  return [...(await db.execute(sql`SELECT * FROM platform.person`))];
}

describe('the write and its event are one transaction', () => {
  it('commits the row and the event together', async () => {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`INSERT INTO platform.person (id, tenant_id) VALUES ('person-1', ${TENANT}::uuid)`,
      );
      await publish(tx, outbox, [pendingEvent()]);
    });

    expect(await personRows()).toHaveLength(1);
    expect(await outboxRows()).toHaveLength(1);
  });

  it('rolls both back when the write fails after the event is staged', async () => {
    /*
     * The failure this design exists to prevent. With a dual write — insert the
     * row, then publish to Redpanda — a crash between the two leaves a consumer
     * reacting to a hiring that never happened, and nothing in the system can
     * tell afterwards that it did not. Here the event is staged in the same
     * transaction, so it cannot outlive the write.
     */
    await expect(
      db.transaction(async (tx) => {
        await publish(
          tx,
          outbox,
          [pendingEvent({ eventId: '01890000-0000-7000-8000-000000000002' })],
        );
        await tx.execute(
          sql`INSERT INTO platform.person (id, tenant_id) VALUES ('person-1', ${TENANT}::uuid)`,
        );
      }),
    ).rejects.toThrow();

    // Still exactly what the first test left behind: the duplicate key aborted
    // the transaction and took the staged event with it.
    expect(await personRows()).toHaveLength(1);
    expect(await outboxRows()).toHaveLength(1);
  });

  it('stages nothing when there is nothing to stage', async () => {
    const before = (await outboxRows()).length;
    await db.transaction(async (tx) => {
      await publish(tx, outbox, []);
    });
    expect(await outboxRows()).toHaveLength(before);
  });
});

describe('what the outbox records is what a consumer needs', () => {
  it('partitions by tenant and aggregate, so per-aggregate order survives', async () => {
    const [row] = await outboxRows();
    // Redpanda guarantees order within a partition and nothing across them. Two
    // events for the same person must therefore share a key, or an approval can
    // be delivered before the request it approves.
    expect(row?.['partition_key']).toBe(`${TENANT}:person-1`);
  });

  it('keeps both timestamps, and adds the one only the writer knows', async () => {
    const [row] = await outboxRows();
    const envelope: unknown = row?.['envelope'];
    expect(envelope).toBeTypeOf('object');
    if (envelope === null || typeof envelope !== 'object') return;

    const record: Record<string, unknown> = { ...envelope };
    // `occurredAt` is when it happened, `effectiveFrom` is when it takes effect
    // in the domain, and `recordedAt` is stamped here because only the write
    // side knows when the row was actually persisted.
    expect(record['occurredAt']).toBe('2026-01-15T09:00:00.000Z');
    expect(record['effectiveFrom']).toBe('2026-01-01');
    expect(record['recordedAt']).toBeTypeOf('string');
  });

  it('gives each event a primary key, so a redelivery cannot duplicate it', async () => {
    // The consumer side of exactly-once. Re-staging the same event id inside a
    // retried transaction must fail rather than enqueue it twice.
    await expect(
      db.transaction(async (tx) => {
        await publish(tx, outbox, [pendingEvent()]);
      }),
    ).rejects.toThrow();
  });
});
