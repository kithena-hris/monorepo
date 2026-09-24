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

/** Pinned by digest; `docker-compose.yml` names the same one. */
const OBJECT_STORE_IMAGE =
  'chrislusf/seaweedfs:4.47@sha256:ce9e796f1fe6f06968f4c04bdaf8f678dad9c8acdfef3d244133d71bfa6bf882';

/**
 * An S3-compatible object store: SeaweedFS, the image `docker-compose.yml`
 * runs. Production is Oracle Object Storage and R2; this stands in for both.
 *
 * `weed mini` is the single-process mode, and it takes its one identity from
 * `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, so SigV4 is really checked.
 * It honours SSE-S3 with no key to configure, and rejects a checksum that does
 * not match the body, as S3 does. `docs/environments.md` has why this one.
 */
export async function startObjectStore(): Promise<{
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  stop: () => Promise<void>;
}> {
  const container = await new GenericContainer(OBJECT_STORE_IMAGE)
    .withEnvironment({
      AWS_ACCESS_KEY_ID: 'kithena',
      AWS_SECRET_ACCESS_KEY: 'kithena-dev-secret',
    })
    .withCommand(['mini', '-dir=/data'])
    .withExposedPorts(8333)
    .withWaitStrategy(Wait.forHttp('/healthz', 8333))
    .start();

  return {
    endpoint: `http://${container.getHost()}:${String(container.getMappedPort(8333))}`,
    accessKeyId: 'kithena',
    secretAccessKey: 'kithena-dev-secret',
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
export async function startRedpanda(
  options: {
    /**
     * SCRAM users to create before SASL is switched on, for a test of a
     * client that authenticates. Each is a superuser: what is under test is
     * the handshake, not the ACLs. Plaintext listener either way.
     */
    readonly scramUsers?: readonly {
      readonly username: string;
      readonly password: string;
      readonly mechanism: 'SCRAM-SHA-256' | 'SCRAM-SHA-512';
    }[];
  } = {},
): Promise<{ brokers: string; stop: () => Promise<void> }> {
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

  const users = options.scramUsers ?? [];
  const rpk = async (...args: string[]) => {
    const run = await container.exec(['rpk', ...args]);
    if (run.exitCode !== 0) throw new Error(`rpk ${args[0] ?? ''} failed: ${run.output}`);
  };
  for (const user of users) {
    // eslint-disable-next-line no-await-in-loop -- one admin call at a time
    await rpk('security', 'user', 'create', user.username, '-p', user.password, '--mechanism', user.mechanism);
  }
  if (users.length > 0) {
    await rpk('cluster', 'config', 'set', 'superusers', JSON.stringify(users.map((u) => u.username)));
    await rpk('cluster', 'config', 'set', 'enable_sasl', 'true');
  }

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

/**
 * The Cosmo Router, the image a deployment runs, with the given files copied in.
 *
 * `host.docker.internal` reaches the host on every platform, including a Linux
 * CI runner where Docker does not add it by itself, so a subgraph or a JWKS
 * served by the test process is reachable from inside.
 */
export async function startCosmoRouter(options: {
  readonly files: readonly { readonly source: string; readonly target: string }[];
  readonly env: Record<string, string>;
}): Promise<{ url: string; stop: () => Promise<void> }> {
  const container = await new GenericContainer('ghcr.io/wundergraph/cosmo/router:latest')
    .withExtraHosts([{ host: 'host.docker.internal', ipAddress: 'host-gateway' }])
    .withCopyFilesToContainer([...options.files])
    .withEnvironment(options.env)
    .withExposedPorts(4000)
    .withWaitStrategy(Wait.forHttp('/health/ready', 4000))
    .withStartupTimeout(90_000)
    .start();

  return {
    url: `http://${container.getHost()}:${String(container.getMappedPort(4000))}`,
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
