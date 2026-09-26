import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import { fixedClock, type Clock, type PendingEvent } from '@kithena/domain-kit';

import type { ScheduleInput } from '../../domain/report/schedule.js';
import { inMemoryReportSchedules } from '../../infrastructure/drizzle-report-schedules.js';
import { inMemorySegments } from '../../infrastructure/drizzle-segments.js';
import { ADA, asking, financeTenant, HR, MANAGER, MARCO } from '../export/fixture.js';
import type { ExportJobDeps } from '../export/job.js';
import { inMemoryExportLedger } from '../export/ledger.js';
import { localObjectStore } from '../export/object-store.js';
import { utcCalendars } from '../org/org.js';
import { noTransaction as tx, TENANT } from '../person/in-memory.js';
import { personAccess } from '../person/person-access.js';
import {
  createSchedule,
  scheduleRuns,
  sendDueReports,
  setPaused,
  updateSchedule,
  type ReportDeps,
  type ReportMail,
} from './scheduled.js';

/**
 * Scheduled reports (PEO-069): built as each recipient when they run, sent
 * once per period, caught up once after the backend slept, and emailed as a
 * link to the tenant app — never the data.
 */

const ORIGIN = 'https://acme.app.kithena.test';
const LEFT = '00000000-0000-4000-8000-0000000000d9';

function movable(start: string): Clock & { set(iso: string): void } {
  let current = fixedClock(start);
  return {
    instant: () => current.instant(),
    date: (tz: string) => current.date(tz),
    now: () => current.now(),
    set(iso: string) {
      current = fixedClock(iso);
    },
  } as unknown as Clock & { set(iso: string): void };
}

function setup() {
  const people = financeTenant();
  // Tuesday 22 September 2026, 09:00 UTC.
  const clock = movable('2026-09-22T09:00:00.000Z');
  const events: PendingEvent[] = [];
  const ledger = inMemoryExportLedger();
  let ids = 0;
  const newId = () => `00000000-0000-4000-9000-${String((ids += 1)).padStart(12, '0')}`;
  const exports: ExportJobDeps = {
    calendars: utcCalendars,
    access: personAccess(people.deps),
    schemas: people.deps.schemas,
    relations: people.deps.relations,
    records: people.deps,
    clock: people.deps.clock,
    store: localObjectStore({
      encryptionKey: randomBytes(32),
      signingKey: randomBytes(32),
      clock: people.deps.clock,
      baseUrl: 'https://people.test/v1/exports/files',
    }),
    notifier: {
      notify: () => {
        throw new Error('a scheduled report announces itself after the commit');
      },
    },
    audit: { publish: (_tx, e) => (events.push(...e), Promise.resolve()) },
    ledger,
    newId,
  };
  const roles = new Map<string, Set<string>>([[HR.accountId, new Set(['hr'])]]);
  const mail: ReportMail[] = [];
  const schedules = inMemoryReportSchedules();
  const segments = inMemorySegments();
  const deps: ReportDeps = {
    inTenant: (_tenantId, fn) => fn({ tx }),
    schedules,
    segments,
    accounts: {
      holdings: () => Promise.resolve(roles),
      candidates: () =>
        Promise.resolve([
          { accountId: HR.accountId, personId: ADA, name: null, workEmail: 'hr@acme.test' },
          {
            accountId: MANAGER.accountId,
            personId: MARCO,
            name: null,
            workEmail: 'marco@acme.test',
          },
        ]),
    },
    calendars: utcCalendars,
    clock,
    newId,
    exports,
    company: () => Promise.resolve({ name: 'Acme', origin: ORIGIN }),
    mailer: { send: (_t, _c, m) => (mail.push(m), Promise.resolve()) },
  };
  const sweep = sendDueReports(deps);
  const make = async (over: Partial<ScheduleInput> = {}) => {
    const made = await createSchedule(deps, tx, asking(HR), {
      name: 'Monday roster',
      audience: { filter: {} },
      report: { kind: 'export', format: 'xlsx', fields: ['given_name', 'job_title'], reason: null },
      cadence: { every: 'week', weekday: 1, hour: 7 },
      legalEntityId: null,
      recipients: [HR.accountId, MANAGER.accountId],
      ...over,
    });
    if (!made.ok) throw new Error(made.error.message);
    return made.value;
  };
  return { deps, clock, mail, events, ledger, roles, schedules, segments, sweep, make };
}

const exportIdOf = (url: string) => new URL(url).searchParams.get('export') ?? '';

describe('a scheduled export', () => {
  it('does not send when it is saved, only when its next period comes', async () => {
    const { clock, mail, sweep, make } = setup();
    await make();
    expect(await sweep(TENANT)).toEqual({ runs: 0, waiting: false });
    expect(mail).toHaveLength(0);

    clock.set('2026-09-28T07:30:00.000Z'); // Monday, after 07:00
    expect(await sweep(TENANT)).toEqual({ runs: 1, waiting: false });
    expect(mail.map((m) => m.email).toSorted()).toEqual(['hr@acme.test', 'marco@acme.test']);
  });

  it('is built as each recipient: their own file, their rows, a link to the tenant app', async () => {
    const { clock, mail, events, ledger, sweep, make } = setup();
    const schedule = await make();
    clock.set('2026-09-28T07:30:00.000Z');
    await sweep(TENANT);

    const byEmail = new Map(mail.map((m) => [m.email, m]));
    for (const [email, account] of [
      ['hr@acme.test', HR.accountId],
      ['marco@acme.test', MANAGER.accountId],
    ] as const) {
      const m = byEmail.get(email);
      expect(m).toMatchObject({ cadence: 'weekly', format: 'xlsx' });
      expect(m?.url.startsWith(`${ORIGIN}/people/export?export=`)).toBe(true);
      expect(m?.dedupeKey).toBe(`${schedule.id}/2026-09-28/${account}`);
      // Only the recipient can open it: the export is theirs.
      const entry = await ledger.find(tx, TENANT, exportIdOf(m?.url ?? ''));
      expect(entry?.requestedBy).toBe(account);
    }
    const rows = async (email: string) => {
      const entry = await ledger.find(tx, TENANT, exportIdOf(byEmail.get(email)?.url ?? ''));
      return entry?.status === 'completed' ? entry.rowCount : -1;
    };
    expect(await rows('hr@acme.test')).toBe(3);
    // The columns are each recipient's own: a manager does not read names HR keeps.
    expect(events.map((e) => (e.payload as { attributeKeys: string[] }).attributeKeys)).toEqual([
      ['given_name', 'job_title'],
      ['job_title'],
    ]);
    // Nobody asked for it: the audit event names the schedule's process.
    expect(events.map((e) => e.actor)).toEqual([
      { kind: 'system', process: 'people.scheduled-report' },
      { kind: 'system', process: 'people.scheduled-report' },
    ]);
  });

  it('runs once per period, however many sweeps see it', async () => {
    const { clock, mail, sweep, make } = setup();
    await make();
    clock.set('2026-09-28T07:30:00.000Z');
    await sweep(TENANT);
    await sweep(TENANT);
    clock.set('2026-09-29T07:30:00.000Z');
    await sweep(TENANT);
    expect(mail).toHaveLength(2);
  });

  it('after a sleep, sends the latest period once and records what it covers', async () => {
    const { deps, clock, mail, sweep, make } = setup();
    const schedule = await make();
    clock.set('2026-10-20T10:00:00.000Z'); // three Mondays later
    await sweep(TENANT);
    expect(mail).toHaveLength(2);
    const runs = await scheduleRuns(deps, tx, asking(HR), schedule.id);
    expect(runs.ok && runs.value).toMatchObject([
      { period: '2026-10-19', missed: 3, outcome: 'sent' },
    ]);
  });

  it('sends nobody a file over a filter they may not use, and nobody who has left', async () => {
    const { deps, clock, mail, sweep, make } = setup();
    const schedule = await make({
      // HR and finance read cost centres; a manager does not.
      audience: { filter: { cost_centre: 'CC-1' } },
      recipients: [HR.accountId, MANAGER.accountId],
    });
    // Somebody on the list leaves after it was made.
    await deps.schedules.insert(tx, TENANT, {
      ...schedule,
      recipients: [...schedule.recipients, LEFT],
    });
    clock.set('2026-09-28T07:30:00.000Z');
    await sweep(TENANT);
    expect(mail.map((m) => m.email)).toEqual(['hr@acme.test']);
    const runs = await scheduleRuns(deps, tx, asking(HR), schedule.id);
    expect(runs.ok && runs.value[0]).toMatchObject({
      outcome: 'partial',
      recipients: [
        { accountId: HR.accountId, outcome: 'sent' },
        { accountId: MANAGER.accountId, outcome: 'FIELD_NOT_FILTERABLE' },
        { accountId: LEFT, outcome: 'not_eligible' },
      ],
    });
  });

  it('stops when its owner stops managing People', async () => {
    const { deps, clock, mail, roles, sweep, make } = setup();
    const schedule = await make();
    roles.delete(HR.accountId);
    clock.set('2026-09-28T07:30:00.000Z');
    await sweep(TENANT);
    expect(mail).toHaveLength(0);
    roles.set(HR.accountId, new Set(['hr']));
    const runs = await scheduleRuns(deps, tx, asking(HR), schedule.id);
    expect(runs.ok && runs.value[0]).toMatchObject({
      outcome: 'skipped',
      recipients: [{ outcome: 'owner_not_allowed' }],
    });
  });
});

describe('pausing', () => {
  it('sends nothing while paused, and nothing it was paused through on resuming', async () => {
    const { deps, clock, mail, sweep, make } = setup();
    const schedule = await make();
    await setPaused(deps, tx, asking(HR), schedule.id, true);
    clock.set('2026-10-06T10:00:00.000Z');
    await sweep(TENANT);
    expect(mail).toHaveLength(0);

    await setPaused(deps, tx, asking(HR), schedule.id, false);
    await sweep(TENANT);
    expect(mail).toHaveLength(0);
    clock.set('2026-10-12T07:30:00.000Z');
    await sweep(TENANT);
    expect(mail).toHaveLength(2);
  });
});

describe('a scheduled summary', () => {
  it('links to the analytics screen under its segment, for whoever could chart by it', async () => {
    const { clock, mail, segments, sweep, make } = setup();
    await segments.insert(tx, TENANT, {
      id: '00000000-0000-4000-8000-00000000005e',
      name: 'Senior',
      filter: { level: 'l2' },
      ownerAccountId: HR.accountId,
      shared: false,
    });
    await make({
      report: { kind: 'summary' },
      audience: { segmentId: '00000000-0000-4000-8000-00000000005e' },
      cadence: { every: 'day', hour: 7 },
      recipients: [HR.accountId],
    });
    clock.set('2026-09-23T07:30:00.000Z');
    await sweep(TENANT);
    // `level` is not a chart dimension, so nobody could chart by it.
    expect(mail).toHaveLength(0);
  });

  it('links to the analytics screen, and carries no number', async () => {
    const { clock, mail, sweep, make } = setup();
    await make({ report: { kind: 'summary' }, cadence: { every: 'day', hour: 7 } });
    clock.set('2026-09-23T07:30:00.000Z');
    await sweep(TENANT);
    expect(mail.map((m) => [m.url, m.format, m.cadence])).toEqual([
      [`${ORIGIN}/people/analytics`, 'summary', 'daily'],
      [`${ORIGIN}/people/analytics`, 'summary', 'daily'],
    ]);
  });
});

describe('changing a schedule', () => {
  it('starts again from the current period, keeps it paused, and belongs to whoever saved it', async () => {
    const { deps, clock, mail, schedules, sweep, make } = setup();
    const schedule = await make();
    await setPaused(deps, tx, asking(HR), schedule.id, true);
    clock.set('2026-10-06T10:00:00.000Z');
    const other = { ...HR, accountId: '00000000-0000-4000-8000-0000000000fd' };
    const changed = await updateSchedule(deps, tx, asking(other), schedule.id, {
      name: 'Daily roster',
      audience: { filter: {} },
      report: { kind: 'export', format: 'pdf', fields: null, reason: null },
      cadence: { every: 'day', hour: 7 },
      legalEntityId: null,
      recipients: [HR.accountId],
    });
    expect(changed).toMatchObject({
      ok: true,
      value: {
        name: 'Daily roster',
        paused: true,
        lastPeriod: '2026-10-06',
        ownerAccountId: other.accountId,
      },
    });
    expect(schedules.held.get(schedule.id)?.cadence).toEqual({ every: 'day', hour: 7 });
    await sweep(TENANT);
    expect(mail).toHaveLength(0);
  });

  it('is refused to anybody but HR and People administrators', async () => {
    const { deps, make } = setup();
    const schedule = await make();
    const refused = await updateSchedule(deps, tx, asking(MANAGER), schedule.id, {
      name: 'Mine',
      audience: { filter: {} },
      report: { kind: 'summary' },
      cadence: { every: 'day', hour: 7 },
      legalEntityId: null,
      recipients: [MANAGER.accountId],
    });
    expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
  });
});

describe('making a schedule', () => {
  it('is for HR and People administrators', async () => {
    const { deps, make } = setup();
    await make();
    const refused = await createSchedule(deps, tx, asking(MANAGER), {
      name: 'Mine',
      audience: { filter: {} },
      report: { kind: 'summary' },
      cadence: { every: 'day', hour: 7 },
      legalEntityId: null,
      recipients: [MANAGER.accountId],
    });
    expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
  });

  it('refuses a recipient who does not sign in here', async () => {
    const { make } = setup();
    await expect(make({ recipients: [LEFT] })).rejects.toThrow(/does not sign in here/);
  });
});
