import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { Kafka } from 'kafkajs';
import postgres from 'postgres';
import { SchemaPublished, type EventEnvelope } from '@kithena/contracts';
import { systemClock } from '@kithena/domain-kit';
import { logger, tenantPolicies, type PolicyRegistry } from '@kithena/telemetry';

import { takeSnapshot } from '../application/analytics/snapshot.js';
import { sweepReminders, type ReminderMailer } from '../application/completeness/reminders.js';
import { drizzleCompletenessStore } from './drizzle-completeness-store.js';
import { drizzlePeopleFacts, drizzleSchemaRepository } from './drizzle-schema-repository.js';
import { onSchemaPublished, wirePolicyRegistry } from './policy-registry.js';
import { knownTenants } from './tenants.js';
import { tenantTransaction } from './unit-of-work.js';

/**
 * Everything People does that no request asks for (PEO-080, PEO-086).
 *
 * - **Governance.** The policy registry loads every known tenant at boot and
 *   reloads one on `people.schema.published`, so a field created at runtime is
 *   redacted in logs and refused at the AI gateway without a restart. The
 *   reload listens in a consumer group of its own: the shared `people` group
 *   hands each event to one replica, and every replica holds a registry.
 * - **The headcount snapshot**, daily. Idempotent per day, so a restart or a
 *   second replica re-running it replaces the day rather than doubling it.
 * - **The reminder sweep**, hourly, only when a mailer is given. There is no
 *   reminder endpoint yet (PEO-084), and a sweep without one would claim the
 *   week's reminder and send nothing.
 *
 * Tenants come from `people.tenant`, which the consumer fills. One tenant at a
 * time, each in its own transaction; one tenant failing is logged and the rest
 * still run. A job still running when its next tick comes skips that tick.
 *
 * Same settings as `wireConsumers`, and the same answer when they are absent:
 * log and do nothing, so the subgraph still boots on a laptop and standalone.
 */

const HOUR = 3_600_000;

export interface BackgroundOptions {
  readonly registry?: PolicyRegistry;
  readonly mailer?: ReminderMailer;
}

export function wireBackground(env = process.env): void {
  startBackground(env).catch((error: unknown) => {
    logger.error({ err: error }, 'people background work failed to start');
    process.exit(1);
  });
}

/** `wireBackground` without the exit, for a test to boot and stop. Null when not configured. */
export async function startBackground(
  env: NodeJS.ProcessEnv,
  options: BackgroundOptions = {},
): Promise<{ stop(): Promise<void> } | null> {
  const databaseUrl = env['PEOPLE_DATABASE_URL'];
  const brokers = env['KAFKA_BROKERS'];
  if (databaseUrl === undefined || brokers === undefined) {
    logger.info('PEOPLE_DATABASE_URL or KAFKA_BROKERS unset; no background work');
    return null;
  }

  const client = postgres(databaseUrl, { max: 2 });
  const db = drizzle(client);
  const inTenant = tenantTransaction(db);
  const registry = options.registry ?? tenantPolicies;
  const schema = drizzleSchemaRepository();

  /*
   * A group per process, from the beginning of the topic. Every replica sees
   * every publish, and replaying the retained ones is a few idempotent
   * reloads — cheaper than reasoning about which offset "latest" resolved to.
   *
   * `ponytail: a group id per boot leaves one stale group behind per restart
   * until the broker expires its offsets. Fine at deploy cadence.`
   */
  const reload = onSchemaPublished(inTenant, registry);
  const policies = new Kafka({ clientId: 'people-policies', brokers: brokers.split(',') }).consumer(
    { groupId: `people-policies-${randomUUID()}` },
  );
  await policies.connect();
  await policies.subscribe({ topics: [SchemaPublished.topic], fromBeginning: true });
  await policies.run({
    eachMessage: async ({ message }) => {
      if (message.value === null) return;
      let raw: unknown;
      try {
        raw = JSON.parse(message.value.toString('utf8'));
      } catch {
        return;
      }
      // The schema is the envelope; `defineEvent` erases it to `ZodType`.
      const event = SchemaPublished.schema.safeParse(raw);
      if (event.success) await reload(event.data as EventEnvelope);
    },
  });

  const forEachTenant = async (job: string, fn: (tenantId: string) => Promise<void>) => {
    for (const tenantId of await knownTenants(db)) {
      try {
        // eslint-disable-next-line no-await-in-loop -- one tenant at a time is the bound
        await fn(tenantId);
      } catch (error) {
        logger.error({ err: error, job, tenantId }, 'background job failed for a tenant');
      }
    }
  };

  const jobs = [
    // The boot load, then hourly as a safety net for an event this process
    // missed. The consumer above is what makes a publish take effect promptly.
    every(HOUR, async () => wirePolicyRegistry(inTenant, await knownTenants(db), registry)),

    every(24 * HOUR, () =>
      forEachTenant('snapshot', (tenantId) =>
        inTenant(tenantId, async (scope) => {
          const version = await schema.currentVersion(scope.tx, tenantId);
          if (version === null) return;
          // `ponytail: UTC day. People does not hold a tenant's calendar yet;
          // the publish request carries one, the snapshot has nowhere to read it.`
          const result = await takeSnapshot(
            { facts: drizzlePeopleFacts(), clock: systemClock },
            scope,
            { definitions: version.document.attributes },
          );
          if (!result.ok) logger.warn({ tenantId, code: result.error.code }, 'snapshot refused');
        }),
      ),
    ),
  ];

  if (options.mailer === undefined) {
    logger.info('no reminder mailer (PEO-084); reminder sweep not scheduled');
  } else {
    const sweep = sweepReminders({
      inTenant,
      store: drizzleCompletenessStore(),
      mailer: options.mailer,
      clock: systemClock,
    });
    jobs.push(
      every(HOUR, () =>
        forEachTenant('reminders', async (tenantId) => {
          const { failed } = await sweep(tenantId);
          if (failed > 0) logger.warn({ tenantId, failed }, 'reminders failed to send');
        }),
      ),
    );
  }

  return {
    async stop() {
      await Promise.all(jobs.map((stop) => stop()));
      await policies.disconnect();
      await client.end();
    },
  };
}

/**
 * Run `job` now and every `ms`, never twice at once. Returns a stop that
 * waits for a run in flight, so a pool is never closed under one.
 */
function every(ms: number, job: () => Promise<unknown>): () => Promise<void> {
  let running: Promise<void> | null = null;
  const tick = () => {
    running ??= job()
      .then(() => undefined)
      .catch((error: unknown) => {
        logger.error({ err: error }, 'background job failed');
      })
      .finally(() => {
        running = null;
      });
  };
  tick();
  const timer = setInterval(tick, ms);
  return async () => {
    clearInterval(timer);
    await running;
  };
}
