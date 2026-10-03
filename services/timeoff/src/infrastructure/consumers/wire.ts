import { Kafka } from 'kafkajs';
import { PersonHired, TenantAdministratorNamed } from '@kithena/contracts';
import { kafkaConfigFrom } from '@kithena/db-kit';
import { systemClock } from '@kithena/domain-kit';
import { logger, onShutdown } from '@kithena/telemetry';

import type { UnitOfWork } from '../../application/ports.js';
import { logNotifier } from '../background.js';
import type { MemberTuples } from '../openfga.js';
import { uuidv7 } from '../unit-of-work.js';
import { timeoffConsumer } from './handle.js';

/**
 * Time Off's Kafka consumer: People's topic, translated into member commands
 * (PRD §5.2, TOF-045). People's rule for when it runs: with a database and a
 * broker both set, and otherwise not, saying so. Standalone, nothing arrives,
 * and the import (TOF-036) keeps the members instead. Identity's topic too,
 * for whom the back office names Time Off's administrator.
 *
 * `uow` is the composition root's — with OpenFGA, the one that keeps the
 * member tuples in step — and null without a database.
 */
export function wireConsumers(
  env: NodeJS.ProcessEnv,
  uow: UnitOfWork | null,
  tuples?: MemberTuples,
): void {
  const started = startConsumers(env, uow, tuples);
  started.catch((error: unknown) => {
    logger.error({ err: error }, 'timeoff consumers failed');
    process.exit(1);
  });
  onShutdown('timeoff consumer', async () => (await started)?.stop());
}

/** `wireConsumers` without the exit, for a test to boot and stop. Null when not configured. */
export async function startConsumers(
  env: NodeJS.ProcessEnv,
  uow: UnitOfWork | null,
  tuples?: MemberTuples,
): Promise<{ stop(): Promise<void> } | null> {
  // First, so a half-configured broker refuses to boot even without a database.
  const kafka = kafkaConfigFrom(env, 'timeoff');
  if (uow === null || kafka === null) {
    logger.info(
      { module: 'timeoff' },
      'TIMEOFF_DATABASE_URL or KAFKA_BROKERS unset; not consuming',
    );
    return null;
  }
  const handle = timeoffConsumer({
    uow,
    clock: systemClock,
    newId: uuidv7,
    notifier: logNotifier,
    ...(tuples === undefined ? {} : { tuples }),
  });
  const consumer = new Kafka(kafka).consumer({ groupId: 'timeoff' });
  await consumer.connect();
  // From the beginning the first time the group exists: every handler is
  // idempotent, and a person hired before Time Off was bought is a member.
  // Every People event shares one topic, and every identity event another;
  // the handler ignores the rest.
  await consumer.subscribe({
    topics: [PersonHired.topic, TenantAdministratorNamed.topic],
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
    },
  };
}
