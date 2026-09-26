import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { mayManage, type Schedule } from '../../domain/report/schedule.js';
import type { Asking } from '../person/person-access.js';
import { run } from '../person/service.js';
import {
  listSchedules,
  scheduleRuns,
  type ReportRun,
  type ScheduleAdminDeps,
} from '../reports/scheduled.js';
import { exportBuilderView } from './operations.js';
import type { ScreenDeps } from './record.js';
import { segmentsFor } from './segments.js';

/**
 * The scheduled reports screen (PEO-069): HR's schedules, each with its last
 * run, and what the form may offer — the viewer's own segments and fields,
 * everybody who signs in, and the legal entities whose clock a schedule can
 * keep.
 *
 * The fields offered are the ones the viewer may export. A recipient may
 * read fewer, and then gets fewer: every run is built as each recipient
 * (`reports/scheduled.ts`). The screen says so before anything is saved.
 */

export type ReportScreenDeps = ScreenDeps & { readonly schedules?: ScheduleAdminDeps };

export interface ScheduleRow {
  readonly id: string;
  readonly name: string;
  readonly ownerName: string | null;
  readonly paused: boolean;
  readonly segmentId: string | null;
  readonly segmentName: string | null;
  readonly filter: readonly { readonly key: string; readonly value: string }[];
  readonly kind: 'export' | 'summary';
  readonly format: 'xlsx' | 'pdf' | null;
  readonly fields: readonly string[] | null;
  readonly reason: string | null;
  readonly every: 'day' | 'week' | 'month';
  readonly weekday: number | null;
  readonly day: number | null;
  readonly hour: number;
  readonly legalEntityId: string | null;
  readonly recipients: readonly { readonly accountId: string; readonly name: string | null }[];
  readonly lastRun: Omit<ReportRun, 'recipients'> | null;
}

export interface ReportSchedulesView {
  /** False for anybody but HR and People administrators, who then see nothing else. */
  readonly canManage: boolean;
  readonly schedules: readonly ScheduleRow[];
  readonly segments: readonly {
    readonly id: string;
    readonly name: string;
    /** Usable to filter an export file; a summary needs `forSummary`. */
    readonly forExport: boolean;
    readonly forSummary: boolean;
  }[];
  readonly people: readonly {
    readonly accountId: string;
    readonly name: string | null;
    readonly workEmail: string | null;
  }[];
  readonly legalEntities: readonly { readonly id: string; readonly name: string }[];
  readonly fields: readonly {
    readonly key: string;
    readonly label: string;
    readonly section: string;
  }[];
}

export interface ReportRunsView {
  readonly id: string;
  readonly name: string;
  readonly runs: readonly (Omit<ReportRun, 'recipients'> & {
    readonly recipients: readonly {
      readonly accountId: string | null;
      readonly name: string | null;
      readonly outcome: string;
    }[];
  })[];
}

const unavailable = () => failure('UNAVAILABLE', 'Scheduled reports are not configured');

const NONE: Omit<ReportSchedulesView, 'canManage'> = {
  schedules: [],
  segments: [],
  people: [],
  legalEntities: [],
  fields: [],
};

function rowOf(
  s: Schedule & { readonly lastRun: ReportRun | null },
  names: ReadonlyMap<string, string | null>,
  segmentNames: ReadonlyMap<string, string>,
): ScheduleRow {
  const segmentId = 'segmentId' in s.audience ? s.audience.segmentId : null;
  const c = s.cadence;
  const lastRun =
    s.lastRun === null ? null : (({ recipients: _recipients, ...rest }) => rest)(s.lastRun);
  return {
    id: s.id,
    name: s.name,
    ownerName: names.get(s.ownerAccountId) ?? null,
    paused: s.paused,
    segmentId,
    segmentName: segmentId === null ? null : (segmentNames.get(segmentId) ?? null),
    filter:
      'filter' in s.audience
        ? Object.entries(s.audience.filter).map(([key, value]) => ({ key, value }))
        : [],
    kind: s.report.kind,
    format: s.report.kind === 'export' ? s.report.format : null,
    fields: s.report.kind === 'export' ? s.report.fields : null,
    reason: s.report.kind === 'export' ? s.report.reason : null,
    every: c.every,
    weekday: c.every === 'week' ? c.weekday : null,
    day: c.every === 'month' ? c.day : null,
    hour: c.hour,
    legalEntityId: s.legalEntityId,
    recipients: s.recipients.map((accountId) => ({
      accountId,
      name: names.get(accountId) ?? null,
    })),
    lastRun,
  };
}

export async function reportSchedulesView(
  deps: ReportScreenDeps,
  asking: Asking,
): Promise<Result<ReportSchedulesView>> {
  const admin = deps.schedules;
  if (admin === undefined) return err(unavailable());
  if (!mayManage(asking.viewer.roles)) return ok({ canManage: false, ...NONE });

  const builder = await exportBuilderView(deps, asking);
  const fields = builder.ok
    ? builder.value.sections.flatMap((s) =>
        s.fields.map((f) => ({ key: f.key, label: f.label, section: s.label })),
      )
    : [];

  return run(deps.service, asking.tenantId, async (tx) => {
    const listed = await listSchedules(admin, tx, asking);
    if (!listed.ok) return listed;
    const candidates = await admin.accounts.candidates(tx, asking.tenantId);
    const names = new Map(candidates.map((c) => [c.accountId, c.name ?? c.workEmail]));
    const segments = await segmentsFor(deps, tx, asking);
    const segmentNames = new Map(segments.map((s) => [s.id, s.name]));
    const calendar = await admin.calendars.load(tx, asking.tenantId);
    return ok({
      canManage: true,
      schedules: listed.value.map((s) => rowOf(s, names, segmentNames)),
      segments: segments.map((s) => ({
        id: s.id,
        name: s.name,
        forExport: s.usableIn.directory,
        forSummary: s.usableIn.analytics,
      })),
      people: candidates.map((c) => ({
        accountId: c.accountId,
        name: c.name,
        workEmail: c.workEmail,
      })),
      legalEntities: [...calendar.entities.values()]
        .filter((e) => e.archived !== true)
        .map((e) => ({ id: e.id, name: e.name })),
      fields,
    });
  });
}

/** One schedule's history, newest first, with each recipient named where they still can be. */
export async function reportRunsView(
  deps: ReportScreenDeps,
  asking: Asking,
  id: string,
): Promise<Result<ReportRunsView>> {
  const admin = deps.schedules;
  if (admin === undefined) return err(unavailable());
  return run(deps.service, asking.tenantId, async (tx) => {
    const runs = await scheduleRuns(admin, tx, asking, id);
    if (!runs.ok) return runs;
    const schedule = (await admin.schedules.all(tx, asking.tenantId)).find((s) => s.id === id);
    const names = new Map(
      (await admin.accounts.candidates(tx, asking.tenantId)).map((c) => [
        c.accountId,
        c.name ?? c.workEmail,
      ]),
    );
    return ok({
      id,
      name: schedule?.name ?? '',
      runs: runs.value.map((r) => ({
        ...r,
        recipients: r.recipients.map((o) => ({
          accountId: o.accountId ?? null,
          name: o.accountId === undefined ? null : (names.get(o.accountId) ?? null),
          outcome: o.outcome,
        })),
      })),
    });
  });
}
