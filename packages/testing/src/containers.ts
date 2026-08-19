import { PostgreSqlContainer } from '@testcontainers/postgresql';

/**
 * Real Postgres in integration tests, not a mock. Mocked infrastructure hides
 * exactly the bugs that matter here: RLS policies that do not apply,
 * transaction boundaries that do not hold, exclusion constraints that never
 * fire.
 */
export async function startPostgres(): Promise<{ url: string; stop: () => Promise<void> }> {
  const container = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase('hris')
    .withUsername('hris')
    .withPassword('hris')
    .start();

  return {
    url: container.getConnectionUri(),
    stop: async () => {
      await container.stop();
    },
  };
}
