import { readdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type * as z from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { Kafka, type Producer } from 'kafkajs';
import postgres from 'postgres';
import { SchemaPublished, type AccountsPage } from '@kithena/contracts';
import { systemClock } from '@kithena/domain-kit';
import {
  aiGateway,
  createLogger,
  createPolicyRegistry,
  tenantPolicies,
  type PolicyRegistry,
} from '@kithena/telemetry';
import { startPostgres, startRedpanda } from '@kithena/testing';

import type { Reminder } from '../application/completeness/store.js';
import { publishSchema } from '../application/schema/publish-schema.js';
import { startBackground } from './background.js';
import { startConsumers, uuidv7 } from './consumers/wire.js';
import { drizzlePeopleFacts, drizzleSchemaRepository } from './drizzle-schema-repository.js';
import { tenantTransaction } from './unit-of-work.js';

/**
 * PEO-080 and PEO-086, through the wiring `main.ts` calls: a real Postgres, a
 * real Redpanda, and the same `startConsumers` / `startBackground` the process
 * boots with. Nothing is called directly that the running process would not
 * call itself — the only stand-in is the producer, playing Debezium's part of
 * moving an outbox row onto its topic.
 *
 * The guarantee: a field a tenant creates at runtime is redacted in logs and
 * refused at the AI gateway, in this process, without a restart. And a
 * restart finds the tenant again with nobody telling it.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const RELIGION = 'Pastafarian';

let stopPg: (() => Promise<void>) | undefined;
let stopKafka: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let admin: PostgresJsDatabase;
let producer: Producer;
let env: NodeJS.ProcessEnv;

const migrations = new URL('../../../../migrations/', import.meta.url);

beforeAll(async () => {
  const [pg, kafka] = await Promise.all([startPostgres(), startRedpanda()]);
  stopPg = pg.stop;
  stopKafka = kafka.stop;

  adminClient = postgres(pg.url, { max: 1 });
  admin = drizzle(adminClient);
  const files = (await readdir(migrations))
    // People's own files name the module right after the timestamp. A bare
    // `_people_` also matched identity's `…_identity_people_facts_at.sql`,
    // which alters a table this suite never creates.
    .filter((f) => f === '20260821120000_tenant_registry.sql' || /^\d{14}_people_/.test(f))
    .toSorted();
  for (const file of files) {
    await admin.execute(sql.raw(await readFile(new URL(file, migrations), 'utf8')));
  }
  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);

  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  serviceClient = postgres(asService.toString(), { max: 2 });
  env = { PEOPLE_DATABASE_URL: asService.toString(), KAFKA_BROKERS: kafka.brokers };

  producer = new Kafka({ clientId: 'test-debezium', brokers: [kafka.brokers] }).producer();
  await producer.connect();
});

afterAll(async () => {
  await producer.disconnect();
  await serviceClient?.end();
  await adminClient?.end();
  await Promise.all([stopPg?.(), stopKafka?.()]);
});

/** Poll until `check` holds, or fail naming what never happened. */
async function until(what: string, check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`never happened: ${what}`);
    // eslint-disable-next-line no-await-in-loop -- polling, in a test
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function count(query: ReturnType<typeof sql>): Promise<number> {
  return Number([...(await admin.execute(query))][0]?.['n']);
}

/** A special-category field nobody may send to a model, and one employees must fill in. */
async function tenantCreatesFields(): Promise<void> {
  await admin.execute(sql`
    INSERT INTO people.section (tenant_id, key, labels, ord, visibility, origin)
    VALUES (${ACME}::uuid, 'diversity', ${JSON.stringify({ default: 'Diversity' })}::jsonb, 0,
            ${'{"self"}'}::text[], 'tenant')
  `);
  const field = (key: string, requiredness: object, classification: object) => sql`
    INSERT INTO people.attribute_definition (
      tenant_id, key, section_key, labels, ord, data_type, type_config, cardinality,
      requiredness, ownership, visibility, collect_at, classification, classification_source,
      include_in_events, origin
    ) VALUES (
      ${ACME}::uuid, ${key}, 'diversity', ${JSON.stringify({ default: key })}::jsonb, 0,
      'text', ${JSON.stringify({ kind: 'text' })}::jsonb, 'single',
      ${JSON.stringify(requiredness)}::jsonb, ${'{"employee"}'}::text[], ${'{"self"}'}::text[],
      'anytime', ${JSON.stringify(classification)}::jsonb, 'human', false, 'tenant'
    )`;
  await admin.execute(
    field(
      'religion',
      { mode: 'never' },
      { classification: 'special-category', piiKind: 'none', exportable: true, aiEligible: false },
    ),
  );
  await admin.execute(
    field(
      'emergency_contact',
      { mode: 'always', requiredFrom: null, appliesTo: 'all_records' },
      { classification: 'internal', piiKind: 'none', exportable: true, aiEligible: true },
    ),
  );
  await admin.execute(sql`
    INSERT INTO people.person (tenant_id, status, given_name, work_email)
    VALUES (${ACME}::uuid, 'active', 'Ada', 'ada@acme.test')
  `);
}

/** Publish through the real use case, then do Debezium's job: outbox row onto its topic. */
async function publishAndRelay(): Promise<void> {
  const published = await tenantTransaction(drizzle(serviceClient as ReturnType<typeof postgres>))(
    ACME,
    ({ tx }) =>
      publishSchema({
        schema: drizzleSchemaRepository(),
        people: drizzlePeopleFacts(),
        clock: systemClock,
        newEventId: uuidv7,
      }).publish(tx, {
        tenantId: ACME,
        actor: { kind: 'system', process: 'integration-test' },
        publishedBy: null,
        correlationId: '00000000-0000-4000-8000-0000000000c1',
        artifactUrl: 'https://api.kithena.test/v1/people/schema/1',
      }),
  );
  expect(published.ok).toBe(true);

  const rows = await admin.execute(sql`
    SELECT envelope FROM people.outbox WHERE event_name = 'people.schema.published'
  `);
  await producer.send({
    topic: SchemaPublished.topic,
    messages: [...rows].map((row) => ({ key: ACME, value: JSON.stringify(row['envelope']) })),
  });
}

function capture() {
  const lines: string[] = [];
  return { base: createLogger({ write: (line: string) => lines.push(line) }), lines };
}

const gatewayOver = (registry: PolicyRegistry) =>
  aiGateway({ registry, send: () => Promise.resolve('a summary') });

const prompt = { instruction: 'Summarise', context: { custom: { religion: RELIGION } } };

const denied = (registry: PolicyRegistry) => () =>
  registry.aiDenied(ACME)?.keys.has('religion') === true;

describe('the running process', () => {
  it('redacts and refuses a field created at runtime, without a restart', async () => {
    const consumers = await startConsumers(env);
    const background = await startBackground(env);
    try {
      // Unknown tenant: fail closed. Nothing about ACME has been loaded.
      await expect(gatewayOver(tenantPolicies).complete(ACME, prompt)).resolves.toMatchObject({
        ok: false,
        error: { code: 'AI_POLICY_UNKNOWN' },
      });

      await tenantCreatesFields();
      await publishAndRelay();

      await until('the registry reloads ACME from people.schema.published', denied(tenantPolicies));

      const { base, lines } = capture();
      tenantPolicies
        .loggerFor(base, ACME)
        .info({ person: { custom: { religion: RELIGION } } }, 'x');
      expect(lines.at(-1)).not.toContain(RELIGION);
      expect(lines.at(-1)).toContain('[redacted]');

      await expect(gatewayOver(tenantPolicies).complete(ACME, prompt)).resolves.toMatchObject({
        ok: false,
        error: { code: 'AI_FIELD_DENIED', path: ['custom', 'religion'] },
      });

      // The shared consumer, meanwhile: the tenant is recorded for background
      // work, and the recompute opened the employee's gap.
      await until('the consumer records ACME and its gap', async () => {
        const tenants = await count(sql`SELECT count(*)::int AS n FROM people.tenant`);
        const gaps = await count(sql`
          SELECT count(*)::int AS n FROM people.completeness_gap WHERE cardinality(employee_keys) > 0`);
        return tenants === 1 && gaps === 1;
      });
    } finally {
      await background?.stop();
      await consumers?.stop();
    }
  });

  it('finds every known tenant again after a restart: policies, snapshot and reminders', async () => {
    // Depends on the test above having published. A fresh registry is a
    // fresh process as far as governance is concerned.
    const registry = createPolicyRegistry({ unknownTenantRedaction: [] });
    const sent: Reminder[] = [];
    const background = await startBackground(env, {
      registry,
      mailer: {
        send: (_tenantId, reminder) => {
          sent.push(reminder);
          return Promise.resolve();
        },
      },
    });
    try {
      await until('the boot load reaches ACME', denied(registry));
      await until('the snapshot and the sweep run for ACME', async () => {
        const runs = await count(sql`
          SELECT count(*)::int AS n FROM people.headcount_snapshot_run WHERE tenant_id = ${ACME}::uuid`);
        return runs === 1 && sent.length === 1;
      });
      expect(sent[0]).toMatchObject({ workEmail: 'ada@acme.test', keys: ['emergency_contact'] });
    } finally {
      await background?.stop();
    }
  });

  it('reconciles a known tenant against identity’s account listing', async () => {
    // Depends on the first test: ACME is known. The stub stands where identity
    // would, serving one page in the contract's shape to the right token only.
    const ACCOUNT = '00000000-0000-4000-8000-0000000000e7';
    const TOKEN = 'people-identity-secret';
    const asked: string[] = [];
    const identity = createServer((request, response) => {
      asked.push(request.url ?? '');
      if (request.headers['x-internal-token'] !== TOKEN) {
        response.writeHead(401).end();
        return;
      }
      const page: z.input<typeof AccountsPage> = {
        accounts: request.url?.startsWith(`/api/internal/tenants/${ACME}/accounts`)
          ? [
              {
                accountId: ACCOUNT,
                workEmail: 'reconciled@acme.test',
                timeZone: 'Europe/Madrid',
                employmentStart: '2026-01-01',
                name: null,
              },
            ]
          : [],
        nextCursor: null,
      };
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(page));
    });
    await new Promise<void>((resolve) => identity.listen(0, '127.0.0.1', resolve));
    const port = (identity.address() as AddressInfo).port;

    const background = await startBackground({
      ...env,
      IDENTITY_URL: `http://127.0.0.1:${String(port)}`,
      PEOPLE_IDENTITY_TOKEN: TOKEN,
    });
    try {
      await until('the account becomes a provisional person', async () => {
        const n = await count(sql`
          SELECT count(*)::int AS n FROM people.person
           WHERE identity_account_id = ${ACCOUNT}::uuid AND status = 'provisional'`);
        return n === 1;
      });
      expect(asked).toContain(`/api/internal/tenants/${ACME}/accounts`);
    } finally {
      await background?.stop();
      await new Promise((resolve) => identity.close(resolve));
    }
  });

  it('does nothing, and says so, when the database or the broker is not configured', async () => {
    await expect(startBackground({ KAFKA_BROKERS: env['KAFKA_BROKERS'] })).resolves.toBeNull();
    await expect(
      startConsumers({ PEOPLE_DATABASE_URL: env['PEOPLE_DATABASE_URL'] }),
    ).resolves.toBeNull();
  });
});
