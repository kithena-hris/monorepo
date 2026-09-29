import { Kafka } from 'kafkajs';
import { SettingsActivityRecorded, SupportSessionStarted } from '@kithena/contracts';
import type { KafkaClientConfig } from '@kithena/db-kit';
import { logger } from '@kithena/telemetry';

/**
 * The topics the log is fed from, consumed as People consumes identity's
 * (`services/people/src/infrastructure/consumers/wire.ts`).
 *
 * Topics are per publishing module, so `kithena.people.v1` and
 * `kithena.identity.v1` carry every event of theirs and the handler ignores
 * what the log does not keep. From the beginning, which only matters the first
 * time the group exists: every entry is idempotent by its event id, and an
 * event published before this service first ran is still a line of the log.
 */
export const TOPICS = [SettingsActivityRecorded.topic, SupportSessionStarted.topic] as const;

export async function startConsumer(
  kafka: KafkaClientConfig,
  handle: (envelope: unknown) => Promise<unknown>,
): Promise<{ stop(): Promise<void> }> {
  const consumer = new Kafka(kafka).consumer({ groupId: 'audit' });
  await consumer.connect();
  await consumer.subscribe({ topics: [...TOPICS], fromBeginning: true });
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
  return { stop: () => consumer.disconnect() };
}
