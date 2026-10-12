import { Kafka } from 'kafkajs';
import { PersonHired, TenantAdministratorNamed } from '@kithena/contracts';
import { kafkaConfigFrom } from '@kithena/db-kit';
import { logger, onShutdown } from '@kithena/telemetry';

import type { UnitOfWork } from '../../application/ports.js';
import { documentsConsumer } from './handle.js';

/**
 * People's topic and identity's, each its own group, from the beginning the
 * first time: every handler is idempotent, and somebody hired before
 * Documents was bought is a member. Time Off's wiring.
 */
export function wireConsumers(env: NodeJS.ProcessEnv, uow: UnitOfWork | null): void {
  const started = startConsumers(env, uow);
  started.catch((error: unknown) => {
    logger.error({ err: error }, 'documents consumers failed');
    process.exit(1);
  });
  onShutdown('documents consumer', async () => (await started)?.stop());
}

async function startConsumers(
  env: NodeJS.ProcessEnv,
  uow: UnitOfWork | null,
): Promise<{ stop(): Promise<void> } | null> {
  const kafka = kafkaConfigFrom(env, 'documents');
  if (uow === null || kafka === null) {
    logger.info(
      { module: 'documents' },
      'DOCUMENTS_DATABASE_URL or KAFKA_BROKERS unset; not consuming',
    );
    return null;
  }
  const handle = documentsConsumer(uow);
  const consumers = await Promise.all([
    consume(new Kafka(kafka), 'documents', PersonHired.topic, handle),
    consume(new Kafka(kafka), 'documents-identity', TenantAdministratorNamed.topic, handle),
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
