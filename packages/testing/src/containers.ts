import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { createServer } from 'node:net';
import { GenericContainer, Wait } from 'testcontainers';

/**
 * Real Postgres in integration tests, not a mock. Mocked infrastructure hides
 * exactly the bugs that matter here: RLS policies that do not apply,
 * transaction boundaries that do not hold, exclusion constraints that never
 * fire.
 */
export async function startPostgres(): Promise<{ url: string; stop: () => Promise<void> }> {
  const container = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase('kithena')
    .withUsername('kithena')
    .withPassword('kithena')
    .start();

  return {
    url: container.getConnectionUri(),
    stop: async () => {
      await container.stop();
    },
  };
}

/**
 * Valkey, for the session cache.
 *
 * `GenericContainer` rather than a dedicated module, because the same image
 * `docker-compose.yml` runs is the one worth testing against — a Redis image
 * would pass and would not be what production talks to.
 */
export async function startValkey(): Promise<{ url: string; stop: () => Promise<void> }> {
  const container = await new GenericContainer('valkey/valkey:8-alpine')
    .withExposedPorts(6379)
    .start();

  return {
    url: `redis://${container.getHost()}:${String(container.getMappedPort(6379))}`,
    stop: async () => {
      await container.stop();
    },
  };
}

/**
 * MinIO, for object storage: the image `docker-compose.yml` runs.
 *
 * With a static KMS key, because server-side encryption (SSE-S3) is refused by
 * a MinIO that has no KMS, and a test that skipped SSE would pass against a
 * bucket production would not accept the request for.
 */
export async function startMinio(): Promise<{
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  stop: () => Promise<void>;
}> {
  const container = await new GenericContainer('quay.io/minio/minio:latest')
    .withEnvironment({
      MINIO_ROOT_USER: 'minio',
      MINIO_ROOT_PASSWORD: 'minio123',
      MINIO_KMS_SECRET_KEY: 'kithena-test:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
    })
    .withCommand(['server', '/data'])
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/minio/health/ready', 9000))
    .start();

  return {
    endpoint: `http://${container.getHost()}:${String(container.getMappedPort(9000))}`,
    accessKeyId: 'minio',
    secretAccessKey: 'minio123',
    stop: async () => {
      await container.stop();
    },
  };
}

/**
 * Redpanda, for a test that has to see a real consumer consume.
 *
 * A Kafka client connects to whatever address the broker advertises, and that
 * has to be the host's mapped port — which a container does not know until it
 * has one. So the port is chosen first and bound fixed.
 *
 * `ponytail: a free port can be taken between choosing and binding it. Retry
 * the file if that ever happens in CI.`
 */
export async function startRedpanda(): Promise<{ brokers: string; stop: () => Promise<void> }> {
  const port = await freePort();
  const container = await new GenericContainer('redpandadata/redpanda:latest')
    .withExposedPorts({ container: 9092, host: port })
    .withCommand([
      'redpanda',
      'start',
      '--mode',
      'dev-container',
      '--smp',
      '1',
      '--kafka-addr',
      '0.0.0.0:9092',
      '--advertise-kafka-addr',
      `localhost:${String(port)}`,
    ])
    .withWaitStrategy(Wait.forLogMessage(/Successfully started Redpanda/))
    .start();

  return {
    brokers: `localhost:${String(port)}`,
    stop: async () => {
      await container.stop();
    },
  };
}

/**
 * OpenFGA, the image `docker-compose.yml` runs, with its in-memory datastore.
 *
 * Memory rather than Postgres: the question a test asks is what the model
 * answers for these tuples, and the datastore does not change the answer.
 */
export async function startOpenFga(): Promise<{ apiUrl: string; stop: () => Promise<void> }> {
  const container = await new GenericContainer('openfga/openfga:latest')
    .withCommand(['run'])
    .withExposedPorts(8080)
    .withWaitStrategy(Wait.forHttp('/healthz', 8080))
    .start();

  return {
    apiUrl: `http://${container.getHost()}:${String(container.getMappedPort(8080))}`,
    stop: async () => {
      await container.stop();
    },
  };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === 'object' && address !== null) resolve(address.port);
        else reject(new Error('no port was assigned'));
      });
    });
  });
}
