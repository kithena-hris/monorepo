import { Kafka } from 'kafkajs';
import {
  LeaveApproved,
  LeaveRequested,
  PersonHired,
  TenantAdministratorNamed,
} from '@kithena/contracts';
import { kafkaConfigFrom } from '@kithena/db-kit';
import { systemClock } from '@kithena/domain-kit';
import { logger, onShutdown } from '@kithena/telemetry';

import type { Reach, UnitOfWork } from '../../application/ports.js';
import { reachOnEvent } from '../../application/reach/events.js';
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
  reach?: Reach,
  feedSecret?: string,
): void {
  const started = startConsumers(env, uow, tuples, reach, feedSecret);
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
  reach?: Reach,
  /** Signs the chat app's buttons; the composition root's. */
  feedSecret?: string,
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
  const outside =
    reach === undefined || feedSecret === undefined
      ? null
      : await startReach(new Kafka(kafka), uow, reach, feedSecret);
  return {
    async stop() {
      await consumer.disconnect();
      await outside?.disconnect();
    },
  };
}

/**
 * Time Off's own request events, read back to put approved time off on
 * calendars (TOF-110), in a group of its own so a slow provider never holds
 * up the member projection. New events only: a calendar does not need last
 * year's approvals replayed into it. A provider's failure is logged, not
 * thrown, so one mailbox does not stop the topic.
 */
async function startReach(kafka: Kafka, uow: UnitOfWork, reach: Reach, feedSecret: string) {
  if ([...reach.calendars, ...reach.chats].every((p) => !p.configured)) return null;
  const handle = reachOnEvent({ uow, clock: systemClock, reach, feedSecret });
  const consumer = kafka.consumer({ groupId: 'timeoff-reach' });
  await consumer.connect();
  // Approvals, changes and cancellations on v1; a request sent is v2.
  await consumer.subscribe({
    topics: [...new Set([LeaveApproved.topic, LeaveRequested.topic])],
    fromBeginning: false,
  });
  await consumer.run({
    eachMessage: async ({ message }) => {
      if (message.value === null) return;
      let envelope: unknown;
      try {
        envelope = JSON.parse(message.value.toString('utf8'));
      } catch {
        return;
      }
      const done = await handle(envelope);
      if (done.ok && done.value.failed.length > 0) {
        logger.warn(
          { module: 'timeoff', failed: done.value.failed.map((f) => f.provider) },
          'a calendar or chat app refused',
        );
      }
    },
  });
  return consumer;
}
