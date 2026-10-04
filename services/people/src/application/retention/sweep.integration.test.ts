import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { fixedClock } from '@kithena/domain-kit';
import type { FieldPolicy } from '@kithena/contracts';
import { startPostgres } from '@kithena/testing';

import { FLOOR_REVIEWS } from '../../domain/retention/floors.js';
import { drizzleRetentionStore } from '../../infrastructure/drizzle-retention-store.js';
import {
  drizzlePeopleFacts,
  drizzleSchemaRepository,
} from '../../infrastructure/drizzle-schema-repository.js';
import { tenantTransaction } from '../../infrastructure/unit-of-work.js';
import { localObjectStore } from '../export/object-store.js';
import { drizzleReportIndex } from '../import/ledger.js';
import { utcCalendars } from '../org/org.js';
import { inTenantResult } from '../person/person-access.js';
import { publishSchema } from '../schema/publish-schema.js';
import { anonymiseDue } from './anonymise.js';
import { sweepRetention, upcomingErasures } from './sweep.js';

/**
 * PEO-075 against a real database: the job erases what a tenant policy alone
 * governs, waits on an unreviewed floor, erases once it is reviewed, does
 * nothing twice, and takes a merge's tombstones with their survivor — never
 * before it (PEO-074).
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
/** Left 2022-03-31: the phone (6 months) and the payslips (es-labour, 48) are both overdue. */
const ADA = '00000000-0000-4000-8000-0000000000a1';
/** Left 2025-01-31: the phone is overdue, nothing under a floor is held. */
const BOB = '00000000-0000-4000-8000-0000000000a2';
/** Bob's tombstone, and one merged into that. */
const BOB_OLD = '00000000-0000-4000-8000-0000000000a3';
const BOB_OLDER = '00000000-0000-4000-8000-0000000000a4';
/** Still employed; so is the tombstone merged into her. */
const CY = '00000000-0000-4000-8000-0000000000a5';
const CY_OLD = '00000000-0000-4000-8000-0000000000a6';

const clock = fixedClock('2026-09-27T09:00:00.000Z');
const reviewed = {
  ...FLOOR_REVIEWS,
  'es-labour': { status: 'reviewed', reviewer: 'A. Counsel', reviewedOn: '2026-09-26', reference: 'memo-1' },
} as const;

let stopPg: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let admin: PostgresJsDatabase;
let inTenant: ReturnType<typeof tenantTransaction>;

let ids = 0;
const newEventId = () => `01890000-0000-7000-8000-${String((ids += 1)).padStart(12, '0')}`;
const store = drizzleRetentionStore();
const reports = {
  store: localObjectStore({
    encryptionKey: randomBytes(32),
    signingKey: randomBytes(32),
    clock,
    baseUrl: 'https://people.test/v1/exports/files',
  }),
  index: drizzleReportIndex(),
};
const anonymise = (reviews = FLOOR_REVIEWS) =>
  anonymiseDue({ calendars: utcCalendars, store, clock, newEventId, reports, reviews });
const sweep = (reviews = FLOOR_REVIEWS) =>
  sweepRetention({ inTenant, store, anonymise: anonymise(reviews), clock, newId: newEventId })(ACME, null);

const migration = (file: string): Promise<string> =>
  readFile(new URL(`../../../../../migrations/${file}`, import.meta.url), 'utf8');

const kept = (retention: FieldPolicy['retention']): FieldPolicy => ({
  classification: 'confidential',
  piiKind: 'identity',
  exportable: true,
  aiEligible: false,
  ...(retention ? { retention } : {}),
});

async function define(key: string, policy: FieldPolicy): Promise<void> {
  await admin.execute(sql`
    INSERT INTO people.attribute_definition (
      tenant_id, key, section_key, labels, ord, data_type, type_config, cardinality,
      requiredness, ownership, visibility, collect_at, classification, classification_source,
      include_in_events, encrypted, origin
    ) VALUES (
      ${ACME}::uuid, ${key}, 'profile', ${JSON.stringify({ default: key })}::jsonb, 0,
      'text', ${JSON.stringify({ kind: 'text' })}::jsonb, 'single',
      ${JSON.stringify({ mode: 'never' })}::jsonb, ${'{"hr"}'}::text[], ${'{"hr"}'}::text[], 'hr_only',
      ${JSON.stringify(policy)}::jsonb, 'human', false, false, 'tenant'
    )
  `);
}

async function custom(id: string): Promise<unknown> {
  const rows = await admin.execute(sql`SELECT custom FROM people.person WHERE id = ${id}::uuid`);
  return [...rows][0]?.['custom'];
}

async function anonymised(): Promise<{ aggregate: string; actor: unknown; payload: Record<string, unknown> }[]> {
  const rows = await admin.execute(sql`
    SELECT aggregate_id, envelope FROM people.outbox
     WHERE event_name = 'people.person.anonymised' ORDER BY event_id
  `);
  return [...rows].map((r) => {
    const envelope = r['envelope'] as { actor: unknown; payload: Record<string, unknown> };
    return { aggregate: String(r['aggregate_id']), actor: envelope.actor, payload: envelope.payload };
  });
}

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
    '20260926180000_people_pending_change.sql',
    '20260926230000_people_pending_change_decided_as.sql',
    '20260922170000_people_person.sql',
    '20260924220000_people_access_end.sql',
    '20260926143000_people_duplicates.sql',
    '20260924220200_people_employment_period.sql',
    '20260923110000_people_completeness.sql',
    '20260923140000_people_retention.sql',
    '20260924150000_people_unique_hash.sql',
    '20260924350000_people_unique_key_lookup.sql',
    '20260924170000_people_calendar.sql',
    '20261005120000_people_section_names.sql',
    '20260924170100_people_tenant_company.sql',
    '20260924250000_people_import_report.sql',
    '20260926160000_people_scim.sql',
  ]) {
    // eslint-disable-next-line no-await-in-loop -- in order
    await admin.execute(sql.raw(await migration(file)));
  }
  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);
  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  serviceClient = postgres(asService.toString(), { max: 4 });
  inTenant = tenantTransaction(drizzle(serviceClient));

  await admin.execute(sql`
    INSERT INTO people.section (tenant_id, key, labels, ord, visibility, origin)
    VALUES (${ACME}::uuid, 'profile', ${JSON.stringify({ default: 'Profile' })}::jsonb, 0,
            ${'{"hr"}'}::text[], 'tenant')
  `);
  await define('phone', kept({ monthsAfterTermination: 6 }));
  await define('payslip_ref', kept({ monthsAfterTermination: 12, statutoryFloor: 'es-labour' }));
  await define('hobby', kept(undefined));
  const published = await inTenant(ACME, ({ tx }) =>
    publishSchema({
      calendars: utcCalendars,
      schema: drizzleSchemaRepository(),
      people: drizzlePeopleFacts(),
      clock,
      newEventId,
    }).publish(tx, {
      tenantId: ACME,
      actor: { kind: 'system', process: 'integration-test' },
      publishedBy: null,
      correlationId: '00000000-0000-4000-8000-0000000000c1',
      artifactUrl: 'https://api.kithena.test/v1/people/schema/1',
    }),
  );
  expect(published.ok).toBe(true);
  await admin.execute(sql`DELETE FROM people.outbox`);

  const person = (id: string, status: string, lastDay: string | null, mergedInto: string | null, values: object) =>
    admin.execute(sql`
      INSERT INTO people.person (id, tenant_id, status, given_name, last_working_day, merged_into, custom, schema_version)
      VALUES (${id}::uuid, ${ACME}::uuid, ${status}, 'Someone', ${lastDay}::date, ${mergedInto}::uuid,
              ${JSON.stringify(values)}::jsonb, 1)
    `);
  await person(ADA, 'terminated', '2022-03-31', null, { phone: '+34 600', payslip_ref: 'P-1', hobby: 'chess' });
  await person(BOB, 'terminated', '2025-01-31', null, { phone: '+34 601', hobby: 'go' });
  await person(BOB_OLD, 'merged', null, BOB, { phone: '+34 602' });
  await person(BOB_OLDER, 'merged', null, BOB_OLD, { phone: '+34 603', payslip_ref: 'P-2' });
  await person(CY, 'active', null, null, { phone: '+34 604' });
  await person(CY_OLD, 'merged', null, CY, { phone: '+34 605' });
});

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stopPg?.();
});

describe('automated anonymisation on retention expiry (PEO-075)', () => {
  it('shows HR who is next, and who waits for legal review', async () => {
    const listed = await inTenantResult(inTenant, ACME, (tx) =>
      upcomingErasures({ store, clock })(tx, { tenantId: ACME, viewer: { roles: new Set(['hr']) } }),
    );
    expect(listed.ok && listed.value.map((e) => [e.personId, e.dueOn, e.waitingForReview])).toEqual([
      [ADA, '2022-09-30', ['es-labour']],
      [BOB, '2025-07-31', []],
    ]);
  });

  it('erases under a tenant policy alone, skips anybody an unreviewed floor governs, and takes tombstones with their survivor', async () => {
    const run = await sweep();
    expect(run).toEqual({ erased: 1, waiting: 1, failed: [], next: null });

    // Ada relies on es-labour, unreviewed: nothing of hers is touched.
    expect(await custom(ADA)).toEqual({ phone: '+34 600', payslip_ref: 'P-1', hobby: 'chess' });
    // Bob's phone is gone, and so is every tombstone's, however deep; a
    // payslip is not due for Bob until 2029, so his tombstone keeps it.
    expect(await custom(BOB)).toEqual({ hobby: 'go' });
    expect(await custom(BOB_OLD)).toEqual({});
    expect(await custom(BOB_OLDER)).toEqual({ payslip_ref: 'P-2' });
    // A tombstone is never erased ahead of a survivor still employed.
    expect(await custom(CY_OLD)).toEqual({ phone: '+34 605' });

    expect(await anonymised()).toEqual(
      [BOB, BOB_OLD, BOB_OLDER].map((id) => ({
        aggregate: id,
        actor: { kind: 'system', process: 'retention' },
        payload: {
          personId: id,
          classesCleared: ['confidential'],
          attributeKeys: ['phone'],
          under: 'tenant_policy',
          automatedReason: 'retention expired (tenant policy)',
          ...(id === BOB ? {} : { survivorId: BOB }),
        },
      })),
    );
  });

  it('does nothing twice', async () => {
    expect(await sweep()).toEqual({ erased: 0, waiting: 1, failed: [], next: null });
    expect(await anonymised()).toHaveLength(3);
  });

  it('erases on the next run once counsel reviews the floor', async () => {
    expect(await sweep(reviewed)).toEqual({ erased: 1, waiting: 0, failed: [], next: null });
    expect(await custom(ADA)).toEqual({ hobby: 'chess' });
    const ada = (await anonymised()).filter((e) => e.aggregate === ADA).map((e) => e.payload);
    expect(ada.map((p) => [p['under'], p['attributeKeys'], p['automatedReason']])).toEqual([
      ['tenant_policy', ['phone'], 'retention expired (tenant policy)'],
      ['statutory_floor', ['payslip_ref'], 'retention expired (es-labour)'],
    ]);
    expect(await sweep(reviewed)).toEqual({ erased: 0, waiting: 0, failed: [], next: null });
  });

  it('never erases a tombstone asked for on its own', async () => {
    const result = await inTenantResult(inTenant, ACME, (tx) =>
      anonymise(reviewed)(tx, {
        tenantId: ACME,
        personId: CY_OLD,
        actor: { kind: 'system', process: 'retention' },
        correlationId: '00000000-0000-4000-8000-0000000000c2',
        mode: { kind: 'automated' },
      }),
    );
    expect(result).toEqual({ ok: true, value: { cleared: [] } });
    expect(await custom(CY_OLD)).toEqual({ phone: '+34 605' });
  });
});
