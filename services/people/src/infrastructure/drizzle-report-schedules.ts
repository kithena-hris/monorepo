import { sql } from 'drizzle-orm';

import type { Cadence, Schedule } from '../domain/report/schedule.js';
import type { ReportRun, ScheduleStore } from '../application/reports/scheduled.js';

/**
 * `people.report_schedule` and `people.report_run` (PEO-069), hand-written
 * against `migrations/20260926170000_people_report_schedule.sql`.
 */

type ScheduleRow = {
  id: string;
  name: string;
  owner_account_id: string;
  segment_id: string | null;
  filter: Record<string, string>;
  kind: 'export' | 'summary';
  format: 'xlsx' | 'pdf' | null;
  fields: string[] | null;
  reason: string | null;
  every: Cadence['every'];
  weekday: number | null;
  day_of_month: number | null;
  hour: number;
  legal_entity_id: string | null;
  recipients: string[];
  paused: boolean;
  last_period: string | Date;
};

type RunRow = {
  period: string | Date;
  missed: number;
  started_at: string | Date;
  finished_at: string | Date | null;
  outcome: ReportRun['outcome'];
  recipients: ReportRun['recipients'];
};

const date = (d: string | Date) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10);
const instant = (d: string | Date) => new Date(d).toISOString();

function cadenceOf(r: ScheduleRow): Cadence {
  if (r.every === 'week') return { every: 'week', weekday: r.weekday ?? 1, hour: r.hour };
  if (r.every === 'month') return { every: 'month', day: r.day_of_month ?? 1, hour: r.hour };
  return { every: 'day', hour: r.hour };
}

function toSchedule(r: ScheduleRow): Schedule {
  return {
    id: r.id,
    name: r.name,
    ownerAccountId: r.owner_account_id,
    audience: r.segment_id === null ? { filter: r.filter } : { segmentId: r.segment_id },
    report:
      r.kind === 'export'
        ? { kind: 'export', format: r.format ?? 'xlsx', fields: r.fields, reason: r.reason }
        : { kind: 'summary' },
    cadence: cadenceOf(r),
    legalEntityId: r.legal_entity_id,
    recipients: r.recipients,
    paused: r.paused,
    lastPeriod: date(r.last_period),
  };
}

const textArray = (values: readonly string[]) =>
  sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(values)}::jsonb))`;

export function drizzleReportSchedules(): ScheduleStore {
  return {
    async all(tx, tenantId) {
      const rows = await tx.execute<ScheduleRow>(sql`
        SELECT id::text, name, owner_account_id::text, segment_id::text, filter, kind, format,
               fields, reason, every, weekday, day_of_month, hour, legal_entity_id::text,
               recipients::text[] AS recipients, paused, last_period::text
          FROM people.report_schedule WHERE tenant_id = ${tenantId}::uuid`);
      return [...rows].map(toSchedule);
    },

    async insert(tx, tenantId, s) {
      const report = s.report;
      const c = s.cadence;
      await tx.execute(sql`
        INSERT INTO people.report_schedule
               (tenant_id, id, name, owner_account_id, segment_id, filter, kind, format, fields,
                reason, every, weekday, day_of_month, hour, legal_entity_id, recipients, last_period)
        VALUES (${tenantId}::uuid, ${s.id}::uuid, ${s.name}, ${s.ownerAccountId}::uuid,
                ${'segmentId' in s.audience ? s.audience.segmentId : null}::uuid,
                ${JSON.stringify('filter' in s.audience ? s.audience.filter : {})}::jsonb,
                ${report.kind}, ${report.kind === 'export' ? report.format : null},
                ${report.kind === 'export' && report.fields !== null ? textArray(report.fields) : null},
                ${report.kind === 'export' ? report.reason : null},
                ${c.every}, ${c.every === 'week' ? c.weekday : null},
                ${c.every === 'month' ? c.day : null}, ${c.hour},
                ${s.legalEntityId}::uuid,
                ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(s.recipients)}::jsonb)::uuid),
                ${s.lastPeriod}::date)`);
    },

    async update(tx, tenantId, s) {
      const report = s.report;
      const c = s.cadence;
      await tx.execute(sql`
        UPDATE people.report_schedule
           SET name = ${s.name}, owner_account_id = ${s.ownerAccountId}::uuid,
               segment_id = ${'segmentId' in s.audience ? s.audience.segmentId : null}::uuid,
               filter = ${JSON.stringify('filter' in s.audience ? s.audience.filter : {})}::jsonb,
               kind = ${report.kind}, format = ${report.kind === 'export' ? report.format : null},
               fields = ${report.kind === 'export' && report.fields !== null ? textArray(report.fields) : null},
               reason = ${report.kind === 'export' ? report.reason : null},
               every = ${c.every}, weekday = ${c.every === 'week' ? c.weekday : null},
               day_of_month = ${c.every === 'month' ? c.day : null}, hour = ${c.hour},
               legal_entity_id = ${s.legalEntityId}::uuid,
               recipients = ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(s.recipients)}::jsonb)::uuid),
               paused = ${s.paused}, last_period = ${s.lastPeriod}::date
         WHERE tenant_id = ${tenantId}::uuid AND id = ${s.id}::uuid`);
    },

    async setPaused(tx, tenantId, id, paused, lastPeriod) {
      await tx.execute(sql`
        UPDATE people.report_schedule SET paused = ${paused}, last_period = ${lastPeriod}::date
         WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
    },

    async remove(tx, tenantId, id) {
      await tx.execute(sql`
        DELETE FROM people.report_schedule WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
    },

    async claim(tx, tenantId, id, period, missed, at) {
      // The run's key is the claim; the schedule moves only for the claimer.
      const rows = await tx.execute(sql`
        WITH run AS (
          INSERT INTO people.report_run (tenant_id, schedule_id, period, missed, started_at)
          VALUES (${tenantId}::uuid, ${id}::uuid, ${period}::date, ${missed}, ${at}::timestamptz)
          ON CONFLICT DO NOTHING
          RETURNING schedule_id
        )
        UPDATE people.report_schedule s SET last_period = GREATEST(s.last_period, ${period}::date)
          FROM run
         WHERE s.tenant_id = ${tenantId}::uuid AND s.id = run.schedule_id
        RETURNING s.id`);
      return [...rows].length > 0;
    },

    async finish(tx, tenantId, id, period, run) {
      await tx.execute(sql`
        UPDATE people.report_run
           SET outcome = ${run.outcome}, recipients = ${JSON.stringify(run.recipients)}::jsonb,
               finished_at = ${run.at}::timestamptz
         WHERE tenant_id = ${tenantId}::uuid AND schedule_id = ${id}::uuid
           AND period = ${period}::date`);
    },

    async runs(tx, tenantId, id, limit) {
      const rows = await tx.execute<RunRow>(sql`
        SELECT period::text, missed, started_at, finished_at, outcome, recipients
          FROM people.report_run
         WHERE tenant_id = ${tenantId}::uuid AND schedule_id = ${id}::uuid
         ORDER BY period DESC LIMIT ${limit}`);
      return [...rows].map((r) => ({
        period: date(r.period),
        missed: r.missed,
        startedAt: instant(r.started_at),
        finishedAt: r.finished_at === null ? null : instant(r.finished_at),
        outcome: r.outcome,
        recipients: r.recipients,
      }));
    },
  };
}

/** The same, in memory, for tests. */
export function inMemoryReportSchedules(): ScheduleStore & {
  readonly held: Map<string, Schedule>;
  readonly history: Map<string, ReportRun>;
} {
  const held = new Map<string, Schedule>();
  const history = new Map<string, ReportRun>();
  const key = (id: string, period: string) => `${id}/${period}`;
  return {
    held,
    history,
    all: () => Promise.resolve([...held.values()]),
    insert(_tx, _tenantId, s) {
      held.set(s.id, s);
      return Promise.resolve();
    },
    update(_tx, _tenantId, s) {
      if (held.has(s.id)) held.set(s.id, s);
      return Promise.resolve();
    },
    setPaused(_tx, _tenantId, id, paused, lastPeriod) {
      const s = held.get(id);
      if (s) held.set(id, { ...s, paused, lastPeriod });
      return Promise.resolve();
    },
    remove(_tx, _tenantId, id) {
      held.delete(id);
      for (const k of history.keys()) if (k.startsWith(`${id}/`)) history.delete(k);
      return Promise.resolve();
    },
    claim(_tx, _tenantId, id, period, missed, at) {
      const s = held.get(id);
      if (!s || history.has(key(id, period)) || s.lastPeriod >= period) {
        return Promise.resolve(false);
      }
      history.set(key(id, period), {
        period,
        missed,
        startedAt: at,
        finishedAt: null,
        outcome: null,
        recipients: [],
      });
      held.set(id, { ...s, lastPeriod: period });
      return Promise.resolve(true);
    },
    finish(_tx, _tenantId, id, period, run) {
      const r = history.get(key(id, period));
      if (r) {
        history.set(key(id, period), {
          ...r,
          outcome: run.outcome,
          recipients: run.recipients,
          finishedAt: run.at,
        });
      }
      return Promise.resolve();
    },
    runs: (_tx, _tenantId, id, limit) =>
      Promise.resolve(
        [...history.entries()]
          .filter(([k]) => k.startsWith(`${id}/`))
          .map(([, r]) => r)
          .toSorted((a, b) => b.period.localeCompare(a.period))
          .slice(0, limit),
      ),
  };
}
