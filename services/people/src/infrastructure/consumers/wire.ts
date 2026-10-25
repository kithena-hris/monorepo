import { randomBytes } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { Kafka, type Consumer } from 'kafkajs';
import postgres from 'postgres';
import { AccountProvisioned, CandidateHired, SchemaPublished } from '@kithena/contracts';
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
import { signupReportFrom } from '../signup-report.js';
import {
  hiresFromRecruiting,
  type HiresFromRecruiting,
} from '../../application/person/hire-from-recruiting.js';
import { personAccess, type PersonAccess } from '../../application/person/person-access.js';
import { enterAsSelf } from '../../application/person/self-entry.js';
import { withSources, withSubjects, withSupport } from '../../application/person/subject.js';
import { drizzleEmployeeNumbers } from '../drizzle-org-store.js';
import { drizzlePersonRepository } from '../drizzle-person-repository.js';
import { Person } from '../../domain/person/person.js';
import { drizzleRelations, drizzleSchemaVersions } from '../drizzle-person-reader.js';
import { drizzleScimStore } from '../drizzle-scim-store.js';
import { drizzleDuplicates } from '../drizzle-duplicates.js';
import { drizzleUniqueClaims } from '../unique.js';
import { recomputePerson } from '../../application/completeness/recompute.js';
import { tenantTransaction } from '../unit-of-work.js';
import { readCacheFrom } from '../valkey-read-cache.js';
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
import { hireSignatures, peopleConsumer } from './handle.js';
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
  const inTenant = tenantTransaction(drizzle(client), readCacheFrom(env)?.changed);
  const approvals = await pendingChanges(env, inTenant);
  const handle = consumerFrom(env, inTenant, approvals);

  const broker = new Kafka(kafka);
  const consumer = broker.consumer({
    groupId: 'people',
  });
  // From the beginning, which only matters the first time the group exists:
  // every handler is idempotent, and an account provisioned before People was
  // first deployed is an account People should still know about.
  // `SchemaPublished.topic` is People's own topic, so the person events the
  // OpenFGA tuples are written from (PEO-092) arrive here too.
  await consume(consumer, [AccountProvisioned.topic, SchemaPublished.topic], handle);
  // Recruiting's topic, under a group of its own: a hire it made becomes a `pre_hire`
  // here (PRD §21.4). `-2`: read from the start again, for the hires skipped while the
  // contract refused a benefit by its catalogue id (`lib:…`); nothing was cancelled then.
  const recruiting = broker.consumer({ groupId: 'people-recruiting-2' });
  await consume(recruiting, [CandidateHired.topic], handle);
  // Recruiting's hires once more, for the signature alone: hires made before
  // the company had a signature field get the contract's (`hireSignatures`).
  const signatures = broker.consumer({ groupId: 'people-hire-signatures' });
  const hires = hiresOf(env);
  await consume(
    signatures,
    [CandidateHired.topic],
    hireSignatures({ inTenant, ...(hires === undefined ? {} : { hires }) }),
  );

  return {
    async stop() {
      await consumer.disconnect();
      await signatures.disconnect();
      await recruiting.disconnect();
      await approvals?.close();
      await client.end();
    },
  };
}

/** Subscribe from the beginning and hand every JSON message to `handle`. */
async function consume(
  consumer: Consumer,
  topics: string[],
  handle: (envelope: unknown) => Promise<unknown>,
): Promise<void> {
  await consumer.connect();
  await consumer.subscribe({ topics, fromBeginning: true });
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
}

/** Recruiting's hires through the write path; absent without the keys it needs. */
function hiresOf(env: NodeJS.ProcessEnv): HiresFromRecruiting | undefined {
  const access = accessFrom(env);
  return access === null ? undefined : hiresFromRecruiting(access, drizzleSchemaVersions());
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
  const reportSignup = signupReportFrom(env, inTenant, systemClock);
  const access = accessFrom(env);
  const handle = peopleConsumer({
    ...(authz === null ? {} : { authz }),
    ...(reportRoles === null ? {} : { reportRoles }),
    ...(reportSignup === null ? {} : { reportSignup }),
    ...(access === null
      ? {}
      : {
          enterAsSelf: enterAsSelf(access, drizzlePersonReader()),
          hires: hiresFromRecruiting(access, drizzleSchemaVersions()),
        }),
    ...(approvals === null ? {} : { approvals }),
    inTenant,
    signedUp: async (tx, tenantId, accountId, correlationId) => {
      const people = drizzlePersonRepository();
      const found = await people.findByAccount(tx, tenantId, accountId);
      if (found === null || found.status !== 'pre_hire') return false;
      const person = Person.rehydrate(found);
      const moved = person.beginOnboarding({
        clock: systemClock,
        newEventId: uuidv7,
        actor: { kind: 'system', process: 'people-identity' },
        correlationId,
        causationId: null,
      });
      if (!moved.ok) return false;
      await people.save(tx, person);
      return true;
    },
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
  /*
   * An event applied may have changed who sees whom without People writing a
   * row: OpenFGA's tuples follow People's events here, and a sync that finds
   * the rows as they were writes nothing in Postgres. So every applied event
   * moves its tenant's read cache on, after the tuples are written
   * (`application/read-cache.ts`).
   */
  const cache = readCacheFrom(env);
  if (cache === null) return handle;
  return async (raw) => {
    const outcome = await handle(raw);
    const tenantId: unknown =
      typeof raw === 'object' && raw !== null ? Reflect.get(raw, 'tenantId') : undefined;
    if (outcome === 'applied' && typeof tenantId === 'string') await cache.changed(tenantId);
    return outcome;
  };
}

/**
 * People's write path, for what a person entered about themselves on
 * identity's page (`self-entry.ts`) and for a hire Recruiting made
 * (`hire-from-recruiting.ts`): the same `personAccess` the transports use,
 * with the same relations — OpenFGA when configured, the owning upstream
 * systems (mirror mode) on every answer — and the same holding of changes
 * that need approval. Null without `PEOPLE_SECRET_KEYS`, which a unique
 * claim and a held sealed value need; the consumer then only fills an empty
 * name, as it did before, and applies no hire.
 */
function accessFrom(env: NodeJS.ProcessEnv): PersonAccess | null {
  const keys = keysFrom(env['PEOPLE_SECRET_KEYS']);
  if (keys.length === 0) {
    logger.warn('PEOPLE_SECRET_KEYS unset; names and sign-up answers only fill empty fields');
    return null;
  }
  const ring = staticKeyRing(keys);
  const org = drizzleOrgStore();
  const reader = drizzlePersonReader();
  const secrets = drizzleSecretStore(ring, logger);
  return personAccess({
    people: drizzlePersonRepository(),
    reader,
    schemas: drizzleSchemaVersions(),
    relations: withSources(
      withSubjects(withSupport(openFgaFrom(env)?.relations ?? drizzleRelations()), reader),
      drizzleScimStore(),
    ),
    approvals: {
      store: drizzlePendingChangeStore({
        seal: (plaintext) => seal(plaintext, ring),
        open: (sealed) => open(sealed, ring),
      }),
      publish: outboxPendingChanges,
      clock: systemClock,
      newId: uuidv7,
    },
    secrets,
    reviews: drizzleIdentifierReviews(ring, secrets),
    duplicates: drizzleDuplicates(),
    uniques: drizzleUniqueClaims(ring),
    clock: systemClock,
    newId: uuidv7,
    calendars: org,
    numbering: drizzleEmployeeNumbers(),
    completeness: recomputePerson({
      schema: drizzleSchemaRepository(),
      people: drizzlePeopleFacts(),
      store: drizzleCompletenessStore(),
      clock: systemClock,
      newEventId: uuidv7,
      calendars: org,
    }),
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
  const mailer = base === null ? undefined : approvalMailerFrom(env, inTenant);
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
