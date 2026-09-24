import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kafka, logLevel } from 'kafkajs';
import { kafkaConfigFrom } from '@kithena/db-kit';
import { startRedpanda } from '@kithena/testing';

/**
 * The client People and identity build (`kafkaConfigFrom`) against a broker
 * that requires SCRAM, as a managed Redpanda does. TLS is covered by the unit
 * tests: a broker certificate here would test the fixture, not the client.
 */

const users = [
  { username: 'people-256', password: 'secret-256', mechanism: 'SCRAM-SHA-256' },
  { username: 'people-512', password: 'secret-512', mechanism: 'SCRAM-SHA-512' },
] as const;

let redpanda: Awaited<ReturnType<typeof startRedpanda>>;

beforeAll(async () => {
  redpanda = await startRedpanda({ scramUsers: users });
});

afterAll(async () => {
  await redpanda.stop();
});

const kafkaFrom = (env: NodeJS.ProcessEnv): Kafka => {
  const config = kafkaConfigFrom({ KAFKA_BROKERS: redpanda.brokers, ...env }, 'people-test');
  if (config === null) throw new Error('no config');
  return new Kafka({ ...config, logLevel: logLevel.NOTHING, retry: { retries: 0 } });
};

describe('Kafka with SASL/SCRAM', () => {
  it.each(users)('authenticates with $mechanism and consumes what it produced', async (user) => {
    const kafka = kafkaFrom({
      KAFKA_SASL_MECHANISM: user.mechanism,
      KAFKA_SASL_USERNAME: user.username,
      KAFKA_SASL_PASSWORD: user.password,
      KAFKA_TLS: 'false',
    });
    const topic = `auth-${user.username}`;
    const producer = kafka.producer({ allowAutoTopicCreation: true });
    await producer.connect();
    await producer.send({ topic, messages: [{ value: 'hello' }] });
    await producer.disconnect();

    const consumer = kafka.consumer({ groupId: topic });
    await consumer.connect();
    await consumer.subscribe({ topics: [topic], fromBeginning: true });
    const received = new Promise<string>((resolve) => {
      void consumer.run({
        eachMessage: ({ message }) => {
          resolve(message.value?.toString('utf8') ?? '');
          return Promise.resolve();
        },
      });
    });
    await expect(received).resolves.toBe('hello');
    await consumer.disconnect();
  });

  it('is refused without credentials, so the broker really requires them', async () => {
    const admin = kafkaFrom({}).admin();
    await admin.connect();
    await expect(admin.listTopics()).rejects.toThrow();
    await admin.disconnect();
  });

  it('is refused with the wrong password', async () => {
    const admin = kafkaFrom({
      KAFKA_SASL_MECHANISM: 'scram-sha-256',
      KAFKA_SASL_USERNAME: 'people-256',
      KAFKA_SASL_PASSWORD: 'wrong',
      KAFKA_TLS: 'false',
    }).admin();
    await expect(admin.connect()).rejects.toThrow();
  });
});
