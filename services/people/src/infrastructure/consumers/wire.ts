import { randomBytes } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { Kafka } from 'kafkajs';
import postgres from 'postgres';
import { AccountProvisioned, SchemaPublished } from '@kithena/contracts';
import { systemClock } from '@kithena/domain-kit';
import { logger } from '@kithena/telemetry';

import { recomputeCompleteness } from '../../application/completeness/recompute.js';
import { orgAdmin } from '../../application/org/org.js';
import { drizzleCompletenessStore } from '../drizzle-completeness-store.js';
import { drizzleOrgStore } from '../drizzle-org-store.js';
import { drizzlePeopleFacts, drizzleSchemaRepository } from '../drizzle-schema-repository.js';
import { tenantTransaction } from '../unit-of-work.js';
import { peopleConsumer } from './handle.js';
import { drizzleProvisionalPeople } from './identity.js';

/**
 * Start consuming, when there is something to consume from.
 *
 * Both settings optional, the way `MESSAGING_URL` is for identity: a subgraph
 * started on a laptop with no Redpanda and no database still serves its schema,
 * and one started in a deployment with both consumes. Returns without starting
 * anything when either is missing, and says so.
 *
 * Topics are per publishing module, so `kithena.identity.v1` carries every
 * identity event and the handler ignores the ones People does not read.
 */
export function wireConsumers(env = process.env): void {
  // A consumer that failed to connect is a process that should be restarted,
  // not a subgraph quietly serving while nothing is provisioned.
  startConsumers(env).catch((error: unknown) => {
    logger.error({ err: error }, 'people consumers failed');
    process.exit(1);
  });
}

/** `wireConsumers` without the exit, for a test to boot and stop. Null when not configured. */
export async function startConsumers(
  env: NodeJS.ProcessEnv,
): Promise<{ stop(): Promise<void> } | null> {
  const databaseUrl = env['PEOPLE_DATABASE_URL'];
  const brokers = env['KAFKA_BROKERS'];
  if (databaseUrl === undefined || brokers === undefined) {
    logger.info('PEOPLE_DATABASE_URL or KAFKA_BROKERS unset; not consuming');
    return null;
  }

  const client = postgres(databaseUrl, { max: 5 });
  const inTenant = tenantTransaction(drizzle(client));
  const handle = peopleConsumer({
    inTenant,
    provisional: drizzleProvisionalPeople({ clock: systemClock, newEventId: uuidv7 }),
    recompute: recomputeCompleteness({
      schema: drizzleSchemaRepository(),
      people: drizzlePeopleFacts(),
      store: drizzleCompletenessStore(),
      clock: systemClock,
      newEventId: uuidv7,
      calendars: drizzleOrgStore(),
    }),
    org: orgAdmin({ store: drizzleOrgStore(), clock: systemClock, newId: uuidv7 }),
  });

  const consumer = new Kafka({ clientId: 'people', brokers: brokers.split(',') }).consumer({
    groupId: 'people',
  });
  await consumer.connect();
  // From the beginning, which only matters the first time the group exists:
  // every handler is idempotent, and an account provisioned before People was
  // first deployed is an account People should still know about.
  await consumer.subscribe({
    topics: [AccountProvisioned.topic, SchemaPublished.topic],
    fromBeginning: true,
  });
  await consumer.run({
    eachMessage: async ({ message }) => {
      if (message.value === null) return;
      let envelope: unknown;
      try {
        envelope = JSON.parse(message.value.toString('utf8'));
      } catch {
        logger.warn('message was not JSON; skipped');
        return;
      }
      await handle(envelope);
    },
  });

  return {
    async stop() {
      await consumer.disconnect();
      await client.end();
    },
  };
}

/**
 * UUIDv7 (RFC 9562): 48 bits of milliseconds, then random bits under the
 * version and variant. The envelope requires v7 so the outbox sorts by time.
 *
 * `ponytail: no in-millisecond counter, unlike identity's. Two events from one
 * recompute batch may share a millisecond and sort by coin flip; nothing reads
 * this outbox in id order within a millisecond yet.`
 */
export function uuidv7(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
