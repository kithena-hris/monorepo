import { Kafka } from 'kafkajs';
import { PersonHired, TenantAdministratorNamed } from '@kithena/contracts';
import { kafkaConfigFrom } from '@kithena/db-kit';
import { logger, onShutdown } from '@kithena/telemetry';

import type { UnitOfWork } from '../../application/ports.js';
import { recruitingConsumer } from './handle.js';

/**
 * People's topic and identity's, each its own group, from the beginning the
 * first time: every handler is idempotent, and somebody hired before
 * Recruiting was bought is a member. Documents' wiring.
 */
export function wireConsumers(env: NodeJS.ProcessEnv, uow: UnitOfWork | null): void {
  const started = startConsumers(env, uow);
  started.catch((error: unknown) => {
    logger.error({ err: error }, 'recruiting consumers failed');
    process.exit(1);
  });
  onShutdown('recruiting consumer', async () => (await started)?.stop());
}

async function startConsumers(
  env: NodeJS.ProcessEnv,
  uow: UnitOfWork | null,
): Promise<{ stop(): Promise<void> } | null> {
  const kafka = kafkaConfigFrom(env, 'recruiting');
  if (uow === null || kafka === null) {
    logger.info(
      { module: 'recruiting' },
      'RECRUITING_DATABASE_URL or KAFKA_BROKERS unset; not consuming',
    );
    return null;
  }
  const handle = recruitingConsumer(uow);
  const consumers = await Promise.all([
    consume(new Kafka(kafka), 'recruiting', PersonHired.topic, handle),
    consume(new Kafka(kafka), 'recruiting-identity', TenantAdministratorNamed.topic, handle),
  ]);
  return {
    stop: async () => {
      await Promise.all(consumers.map((c) => c.disconnect()));
    },
  };
}

async function consume(
  kafka: Kafka,
  groupId: string,
  topic: string,
  handle: (envelope: unknown) => Promise<unknown>,
) {
  const consumer = kafka.consumer({ groupId });
  await consumer.connect();
  await consumer.subscribe({ topics: [topic], fromBeginning: true });
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
  return consumer;
}
