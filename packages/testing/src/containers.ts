import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer } from 'testcontainers';

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
