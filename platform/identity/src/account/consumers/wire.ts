import { drizzle } from 'drizzle-orm/postgres-js';
import { Kafka } from 'kafkajs';
import postgres from 'postgres';
import {
  PersonAccessEnded,
  PersonAccessRestored,
  PersonIdentityFactsChanged,
} from '@kithena/contracts';
import { kafkaConfigFrom, withTenant, type KafkaClientConfig } from '@kithena/db-kit';
import { logger, onShutdown } from '@kithena/telemetry';

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
  // Throws on a half-configured SASL or TLS setting: a boot that fails, not a
  // consumer that connects without the credentials it was meant to have.
  const kafka = kafkaConfigFrom(env, 'identity');
  if (kafka === null) {
    logger.info('KAFKA_BROKERS unset; not consuming People corrections');
    return;
  }

  // A consumer that failed to connect is a process to restart, not a service
  // quietly serving stale names.
  const started = start(databaseUrl, kafka);
  started.catch((error: unknown) => {
    logger.error({ err: error }, 'identity consumer failed');
    process.exit(1);
  });
  // Leave the group after the message in hand, then close the pool (PEO-118).
  onShutdown('people corrections consumer', async () => (await started)());
}

async function start(databaseUrl: string, kafka: KafkaClientConfig): Promise<() => Promise<void>> {
  const client = postgres(databaseUrl, { max: 2 });
  const db = drizzle(client);
  const handle = peopleConsumer((tenantId, fn) => withTenant(db, tenantId, fn));

  const consumer = new Kafka(kafka).consumer({
    groupId: 'identity',
  });
  await consumer.connect();
  // One topic per module today, so this is one subscription; a set, so it stays right if not.
  await consumer.subscribe({
    topics: [
      ...new Set([
        PersonIdentityFactsChanged.topic,
        PersonAccessEnded.topic,
        PersonAccessRestored.topic,
      ]),
    ],
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
  return async () => {
    await consumer.disconnect();
    await client.end();
  };
}
