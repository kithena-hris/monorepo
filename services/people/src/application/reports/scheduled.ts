import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok, type Clock, type Result } from '@kithena/domain-kit';

import { entityZone } from '../../domain/org/calendar.js';
import {
  checkSchedule,
  duePeriod,
  latestPeriod,
  mayManage,
  type Schedule,
  type ScheduleInput,
} from '../../domain/report/schedule.js';
import { seenBy } from '../../domain/segment/segment.js';
import type { SegmentStore } from '../../infrastructure/drizzle-segments.js';
import type { ReminderCompany } from '../completeness/reminders.js';
import { runExportJob, type ExportJobDeps, type ExportNotifier } from '../export/job.js';
import type { Calendars } from '../org/org.js';
import type { Asking } from '../person/person-access.js';
import type { InTenant } from '../person/service.js';
import type { Viewer } from '../person/ports.js';
import type { RoleStore } from '../roles/roles.js';
import { NOBODY } from '../screens/record.js';
import { chartViewerOf, usableIn } from '../screens/segments.js';

/**
 * Scheduled reports (PEO-069, PRD §16.3): made by HR, run by the background
 * sweep, delivered through `platform/messaging` as a link — never the data.
 *
 * **Every run is authorized as each recipient, when it runs.** The file is
 * the export that recipient could have asked for themselves that morning —
 * their rows, their readable columns, the segment's filter checked against
 * what *they* may filter by — and a summary is only sent to somebody the
 * analytics screen would draw for. A recipient who has left, lost a role or
 * no longer has a work email gets nothing, and the run history says so.
 * Nothing is built as the owner and then handed to somebody else.
 *
 * **The email links to the tenant app, signed in.** A file waits on the
 * export page (`/people/export?export=…`), which hands the recipient — only
 * the recipient, `GET /v1/exports/{id}` checks — the signed 24-hour link; a
 * summary is the analytics screen. Two reasons over putting the signed link
 * in the email: a forwarded email opens nothing, and the backend sleeps when
 * idle, so a link to it would usually be dead by the time it was clicked,
 * where the tenant app wakes it (docs/environments.md, "While it is stopped").
 *
 * **Claimed, committed, then built and sent** — at most once per (schedule,
 * period), as reminders are. A crash mid-run leaves the run without an
 * outcome, and that period is not sent again: a report twice is worse than a
 * report missed and recorded as missed.
 *
 * **Asleep through the hour.** The sweep runs on every boot and hourly after,
 * and a schedule is due when a period has come that has not run — see
 * `duePeriod`. Only the latest is sent; the ones it covers are counted. So a
 * weekly report reaches its recipients the next time anybody wakes People,
 * not at 07:00 on Monday, and a tenant nobody opens for a month gets one
 * report when somebody does, not four.
 */

type Tx = PostgresJsDatabase;

export interface ReportRun {
  readonly period: string;
  readonly missed: number;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  /** Null while running, or after a crash mid-run. */
  readonly outcome: 'sent' | 'partial' | 'failed' | 'skipped' | null;
  readonly recipients: readonly RecipientOutcome[];
}

/** An outcome code, never a value, an address or a link. */
export interface RecipientOutcome {
  readonly accountId?: string;
  readonly outcome: string;
}

export interface ScheduleStore {
  all(tx: Tx, tenantId: string): Promise<readonly Schedule[]>;
  insert(tx: Tx, tenantId: string, schedule: Schedule): Promise<void>;
  setPaused(
    tx: Tx,
    tenantId: string,
    id: string,
    paused: boolean,
    lastPeriod: string,
  ): Promise<void>;
  remove(tx: Tx, tenantId: string, id: string): Promise<void>;
  /**
   * Record that `period` runs now and move the schedule's last period to it.
   * False when it was already claimed: a second replica, or a second sweep.
   */
  claim(
    tx: Tx,
    tenantId: string,
    id: string,
    period: string,
    missed: number,
    at: string,
  ): Promise<boolean>;
  finish(
    tx: Tx,
    tenantId: string,
    id: string,
    period: string,
    run: Pick<ReportRun, 'outcome' | 'recipients'> & { readonly at: string },
  ): Promise<void>;
  /** Newest first. */
  runs(tx: Tx, tenantId: string, id: string, limit: number): Promise<readonly ReportRun[]>;
}

/** Who a recipient is, and what they may do, as the rows hold it when the run starts. */
export type Accounts = Pick<RoleStore, 'candidates' | 'holdings'>;

export interface ReportMail {
  readonly email: string;
  readonly url: string;
  readonly cadence: 'daily' | 'weekly' | 'monthly';
  readonly format: 'xlsx' | 'pdf' | 'summary';
  /** The schedule, period and recipient: a retry of one is the same email. */
  readonly dedupeKey: string;
}

export interface ReportMailer {
  send(tenantId: string, company: ReminderCompany, mail: ReportMail): Promise<void>;
}

/** What HR's screens need to manage schedules. */
export interface ScheduleAdminDeps {
  readonly schedules: ScheduleStore;
  readonly segments: SegmentStore;
  readonly accounts: Accounts;
  readonly calendars: Calendars;
  readonly clock: Clock;
  readonly newId: () => string;
}

/** What the sweep needs besides. */
export interface ReportDeps extends ScheduleAdminDeps {
  readonly inTenant: InTenant;
  /** The export pipeline, as REST wires it; its notifier is not used. */
  readonly exports: ExportJobDeps;
  readonly company: (tx: Tx, tenantId: string) => Promise<ReminderCompany | null>;
  readonly mailer: ReportMailer;
}

const Forbidden = failure(
  'FORBIDDEN',
  'Only HR and People administrators manage scheduled reports',
);
const NoSuchSchedule = failure('NOT_FOUND', 'There is no such scheduled report');

/* ------------------------------------------------------------ managing -- */

export interface ScheduleView extends Schedule {
  readonly lastRun: ReportRun | null;
}

export async function listSchedules(
  deps: ScheduleAdminDeps,
  tx: Tx,
  asking: Asking,
): Promise<Result<readonly ScheduleView[]>> {
  if (!mayManage(asking.viewer.roles)) return err(Forbidden);
  const all = await deps.schedules.all(tx, asking.tenantId);
  const views = await Promise.all(
    all.map(async (s) => ({
      ...s,
      lastRun: (await deps.schedules.runs(tx, asking.tenantId, s.id, 1))[0] ?? null,
    })),
  );
  return ok(views.toSorted((a, b) => a.name.localeCompare(b.name)));
}

/**
 * A schedule, starting from the period current now: saving one never sends
 * it. Its segment must be one the owner sees, and each recipient somebody
 * who signs in here and has not left — whether they may read the report is
 * asked on every run, not here.
 */
export async function createSchedule(
  deps: ScheduleAdminDeps,
  tx: Tx,
  asking: Asking,
  input: ScheduleInput,
): Promise<Result<Schedule>> {
  if (!mayManage(asking.viewer.roles)) return err(Forbidden);
  const checked = checkSchedule(input);
  if (!checked.ok) return checked;
  const value = checked.value;

  if ('segmentId' in value.audience) {
    const id = value.audience.segmentId;
    const all = await deps.segments.all(tx, asking.tenantId);
    if (!all.some((s) => s.id === id && seenBy(s, asking.viewer.accountId))) {
      return err(failure('NOT_FOUND', 'There is no such segment', ['segmentId']));
    }
  }
  const known = new Set(
    (await deps.accounts.candidates(tx, asking.tenantId)).map((c) => c.accountId),
  );
  const unknown = value.recipients.filter((r) => !known.has(r));
  if (unknown.length > 0) {
    return err(
      failure(
        'RECIPIENT_UNKNOWN',
        'Somebody on the list does not sign in here, or has left',
        unknown,
      ),
    );
  }
  const calendar = await deps.calendars.load(tx, asking.tenantId);
  if (value.legalEntityId !== null && !calendar.entities.has(value.legalEntityId)) {
    return err(failure('NOT_FOUND', 'There is no such legal entity', ['legalEntityId']));
  }

  const schedule: Schedule = {
    ...value,
    id: deps.newId(),
    ownerAccountId: asking.viewer.accountId,
    paused: false,
    lastPeriod: latestPeriod(
      value.cadence,
      entityZone(calendar, value.legalEntityId),
      deps.clock.instant(),
    ),
  };
  await deps.schedules.insert(tx, asking.tenantId, schedule);
  return ok(schedule);
}

/**
 * Pause, or resume from the period current now — the periods it was paused
 * through are not sent on resuming, they were paused.
 */
export async function setPaused(
  deps: ScheduleAdminDeps,
  tx: Tx,
  asking: Asking,
  id: string,
  paused: boolean,
): Promise<Result<Schedule>> {
  const found = await findSchedule(deps, tx, asking, id);
  if (!found.ok) return found;
  const s = found.value;
  if (s.paused === paused) return ok(s);
  const calendar = await deps.calendars.load(tx, asking.tenantId);
  const lastPeriod = paused
    ? s.lastPeriod
    : latestPeriod(s.cadence, entityZone(calendar, s.legalEntityId), deps.clock.instant());
  await deps.schedules.setPaused(tx, asking.tenantId, id, paused, lastPeriod);
  return ok({ ...s, paused, lastPeriod });
}

/** Delete a schedule and its history. Any HR or People administrator: it is the tenant's. */
export async function deleteSchedule(
  deps: ScheduleAdminDeps,
  tx: Tx,
  asking: Asking,
  id: string,
): Promise<Result<void>> {
  const found = await findSchedule(deps, tx, asking, id);
  if (!found.ok) return found;
  await deps.schedules.remove(tx, asking.tenantId, id);
  return ok(undefined);
}

export async function scheduleRuns(
  deps: ScheduleAdminDeps,
  tx: Tx,
  asking: Asking,
  id: string,
): Promise<Result<readonly ReportRun[]>> {
  const found = await findSchedule(deps, tx, asking, id);
  if (!found.ok) return found;
  return ok(await deps.schedules.runs(tx, asking.tenantId, id, 50));
}

async function findSchedule(
  deps: ScheduleAdminDeps,
  tx: Tx,
  asking: Asking,
  id: string,
): Promise<Result<Schedule>> {
  if (!mayManage(asking.viewer.roles)) return err(Forbidden);
  const found = (await deps.schedules.all(tx, asking.tenantId)).find((s) => s.id === id);
  return found === undefined ? err(NoSuchSchedule) : ok(found);
}

/* ------------------------------------------------------------- sending -- */

export interface SweepResult {
  readonly runs: number;
  /** True when the company is not known yet, so nothing was claimed. */
  readonly waiting: boolean;
}

const CADENCE = { day: 'daily', week: 'weekly', month: 'monthly' } as const;

/** The file is built by the pipeline and announced here, after the commit. */
const SILENT: ExportNotifier = { notify: () => Promise.resolve() };

export function sendDueReports(deps: ReportDeps) {
  return async (tenantId: string): Promise<SweepResult> => {
    const at = deps.clock.instant();
    const claimed = await deps.inTenant(tenantId, async ({ tx }) => {
      const company = await deps.company(tx, tenantId);
      if (company === null) return null;
      const calendar = await deps.calendars.load(tx, tenantId);
      const jobs: { schedule: Schedule; period: string }[] = [];
      for (const schedule of await deps.schedules.all(tx, tenantId)) {
        const due = duePeriod(schedule, entityZone(calendar, schedule.legalEntityId), at);
        if (due === null) continue;
        // eslint-disable-next-line no-await-in-loop -- one claim per schedule, in this transaction
        if (await deps.schedules.claim(tx, tenantId, schedule.id, due.period, due.missed, at)) {
          jobs.push({ schedule, period: due.period });
        }
      }
      return { company, jobs };
    });
    if (claimed === null) return { runs: 0, waiting: true };

    for (const job of claimed.jobs) {
      // eslint-disable-next-line no-await-in-loop -- one schedule at a time is the bound
      const { outcome, recipients } = await runOne(
        deps,
        tenantId,
        claimed.company,
        job.schedule,
        job.period,
      );
      // eslint-disable-next-line no-await-in-loop
      await deps.inTenant(tenantId, ({ tx }) =>
        deps.schedules.finish(tx, tenantId, job.schedule.id, job.period, {
          outcome,
          recipients,
          at: deps.clock.instant(),
        }),
      );
    }
    return { runs: claimed.jobs.length, waiting: false };
  };
}

interface Prepared {
  readonly where: Readonly<Record<string, string>>;
  /** How the audience is described on the file's provenance sheet. */
  readonly label: string | undefined;
  readonly segmentId: string | null;
  readonly holdings: ReadonlyMap<string, ReadonlySet<string>>;
  readonly people: ReadonlyMap<string, { personId: string; workEmail: string | null }>;
}

async function runOne(
  deps: ReportDeps,
  tenantId: string,
  company: ReminderCompany,
  schedule: Schedule,
  period: string,
): Promise<Pick<ReportRun, 'recipients'> & { outcome: NonNullable<ReportRun['outcome']> }> {
  const prepared = await deps.inTenant(tenantId, async ({ tx }): Promise<Result<Prepared>> => {
    const holdings = await deps.accounts.holdings(tx, tenantId);
    // The owner's say-so lapses with their role: nobody keeps sending HR's
    // reports after they stop being HR.
    if (!mayManage(holdings.get(schedule.ownerAccountId) ?? new Set())) {
      return err(failure('owner_not_allowed', 'The owner no longer manages People'));
    }
    let where: Readonly<Record<string, string>> = {};
    let label: string | undefined;
    let segmentId: string | null = null;
    if ('segmentId' in schedule.audience) {
      const id = schedule.audience.segmentId;
      const segment = (await deps.segments.all(tx, tenantId)).find(
        (s) => s.id === id && seenBy(s, schedule.ownerAccountId),
      );
      if (segment === undefined) return err(failure('segment_gone', 'The segment is gone'));
      where = segment.filter;
      label = segment.name;
      segmentId = id;
    } else {
      where = schedule.audience.filter;
      const pairs = Object.entries(where).map(([k, v]) => `${k}:${v}`);
      label = pairs.length === 0 ? undefined : pairs.join(',');
    }
    const people = new Map(
      (await deps.accounts.candidates(tx, tenantId)).map((c) => [
        c.accountId,
        { personId: c.personId, workEmail: c.workEmail },
      ]),
    );
    return ok({ where, label, segmentId, holdings, people });
  });
  if (!prepared.ok) return { outcome: 'skipped', recipients: [{ outcome: prepared.error.code }] };
  const p = prepared.value;

  const outcomes: RecipientOutcome[] = [];
  for (const accountId of schedule.recipients) {
    const person = p.people.get(accountId);
    if (person?.workEmail == null) {
      outcomes.push({ accountId, outcome: 'not_eligible' });
      continue;
    }
    const viewer: Viewer = { accountId, roles: new Set(p.holdings.get(accountId) ?? []) };
    try {
      // eslint-disable-next-line no-await-in-loop -- one recipient's file at a time
      const link = await deps.inTenant(tenantId, ({ tx }) =>
        linkFor(deps, tx, {
          tenantId,
          company,
          schedule,
          period,
          viewer,
          personId: person.personId,
          prepared: p,
        }),
      );
      if (!link.ok) {
        outcomes.push({ accountId, outcome: link.error.code });
        continue;
      }
      // After the commit: a rolled-back file is never announced.
      // eslint-disable-next-line no-await-in-loop
      await deps.mailer.send(tenantId, company, {
        email: person.workEmail,
        url: link.value,
        cadence: CADENCE[schedule.cadence.every],
        format: schedule.report.kind === 'export' ? schedule.report.format : 'summary',
        dedupeKey: `${schedule.id}/${period}/${accountId}`,
      });
      outcomes.push({ accountId, outcome: 'sent' });
    } catch {
      outcomes.push({ accountId, outcome: 'failed' });
    }
  }
  const sent = outcomes.filter((o) => o.outcome === 'sent').length;
  return {
    outcome: sent === outcomes.length ? 'sent' : sent === 0 ? 'failed' : 'partial',
    recipients: outcomes,
  };
}

/** The recipient's own report, built or checked as them, and where it waits. */
async function linkFor(
  deps: ReportDeps,
  tx: Tx,
  run: {
    readonly tenantId: string;
    readonly company: ReminderCompany;
    readonly schedule: Schedule;
    readonly period: string;
    readonly viewer: Viewer;
    readonly personId: string;
    readonly prepared: Prepared;
  },
): Promise<Result<string>> {
  const { tenantId, schedule, viewer, prepared } = run;
  const report = schedule.report;
  const asking: Asking = { tenantId, viewer, correlationId: deps.newId() };

  if (report.kind === 'export') {
    const built = await runExportJob(
      tx,
      { ...deps.exports, notifier: SILENT },
      {
        ...asking,
        format: report.format,
        ...(report.fields === null ? {} : { fields: report.fields }),
        ...(Object.keys(prepared.where).length === 0 ? {} : { where: prepared.where }),
        ...(prepared.label === undefined ? {} : { filter: prepared.label }),
        ...(report.reason === null ? {} : { reason: report.reason }),
        actor: { kind: 'system', process: 'people.scheduled-report' },
      },
    );
    if (!built.ok) return built;
    const url = new URL('/people/export', run.company.origin);
    url.searchParams.set('export', built.value.exportId);
    return ok(url.toString());
  }

  // A summary is the analytics screen: sent only to somebody it would draw
  // for, under a segment only when they could chart by it.
  const everyone = await deps.exports.relations.relations(tx, tenantId, viewer, NOBODY);
  const chart = await chartViewerOf(
    { personOf: () => Promise.resolve(run.personId) },
    tx,
    asking,
    everyone,
  );
  if (chart === null) return err(failure('NOT_A_VIEWER', 'Nothing to chart for this person'));
  const url = new URL('/people/analytics', run.company.origin);
  if (prepared.segmentId !== null) {
    const version = await deps.exports.schemas.current(tx, tenantId);
    const definitions = version?.document.attributes.filter((d) => d.deprecatedAt === null) ?? [];
    if (!usableIn(prepared.where, definitions, everyone, chart).analytics) {
      return err(failure('FIELD_NOT_FILTERABLE', 'They cannot chart by this segment'));
    }
    url.searchParams.set('segment', prepared.segmentId);
  }
  return ok(url.toString());
}
