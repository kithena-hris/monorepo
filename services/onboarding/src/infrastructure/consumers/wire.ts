import { Kafka } from 'kafkajs';
import {
  CandidateHired,
  PersonHired,
  ReviewReleased,
  TenantAdministratorNamed,
} from '@kithena/contracts';
import { kafkaConfigFrom } from '@kithena/db-kit';
import { logger, onShutdown } from '@kithena/telemetry';

import type { Deps } from '../../application/ports.js';
import { onboardingConsumer } from './handle.js';

/**
 * People's, Recruiting's and identity's topics, each its own group, from the
 * beginning the first time: every handler is idempotent, and somebody hired
 * before Onboarding was bought is a member without a plan. Recruiting's wiring.
 */
export function wireConsumers(env: NodeJS.ProcessEnv, deps: Deps | null): void {
  const started = startConsumers(env, deps);
  started.catch((error: unknown) => {
    logger.error({ err: error }, 'onboarding consumers failed');
    process.exit(1);
  });
  onShutdown('onboarding consumer', async () => (await started)?.stop());
}

async function startConsumers(
  env: NodeJS.ProcessEnv,
  deps: Deps | null,
): Promise<{ stop(): Promise<void> } | null> {
  const kafka = kafkaConfigFrom(env, 'onboarding');
  if (deps === null || kafka === null) {
    logger.info(
      { module: 'onboarding' },
      'RECRUITING_DATABASE_URL or KAFKA_BROKERS unset; not consuming',
    );
    return null;
  }
  const handle = onboardingConsumer(deps);
  const consumers = await Promise.all([
    consume(new Kafka(kafka), 'onboarding', PersonHired.topic, handle),
    // `-2`: Recruiting's hires again from the start; they were skipped while the
    // contract refused a benefit by its catalogue id (`lib:…`).
    consume(new Kafka(kafka), 'onboarding-recruiting-2', CandidateHired.topic, handle),
    consume(new Kafka(kafka), 'onboarding-identity', TenantAdministratorNamed.topic, handle),
    consume(new Kafka(kafka), 'onboarding-performance', ReviewReleased.topic, handle),
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
