import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

/**
 * Time Off's Kafka consumers: People's events translated into Time Off
 * commands (PRD §5.2). Empty until TOF-045; called from `main.ts` already so
 * the boot sequence is People's from the start.
 */
export function wireConsumers(_env: NodeJS.ProcessEnv, _db: PostgresJsDatabase | null): void {
  // TOF-045.
}
