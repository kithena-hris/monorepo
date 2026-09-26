import { readFile } from 'node:fs/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { startPostgres } from '@kithena/testing';

import type { Schedule } from '../domain/report/schedule.js';
import { drizzleReportSchedules } from './drizzle-report-schedules.js';
import { tenantTransaction } from './unit-of-work.js';

/**
 * `people.report_schedule` and `people.report_run` (PEO-069), against the
 * migration: a schedule round-trips, a period is claimed once, a run records
 * outcomes, and a tenant sees only its own.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const GLOBEX = '00000000-0000-4000-8000-00000000000b';
const PRIYA = '00000000-0000-4000-8000-0000000000b1';
const MARCO = '00000000-0000-4000-8000-0000000000b2';

const schedule: Schedule = {
  id: '00000000-0000-4000-8000-0000000000c1',
  name: 'Monday roster',
  ownerAccountId: PRIYA,
  audience: { filter: { cost_centre: 'CC-1' } },
  report: { kind: 'export', format: 'pdf', fields: ['given_name', 'job_title'], reason: null },
  cadence: { every: 'week', weekday: 1, hour: 7 },
  legalEntityId: null,
  recipients: [PRIYA, MARCO],
  paused: false,
  lastPeriod: '2026-09-21',
};

let stop: (() => Promise<void>) | undefined;
const clients: ReturnType<typeof postgres>[] = [];
let inTenant: ReturnType<typeof tenantTransaction>;
const store = drizzleReportSchedules();

beforeAll(async () => {
  const pg = await startPostgres();
  stop = pg.stop;
  const adminClient = postgres(pg.url, { max: 1 });
  clients.push(adminClient);
  const admin = drizzle(adminClient);
  for (const file of [
    '20260821120000_tenant_registry.sql',
    '20260922140000_people_bootstrap.sql',
    '20260926170000_people_report_schedule.sql',
  ]) {
    const text = await readFile(new URL(`../../../../migrations/${file}`, import.meta.url), 'utf8');
    await admin.execute(sql.raw(text));
  }
  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);
  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  const service = postgres(asService.toString(), { max: 2 });
  clients.push(service);
  inTenant = tenantTransaction(drizzle(service));
}, 120_000);

afterAll(async () => {
  await Promise.all(clients.map((c) => c.end()));
  await stop?.();
});

describe('the schedule store', () => {
  it('round-trips a schedule, and another tenant sees none of it', async () => {
    await inTenant(ACME, ({ tx }) => store.insert(tx, ACME, schedule));
    expect(await inTenant(ACME, ({ tx }) => store.all(tx, ACME))).toEqual([schedule]);
    expect(await inTenant(GLOBEX, ({ tx }) => store.all(tx, ACME))).toEqual([]);
  });

  it('claims a period once, moves the schedule on, and records what the run did', async () => {
    const at = '2026-09-28T07:30:00.000Z';
    const claim = () =>
      inTenant(ACME, ({ tx }) => store.claim(tx, ACME, schedule.id, '2026-09-28', 0, at));
    expect(await claim()).toBe(true);
    expect(await claim()).toBe(false);
    const [moved] = await inTenant(ACME, ({ tx }) => store.all(tx, ACME));
    expect(moved?.lastPeriod).toBe('2026-09-28');

    await inTenant(ACME, ({ tx }) =>
      store.finish(tx, ACME, schedule.id, '2026-09-28', {
        outcome: 'partial',
        recipients: [
          { accountId: PRIYA, outcome: 'sent' },
          { accountId: MARCO, outcome: 'FIELD_NOT_FILTERABLE' },
        ],
        at: '2026-09-28T07:31:00.000Z',
      }),
    );
    expect(await inTenant(ACME, ({ tx }) => store.runs(tx, ACME, schedule.id, 10))).toEqual([
      {
        period: '2026-09-28',
        missed: 0,
        startedAt: at,
        finishedAt: '2026-09-28T07:31:00.000Z',
        outcome: 'partial',
        recipients: [
          { accountId: PRIYA, outcome: 'sent' },
          { accountId: MARCO, outcome: 'FIELD_NOT_FILTERABLE' },
        ],
      },
    ]);
  });

  it('pauses, and deletes a schedule with its history', async () => {
    await inTenant(ACME, ({ tx }) => store.setPaused(tx, ACME, schedule.id, true, '2026-09-28'));
    expect((await inTenant(ACME, ({ tx }) => store.all(tx, ACME)))[0]?.paused).toBe(true);
    await inTenant(ACME, ({ tx }) => store.remove(tx, ACME, schedule.id));
    expect(await inTenant(ACME, ({ tx }) => store.all(tx, ACME))).toEqual([]);
    expect(await inTenant(ACME, ({ tx }) => store.runs(tx, ACME, schedule.id, 10))).toEqual([]);
  });

  it('holds a summary only without a filter, fields or a format', async () => {
    const summary: Schedule = {
      ...schedule,
      id: '00000000-0000-4000-8000-0000000000c2',
      audience: { segmentId: '00000000-0000-4000-8000-0000000000d1' },
      report: { kind: 'summary' },
      cadence: { every: 'month', day: 1, hour: 6 },
    };
    await inTenant(ACME, ({ tx }) => store.insert(tx, ACME, summary));
    expect(await inTenant(ACME, ({ tx }) => store.all(tx, ACME))).toEqual([summary]);
  });
});
