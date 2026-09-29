import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { kafkaConfigFrom, type KafkaClientConfig } from '@kithena/db-kit';
import { systemClock } from '@kithena/domain-kit';
import { logger } from '@kithena/telemetry';

import type { Readers } from './application/ports.js';
import { readActivity } from './application/read.js';
import { recordEvent } from './application/record.js';
import { retentionCutoff } from './domain/reading.js';
import { startConsumer } from './infrastructure/consumer.js';
import { drizzleEntryStore, purgeBefore } from './infrastructure/drizzle-entry-store.js';
import { openFgaReaders } from './infrastructure/openfga-readers.js';
import { configureGraphQL } from './graphql/schema.js';

/**
 * Where the audit service is assembled: one file that knows every piece, as
 * messaging's `composition.ts` is. `main.ts` starts a server; this decides
 * what it serves and consumes.
 */

export interface Config {
  /** As `svc_audit`. Absent: nothing is served or consumed, and it says so. */
  readonly databaseUrl: string | undefined;
  readonly kafka: KafkaClientConfig | null;
  /** What the router presents (`AUDIT_API_TOKEN`). Empty: every read is refused. */
  readonly internalToken: string;
  /** People's OpenFGA. Absent: every read is refused — failing open would publish the log. */
  readonly openFgaUrl: string | undefined;
  readonly openFgaStoreId: string | undefined;
  /** Days an entry is kept; null keeps everything (PEO-129 has not decided a period). */
  readonly retentionDays: number | null;
}

/** The one place `AUDIT_RETENTION_DAYS` is read. Anything but a positive whole number refuses to boot. */
export function retentionFrom(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const days = Number(value);
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error('AUDIT_RETENTION_DAYS must be a positive whole number of days, or unset');
  }
  return days;
}

export function configFrom(env: NodeJS.ProcessEnv): Config {
  return {
    databaseUrl: env['AUDIT_DATABASE_URL'],
    kafka: kafkaConfigFrom(env, 'audit'),
    internalToken: env['AUDIT_API_TOKEN'] ?? '',
    openFgaUrl: env['OPENFGA_URL'],
    openFgaStoreId: env['OPENFGA_STORE_ID'],
    retentionDays: retentionFrom(env['AUDIT_RETENTION_DAYS']),
  };
}

const nobody: Readers = { roles: () => Promise.resolve(new Set()) };

const DAY_MS = 24 * 60 * 60 * 1000;

export async function compose(config: Config): Promise<{ stop(): Promise<void> }> {
  if (config.databaseUrl === undefined || config.databaseUrl === '') {
    logger.warn('AUDIT_DATABASE_URL unset: the activity log is neither kept nor read here');
    return { stop: () => Promise.resolve() };
  }

  const client = postgres(config.databaseUrl, { max: 5 });
  const db = drizzle(client);
  const inTenant = <T>(tenantId: string, fn: (tx: PostgresJsDatabase) => Promise<T>) =>
    db.transaction(async (tx) => {
      // LOCAL: to the end of this transaction and no further.
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
      return fn(tx);
    });
  const store = drizzleEntryStore(inTenant);

  if (config.openFgaUrl === undefined || config.openFgaUrl === '') {
    logger.warn('OPENFGA_URL unset: nobody may read the activity log here');
  }
  if (config.internalToken === '') logger.warn('AUDIT_API_TOKEN unset: every read is refused');
  configureGraphQL({
    read: readActivity({
      store,
      readers:
        config.openFgaUrl === undefined || config.openFgaUrl === ''
          ? nobody
          : openFgaReaders(config.openFgaUrl, config.openFgaStoreId),
    }),
    internalToken: config.internalToken,
  });

  const consumer =
    config.kafka === null
      ? (logger.info('KAFKA_BROKERS unset; not consuming'), null)
      : await startConsumer(
          config.kafka,
          recordEvent({
            store,
            onRejected: (eventName, issues) => {
              logger.warn({ eventName, issues }, 'event refused by its contract; skipped');
            },
          }),
        );

  // Retention: nothing, until a period is set (PEO-129). Then once a day.
  const sweep =
    config.retentionDays === null
      ? null
      : setInterval(() => {
          const cutoff = retentionCutoff(config.retentionDays, systemClock.now());
          if (cutoff === null) return;
          purgeBefore(db, cutoff).then(
            (gone) => {
              logger.info({ gone, cutoff }, 'activity log retention applied');
            },
            (error: unknown) => {
              logger.error({ err: error }, 'activity log retention failed');
            },
          );
        }, DAY_MS);
  sweep?.unref();

  return {
    async stop() {
      if (sweep !== null) clearInterval(sweep);
      await consumer?.stop();
      await client.end();
    },
  };
}
