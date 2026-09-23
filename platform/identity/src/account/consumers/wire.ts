import { drizzle } from 'drizzle-orm/postgres-js';
import { Kafka } from 'kafkajs';
import postgres from 'postgres';
import { PersonAccessEnded, PersonIdentityFactsChanged } from '@kithena/contracts';
import { withTenant } from '@kithena/db-kit';
import { logger } from '@kithena/telemetry';

import { peopleConsumer } from './people.js';

/**
 * Consume People's corrections and access events, when there is a broker to
 * consume from.
 *
 * Optional the way `MESSAGING_URL` is: without `KAFKA_BROKERS` identity serves
 * sign-in exactly as before, which is also every tenant's situation when no
 * People module exists to publish. The Vercel gateway never calls this; a
 * long-lived consumer belongs to the node server.
 */
export function wirePeopleConsumer(databaseUrl: string, env = process.env): void {
  const brokers = env['KAFKA_BROKERS'];
  if (brokers === undefined || brokers === '') {
    logger.info('KAFKA_BROKERS unset; not consuming People corrections');
    return;
  }

  // A consumer that failed to connect is a process to restart, not a service
  // quietly serving stale names.
  start(databaseUrl, brokers).catch((error: unknown) => {
    logger.error({ err: error }, 'identity consumer failed');
    process.exit(1);
  });
}

async function start(databaseUrl: string, brokers: string): Promise<void> {
  const db = drizzle(postgres(databaseUrl, { max: 2 }));
  const handle = peopleConsumer((tenantId, fn) => withTenant(db, tenantId, fn));

  const consumer = new Kafka({ clientId: 'identity', brokers: brokers.split(',') }).consumer({
    groupId: 'identity',
  });
  await consumer.connect();
  // One topic per module today, so this is one subscription; a set, so it stays right if not.
  await consumer.subscribe({
    topics: [...new Set([PersonIdentityFactsChanged.topic, PersonAccessEnded.topic])],
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
}
