import { Kafka } from 'kafkajs';
import { PersonHired, PlanStarted, TenantAdministratorNamed } from '@kithena/contracts';
import { kafkaConfigFrom } from '@kithena/db-kit';
import { logger, onShutdown } from '@kithena/telemetry';

import type { Deps } from '../../application/ports.js';
import { performanceConsumer } from './handle.js';

/**
 * People's, Onboarding's and identity's topics, each its own group, from the
 * beginning the first time: every handler is idempotent, and somebody hired
 * before Performance was bought is a member like any other. Onboarding's wiring.
 */
export function wireConsumers(env: NodeJS.ProcessEnv, deps: Deps | null): void {
  const started = startConsumers(env, deps);
  started.catch((error: unknown) => {
    logger.error({ err: error }, 'performance consumers failed');
    process.exit(1);
  });
  onShutdown('performance consumer', async () => (await started)?.stop());
}

async function startConsumers(
  env: NodeJS.ProcessEnv,
  deps: Deps | null,
): Promise<{ stop(): Promise<void> } | null> {
  const kafka = kafkaConfigFrom(env, 'performance');
  if (deps === null || kafka === null) {
    logger.info(
      { module: 'performance' },
      'PERFORMANCE_DATABASE_URL or KAFKA_BROKERS unset; not consuming',
    );
    return null;
  }
  const handle = performanceConsumer(deps);
  const consumers = await Promise.all([
    consume(new Kafka(kafka), 'performance', PersonHired.topic, handle),
    consume(new Kafka(kafka), 'performance-onboarding', PlanStarted.topic, handle),
    // `-2`: identity's topic again from the start, for the company's host (`TenantProvisioned`).
    consume(new Kafka(kafka), 'performance-identity-2', TenantAdministratorNamed.topic, handle),
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
