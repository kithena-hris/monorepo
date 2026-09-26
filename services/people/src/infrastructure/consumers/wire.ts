import { randomBytes } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { Kafka } from 'kafkajs';
import postgres from 'postgres';
import { AccountProvisioned, SchemaPublished } from '@kithena/contracts';
import { kafkaConfigFrom } from '@kithena/db-kit';
import { systemClock } from '@kithena/domain-kit';
import { logger, onShutdown } from '@kithena/telemetry';

import { recomputeCompleteness } from '../../application/completeness/recompute.js';
import { orgAdmin } from '../../application/org/org.js';
import { tenantRoles } from '../../application/roles/roles.js';
import { drizzleRoleStore } from '../drizzle-role-store.js';
import { drizzleCompletenessStore } from '../drizzle-completeness-store.js';
import { drizzleOrgStore } from '../drizzle-org-store.js';
import { drizzlePeopleFacts, drizzleSchemaRepository } from '../drizzle-schema-repository.js';
import { openFgaFrom } from '../openfga.js';
import { roleReportFrom } from '../role-report.js';
import { tenantTransaction } from '../unit-of-work.js';
import { approvalMailerFrom } from '../approval-mailer.js';
import { drizzlePersonReader } from '../drizzle-person-reader.js';
import { drizzleIdentifierReviews } from '../drizzle-identifier-reviews.js';
import { drizzleSecretStore } from '../secret-store.js';
import { keysFrom, open, seal, staticKeyRing } from '../envelope.js';
import { tenantAppBase, tenantCompanies } from '../tenant-origin.js';
import { startPendingChanges, type PendingChangeRunner } from '../temporal/pending-change.js';
import {
  drizzlePendingChangeStore,
  outboxPendingChanges,
} from '../../application/person/pending-store.js';
import { peopleConsumer } from './handle.js';
import { drizzleProvisionalPeople } from './identity.js';

/**
 * Start consuming, when there is something to consume from.
 *
 * Both settings optional, the way `MESSAGING_URL` is for identity: a subgraph
 * started on a laptop with no Redpanda and no database still serves its schema,
 * and one started in a deployment with both consumes. Returns without starting
 * anything when either is missing, and says so.
 *
 * Topics are per publishing module, so `kithena.identity.v1` carries every
 * identity event and the handler ignores the ones People does not read.
 */
export function wireConsumers(env = process.env): void {
  // A consumer that failed to connect is a process that should be restarted,
  // not a subgraph quietly serving while nothing is provisioned.
  const started = startConsumers(env);
  started.catch((error: unknown) => {
    logger.error({ err: error }, 'people consumers failed');
    process.exit(1);
  });
  // Leave the group and close the pool on SIGTERM, after the message in hand (PEO-118).
  onShutdown('people consumer', async () => (await started)?.stop());
}

/** `wireConsumers` without the exit, for a test to boot and stop. Null when not configured. */
export async function startConsumers(
  env: NodeJS.ProcessEnv,
): Promise<{ stop(): Promise<void> } | null> {
  // First, so a half-configured broker refuses to boot even without a database.
  const kafka = kafkaConfigFrom(env, 'people');
  const databaseUrl = env['PEOPLE_DATABASE_URL'];
  if (databaseUrl === undefined || kafka === null) {
    logger.info('PEOPLE_DATABASE_URL or KAFKA_BROKERS unset; not consuming');
    return null;
  }

  const client = postgres(databaseUrl, { max: 5 });
  const inTenant = tenantTransaction(drizzle(client));
  const approvals = await pendingChanges(env, inTenant);
  const handle = consumerFrom(env, inTenant, approvals);

  const consumer = new Kafka(kafka).consumer({
    groupId: 'people',
  });
  await consumer.connect();
  // From the beginning, which only matters the first time the group exists:
  // every handler is idempotent, and an account provisioned before People was
  // first deployed is an account People should still know about.
  // `SchemaPublished.topic` is People's own topic, so the person events the
  // OpenFGA tuples are written from (PEO-092) arrive here too.
  await consumer.subscribe({
    topics: [AccountProvisioned.topic, SchemaPublished.topic],
    fromBeginning: true,
  });
  await consumer.run({
    eachMessage: async ({ message }) => {
      if (message.value === null) return;
      let envelope: unknown;
      try {
        envelope = JSON.parse(message.value.toString('utf8'));
      } catch {
        logger.warn('message was not JSON; skipped');
        return;
      }
      await handle(envelope);
    },
  });

  return {
    async stop() {
      await consumer.disconnect();
      await approvals?.close();
      await client.end();
    },
  };
}

/**
 * The handler every message goes through, wired to this database and, when
 * `OPENFGA_URL` is set, OpenFGA. Also what the local seed delivers events to
 * (`scripts/seed-local.ts`), so a laptop with no Debezium applies them exactly
 * as a deployment does.
 */
export function consumerFrom(
  env: NodeJS.ProcessEnv,
  inTenant: ReturnType<typeof tenantTransaction>,
  approvals: PendingChangeRunner | null = null,
): ReturnType<typeof peopleConsumer> {
  const authz = openFgaFrom(env);
  const reportRoles = roleReportFrom(env, inTenant, systemClock);
  return peopleConsumer({
    ...(authz === null ? {} : { authz }),
    ...(reportRoles === null ? {} : { reportRoles }),
    ...(approvals === null ? {} : { approvals }),
    inTenant,
    provisional: drizzleProvisionalPeople({ clock: systemClock, newEventId: uuidv7 }),
    recompute: recomputeCompleteness({
      schema: drizzleSchemaRepository(),
      people: drizzlePeopleFacts(),
      store: drizzleCompletenessStore(),
      clock: systemClock,
      newEventId: uuidv7,
      calendars: drizzleOrgStore(),
    }),
    org: orgAdmin({ store: drizzleOrgStore(), clock: systemClock, newId: uuidv7 }),
    roles: tenantRoles({ store: drizzleRoleStore(), clock: systemClock, newId: uuidv7 }),
  });
}

/**
 * The approval workflows of held changes (PEO-077), run beside the consumer
 * that starts them. Null without the secrets' keys, which a held sealed value
 * needs; the events then start nothing and an undecided change expires lazily.
 */
async function pendingChanges(
  env: NodeJS.ProcessEnv,
  inTenant: ReturnType<typeof tenantTransaction>,
): Promise<PendingChangeRunner | null> {
  const keys = keysFrom(env['PEOPLE_SECRET_KEYS']);
  if (keys.length === 0) {
    logger.warn('PEOPLE_SECRET_KEYS unset; pending-change workflows not started');
    return null;
  }
  const ring = staticKeyRing(keys);
  const base = tenantAppBase(env);
  const mailer = base === null ? undefined : approvalMailerFrom(env);
  return startPendingChanges(env, inTenant, {
    holding: {
      store: drizzlePendingChangeStore({
        seal: (plaintext) => seal(plaintext, ring),
        open: (sealed) => open(sealed, ring),
      }),
      publish: outboxPendingChanges,
      clock: systemClock,
      newId: uuidv7,
    },
    // A held identifier's review closes with its change (PEO-125).
    reviews: drizzleIdentifierReviews(ring, drizzleSecretStore(ring, logger)),
    reader: drizzlePersonReader(),
    roles: drizzleRoleStore(),
    companyOf: tenantCompanies(base ?? '', drizzleOrgStore()),
    ...(mailer === undefined ? {} : { mailer }),
  });
}

/**
 * UUIDv7 (RFC 9562): 48 bits of milliseconds, then random bits under the
 * version and variant. The envelope requires v7 so the outbox sorts by time.
 *
 * `ponytail: no in-millisecond counter, unlike identity's. Two events from one
 * recompute batch may share a millisecond and sort by coin flip; nothing reads
 * this outbox in id order within a millisecond yet.`
 */
export function uuidv7(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
