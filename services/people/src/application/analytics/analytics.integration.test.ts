import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { fixedClock } from '@kithena/domain-kit';
import { AttributeDefinition, type AttributeDefinitionInput } from '@kithena/contracts';
import { startPostgres } from '@kithena/testing';

import { UTC_CALENDAR, type TenantCalendar } from '../../domain/org/calendar.js';
import { drizzleRelations } from '../../infrastructure/drizzle-person-reader.js';
import { drizzlePeopleFacts } from '../../infrastructure/drizzle-schema-repository.js';
import { tenantTransaction } from '../../infrastructure/unit-of-work.js';
import { fixedCalendars } from '../org/org.js';
import { relationsToMany } from '../person/person-access.js';
import { chartExport, chartTooltip, type ChartViewer } from './access.js';
import {
  attritionTrend,
  completeness,
  composition,
  expiries,
  expiryTimeline,
  headcountTrend,
  joinerHeatmap,
  movementWaterfall,
  selfIdBreakdown,
  spanOfControl,
  tenure,
  type ChartContext,
  type Filters,
} from './queries.js';
import { publishBreakdowns, ROUNDING_NOTE } from './publish.js';
import { takeSnapshot } from './snapshot.js';
import { utcCalendars } from '../org/org.js';

/**
 * Snapshots and the charts over them, against real Postgres as `svc_people`.
 *
 * `svc_people` is NOBYPASSRLS, so every read here goes through the tenant
 * policy exactly as production's would. The seeding runs as the container's
 * superuser, which is the only thing that may write another tenant's rows.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const GLOBEX = '00000000-0000-4000-8000-00000000000b';
const SELF_ID = '00000000-0000-4000-8000-00000000000c';
const PERF = '00000000-0000-4000-8000-00000000000d';

const ENG = '00000000-0000-4000-8000-0000000000e1';
const OPS = '00000000-0000-4000-8000-0000000000e2';
const MADRID = '00000000-0000-4000-8000-0000000000f1';

const BOSS = '00000000-0000-4000-8000-000000000101';
const MANAGER = '00000000-0000-4000-8000-000000000102';
const REPORT = '00000000-0000-4000-8000-000000000103';
const JOINER = '00000000-0000-4000-8000-000000000104';
const LEAVER = '00000000-0000-4000-8000-000000000105';
const FUTURE = '00000000-0000-4000-8000-000000000106';
const DISCARDED = '00000000-0000-4000-8000-000000000107';
const OUTSIDER = '00000000-0000-4000-8000-000000000108';

const D1 = '2026-03-01';
const D2 = '2026-03-02';
const D3 = '2026-03-03';

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

const SPECIAL = {
  classification: 'special-category',
  piiKind: 'none',
  exportable: true,
  aiEligible: false,
} as const;

const definitions = [
  define({ key: 'org_unit' }),
  define({ key: 'work_location', visibility: ['hr'] }),
  define({ key: 'status' }),
  define({ key: 'employment_type' }),
  // Required and on every record: a core column, so it must count zero missing
  // (PEO-079), not "missing for everybody" because it is not in `custom`.
  define({ key: 'hire_date', requiredness: { mode: 'always' } }),
  define({ key: 'manager' }),
  define({ key: 'work_permit_expiry' }),
  define({ key: 'probation_end', visibility: ['hr'] }),
  define({ key: 'cost_centre', requiredness: { mode: 'always' }, origin: 'tenant' }),
  define({
    key: 'ethnicity',
    sectionKey: 'diversity',
    dataType: 'select',
    typeConfig: {
      kind: 'select',
      options: [
        { value: 'a', label: { default: 'A' } },
        { value: 'b', label: { default: 'B' } },
        { value: 'prefer_not_to_say', label: { default: 'Prefer not to say' } },
      ],
    },
    ownership: ['employee'],
    visibility: [],
    classification: SPECIAL,
    includeInEvents: false,
    origin: 'tenant',
  }),
];

const hr: ChartViewer = { kind: 'hr' };
const NO_RELATIONS = {
  isSelf: false,
  isManager: false,
  isInManagerChain: false,
  isHr: false,
  isFinance: false,
  isAdmin: false,
};
const HR_RELATIONS = { ...NO_RELATIONS, isHr: true };
const managerOf = (personId: string): ChartViewer => ({ kind: 'manager', personId });

const facts = drizzlePeopleFacts();

async function snapshotOn(tenantId: string, day: string, defs = definitions) {
  return inTenant(tenantId, (scope) =>
    takeSnapshot({ calendars: utcCalendars, facts, clock: fixedClock(`${day}T12:00:00.000Z`) }, scope, {
      definitions: defs,
    }),
  );
}

/** The job's second step: publish whatever special-category breakdown is due. */
async function publishOn(tenantId: string, day: string, defs = definitions) {
  return inTenant(tenantId, (scope) =>
    publishBreakdowns({ calendars: utcCalendars, clock: fixedClock(`${day}T12:00:00.000Z`) }, scope, {
      definitions: defs,
      // A tenant with no legal entity: everybody on the tenant's day.
      run: { day, days: { byEntity: new Map(), fallback: day } },
    }),
  );
}

/** Both steps, as the daily job runs them. */
async function dailyJob(tenantId: string, day: string, defs = definitions) {
  expect((await snapshotOn(tenantId, day, defs)).ok).toBe(true);
  const published = await publishOn(tenantId, day, defs);
  expect(published.ok).toBe(true);
  return published.ok ? published.value.published : [];
}

function chart<T>(
  tenantId: string,
  viewer: ChartViewer,
  fn: (ctx: ChartContext) => Promise<T>,
  defs = definitions,
): Promise<T> {
  return inTenant(tenantId, (scope) => fn({ ...scope, viewer, definitions: defs }));
}

interface Seed {
  id: string;
  tenantId?: string;
  status?: string;
  hire?: string | null;
  lastDay?: string | null;
  manager?: string | null;
  orgUnit?: string | null;
  custom?: Record<string, unknown>;
}

async function seed(...people: Seed[]): Promise<void> {
  for (const p of people) {
    await admin.execute(sql`
      INSERT INTO people.person
        (id, tenant_id, status, hire_date, last_working_day, manager_id, org_unit_id, location_id,
         employment_type, completeness, custom)
      VALUES (${p.id}, ${p.tenantId ?? ACME}, ${p.status ?? 'active'}, ${p.hire ?? null},
              ${p.lastDay ?? null}, ${p.manager ?? null}, ${p.orgUnit ?? ENG}, ${MADRID},
              'permanent', 'complete', ${JSON.stringify(p.custom ?? { cost_centre: 'CC1' })}::jsonb)`);
  }
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
    '20260924220200_people_employment_period.sql',
    '20260923100000_people_snapshot.sql',
    '20260923180000_people_published_breakdown.sql',
    '20260924340000_people_person_key_lookup.sql',
  ]) {
    await admin.execute(sql.raw(await migration(file)));
  }

  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);

  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  serviceClient = postgres(asService.toString(), { max: 4 });
  inTenant = tenantTransaction(drizzle(serviceClient));

  await seed(
    { id: BOSS, hire: '2020-01-01' },
    { id: MANAGER, hire: '2025-01-01', manager: BOSS },
    // Moved from Engineering to Operations on D2 — history says so, the row
    // holds today's value.
    { id: REPORT, hire: '2025-06-01', manager: MANAGER, orgUnit: OPS, custom: {} },
    // Hired on the day no snapshot was taken.
    {
      id: JOINER,
      hire: D2,
      manager: MANAGER,
      orgUnit: OPS,
      custom: { work_permit_expiry: '2026-04-15' },
    },
    // Last working day D1: here on D1, gone by D3.
    {
      id: LEAVER,
      hire: '2024-01-01',
      lastDay: D1,
      status: 'terminated',
      manager: BOSS,
      orgUnit: OPS,
    },
    { id: FUTURE, hire: '2026-04-01', status: 'pre_hire', manager: BOSS },
    { id: DISCARDED, hire: '2025-01-01', status: 'discarded' },
    { id: OUTSIDER, tenantId: GLOBEX, hire: '2020-01-01' },
  );

  const actor = JSON.stringify({ kind: 'system', process: 'test' });
  await admin.execute(sql`
    INSERT INTO people.person_attribute_history
      (id, tenant_id, person_id, attribute_key, value, effective_from, actor)
    VALUES
      ('01890000-0000-7000-8000-000000000001', ${ACME}, ${REPORT}, 'org_unit', ${JSON.stringify(ENG)}::jsonb, '2025-06-01', ${actor}::jsonb),
      ('01890000-0000-7000-8000-000000000002', ${ACME}, ${REPORT}, 'org_unit', ${JSON.stringify(OPS)}::jsonb, ${D2}, ${actor}::jsonb)`);

  expect((await snapshotOn(ACME, D1)).ok).toBe(true);
  expect((await snapshotOn(GLOBEX, D1)).ok).toBe(true);
  expect(await snapshotOn(ACME, D3)).toMatchObject({ ok: true, value: { day: D3, flowsFrom: D1 } });
});

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stopPg?.();
});

describe('tenant isolation', () => {
  it('forces row level security on every snapshot table', async () => {
    const result = await admin.execute(sql`
      SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
       WHERE relnamespace = 'people'::regnamespace
         AND (relname LIKE 'headcount_snapshot%' OR relname = 'published_breakdown')
         AND relkind = 'r' ORDER BY relname`);
    expect([...result]).toEqual([
      { relname: 'headcount_snapshot', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'headcount_snapshot_measure', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'headcount_snapshot_run', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'published_breakdown', relrowsecurity: true, relforcerowsecurity: true },
    ]);
  });

  it("shows a tenant none of another tenant's snapshot rows", async () => {
    const seen = await inTenant(ACME, async ({ tx }) => {
      const result = await tx.execute(sql`
        SELECT (SELECT count(*) FROM people.headcount_snapshot_run WHERE tenant_id = ${GLOBEX})::int AS runs,
               (SELECT count(*) FROM people.headcount_snapshot WHERE tenant_id = ${GLOBEX})::int AS cube,
               (SELECT count(*) FROM people.headcount_snapshot_measure WHERE tenant_id = ${GLOBEX})::int AS measures`);
      return [...result][0];
    });
    expect(seen).toEqual({ runs: 0, cube: 0, measures: 0 });
  });

  it('refuses a row written for another tenant', async () => {
    await expect(
      inTenant(ACME, ({ tx }) =>
        tx.execute(sql`INSERT INTO people.headcount_snapshot_run (tenant_id, day, flows_from)
                       VALUES (${GLOBEX}, '2026-05-01', '2026-04-30')`),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });

  it('sees nothing with no tenant set', async () => {
    if (!serviceClient) throw new Error('no service connection');
    const result = await serviceClient`SELECT count(*)::int AS n FROM people.headcount_snapshot`;
    expect(result[0]?.['n']).toBe(0);
  });
});

describe('the snapshot', () => {
  it('counts by dated facts: hired by the day, not past the last one, never discarded', async () => {
    const d1 = await chart(ACME, hr, (ctx) => composition(ctx, { asOf: D1, by: ['status'] }));
    // Boss, manager, report and the leaver on their last day.
    expect(d1).toMatchObject({
      ok: true,
      value: { source: 'snapshot', cells: [{ keys: ['active'], count: 4 }] },
    });
    // Not special-category: live, exact, and none of PEO-083's publication marks.
    expect(d1.ok && d1.value).not.toHaveProperty('publishedAsOf');
    expect(d1.ok && d1.value).not.toHaveProperty('rounded');
  });

  it('carries movements across a day nobody snapshotted, so the waterfall reconciles', async () => {
    const waterfall = await chart(ACME, hr, (ctx) => movementWaterfall(ctx, { from: D1, to: D3 }));
    expect(waterfall).toEqual({
      ok: true,
      value: {
        opening: 4,
        joiners: 1,
        internalMoves: 0,
        leavers: 1,
        closing: 4,
        source: 'snapshot',
      },
    });
  });

  it('shows a move between departments as an internal move, from history', async () => {
    const ops = await chart(ACME, hr, (ctx) =>
      movementWaterfall(ctx, { from: D1, to: D3, filters: { department: [OPS] } }),
    );
    // Opening: the leaver. Closing: the joiner and the report who moved in.
    expect(ops).toEqual({
      ok: true,
      value: {
        opening: 1,
        joiners: 1,
        internalMoves: 1,
        leavers: 1,
        closing: 2,
        source: 'snapshot',
      },
    });
  });

  it('is idempotent: a second run on one day replaces the first', async () => {
    expect(await snapshotOn(ACME, D3)).toMatchObject({ ok: true, value: { day: D3, flowsFrom: D1 } });
    const trend = await chart(ACME, hr, (ctx) => headcountTrend(ctx, { from: D1, to: D3 }));
    expect(trend).toEqual({
      ok: true,
      value: { points: [{ month: '2026-03', headcount: 4, joiners: 1, leavers: 1 }] },
    });
  });

  it('refuses a run for a day before the latest, which would split its flows', async () => {
    const result = await snapshotOn(ACME, D2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SNAPSHOT_OUT_OF_ORDER');
  });

  it("counts a manager's whole chain and nobody else", async () => {
    const boss = await chart(ACME, managerOf(BOSS), (ctx) =>
      composition(ctx, { asOf: D3, by: ['status'] }),
    );
    const manager = await chart(ACME, managerOf(MANAGER), (ctx) =>
      composition(ctx, { asOf: D3, by: ['status'] }),
    );
    expect(boss).toMatchObject({ ok: true, value: { cells: [{ keys: ['active'], count: 3 }] } });
    expect(manager).toMatchObject({ ok: true, value: { cells: [{ keys: ['active'], count: 2 }] } });
  });

  it('falls back to history off the grid, and says so', async () => {
    const d2 = await chart(ACME, hr, (ctx) => composition(ctx, { asOf: D2, by: ['department'] }));
    // On D2 the report had just moved to Operations and the joiner started.
    expect(d2).toMatchObject({
      ok: true,
      value: { source: 'history', asOf: D2, status: 'ok' },
    });
    if (d2.ok && d2.value.status === 'ok') {
      expect(d2.value.cells).toEqual(
        expect.arrayContaining([
          { keys: [ENG], count: 2 },
          { keys: [OPS], count: 2 },
        ]),
      );
    }
  });

  it('agrees with itself: the history path for a snapshot day gives the snapshot', async () => {
    const onGrid = await chart(ACME, hr, (ctx) => movementWaterfall(ctx, { from: D1, to: D3 }));
    const offGrid = await chart(ACME, hr, (ctx) =>
      movementWaterfall(ctx, { from: D1, to: '2026-03-04' }),
    );
    expect(offGrid).toEqual({
      ok: true,
      value: { ...(onGrid.ok ? onGrid.value : {}), source: 'history' },
    });
  });

  it('bands tenure at the day for those here and at leaving for those who left', async () => {
    const result = await chart(ACME, hr, (ctx) => tenure(ctx, { asOf: D3 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const band = (b: string) => result.value.bands.find((x) => x.band === b);
    expect(band('0_6m')).toEqual({ band: '0_6m', headcount: 1, leavers: 0 });
    expect(band('2_5y')).toEqual({ band: '2_5y', headcount: 0, leavers: 1 });
    expect(band('5y_plus')).toEqual({ band: '5y_plus', headcount: 1, leavers: 0 });
  });

  it('counts span of control and upcoming expiries', async () => {
    const span = await chart(ACME, hr, (ctx) => spanOfControl(ctx, { asOf: D3 }));
    // The boss manages the manager; the manager manages two.
    expect(span).toEqual({
      ok: true,
      value: {
        source: 'snapshot',
        spans: [
          { reports: 1, managers: 1 },
          { reports: 2, managers: 1 },
        ],
      },
    });

    const soon = await chart(ACME, hr, (ctx) => expiries(ctx, { asOf: D3 }));
    expect(soon).toEqual({
      ok: true,
      value: {
        source: 'snapshot',
        expiries: [{ kind: 'work_permit', day: '2026-04-15', count: 1 }],
      },
    });
  });

  it('states attrition as leavers over average month-end headcount, with its formula', async () => {
    const result = await chart(ACME, hr, (ctx) => attritionTrend(ctx, { from: D1, to: D3 }));
    expect(result.ok && result.value.formula).toContain('average of month-end headcount');
    expect(result).toMatchObject({
      ok: true,
      value: {
        points: [
          { month: '2026-03', leavers: 1, averageHeadcount: 4, rate: 0.25, monthsCovered: 1 },
        ],
      },
    });
  });

  it('places joiners by month and department', async () => {
    const result = await chart(ACME, hr, (ctx) => joinerHeatmap(ctx, { from: D1, to: D3 }));
    expect(result).toEqual({
      ok: true,
      value: { cells: [{ month: '2026-03', department: OPS, joiners: 1 }] },
    });
  });

  it('counts which required field is missing, for HR only', async () => {
    const forHr = await chart(ACME, hr, (ctx) => completeness(ctx, { asOf: D3 }));
    expect(forHr).toMatchObject({
      ok: true,
      value: { byField: [{ key: 'cost_centre', sectionKey: 'hr_information', missing: 2 }] },
    });
    const forManager = await chart(ACME, managerOf(MANAGER), (ctx) =>
      completeness(ctx, { asOf: D3 }),
    );
    expect(forManager).toMatchObject({ ok: true, value: { byField: null } });
  });
});

describe('a chart is a read', () => {
  it('refuses a manager a breakdown by a field they cannot read', async () => {
    const result = await chart(ACME, managerOf(BOSS), (ctx) =>
      composition(ctx, { asOf: D3, by: ['location'] }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'FIELD_NOT_READABLE' } });
  });

  it('refuses a filter on a field they cannot read, since a filter is a read too', async () => {
    const result = await chart(ACME, managerOf(BOSS), (ctx) =>
      headcountTrend(ctx, { from: D1, to: D3, filters: { location: [MADRID] } }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'FIELD_NOT_READABLE' } });
  });

  it('refuses a dimension the snapshot does not hold, rather than throwing', async () => {
    const filters = JSON.parse('{"constructor":["x"]}') as Filters;
    const result = await chart(ACME, hr, (ctx) =>
      headcountTrend(ctx, { from: D1, to: D3, filters }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'UNKNOWN_DIMENSION' } });
  });

  it('leaves out an expiry kind the viewer cannot read, rather than showing it as zero', async () => {
    const result = await chart(ACME, managerOf(BOSS), (ctx) => expiries(ctx, { asOf: D3 }));
    expect(result).toMatchObject({ ok: true, value: { expiries: [{ kind: 'work_permit' }] } });
  });
});

describe('the cohort minimum', () => {
  let next = 1000;
  /** `n` people hired on `hire`, each answering `answer`. */
  const answered = (n: number, answer: string, hire = '2024-01-01'): Seed[] =>
    Array.from({ length: n }, () => ({
      id: `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`,
      tenantId: SELF_ID,
      hire,
      custom: { ethnicity: answer },
    }));

  const breakdown = (cohortMinimum?: number) =>
    inTenant(SELF_ID, (scope) =>
      selfIdBreakdown(
        {
          ...scope,
          viewer: hr,
          definitions,
          ...(cohortMinimum === undefined ? {} : { cohortMinimum }),
        },
        { attributeKey: 'ethnicity' },
      ),
    );

  /** What the live snapshot says on a day: the number PEO-083 stops anybody reading. */
  const live = async (day: string) =>
    [
      ...(await admin.execute(sql`
        SELECT bucket, count FROM people.headcount_snapshot_measure
         WHERE tenant_id = ${SELF_ID}::uuid AND day = ${day}::date AND measure = 'self_id:ethnicity'
         ORDER BY bucket`)),
    ] as unknown as { bucket: string; count: number }[];

  /** An employee changes their answer: history and the projection, as the write path does. */
  async function changeAnswer(person: Seed, answer: string, on: string) {
    await admin.execute(sql`
      INSERT INTO people.person_attribute_history
        (id, tenant_id, person_id, attribute_key, value, effective_from, recorded_at, actor)
      VALUES (gen_random_uuid(), ${SELF_ID}, ${person.id}, 'ethnicity', ${JSON.stringify(answer)}::jsonb,
              ${on}::date, ${`${on}T09:00:00.000Z`}::timestamptz,
              ${JSON.stringify({ kind: 'system', process: 'test' })}::jsonb)`);
    await admin.execute(sql`
      UPDATE people.person SET custom = jsonb_set(custom, '{ethnicity}', ${JSON.stringify(answer)}::jsonb)
       WHERE id = ${person.id}`);
  }

  const original = answered(9, 'a');
  const marchJoiners = [
    ...answered(1, 'a', '2026-03-10'),
    ...answered(10, 'prefer_not_to_say', '2026-03-10'),
  ];

  /*
   * The ticket's own line: nine people, and "insufficient data" through the
   * query, the tooltip and the export alike.
   */
  it('withholds a breakdown of nine people in the query, the tooltip and the export', async () => {
    await seed(...original);
    // One of them answered through the write path, so history holds it.
    await changeAnswer(original[0] as Seed, 'a', '2024-01-01');
    expect(await dailyJob(SELF_ID, '2026-03-01')).toEqual(['self_id:ethnicity']);

    const result = await breakdown();
    expect(result).toEqual({
      ok: true,
      value: {
        asOf: '2026-03-01',
        publishedAsOf: '2026-03-01',
        rounded: 5,
        note: ROUNDING_NOTE,
        status: 'insufficient_data',
        minimum: 10,
      },
    });
    if (!result.ok) return;
    expect(chartTooltip(result.value, 'a')).toEqual({ bucket: 'a', value: 'insufficient data' });
    expect(chartExport(result.value)).toEqual([
      ['bucket', 'count'],
      ['insufficient data', ''],
    ]);
    expect(
      JSON.stringify([result, chartTooltip(result.value, 'a'), chartExport(result.value)]),
    ).not.toMatch(/\b9\b/);
  });

  it('says "insufficient data" before anything is published, whatever the snapshot holds', async () => {
    const other = await inTenant(GLOBEX, (scope) =>
      selfIdBreakdown({ ...scope, viewer: hr, definitions }, { attributeKey: 'ethnicity' }),
    );
    expect(other).toMatchObject({
      ok: true,
      value: { asOf: null, publishedAsOf: null, status: 'insufficient_data' },
    });
  });

  it('waits for the boundary: eleven joiners by the 12th are not published on the 12th', async () => {
    await seed(...marchJoiners);
    expect(await dailyJob(SELF_ID, '2026-03-12')).toEqual([]);
    expect(await live('2026-03-12')).toEqual([
      { bucket: 'a', count: 10 },
      { bucket: 'prefer_not_to_say', count: 10 },
    ]);
    // The live snapshot would pass the minimum; the served breakdown is still the 1st's.
    expect(await breakdown()).toMatchObject({
      ok: true,
      value: { publishedAsOf: '2026-03-01', status: 'insufficient_data' },
    });
  });

  it('publishes at the boundary, every count and the total rounded', async () => {
    expect(await dailyJob(SELF_ID, '2026-04-01')).toEqual(['self_id:ethnicity']);
    expect(await breakdown()).toEqual({
      ok: true,
      value: {
        asOf: '2026-04-01',
        publishedAsOf: '2026-04-01',
        rounded: 5,
        note: ROUNDING_NOTE,
        status: 'ok',
        total: 20,
        cells: [
          { bucket: 'a', count: 10 },
          { bucket: 'prefer_not_to_say', count: 10 },
        ],
      },
    });
  });

  const tuesdayJoiner = answered(1, 'a', '2026-04-07');

  /*
   * The attack: 10 on Monday, 11 on Tuesday, and HR knows exactly one person
   * started on Tuesday. The live snapshot moves; what is served does not.
   */
  it('serves the same breakdown before and after one self-identifying joiner', async () => {
    await seed(...tuesdayJoiner);
    await dailyJob(SELF_ID, '2026-04-06');
    const monday = await breakdown();
    await dailyJob(SELF_ID, '2026-04-07');
    const tuesday = await breakdown();

    expect((await live('2026-04-06')).find((c) => c.bucket === 'a')?.count).toBe(10);
    expect((await live('2026-04-07')).find((c) => c.bucket === 'a')?.count).toBe(11);
    expect(tuesday).toEqual(monday);
    expect(tuesday).toMatchObject({ ok: true, value: { publishedAsOf: '2026-04-01' } });
  });

  it('gives the tooltip and the export the same published, rounded numbers as the chart', async () => {
    const result = await breakdown();
    if (!result.ok || result.value.status !== 'ok') throw new Error('expected a served breakdown');
    const chartA = result.value.cells.find((c) => c.bucket === 'a')?.count;
    expect(chartA).toBe(10);
    expect(chartTooltip(result.value, 'a')).toEqual({ bucket: 'a', value: chartA });
    expect(chartExport(result.value)).toEqual([
      ['bucket', 'count'],
      ['a', 10],
      ['prefer_not_to_say', 10],
      ['total', 20],
      [ROUNDING_NOTE, ''],
    ]);
  });

  const aprilJoiners = answered(6, 'a', '2026-04-20');

  it('does not republish on nine changes', async () => {
    // The Tuesday joiner, two changed answers and six more joiners: nine.
    await changeAnswer(marchJoiners[1] as Seed, 'a', '2026-04-15');
    await changeAnswer(marchJoiners[2] as Seed, 'a', '2026-04-15');
    await seed(...aprilJoiners);
    // Saving the answer one already had is not a change.
    await changeAnswer(original[0] as Seed, 'a', '2026-04-16');

    expect(await dailyJob(SELF_ID, '2026-05-01')).toEqual([]);
    expect(await breakdown()).toMatchObject({ ok: true, value: { publishedAsOf: '2026-04-01' } });
  });

  it('republishes on the tenth, at the next boundary and not before', async () => {
    await admin.execute(sql`
      UPDATE people.person SET last_working_day = '2026-05-10' WHERE id = ${(original[1] as Seed).id}`);
    expect(await dailyJob(SELF_ID, '2026-05-15')).toEqual([]);
    expect(await breakdown()).toMatchObject({ ok: true, value: { publishedAsOf: '2026-04-01' } });

    expect(await dailyJob(SELF_ID, '2026-06-01')).toEqual(['self_id:ethnicity']);
    // At most once in a calendar month.
    expect(await dailyJob(SELF_ID, '2026-06-02')).toEqual([]);
  });

  /*
   * June's truth is 18 "a" and 8 "prefer not to say". Rounded, the 8 would
   * read as 10: the minimum is checked before rounding, so it never does.
   */
  it('withholds on the true counts although rounding would lift a cell to 10', async () => {
    expect(await live('2026-06-01')).toEqual([
      { bucket: 'a', count: 18 },
      { bucket: 'prefer_not_to_say', count: 8 },
    ]);
    const result = await breakdown();
    expect(result).toMatchObject({
      ok: true,
      value: { publishedAsOf: '2026-06-01', status: 'insufficient_data', minimum: 10 },
    });
    expect(result.ok && result.value).not.toHaveProperty('cells');
    expect(result.ok && result.value).not.toHaveProperty('total');
  });

  it('honours a raised minimum and ignores a lowered one', async () => {
    const raised = await breakdown(50);
    expect(raised).toMatchObject({ ok: true, value: { status: 'insufficient_data', minimum: 50 } });
    const lowered = await breakdown(1);
    expect(lowered).toMatchObject({
      ok: true,
      value: { status: 'insufficient_data', minimum: 10 },
    });
  });

  it('never answers a manager, and never answers for a field that is not special-category', async () => {
    const asManager = await chart(SELF_ID, managerOf(BOSS), (ctx) =>
      selfIdBreakdown(ctx, { attributeKey: 'ethnicity' }),
    );
    expect(asManager).toMatchObject({ ok: false, error: { code: 'SPECIAL_CATEGORY_HR_ONLY' } });
    const notSpecial = await chart(SELF_ID, hr, (ctx) =>
      selfIdBreakdown(ctx, { attributeKey: 'org_unit' }),
    );
    expect(notSpecial).toMatchObject({ ok: false, error: { code: 'NOT_A_SELF_ID_FIELD' } });
  });

  describe('a core field a tenant tightened to special-category', () => {
    const tightened = definitions.map((d) =>
      d.key === 'work_location'
        ? define({
            key: 'work_location',
            visibility: ['hr'],
            classification: SPECIAL,
            includeInEvents: false,
          })
        : d,
    );

    it('is withheld whole below the minimum', async () => {
      const result = await chart(
        ACME,
        hr,
        (ctx) => composition(ctx, { by: ['location'] }),
        tightened,
      );
      // Nothing published yet: "insufficient data" rather than a live read.
      expect(result).toMatchObject({
        ok: true,
        value: { publishedAsOf: null, status: 'insufficient_data', minimum: 10 },
      });
    });

    it('is read from its publication, not from the snapshot', async () => {
      expect(await publishOn(ACME, D3, tightened)).toEqual({
        ok: true,
        value: { published: ['self_id:ethnicity', 'composition:location'] },
      });
      const result = await chart(
        ACME,
        hr,
        (ctx) => composition(ctx, { by: ['location'] }),
        tightened,
      );
      expect(result).toMatchObject({
        ok: true,
        value: { asOf: D3, publishedAsOf: D3, rounded: 5, status: 'insufficient_data' },
      });
    });

    it('cannot be filtered, which would difference a cell out of two queries', async () => {
      const result = await chart(
        ACME,
        hr,
        (ctx) => composition(ctx, { by: ['location'], filters: { department: [ENG] } }),
        tightened,
      );
      expect(result).toMatchObject({ ok: false, error: { code: 'SPECIAL_CATEGORY_UNFILTERED' } });
    });

    it('cannot be read at an earlier snapshot, which would difference it across time', async () => {
      const result = await chart(
        ACME,
        hr,
        (ctx) => composition(ctx, { asOf: D1, by: ['location'] }),
        tightened,
      );
      expect(result).toMatchObject({ ok: false, error: { code: 'SPECIAL_CATEGORY_LATEST_ONLY' } });
    });

    it('cannot appear in a range chart, nor as a filter on one', async () => {
      const result = await chart(
        ACME,
        hr,
        (ctx) => headcountTrend(ctx, { from: D1, to: D3, filters: { location: [MADRID] } }),
        tightened,
      );
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'SPECIAL_CATEGORY_POINT_IN_TIME' },
      });
    });
  });
});

describe('a tenant with entities in Madrid and Bangalore (PRD §6.8, §16)', () => {
  const TENANT = '00000000-0000-4000-8000-00000000000e';
  const SL = '00000000-0000-4000-8000-000000000201';
  const INDIA = '00000000-0000-4000-8000-000000000202';
  const calendar: TenantCalendar = {
    defaultZone: 'Europe/Madrid',
    entities: new Map([
      [SL, { id: SL, name: 'Acme SL', country: 'ES', timeZone: 'Europe/Madrid' }],
      [INDIA, { id: INDIA, name: 'Acme India', country: 'IN', timeZone: 'Asia/Kolkata' }],
    ]),
    locations: new Map(),
  };

  it('counts each entity on its own day and files the run under the tenant’s', async () => {
    // Both start on 1 April. At 20:00 UTC on 31 March it is already the 1st in
    // Bangalore (01:30) and still the 31st in Madrid (22:00).
    for (const [id, entity] of [
      ['00000000-0000-4000-8000-000000000211', SL],
      ['00000000-0000-4000-8000-000000000212', INDIA],
    ] as const) {
      // eslint-disable-next-line no-await-in-loop -- two rows
      await admin.execute(sql`
        INSERT INTO people.person (id, tenant_id, status, hire_date, legal_entity_id, completeness)
        VALUES (${id}, ${TENANT}, 'active', '2026-04-01', ${entity}, 'complete')`);
    }
    const run = await inTenant(TENANT, (scope) =>
      takeSnapshot(
        {
          facts,
          clock: fixedClock('2026-03-31T20:00:00.000Z'),
          calendars: fixedCalendars(calendar),
        },
        scope,
        { definitions },
      ),
    );
    expect(run).toMatchObject({ ok: true, value: { day: '2026-03-31' } });
    const [row] = [
      ...(await admin.execute(sql`
        SELECT sum(headcount)::int AS headcount, sum(joiners)::int AS joiners
          FROM people.headcount_snapshot
         WHERE tenant_id = ${TENANT}::uuid AND scope_id = ${TENANT}::uuid AND day = '2026-03-31'`)),
    ];
    // The tenant's figure is the sum of the entities' own-day figures: 0 + 1.
    expect(row).toEqual({ headcount: 1, joiners: 1 });
  });

  it('opens each person’s expiry window on their entity’s day (PEO-122)', async () => {
    // At 20:00 UTC on 31 March, Madrid's window is (31 Mar, 29 Jun] and
    // Bangalore's (1 Apr, 30 Jun]: the same two dates fall either side.
    const people = [
      ['00000000-0000-4000-8000-000000000221', SL, '2026-04-01'],
      ['00000000-0000-4000-8000-000000000222', SL, '2026-06-30'],
      ['00000000-0000-4000-8000-000000000223', INDIA, '2026-04-01'],
      ['00000000-0000-4000-8000-000000000224', INDIA, '2026-06-30'],
    ] as const;
    for (const [id, entity, expiry] of people) {
      // eslint-disable-next-line no-await-in-loop -- four rows
      await admin.execute(sql`
        INSERT INTO people.person (id, tenant_id, status, hire_date, legal_entity_id, completeness, custom)
        VALUES (${id}, ${TENANT}, 'active', '2020-01-01', ${entity}, 'complete',
                ${JSON.stringify({ work_permit_expiry: expiry })}::jsonb)`);
    }
    const viewer = { accountId: '00000000-0000-4000-8000-0000000002ff', roles: new Set(['hr']) };
    const result = await chart(TENANT, hr, (ctx) =>
      expiryTimeline(ctx, {
        calendar,
        at: '2026-03-31T20:00:00.000Z',
        everyone: HR_RELATIONS,
        relations: (ids) => relationsToMany(drizzleRelations(), ctx.tx, TENANT, viewer, ids),
      }),
    );
    expect(result).toMatchObject({ ok: true, value: { today: '2026-03-31', horizon: 90 } });
    expect(result.ok && result.value.items.map((i) => [i.personId, i.day])).toEqual([
      [people[0][0], '2026-04-01'],
      [people[3][0], '2026-06-30'],
    ]);
  });
});

describe('the expiry timeline, live and item by item (PEO-122)', () => {
  const TENANT = '00000000-0000-4000-8000-00000000000f';
  const TOP = '00000000-0000-4000-8000-000000000301';
  const MGR = '00000000-0000-4000-8000-000000000302';
  const MINE = '00000000-0000-4000-8000-000000000303';
  const DEEP = '00000000-0000-4000-8000-000000000304';
  const OTHER = '00000000-0000-4000-8000-000000000305';
  const GONE = '00000000-0000-4000-8000-000000000306';
  const MGR_ACCOUNT = '00000000-0000-4000-8000-0000000003a2';
  const AT = '2026-03-31T12:00:00.000Z';

  // A permit is its holder's and HR's; a contract end is HR's and the chain's.
  const defs = [
    define({ key: 'work_permit_expiry', visibility: ['self', 'hr'] }),
    define({ key: 'contract_end', visibility: ['hr', 'manager_chain'] }),
    define({ key: 'given_name', visibility: ['directory'] }),
    define({ key: 'family_name', visibility: ['directory'] }),
  ];

  beforeAll(async () => {
    const rows: [string, string | null, string, string | null, Record<string, string>][] = [
      [TOP, null, 'active', null, {}],
      [MGR, TOP, 'active', null, {}],
      [MINE, MGR, 'active', null, { work_permit_expiry: '2026-04-30', contract_end: '2026-05-10' }],
      [DEEP, MINE, 'active', null, { contract_end: '2026-07-15' }],
      // Not in the manager's chain, expiring in 30 days like theirs.
      [OTHER, TOP, 'active', null, { work_permit_expiry: '2026-04-30' }],
      // Gone before the window opens: nothing of theirs expires for us.
      [GONE, MGR, 'terminated', '2026-03-01', { work_permit_expiry: '2026-04-30' }],
    ];
    for (const [id, manager, status, lastDay, custom] of rows) {
      // eslint-disable-next-line no-await-in-loop -- six rows
      await admin.execute(sql`
        INSERT INTO people.person (id, tenant_id, status, hire_date, last_working_day, manager_id,
                                   identity_account_id, given_name, family_name, completeness, custom)
        VALUES (${id}, ${TENANT}, ${status}, '2020-01-01', ${lastDay}, ${manager},
                ${id === MGR ? MGR_ACCOUNT : null}, 'Given', ${id.slice(-3)}, 'complete',
                ${JSON.stringify({ ...custom, certification: [{ certification_expiry: '2027-01-01' }] })}::jsonb)`);
    }
  });

  const timeline = (viewer: ChartViewer, account: { accountId: string; roles: Set<string> }) =>
    chart(
      TENANT,
      viewer,
      (ctx) =>
        expiryTimeline(ctx, {
          calendar: UTC_CALENDAR,
          at: AT,
          everyone: account.roles.has('hr') ? HR_RELATIONS : NO_RELATIONS,
          relations: (ids) => relationsToMany(drizzleRelations(), ctx.tx, TENANT, account, ids),
        }),
      defs,
    );

  it('shows HR every permit and contract in the next 90 days, named, earliest first', async () => {
    const result = await timeline(hr, {
      accountId: '00000000-0000-4000-8000-0000000003ff',
      roles: new Set(['hr']),
    });
    expect(result).toEqual({
      ok: true,
      value: {
        today: '2026-03-31',
        horizon: 90,
        kinds: ['work_permit', 'fixed_term'],
        items: [
          { personId: MINE, kind: 'work_permit', day: '2026-04-30', name: 'Given 303' },
          { personId: OTHER, kind: 'work_permit', day: '2026-04-30', name: 'Given 305' },
          { personId: MINE, kind: 'fixed_term', day: '2026-05-10', name: 'Given 303' },
        ],
      },
    });
  });

  it('shows a manager their chain’s contracts and no permit, not even the item', async () => {
    const result = await timeline(
      { kind: 'manager', personId: MGR },
      { accountId: MGR_ACCOUNT, roles: new Set() },
    );
    // OTHER is outside the chain; MINE's permit is MINE's and HR's. Nothing
    // is drawn for either, so there is no gap to count.
    expect(result.ok && result.value.items).toEqual([
      { personId: MINE, kind: 'fixed_term', day: '2026-05-10', name: 'Given 303' },
    ]);
    expect(result.ok && result.value.kinds).toEqual(['fixed_term']);
  });

  it('looks as far ahead as asked, and refuses a horizon that is not a number of days', async () => {
    const far = await chart(
      TENANT,
      hr,
      (ctx) =>
        expiryTimeline(ctx, {
          calendar: UTC_CALENDAR,
          at: AT,
          horizon: 120,
          everyone: HR_RELATIONS,
          // HR reads both fields tenant-wide, so nobody's relations are asked.
          relations: () => Promise.reject(new Error('not asked')),
        }),
      defs,
    );
    expect(far.ok && far.value.items.map((i) => i.personId)).toContain(DEEP);
    const refused = await chart(
      TENANT,
      hr,
      (ctx) =>
        expiryTimeline(ctx, {
          calendar: UTC_CALENDAR,
          at: AT,
          horizon: 0,
          everyone: HR_RELATIONS,
          relations: () => Promise.reject(new Error('not asked')),
        }),
      defs,
    );
    expect(refused).toMatchObject({ ok: false, error: { code: 'INVALID_HORIZON' } });
  });
});

describe('at 50,000 people', () => {
  beforeAll(async () => {
    /*
     * Everybody first, their managers second, with ANALYZE between.
     *
     * `manager_id` is a foreign key into this same table on (tenant_id, id),
     * so every row checks its manager exists. `admin` is one connection, and
     * it has already run that check for the handful of people seeded above:
     * Postgres keeps the check's plan per connection, made for a table of a
     * few rows, and reuses it here. It walked a tenant-prefixed index rather
     * than the key — 50,000 checks, each over up to 50,000 rows: 2 to 5
     * minutes on two cores, against under a second for the same insert on a
     * fresh connection. Anything that invalidated the plan first (autovacuum
     * analyzing the table) turned it back into seconds, which is what made
     * the 180 s hook limit a coin toss. Setting managers after
     * ANALYZE plans the check against a table that knows this tenant has
     * 50,000 people, so it looks each manager up by key.
     */
    const seeding = performance.now();
    await admin.execute(sql`
      INSERT INTO people.person
        (id, tenant_id, status, hire_date, last_working_day, manager_id, org_unit_id, location_id,
         employment_type, completeness, custom)
      SELECT md5('perf' || i)::uuid, ${PERF}::uuid,
             CASE WHEN i % 15 = 0 THEN 'terminated' WHEN i % 40 = 0 THEN 'on_leave' ELSE 'active' END,
             DATE '2015-01-01' + (i % 4000),
             CASE WHEN i % 15 = 0 THEN DATE '2015-01-01' + (i % 4000) + 200 END,
             NULL,
             md5('ou' || (i % 20))::uuid, md5('loc' || (i % 5))::uuid,
             (ARRAY['permanent', 'fixed_term', 'contractor', 'intern'])[1 + i % 4],
             CASE WHEN i % 7 = 0 THEN 'incomplete' ELSE 'complete' END,
             jsonb_build_object('ethnicity', (ARRAY['a', 'b', 'prefer_not_to_say'])[1 + i % 3],
                                'cost_centre', 'CC' || (i % 10))
        FROM generate_series(1, 50000) AS i`);
    await admin.execute(sql`ANALYZE people.person`);
    await admin.execute(sql`
      UPDATE people.person p SET manager_id = md5('perf' || ((i - 2) / 8 + 1))::uuid
        FROM generate_series(2, 50000) AS i
       WHERE p.tenant_id = ${PERF}::uuid AND p.id = md5('perf' || i)::uuid`);
    // The update leaves a dead version of every row; the snapshot should read
    // a table as production's looks, not one twice its size.
    await admin.execute(sql`VACUUM ANALYZE people.person`);
    console.info(
      `seeding 50,000 people took ${String(Math.round(performance.now() - seeding))} ms`,
    );

    const start = performance.now();
    expect(await dailyJob(PERF, '2026-03-31')).toEqual(['self_id:ethnicity']);
    console.info(
      `snapshot of 50,000 people took ${String(Math.round(performance.now() - start))} ms`,
    );

    // A year of month-end runs behind it, copied rather than recomputed. Only
    // the tenant-wide scope: the trend below reads nothing else, and copying
    // every manager's chain eleven times was millions of rows — seconds on a
    // laptop, past the 180 s hook limit on a two-core CI runner.
    await admin.execute(sql`
      WITH months AS (SELECT (DATE '2026-03-31' - make_interval(months => n))::date AS day
                        FROM generate_series(1, 11) AS n)
      INSERT INTO people.headcount_snapshot_run (tenant_id, day, flows_from)
      SELECT ${PERF}::uuid, day, day - 30 FROM months`);
    await admin.execute(sql`
      INSERT INTO people.headcount_snapshot
      SELECT s.tenant_id, r.day, s.scope_id, s.department, s.location, s.status, s.employment_type,
             s.tenure_band, s.completeness, s.headcount, s.joiners, s.leavers
        FROM people.headcount_snapshot s
        JOIN people.headcount_snapshot_run r ON r.tenant_id = s.tenant_id AND r.day < DATE '2026-03-31'
       WHERE s.tenant_id = ${PERF}::uuid AND s.day = DATE '2026-03-31'
         AND s.scope_id = ${PERF}::uuid`);
    await admin.execute(sql`ANALYZE people.headcount_snapshot`);
  });

  async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; result: T }> {
    await fn(); // one warm-up, so the timing is the query rather than the first connection
    const start = performance.now();
    const result = await fn();
    return { ms: performance.now() - start, result };
  }

  it('answers a composition chart in under 400 ms', async () => {
    const { ms, result } = await timed(() =>
      chart(PERF, hr, (ctx) =>
        composition(ctx, { asOf: '2026-03-31', by: ['department', 'employment_type'] }),
      ),
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.value.status === 'ok') {
      expect(result.value.cells.reduce((n, c) => n + c.count, 0)).toBeGreaterThan(40_000);
    }
    expect(ms).toBeLessThan(400);
  });

  it('answers a year of headcount trend in under 400 ms', async () => {
    const { ms, result } = await timed(() =>
      chart(PERF, hr, (ctx) => headcountTrend(ctx, { from: '2025-04-01', to: '2026-03-31' })),
    );
    expect(result.ok && result.value.points).toHaveLength(12);
    expect(ms).toBeLessThan(400);
  });

  it("answers a manager's chain chart in under 400 ms", async () => {
    const [top] = [...(await admin.execute(sql`SELECT md5('perf1')::uuid::text AS id`))] as {
      id: string;
    }[];
    if (!top) throw new Error('no top of the org');
    const { ms, result } = await timed(() =>
      chart(PERF, managerOf(top.id), (ctx) =>
        composition(ctx, { asOf: '2026-03-31', by: ['department'] }),
      ),
    );
    expect(result.ok).toBe(true);
    expect(ms).toBeLessThan(400);
  });

  it('answers the live expiry timeline in under 400 ms', async () => {
    await admin.execute(sql`
      UPDATE people.person
         SET custom = custom || jsonb_build_object('work_permit_expiry',
                                 (DATE '2026-04-01' + (hashtext(id::text) & 255))::text)
       WHERE tenant_id = ${PERF}::uuid AND hashtext(id::text) % 50 = 0`);
    const { ms, result } = await timed(() =>
      chart(PERF, hr, (ctx) =>
        expiryTimeline(ctx, {
          calendar: UTC_CALENDAR,
          at: '2026-03-31T12:00:00.000Z',
          everyone: HR_RELATIONS,
          // HR reads the permit on everybody: no per-person question is asked.
          relations: () => Promise.reject(new Error('not asked')),
        }),
      ),
    );
    expect(result.ok && result.value.items.length).toBeGreaterThan(100);
    console.info(`the expiry timeline over 50,000 people took ${String(Math.round(ms))} ms`);
    expect(ms).toBeLessThan(400);
  });

  it('never reads the person table to draw a chart from the snapshot', async () => {
    // Taken away rather than counted: a chart that touched the table would fail.
    await admin.execute(sql`REVOKE SELECT ON people.person FROM svc_people`);
    try {
      const drawn = await Promise.all([
        chart(PERF, hr, (ctx) => composition(ctx, { asOf: '2026-03-31', by: ['department'] })),
        chart(PERF, hr, (ctx) => headcountTrend(ctx, { from: '2025-04-01', to: '2026-03-31' })),
        chart(PERF, hr, (ctx) => movementWaterfall(ctx, { from: '2026-02-28', to: '2026-03-31' })),
        chart(PERF, hr, (ctx) => spanOfControl(ctx, { asOf: '2026-03-31' })),
        chart(PERF, hr, (ctx) => selfIdBreakdown(ctx, { attributeKey: 'ethnicity' })),
      ]);
      expect(drawn.every((r) => r.ok)).toBe(true);
    } finally {
      await admin.execute(sql`GRANT SELECT ON people.person TO svc_people`);
    }
  });
});
