import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { Kafka } from 'kafkajs';
import postgres from 'postgres';
import { SchemaPublished, type EventEnvelope } from '@kithena/contracts';
import { kafkaConfigFrom } from '@kithena/db-kit';
import { systemClock } from '@kithena/domain-kit';
import { logger, onShutdown, tenantPolicies, type PolicyRegistry } from '@kithena/telemetry';

import { publishBreakdowns } from '../application/analytics/publish.js';
import { takePaySnapshot } from '../application/analytics/pay.js';
import { takeSnapshot } from '../application/analytics/snapshot.js';
import { sweepReminders, type ReminderMailer } from '../application/completeness/reminders.js';
import { recomputePerson } from '../application/completeness/recompute.js';
import { personAccess } from '../application/person/person-access.js';
import { bringDueIntoForce, endAccessDue, startArrivals } from '../application/person/start.js';
import { reconcile } from '../application/reconcile.js';
import { tenantRoles } from '../application/roles/roles.js';
import { drizzleRoleStore } from './drizzle-role-store.js';
import { drizzleProvisionalPeople, httpAccountDirectory } from './consumers/identity.js';
import { uuidv7 } from './consumers/wire.js';
import { drizzleCompletenessStore } from './drizzle-completeness-store.js';
import { drizzleEmployeeNumbers, drizzleOrgStore } from './drizzle-org-store.js';
import {
  drizzleArrivals,
  drizzleLeavers,
  drizzlePersonReader,
  drizzleRelations,
  drizzleScheduled,
  drizzleScheduledRefusals,
  drizzleSchemaVersions,
} from './drizzle-person-reader.js';
import { keysFrom, staticKeyRing } from './envelope.js';
import { drizzlePersonRepository } from './drizzle-person-repository.js';
import { drizzlePeopleFacts, drizzleSchemaRepository } from './drizzle-schema-repository.js';
import { onSchemaPublished, wirePolicyRegistry } from './policy-registry.js';
import { reminderMailerFrom } from './reminder-mailer.js';
import { NO_TENANT_APP_BASE, tenantAppBase, tenantCompanies } from './tenant-origin.js';
import { knownTenants } from './tenants.js';
import { drizzleSecretStore, secretRotation } from './secret-store.js';
import { claimRotation, drizzleUniqueClaims } from './unique.js';
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
 *   holds one publication per breakdown whoever runs it. Then pay in
 *   aggregate (PEO-078): a sealed salary is decrypted in memory, only
 *   quartiles per group are written, and the run is audited with a count.
 * - **Starting pre-hires** (§8.1) and **ending leavers' access** (PEO-109),
 *   hourly: each on their own start date or after their own last day, on
 *   their own calendar.
 * - **The reminder sweep**, hourly, only when a mailer is configured
 *   (PEO-084: `MESSAGING_URL` and `MESSAGING_PEOPLE_TOKEN`). A sweep without
 *   one would claim the week's reminder and send nothing. Links go to the
 *   tenant's own origin, from `TENANT_APP_BASE`.
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
  const started = startBackground(env);
  started.catch((error: unknown) => {
    logger.error({ err: error }, 'people background work failed to start');
    process.exit(1);
  });
  // A job in flight finishes before its pool closes (PEO-118).
  onShutdown('background jobs', async () => (await started)?.stop());
}

/** `wireBackground` without the exit, for a test to boot and stop. Null when not configured. */
export async function startBackground(
  env: NodeJS.ProcessEnv,
  options: BackgroundOptions = {},
): Promise<{ stop(): Promise<void> } | null> {
  const kafka = kafkaConfigFrom(env, 'people-policies');
  const databaseUrl = env['PEOPLE_DATABASE_URL'];
  if (databaseUrl === undefined || kafka === null) {
    logger.info('PEOPLE_DATABASE_URL or KAFKA_BROKERS unset; no background work');
    return null;
  }

  const client = postgres(databaseUrl, { max: 2 });
  const db = drizzle(client);
  const inTenant = tenantTransaction(db);
  const registry = options.registry ?? tenantPolicies;
  const schema = drizzleSchemaRepository();
  const org = drizzleOrgStore();

  /*
   * A group per process, from the beginning of the topic. Every replica sees
   * every publish, and replaying the retained ones is a few idempotent
   * reloads — cheaper than reasoning about which offset "latest" resolved to.
   *
   * `ponytail: a group id per boot leaves one stale group behind per restart
   * until the broker expires its offsets. Fine at deploy cadence.`
   */
  const reload = onSchemaPublished(inTenant, registry);
  const policies = new Kafka(kafka).consumer({ groupId: `people-policies-${randomUUID()}` });
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

  // The unique claims, the dated values and the pay snapshot's sealed salaries.
  const keys = keysFrom(env['PEOPLE_SECRET_KEYS']);
  const sealed =
    keys.length === 0 ? undefined : drizzleSecretStore(staticKeyRing(keys), logger).revealAll;

  const jobs = [
    // The boot load, then hourly as a safety net for an event this process
    // missed. The consumer above is what makes a publish take effect promptly.
    every(HOUR, async () => wirePolicyRegistry(inTenant, await knownTenants(db), registry)),

    every(24 * HOUR, () =>
      forEachTenant('snapshot', async (tenantId) => {
        const taken = await inTenant(tenantId, async (scope) => {
          const version = await schema.currentVersion(scope.tx, tenantId);
          if (version === null) return null;
          // Each legal entity counted on its own day (PRD §6.8, §16).
          const definitions = version.document.attributes;
          const result = await takeSnapshot(
            { facts: drizzlePeopleFacts(), clock: systemClock, calendars: org },
            scope,
            { definitions },
          );
          if (!result.ok) {
            logger.warn({ tenantId, code: result.error.code }, 'snapshot refused');
            return null;
          }
          // The tenant's own minimum, which is the change threshold too.
          const { cohortMinimum } = await org.settings(scope.tx, tenantId);
          const published = await publishBreakdowns({ clock: systemClock, calendars: org }, scope, {
            definitions,
            cohortMinimum,
            run: result.value,
          });
          if (!published.ok) {
            logger.warn({ tenantId, code: published.error.code }, 'publication refused');
          } else if (published.value.published.length > 0) {
            logger.info(
              { tenantId, count: published.value.published.length },
              'breakdowns published',
            );
          }
          return { run: result.value, definitions, cohortMinimum };
        });
        if (taken === null) return;
        // Pay in its own transaction, on the run above: a sealed value that
        // will not open must not take the headcount snapshot down with it.
        // Counts only: no value, no person, no group ever reaches a log line.
        const pay = await inTenant(tenantId, (scope) =>
          takePaySnapshot(
            { clock: systemClock, newId: uuidv7, ...(sealed === undefined ? {} : { sealed }) },
            scope,
            { ...taken, takenBy: 'system:people.snapshot' },
          ),
        );
        if (pay.ok) logger.info({ tenantId, ...pay.value }, 'pay snapshot taken');
        else if (pay.error.code !== 'NOT_CONFIGURED') {
          logger.warn({ tenantId, code: pay.error.code }, 'pay snapshot not taken');
        }
      }),
    ),
  ];

  // The lifecycle's dated moves (§8.1), hourly, so each lands within an hour
  // of the person's own midnight; idempotent, so a second replica finds nobody
  // left. Starts every pre-hire whose start date has arrived, and ends the
  // access of every leaver whose last working day has ended (PEO-109).
  const lifecycleDeps = {
    inTenant,
    people: drizzlePersonRepository(),
    reader: drizzlePersonReader(),
    calendars: org,
    clock: systemClock,
    newId: uuidv7,
  };
  const lifecycleCompleteness = recomputePerson({
    schema,
    people: drizzlePeopleFacts(),
    store: drizzleCompletenessStore(),
    clock: systemClock,
    newEventId: uuidv7,
    calendars: org,
  });
  const start = startArrivals({
    ...lifecycleDeps,
    arrivals: drizzleArrivals(),
    completeness: lifecycleCompleteness,
  });
  const endAccess = endAccessDue({
    ...lifecycleDeps,
    leavers: drizzleLeavers(),
    // A leaver's tenant roles end with their access (PEO-109 × PEO-112).
    roles: tenantRoles({ store: drizzleRoleStore(), clock: systemClock, newId: uuidv7 }),
  });
  // Dated values whose day has come (PEO-124), after the starts so a value
  // dated a pre-hire's first day lands on an active record. The access it
  // goes through renumbers a transfer, so it holds the unique-claim key ring;
  // without one there is no People to write anyway (the server refuses to boot).
  const bringDue =
    keys.length === 0
      ? null
      : bringDueIntoForce({
          inTenant,
          scheduled: drizzleScheduled(),
          clock: systemClock,
          access: personAccess({
            ...lifecycleDeps,
            schemas: drizzleSchemaVersions(),
            relations: drizzleRelations(),
            secrets: drizzleSecretStore(staticKeyRing(keys), logger),
            uniques: drizzleUniqueClaims(staticKeyRing(keys)),
            numbering: drizzleEmployeeNumbers(),
            completeness: lifecycleCompleteness,
            refusals: drizzleScheduledRefusals(),
          }),
        });
  jobs.push(
    every(HOUR, () =>
      forEachTenant('lifecycle', async (tenantId) => {
        const started = await start(tenantId, randomUUID());
        const ended = await endAccess(tenantId, randomUUID());
        const effective = (await bringDue?.(tenantId, randomUUID())) ?? { applied: 0, failed: [] };
        for (const f of [...started.failed, ...ended.failed, ...effective.failed]) {
          logger.error({ err: f.error, tenantId, personId: f.personId }, 'lifecycle move failed');
        }
        if (started.started > 0) logger.info({ tenantId, started: started.started }, 'pre-hires started');
        if (ended.ended > 0) logger.info({ tenantId, ended: ended.ended }, 'leavers’ access ended');
        if (effective.applied > 0) {
          logger.info({ tenantId, applied: effective.applied }, 'dated values came into force');
        }
      }),
    ),
  );

  jobs.push(
    every(HOUR, () =>
      forEachTenant('unique-claims', claimRotation(inTenant, env['PEOPLE_SECRET_KEYS'])),
    ),
  );
  // The same rollout, for the encrypted values themselves (PEO-105).
  const rewrap = secretRotation(inTenant, env['PEOPLE_SECRET_KEYS']);
  jobs.push(
    every(HOUR, () =>
      forEachTenant('secret-rotation', async (tenantId) => {
        await rewrap(tenantId);
      }),
    ),
  );

  const mailer = options.mailer ?? reminderMailerFrom(env);
  const base = tenantAppBase(env);
  if (base === null) logger.error({ variable: 'TENANT_APP_BASE' }, NO_TENANT_APP_BASE);
  if (mailer === undefined || base === null) {
    logger.info('no reminder mailer or no tenant app base; reminder sweep not scheduled');
  } else {
    const sweep = sweepReminders({
      inTenant,
      store: drizzleCompletenessStore(),
      mailer,
      clock: systemClock,
      calendars: org,
      company: tenantCompanies(base, org),
    });
    jobs.push(
      every(HOUR, () =>
        forEachTenant('reminders', async (tenantId) => {
          const { failed, waiting } = await sweep(tenantId);
          if (waiting) {
            logger.info({ tenantId }, 'company not known yet; reminders wait for the next sweep');
          }
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
