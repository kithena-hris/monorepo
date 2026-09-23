import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { Kafka } from 'kafkajs';
import postgres from 'postgres';
import { SchemaPublished, type EventEnvelope } from '@kithena/contracts';
import { systemClock } from '@kithena/domain-kit';
import { logger, tenantPolicies, type PolicyRegistry } from '@kithena/telemetry';

import { publishBreakdowns } from '../application/analytics/publish.js';
import { takeSnapshot } from '../application/analytics/snapshot.js';
import { sweepReminders, type ReminderMailer } from '../application/completeness/reminders.js';
import { reconcile } from '../application/reconcile.js';
import { drizzleProvisionalPeople, httpAccountDirectory } from './consumers/identity.js';
import { uuidv7 } from './consumers/wire.js';
import { drizzleCompletenessStore } from './drizzle-completeness-store.js';
import { drizzlePeopleFacts, drizzleSchemaRepository } from './drizzle-schema-repository.js';
import { onSchemaPublished, wirePolicyRegistry } from './policy-registry.js';
import { knownTenants } from './tenants.js';
import { claimRotation } from './unique.js';
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
 *   The same transaction then publishes whichever special-category
 *   breakdowns are due (PEO-083): the monthly check lives here, and a month
 *   holds one publication per breakdown whoever runs it.
 * - **The reminder sweep**, hourly, only when a mailer is given. There is no
 *   reminder endpoint yet (PEO-084), and a sweep without one would claim the
 *   week's reminder and send nothing.
 * - **Reconciliation** (§8.2, "People is bought later"), for a tenant within
 *   one tick of People first learning of it, then again once a day. It reads
 *   identity's account listing, so it runs only when `IDENTITY_URL` and a
 *   token (`PEOPLE_IDENTITY_TOKEN`, else `INTERNAL_API_TOKEN`) are set.
 *   Idempotent on the account, so a re-run or a second replica creates
 *   nothing twice.
 *
 * Tenants come from `people.tenant`, which the consumer fills. One tenant at a
 * time, each in its own transaction; one tenant failing is logged and the rest
 * still run. A job still running when its next tick comes skips that tick.
 *
 * Same settings as `wireConsumers`, and the same answer when they are absent:
 * log and do nothing, so the subgraph still boots on a laptop and standalone.
 */

const HOUR = 3_600_000;

const RECONCILE_TICK = 5 * 60_000;
const RECONCILE_AGAIN = 24 * HOUR;

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
          const definitions = version.document.attributes;
          const result = await takeSnapshot(
            { facts: drizzlePeopleFacts(), clock: systemClock },
            scope,
            { definitions },
          );
          if (!result.ok) {
            logger.warn({ tenantId, code: result.error.code }, 'snapshot refused');
            return;
          }
          // `ponytail: default cohort minimum. No tenant setting is stored yet;
          // when one is, pass it here — it is the change threshold too.`
          const published = await publishBreakdowns({ clock: systemClock }, scope, { definitions });
          if (!published.ok) {
            logger.warn({ tenantId, code: published.error.code }, 'publication refused');
          } else if (published.value.published.length > 0) {
            logger.info(
              { tenantId, count: published.value.published.length },
              'breakdowns published',
            );
          }
        }),
      ),
    ),
  ];

  jobs.push(every(HOUR, () => forEachTenant('unique-claims', claimRotation(inTenant, env['PEOPLE_SECRET_KEYS']))));

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

  const identityUrl = env['IDENTITY_URL'];
  const identityToken = env['PEOPLE_IDENTITY_TOKEN'] ?? env['INTERNAL_API_TOKEN'];
  if (!identityUrl || !identityToken) {
    logger.info('IDENTITY_URL or PEOPLE_IDENTITY_TOKEN unset; reconciliation not scheduled');
  } else {
    const run = reconcile({
      directory: httpAccountDirectory({ baseUrl: identityUrl, internalToken: identityToken }),
      people: drizzleProvisionalPeople({ clock: systemClock, newEventId: uuidv7 }),
      inTenant,
    });
    /*
     * When each tenant was last reconciled by this process. A tenant not in
     * here — new since the last tick, or since boot — runs on the next tick.
     *
     * `ponytail: per process, so a restart re-runs every tenant once. That is
     * one listing per tenant, and idempotent.`
     */
    const reconciledAt = new Map<string, number>();
    jobs.push(
      every(RECONCILE_TICK, () =>
        forEachTenant('reconcile', async (tenantId) => {
          const at = reconciledAt.get(tenantId);
          if (at !== undefined && Date.now() - at < RECONCILE_AGAIN) return;
          const result = await run(tenantId, {
            actor: { kind: 'system', process: 'people-reconcile' },
            correlationId: randomUUID(),
            causationId: null,
          });
          // A failure is retried next tick rather than in a day.
          if (!result.ok) {
            logger.warn({ tenantId, code: result.error.code }, 'reconciliation failed');
            return;
          }
          reconciledAt.set(tenantId, Date.now());
          if (result.value.created > 0) logger.info({ tenantId, ...result.value }, 'reconciled');
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
