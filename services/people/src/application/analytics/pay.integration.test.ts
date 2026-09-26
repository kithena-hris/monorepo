import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { publish } from '@kithena/db-kit';
import { fixedClock, ok } from '@kithena/domain-kit';
import {
  AttributeDefinition,
  PayBandCorrected,
  PayBandSet,
  type AttributeDefinitionInput,
} from '@kithena/contracts';
import { startPostgres } from '@kithena/testing';

import type { PublishedVersion } from '../../domain/schema/publish.js';
import { staticKeyRing } from '../../infrastructure/envelope.js';
import { drizzleSecretStore } from '../../infrastructure/secret-store.js';
import { outbox } from '../../infrastructure/tables.js';
import { tenantTransaction } from '../../infrastructure/unit-of-work.js';
import { utcCalendars } from '../org/org.js';
import { uuidv7 } from '../person/ids.js';
import { analyticsView, payExport } from '../screens/analytics.js';
import type { ScreenDeps } from '../screens/record.js';
import { payBands, payCharts, takePaySnapshot } from './pay.js';

/**
 * Pay bands and pay in aggregate (PEO-078), against real Postgres as
 * `svc_people`, with base salary sealed so the snapshot has to decrypt it.
 *
 * The three decisions this holds to: bands are People's, maintained by HR or
 * finance with an event per change; the snapshot decrypts in memory and
 * stores quartiles only, audited; finance sees quartiles per group and a
 * group under the cohort minimum shows no number anywhere.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const DAY = '2026-09-01';
const AT = `${DAY}T12:00:00.000Z`;

const HR = '00000000-0000-4000-8000-0000000000d1';
const FINANCE = '00000000-0000-4000-8000-0000000000d2';
const MANAGER = '00000000-0000-4000-8000-0000000000d3';
const BOSS = '00000000-0000-4000-8000-000000000100';

let stopPg: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let admin: PostgresJsDatabase;
let inTenant: ReturnType<typeof tenantTransaction>;

const migration = (file: string): Promise<string> =>
  readFile(new URL(`../../../../../migrations/${file}`, import.meta.url), 'utf8');

const define = (over: Partial<AttributeDefinitionInput> & { key: string }) =>
  AttributeDefinition.parse({
    sectionKey: 'hr_information',
    label: { default: over.key },
    dataType: 'text',
    typeConfig: { kind: 'text' },
    requiredness: { mode: 'never' },
    ownership: ['hr'],
    visibility: ['hr', 'manager_chain'],
    collectAt: 'hr_only',
    classification: {
      classification: 'internal',
      piiKind: 'none',
      exportable: true,
      aiEligible: true,
    },
    classificationSource: 'human',
    origin: 'core',
    ...over,
  });

const definitions = [
  define({ key: 'org_unit' }),
  define({ key: 'work_location' }),
  define({ key: 'status' }),
  define({ key: 'employment_type' }),
  define({ key: 'hire_date' }),
  define({
    key: 'grade',
    dataType: 'select',
    typeConfig: {
      kind: 'select',
      options: [
        { value: 'l3', label: { default: 'Level 3' } },
        { value: 'l4', label: { default: 'Level 4' } },
      ],
    },
    visibility: ['hr', 'finance'],
  }),
  define({
    key: 'base_salary',
    sectionKey: 'compensation',
    dataType: 'money',
    typeConfig: { kind: 'money' },
    visibility: ['hr', 'finance'],
    ownership: ['hr', 'finance'],
    encrypted: true,
    classification: {
      classification: 'confidential',
      piiKind: 'financial',
      exportable: true,
      aiEligible: false,
    },
  }),
];

const version = {
  version: 1,
  document: {
    attributes: definitions,
    sections: [{ key: 'hr_information', label: { default: 'HR' }, order: 0 }],
  },
} as unknown as PublishedVersion;

const ring = staticKeyRing([{ id: 'k1', key: randomBytes(32) }]);
const logged: string[] = [];
const secrets = drizzleSecretStore(ring, {
  info: (fields, message) => logged.push(JSON.stringify({ fields, message })),
});

const as = (accountId: string, roles: string[]) => ({
  tenantId: ACME,
  viewer: { accountId, roles: new Set(roles) },
  correlationId: '00000000-0000-4000-8000-0000000000cc',
});

const bands = payBands({
  clock: fixedClock(AT),
  newId: uuidv7,
  publish: (tx, events) => publish(tx, outbox, events),
});

const eur = (n: number) => String(n);

/**
 * Twelve Level 3s in EUR (4.5m to 5.6m minor units), ten Level 3s in GBP,
 * three Level 4s in EUR — a group of three, which must never show.
 */
const SALARIES: { grade: string; amountMinor: number; currency: string; hire: string }[] = [
  ...Array.from({ length: 12 }, (_, i) => ({
    grade: 'l3',
    amountMinor: 4_500_000 + i * 100_000,
    currency: 'EUR',
    hire: '2024-01-01',
  })),
  ...Array.from({ length: 10 }, (_, i) => ({
    grade: 'l3',
    amountMinor: 3_000_000 + i * 50_000,
    currency: 'GBP',
    hire: '2026-06-01',
  })),
  { grade: 'l4', amountMinor: 7_000_001, currency: 'EUR', hire: '2020-01-01' },
  { grade: 'l4', amountMinor: 7_300_003, currency: 'EUR', hire: '2020-01-01' },
  { grade: 'l4', amountMinor: 7_700_007, currency: 'EUR', hire: '2020-01-01' },
];
const personId = (i: number) => `00000000-0000-4000-8000-${String(200 + i).padStart(12, '0')}`;

async function snapshot(minimum?: number) {
  return inTenant(ACME, (scope) =>
    takePaySnapshot(
      { clock: fixedClock(AT), newId: uuidv7, sealed: (tx, where) => secrets.revealAll(tx, where) },
      scope,
      {
        run: { day: DAY, days: { byEntity: new Map(), fallback: DAY } },
        definitions,
        ...(minimum === undefined ? {} : { cohortMinimum: minimum }),
        takenBy: 'system:test',
      },
    ),
  );
}

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;
  adminClient = postgres(pg.url, { max: 1 });
  admin = drizzle(adminClient);

  for (const file of [
    '20260821120000_tenant_registry.sql',
    '20260922140000_people_bootstrap.sql',
    '20260922170000_people_person.sql',
    '20260924220000_people_access_end.sql',
    '20260926143000_people_duplicates.sql',
    '20260924220200_people_employment_period.sql',
    '20260923100000_people_snapshot.sql',
    '20260923180000_people_published_breakdown.sql',
    '20260924340000_people_person_key_lookup.sql',
    '20260926190000_people_pay.sql',
  ]) {
    await admin.execute(sql.raw(await migration(file)));
  }
  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);
  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  serviceClient = postgres(asService.toString(), { max: 4 });
  inTenant = tenantTransaction(drizzle(serviceClient));

  await admin.execute(sql`
    INSERT INTO people.person (id, tenant_id, status, hire_date, completeness, custom)
    VALUES (${BOSS}, ${ACME}, 'active', '2019-01-01', 'complete', '{}'::jsonb)`);
  for (const [i, s] of SALARIES.entries()) {
    await admin.execute(sql`
      INSERT INTO people.person (id, tenant_id, status, hire_date, manager_id, completeness, custom)
      VALUES (${personId(i)}, ${ACME}, 'active', ${s.hire}, ${BOSS}, 'complete',
              ${JSON.stringify({ grade: s.grade })}::jsonb)`);
    await inTenant(ACME, ({ tx }) =>
      secrets.put(
        tx,
        { tenantId: ACME, personId: personId(i), attributeKey: 'base_salary' },
        JSON.stringify({ amountMinor: s.amountMinor, currency: s.currency }),
      ),
    );
  }
});

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stopPg?.();
});

describe('pay bands', () => {
  it('are set by HR or finance, each with its event, and corrected by a row that supersedes', async () => {
    const input = {
      grade: 'l3',
      currency: 'EUR',
      minimumMinor: eur(4_000_000),
      midpointMinor: eur(5_000_000),
      maximumMinor: eur(6_000_000),
      effectiveFrom: '2026-01-01',
    };
    const set = await inTenant(ACME, ({ tx }) => bands.set(tx, as(HR, ['hr']), input));
    if (!set.ok) throw new Error(set.error.message);
    expect(set.value.supersedes).toBeNull();

    const corrected = await inTenant(ACME, ({ tx }) =>
      bands.set(tx, as(FINANCE, ['finance']), { ...input, maximumMinor: eur(6_500_000) }),
    );
    if (!corrected.ok) throw new Error(corrected.error.message);
    expect(corrected.value.supersedes).toBe(set.value.id);

    // Stored in major units as numeric(19,4), never a float.
    const [stored] = [
      ...(await admin.execute(
        sql`SELECT maximum::text FROM people.pay_band WHERE id = ${corrected.value.id}`,
      )),
    ];
    expect(stored).toEqual({ maximum: '65000.0000' });

    const events = [
      ...(await admin.execute(
        sql`SELECT event_name, envelope FROM people.outbox WHERE event_name LIKE 'people.pay_band.%' ORDER BY event_id`,
      )),
    ] as { event_name: string; envelope: unknown }[];
    expect(events.map((e) => e.event_name)).toEqual([
      'people.pay_band.set',
      'people.pay_band.corrected',
    ]);
    expect(PayBandSet.schema.safeParse(events[0]?.envelope).success).toBe(true);
    const parsed = PayBandCorrected.schema.parse(events[1]?.envelope) as {
      payload: { supersedes: string; maximum: unknown };
      actor: unknown;
      effectiveFrom: string;
    };
    expect(parsed.payload.supersedes).toBe(set.value.id);
    expect(parsed.payload.maximum).toEqual({ amountMinor: 6_500_000, currency: 'EUR' });
    expect(parsed.actor).toEqual({ kind: 'user', userId: FINANCE });
    expect(parsed.effectiveFrom).toBe('2026-01-01');

    // The list shows the band as it now stands: one row for the day.
    const listed = await inTenant(ACME, ({ tx }) => bands.list(tx, as(HR, ['hr'])));
    expect(listed.ok && listed.value.map((b) => [b.grade, b.maximumMinor])).toEqual([
      ['l3', '6500000'],
    ]);
  });

  it('are refused to a manager and a People administrator who is neither', async () => {
    for (const roles of [[], ['people_admin']]) {
      const refused = await inTenant(ACME, ({ tx }) => bands.list(tx, as(MANAGER, roles)));
      expect(refused).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    }
  });
});

describe('the pay snapshot', () => {
  it('decrypts in memory and stores quartiles per group, never a person or a salary', async () => {
    logged.length = 0;
    const taken = await snapshot();
    if (!taken.ok) throw new Error(taken.error.message);
    expect(taken.value).toMatchObject({ valuesRead: 25, valuesSealed: 25 });

    const stored = [
      ...(await admin.execute(
        sql`SELECT * FROM people.pay_snapshot ORDER BY measure, bucket, currency`,
      )),
    ] as Record<string, unknown>[];
    expect(Object.keys(stored[0] ?? {}).toSorted()).toEqual(
      [
        'bucket',
        'currency',
        'day',
        'measure',
        'median',
        'p25',
        'p75',
        'people',
        'tenant_id',
      ].toSorted(),
    );
    const text = JSON.stringify(stored);
    for (let i = 0; i < SALARIES.length; i += 1) expect(text).not.toContain(personId(i));
    // The Level 4 salaries end in odd digits nobody else's do: none is stored.
    for (const odd of ['70000.01', '73000.03', '77000.07']) expect(text).not.toContain(odd);

    const l4 = stored.find((r) => r['measure'] === 'grade' && r['bucket'] === 'l4');
    expect(l4).toMatchObject({ people: null, p25: null, median: null, p75: null });

    const l3eur = stored.find(
      (r) => r['measure'] === 'grade' && r['bucket'] === 'l3' && r['currency'] === 'EUR',
    );
    // 45,000 to 56,000 in twelve steps: the median is 50,500.
    expect(l3eur).toMatchObject({ people: 12, median: '50500.0000' });
    const l3gbp = stored.find(
      (r) => r['measure'] === 'grade' && r['bucket'] === 'l3' && r['currency'] === 'GBP',
    );
    expect(l3gbp).toMatchObject({ people: 10, median: '32250.0000' });
    // No band in GBP: no compa-ratio in GBP.
    expect(stored.filter((r) => r['measure'] === 'compa').map((r) => r['currency'])).toEqual([
      'EUR',
    ]);

    const [audit] = [
      ...(await admin.execute(
        sql`SELECT day::text, taken_by, values_read, values_sealed, groups, withheld FROM people.pay_snapshot_audit`,
      )),
    ];
    expect(audit).toMatchObject({
      day: DAY,
      taken_by: 'system:test',
      values_read: 25,
      values_sealed: 25,
    });

    // One line, with a count; no salary, no person.
    expect(logged).toEqual([
      JSON.stringify({
        fields: { attributeKey: 'base_salary', count: 25 },
        message: 'secrets revealed for an aggregate',
      }),
    ]);
  });

  it('refuses to store a figure for a group under ten, whatever path writes it', async () => {
    await expect(
      admin.execute(sql`
        INSERT INTO people.pay_snapshot (tenant_id, day, measure, bucket, currency, people, p25, median, p75)
        VALUES (${ACME}, '2026-01-01', 'grade', 'x', 'EUR', 3, 1, 2, 3)`),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
  });

  it('is replaced, not doubled, by a second run of the day, and audited again', async () => {
    expect((await snapshot()).ok).toBe(true);
    const [counts] = [
      ...(await admin.execute(sql`
        SELECT (SELECT count(*) FROM people.pay_snapshot WHERE measure = 'grade')::int AS grade,
               (SELECT count(*) FROM people.pay_snapshot_audit)::int AS audits`)),
    ];
    expect(counts).toEqual({ grade: 3, audits: 2 });
  });
});

describe('who sees pay', () => {
  function deps(cohortMinimum = 10): ScreenDeps {
    return {
      service: {
        access: {} as never,
        schemas: { current: () => Promise.resolve(version) } as never,
        inTenant: (tenantId, fn) => inTenant(tenantId, fn),
        org: {
          settings: () =>
            Promise.resolve(
              ok({ defaultTimeZone: 'UTC', cohortMinimum, slug: null, displayName: null }),
            ),
        } as never,
      },
      relations: {
        relations: (_tx, _tenant, viewer) =>
          Promise.resolve({
            isSelf: false,
            isManager: false,
            isInManagerChain: false,
            isHr: viewer.roles.has('hr'),
            isFinance: viewer.roles.has('finance'),
            isAdmin: false,
          }),
      },
      clock: fixedClock(AT),
      calendars: utcCalendars,
      // Finance and the manager have records; the manager manages everybody.
      personOf: (_tx, _tenant, account) =>
        Promise.resolve(account === FINANCE ? personId(0) : account === MANAGER ? BOSS : null),
      gapTotals: () => Promise.resolve({ waiting: 0, staff: [] }),
    };
  }

  it('shows finance quartiles per group, and a small group as insufficient data with no number', async () => {
    const result = await analyticsView(deps(), as(FINANCE, ['finance']));
    if (!result.ok) throw new Error(result.error.message);
    const pay = result.value.pay;
    expect(pay?.asOf).toBe(DAY);
    expect(pay?.grade.map((g) => [g.label, g.currency, g.status])).toEqual([
      ['Level 3', 'EUR', 'ok'],
      ['Level 3', 'GBP', 'ok'],
      ['Level 4', 'EUR', 'insufficient_data'],
    ]);
    expect(pay?.grade[0]).toMatchObject({
      people: 12,
      median: '5050000',
      band: { minimumMinor: '4000000', midpointMinor: '5000000', maximumMinor: '6500000' },
    });
    expect(pay?.grade[2]).toEqual({
      label: 'Level 4',
      currency: 'EUR',
      status: 'insufficient_data',
      people: null,
      p25: null,
      median: null,
      p75: null,
      band: null,
    });
    // Pay against tenure by band, one currency each.
    expect(pay?.tenure.map((t) => [t.label, t.currency, t.status])).toEqual([
      ['Under 6 months', 'GBP', 'ok'],
      ['2 to 5 years', 'EUR', 'ok'],
      ['5 years or more', 'EUR', 'insufficient_data'],
    ]);
    // 45,000 to 56,000 against a 50,000 midpoint.
    expect(pay?.compa[0]).toMatchObject({ label: 'Level 3', median: '1.0100', p25: '0.9550' });

    // Nothing in the whole answer is one person's salary.
    const answer = JSON.stringify(result.value);
    for (const s of SALARIES.filter((x) => x.grade === 'l4')) {
      expect(answer).not.toContain(String(s.amountMinor));
    }

    // Nor in the CSV: the small group is words and empty cells.
    const csv = payExport(pay ?? { asOf: null, minimum: 10, grade: [], tenure: [], compa: [] });
    expect(csv).toContainEqual([
      'salary by grade',
      'Level 4',
      'EUR',
      'insufficient data',
      '',
      '',
      '',
    ]);
    expect(csv).toContainEqual([
      'salary by grade',
      'Level 3',
      'EUR',
      '12',
      '47750.00',
      '50500.00',
      '53250.00',
    ]);
    expect(JSON.stringify(csv)).not.toMatch(/70000\.01|73000\.03|77000\.07/u);
  });

  it('withholds a group again when the tenant raises its minimum after the run', async () => {
    const result = await analyticsView(deps(11), as(FINANCE, ['finance']));
    const gbp = result.ok ? result.value.pay?.grade.find((g) => g.currency === 'GBP') : undefined;
    expect(gbp).toMatchObject({ status: 'insufficient_data', people: null, median: null });
  });

  it('shows HR and a manager no pay at all, and refuses them the query', async () => {
    for (const [account, roles] of [
      [HR, ['hr']],
      [MANAGER, []],
    ] as const) {
      const result = await analyticsView(deps(), as(account, [...roles]));
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.pay).toBeNull();
      const refused = await inTenant(ACME, (scope) => payCharts(scope, as(account, [...roles])));
      expect(refused).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    }
  });
});
