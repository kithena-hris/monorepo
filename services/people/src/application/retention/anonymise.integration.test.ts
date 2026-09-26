import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { fixedClock } from '@kithena/domain-kit';
import type { FieldPolicy } from '@kithena/contracts';
import { startPostgres } from '@kithena/testing';

import { drizzleRetentionStore } from '../../infrastructure/drizzle-retention-store.js';
import {
  drizzlePeopleFacts,
  drizzleSchemaRepository,
} from '../../infrastructure/drizzle-schema-repository.js';
import { staticKeyRing } from '../../infrastructure/envelope.js';
import { drizzleSecretStore } from '../../infrastructure/secret-store.js';
import { drizzleUniqueClaims } from '../../infrastructure/unique.js';
import { tenantTransaction } from '../../infrastructure/unit-of-work.js';
import { publishSchema } from '../schema/publish-schema.js';
import { localObjectStore } from '../export/object-store.js';
import { reportKey } from '../import/commit.js';
import { drizzleReportIndex } from '../import/ledger.js';
import { anonymiseDue, type AnonymiseRequest } from './anonymise.js';
import { utcCalendars } from '../org/org.js';

/**
 * PEO-037 and PEO-085 against a real database: a leaver four and a half years
 * gone, a statutory floor that has passed, one that has not, and a tenant
 * policy that has. What is erased — from the row, the secrets and the history —
 * what survives, and what the event says.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const ADA = '00000000-0000-4000-8000-0000000000a1';
const IBAN = 'ES9121000418450200051332';
const PHONE_OLD = '+34 611 111 111';
const PHONE = '+34 600 000 000';
const clock = fixedClock('2026-09-22T09:00:00.000Z');
const ring = staticKeyRing([{ id: 'k1', key: randomBytes(32) }]);

let stopPg: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let admin: PostgresJsDatabase;
let service: PostgresJsDatabase;
let inTenant: ReturnType<typeof tenantTransaction>;
let ciphertext = '';

let ids = 0;
const newEventId = () => `01890000-0000-7000-8000-${String((ids += 1)).padStart(12, '0')}`;
// Two stored import reports: one holds Ada's row, one somebody else's (PEO-090).
const reports = {
  store: localObjectStore({
    encryptionKey: randomBytes(32),
    signingKey: randomBytes(32),
    clock,
    baseUrl: 'https://people.test/v1/exports/files',
  }),
  index: drizzleReportIndex(),
};
const WITH_ADA = 'a'.repeat(64);
const WITHOUT_ADA = 'b'.repeat(64);
const SOMEBODY = '00000000-0000-4000-8000-0000000000b9';
const anonymise = anonymiseDue({
  calendars: utcCalendars,
  store: drizzleRetentionStore(),
  clock,
  newEventId,
  reports,
});
const HR_USER = '00000000-0000-4000-8000-0000000000d1';
const REASON = 'Asked for erasure; counsel confirmed by email';
/** The floors are unreviewed (PEO-126): what a job may not do, HR does by hand. */
const byHand = { kind: 'manual', roles: new Set(['hr']), reason: REASON } as const;
const run = (mode: AnonymiseRequest['mode'] = byHand) =>
  inTenant(ACME, ({ tx }) =>
    anonymise(tx, {
      tenantId: ACME,
      personId: ADA,
      actor:
        mode.kind === 'manual'
          ? { kind: 'user', userId: HR_USER }
          : { kind: 'system', process: 'retention' },
      correlationId: '00000000-0000-4000-8000-0000000000c1',
      mode,
    }),
  );

const migration = (file: string): Promise<string> =>
  readFile(new URL(`../../../../../migrations/${file}`, import.meta.url), 'utf8');

const kept = (retention?: FieldPolicy['retention'], over: Partial<FieldPolicy> = {}): FieldPolicy => ({
  classification: 'confidential',
  piiKind: 'identity',
  exportable: true,
  aiEligible: false,
  ...over,
  ...(retention ? { retention } : {}),
});

async function define(key: string, policy: FieldPolicy, over: { origin?: string; encrypted?: boolean } = {}): Promise<void> {
  await admin.execute(sql`
    INSERT INTO people.attribute_definition (
      tenant_id, key, section_key, labels, ord, data_type, type_config, cardinality,
      requiredness, ownership, visibility, collect_at, classification, classification_source,
      include_in_events, encrypted, origin
    ) VALUES (
      ${ACME}::uuid, ${key}, 'profile', ${JSON.stringify({ default: key })}::jsonb, 0,
      'text', ${JSON.stringify({ kind: 'text' })}::jsonb, 'single',
      ${JSON.stringify({ mode: 'never' })}::jsonb, ${'{"hr"}'}::text[], ${'{"hr"}'}::text[], 'hr_only',
      ${JSON.stringify(policy)}::jsonb, 'human', false, ${over.encrypted ?? false}, ${over.origin ?? 'tenant'}
    )
  `);
}

async function history(id: string, key: string, value: unknown, supersedes: string | null = null): Promise<void> {
  await admin.execute(sql`
    INSERT INTO people.person_attribute_history
      (id, tenant_id, person_id, attribute_key, value, effective_from, actor, supersedes)
    VALUES (${id}::uuid, ${ACME}::uuid, ${ADA}::uuid, ${key}, ${JSON.stringify(value)}::jsonb, '2021-01-01',
            ${JSON.stringify({ kind: 'system', process: 'seed' })}::jsonb, ${supersedes}::uuid)
  `);
}

/** Every value in every table in the `people` schema, as one string. */
async function everythingStored(): Promise<string> {
  const tables = await admin.execute(sql`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'people' AND table_type = 'BASE TABLE'
  `);
  const dumps: string[] = [];
  for (const table of tables) {
    // eslint-disable-next-line no-await-in-loop -- a handful of tables, in a test
    const rows = await admin.execute(sql.raw(`SELECT * FROM people.${String(table['table_name'])}`));
    dumps.push(JSON.stringify([...rows]));
  }
  return dumps.join('\n');
}

const H_PHONE_OLD = '01890000-0000-7000-8000-0000000000f1';
const H_PHONE_FIX = '01890000-0000-7000-8000-0000000000f2';
const H_PAYSLIP = '01890000-0000-7000-8000-0000000000f3';
const H_PENSION = '01890000-0000-7000-8000-0000000000f4';

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;
  adminClient = postgres(pg.url, { max: 1 });
  admin = drizzle(adminClient);
  for (const file of [
    '20260821120000_tenant_registry.sql',
    '20260922140000_people_bootstrap.sql',
    '20260922160000_people_registry.sql',
    '20260926140000_people_visibility_rules.sql',
    '20260922170000_people_person.sql',
    '20260924220000_people_access_end.sql',
    '20260924220200_people_employment_period.sql',
    '20260923110000_people_completeness.sql',
    '20260923140000_people_retention.sql',
    '20260924150000_people_unique_hash.sql',
    '20260924350000_people_unique_key_lookup.sql',
    '20260924170000_people_calendar.sql',
    '20260924170100_people_tenant_company.sql',
    '20260924250000_people_import_report.sql',
    '20260926160000_people_scim.sql',
  ]) {
    await admin.execute(sql.raw(await migration(file)));
  }
  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);
  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  serviceClient = postgres(asService.toString(), { max: 4 });
  service = drizzle(serviceClient);
  inTenant = tenantTransaction(service);

  await admin.execute(sql`
    INSERT INTO people.section (tenant_id, key, labels, ord, visibility, origin)
    VALUES (${ACME}::uuid, 'profile', ${JSON.stringify({ default: 'Profile' })}::jsonb, 0,
            ${'{"hr"}'}::text[], 'tenant')
  `);
  await define('given_name', kept({ monthsAfterTermination: 24 }), { origin: 'core' });
  await define('phone', kept({ monthsAfterTermination: 6 }));
  await define('bank_account', kept({ monthsAfterTermination: 6 }, { piiKind: 'financial' }), { encrypted: true });
  await define('payslip_ref', kept({ monthsAfterTermination: 12, statutoryFloor: 'es-labour' }));
  await define('pension_ref', kept({ monthsAfterTermination: 12, statutoryFloor: 'de-labour' }));
  await define('hobby', kept());

  const published = await inTenant(ACME, ({ tx }) =>
    publishSchema({ calendars: utcCalendars, schema: drizzleSchemaRepository(), people: drizzlePeopleFacts(), clock, newEventId }).publish(tx, {
      tenantId: ACME,
      actor: { kind: 'system', process: 'integration-test' },
      publishedBy: null,
      correlationId: '00000000-0000-4000-8000-0000000000c1',
      artifactUrl: 'https://api.kithena.test/v1/people/schema/1',
    }),
  );
  expect(published.ok).toBe(true);
  await admin.execute(sql`DELETE FROM people.outbox`);

  // Left on 31 March 2022: four and a half years before the clock.
  await admin.execute(sql`
    INSERT INTO people.person (id, tenant_id, status, given_name, family_name, last_working_day, custom, schema_version)
    VALUES (${ADA}::uuid, ${ACME}::uuid, 'terminated', 'Ada', 'Lovelace', '2022-03-31',
            ${JSON.stringify({ phone: PHONE, payslip_ref: 'P-1', pension_ref: 'DE-9', hobby: 'chess' })}::jsonb, 1)
  `);
  await inTenant(ACME, ({ tx }) =>
    drizzleSecretStore(ring).put(
      tx,
      { tenantId: ACME, personId: ADA, attributeKey: 'bank_account' },
      IBAN,
    ),
  );
  const sealed = await admin.execute(sql`SELECT encode(ciphertext, 'base64') AS c FROM people.person_secret`);
  ciphertext = String([...sealed][0]?.['c']);

  // Both unique: one is due, one a statutory floor still holds (PEO-082).
  for (const [attributeKey, value] of [['bank_account', IBAN], ['pension_ref', 'DE-9']] as const) {
    // eslint-disable-next-line no-await-in-loop -- two claims, in a test
    const claimed = await inTenant(ACME, ({ tx }) =>
      drizzleUniqueClaims(ring).claim(tx, ACME, { attributeKey, scopeId: ACME, value, personId: ADA }),
    );
    expect(claimed.ok).toBe(true);
  }

  // A phone number, then a correction of it: both rows hold a value.
  await history(H_PHONE_OLD, 'phone', PHONE_OLD);
  await history(H_PHONE_FIX, 'phone', PHONE, H_PHONE_OLD);
  await history(H_PAYSLIP, 'payslip_ref', 'P-1');
  await history(H_PENSION, 'pension_ref', 'DE-9');

  for (const [checksum, personIds] of [
    [WITH_ADA, [SOMEBODY, ADA]],
    [WITHOUT_ADA, [SOMEBODY]],
  ] as const) {
    // eslint-disable-next-line no-await-in-loop -- two reports, in a test
    await reports.store.put(reportKey(ACME, checksum), new TextEncoder().encode('Ada,…'), 'text/csv');
    // eslint-disable-next-line no-await-in-loop -- two reports, in a test
    await inTenant(ACME, ({ tx }) =>
      reports.index.save(tx, {
        tenantId: ACME,
        checksum,
        personIds,
        storedAt: '2026-09-21T09:00:00.000Z',
        expiresAt: '2026-09-28T09:00:00.000Z',
      }),
    );
  }
});

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stopPg?.();
});

describe('anonymising a leaver', () => {
  it('refuses a job, and clears nothing, while a floor it relies on is unreviewed (PEO-126)', async () => {
    const refused = await run({ kind: 'automated' });
    expect(!refused.ok && refused.error.code).toBe('RETENTION_FLOOR_UNREVIEWED');
    const rows = await admin.execute(sql`SELECT custom FROM people.person`);
    expect([...rows][0]?.['custom']).toMatchObject({ phone: PHONE, payslip_ref: 'P-1' });
    const events = await admin.execute(sql`SELECT count(*)::int AS n FROM people.outbox`);
    expect(Number([...events][0]?.['n'])).toBe(0);
  });

  it('erases what is due from the row, the secrets and the history, and keeps what a floor still holds', async () => {
    const result = await run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.value.cleared].toSorted()).toEqual(['bank_account', 'given_name', 'payslip_ref', 'phone']);

    const everything = await everythingStored();
    for (const gone of [IBAN, ciphertext, PHONE, PHONE_OLD, '"P-1"', '"Ada"']) {
      expect(everything).not.toContain(gone);
    }
    // The last four of the account went with the row. Matched as the end of a
    // stored string: a bare `1332` also turns up in microsecond timestamps.
    expect(everything).not.toContain('1332"');

    // The erased value's unique claim went with it; the kept one's stays.
    const claims = await admin.execute(sql`SELECT attribute_key FROM people.attribute_unique`);
    expect([...claims].map((c) => c['attribute_key'])).toEqual(['pension_ref']);

    const rows = await admin.execute(sql`SELECT family_name, custom FROM people.person`);
    const row = [...rows][0];
    expect(row?.['family_name']).toBe('Lovelace');
    // pension_ref: the tenant said 12 months, German law says six years.
    expect(row?.['custom']).toEqual({ pension_ref: 'DE-9', hobby: 'chess' });
  });

  it('deletes every stored import report that contains them, and no other', async () => {
    // The first test ran the anonymisation.
    expect(reports.store.raw(reportKey(ACME, WITH_ADA))).toBeUndefined();
    expect(reports.store.raw(reportKey(ACME, WITHOUT_ADA))).toBeDefined();
    const left = await admin.execute(sql`SELECT checksum FROM people.import_report`);
    expect([...left].map((r) => r['checksum'])).toEqual([WITHOUT_ADA]);
  });

  it('redacts every history row for a due key, corrections included, and leaves the timeline', async () => {
    const rows = await admin.execute(sql`
      SELECT id, attribute_key, value, redacted_at IS NOT NULL AS redacted, redaction_reason,
             effective_from::text AS effective_from, supersedes
        FROM people.person_attribute_history ORDER BY id
    `);
    expect([...rows].map((r) => ({ ...r }))).toEqual([
      { id: H_PHONE_OLD, attribute_key: 'phone', value: null, redacted: true, redaction_reason: 'retention', effective_from: '2021-01-01', supersedes: null },
      { id: H_PHONE_FIX, attribute_key: 'phone', value: null, redacted: true, redaction_reason: 'retention', effective_from: '2021-01-01', supersedes: H_PHONE_OLD },
      { id: H_PAYSLIP, attribute_key: 'payslip_ref', value: null, redacted: true, redaction_reason: 'retention', effective_from: '2021-01-01', supersedes: null },
      // The statutory floor still holds this one: untouched.
      { id: H_PENSION, attribute_key: 'pension_ref', value: 'DE-9', redacted: false, redaction_reason: null, effective_from: '2021-01-01', supersedes: null },
    ]);
  });

  it('says exactly what was erased, and under which rule', async () => {
    const rows = await admin.execute(sql`
      SELECT envelope FROM people.outbox WHERE event_name = 'people.person.anonymised'
    `);
    const payloads = [...rows]
      .map((r) => (r['envelope'] as { payload: { under: string; attributeKeys: string[]; classesCleared: string[] } }).payload)
      .map((p) => ({ ...p, attributeKeys: p.attributeKeys.toSorted() }))
      .toSorted((a, b) => a.under.localeCompare(b.under));

    // By hand, so each carries HR's reason; the envelope's actor says who.
    expect(payloads).toEqual([
      { personId: ADA, under: 'statutory_floor', attributeKeys: ['payslip_ref'], classesCleared: ['confidential'], manualReason: REASON },
      { personId: ADA, under: 'tenant_policy', attributeKeys: ['bank_account', 'given_name', 'phone'], classesCleared: ['confidential'], manualReason: REASON },
    ]);
  });

  it('does nothing the second time', async () => {
    const again = await run();
    expect(again).toEqual({ ok: true, value: { cleared: [] } });
    const rows = await admin.execute(sql`SELECT count(*)::int AS n FROM people.outbox`);
    expect(Number([...rows][0]?.['n'])).toBe(2);
  });
});

describe('history stays append-only for everything else', () => {
  const refused = (statement: ReturnType<typeof sql>) => expect(admin.execute(statement)).rejects.toThrow();

  it('refuses changing a value without redacting it', async () => {
    await refused(sql`UPDATE people.person_attribute_history SET value = '"x"'::jsonb WHERE id = ${H_PENSION}::uuid`);
  });

  it('refuses a redaction that also moves a date, a key or supersedes', async () => {
    for (const change of [
      sql`effective_from = '2020-01-01'`,
      sql`attribute_key = 'hobby'`,
      sql`supersedes = ${H_PAYSLIP}::uuid`,
    ]) {
      // eslint-disable-next-line no-await-in-loop -- three statements, in a test
      await refused(sql`
        UPDATE people.person_attribute_history
           SET value = NULL, redacted_at = now(), redaction_reason = 'retention', ${change}
         WHERE id = ${H_PENSION}::uuid
      `);
    }
  });

  it('refuses touching a row already redacted', async () => {
    await refused(sql`
      UPDATE people.person_attribute_history SET redacted_at = now() WHERE id = ${H_PAYSLIP}::uuid
    `);
  });

  it('refuses a redaction with a reason nobody defined', async () => {
    await refused(sql`
      UPDATE people.person_attribute_history
         SET value = NULL, redacted_at = now(), redaction_reason = 'because'
       WHERE id = ${H_PENSION}::uuid
    `);
  });

  it('refuses a delete', async () => {
    await refused(sql`DELETE FROM people.person_attribute_history WHERE id = ${H_PENSION}::uuid`);
  });

  it('gives the service no UPDATE on any other column', async () => {
    await expect(
      inTenant(ACME, ({ tx }) =>
        tx.execute(sql`UPDATE people.person_attribute_history SET effective_from = '2020-01-01' WHERE id = ${H_PENSION}::uuid`),
      ),
      // 42501, insufficient_privilege: the column grant refuses before the trigger is asked.
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });
});
