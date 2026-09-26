import type {
  ReportRunsView,
  ReportSchedulesView,
  ScheduleRow,
} from '../application/screens/reports.js';
import type { PeopleBuilder, ViaRest } from './builder.js';

/**
 * Scheduled reports over GraphQL (PEO-069): the screen's reads and its five
 * writes, each one REST call through `viaRest`, so every rule is REST's —
 * who may manage, what a schedule may hold, and that each run is built as
 * each recipient.
 */

const list = <T>(items: readonly T[]): T[] => [...items];

type Run = ReportRunsView['runs'][number];

export function defineReports(builder: PeopleBuilder, viaRest: ViaRest): void {
  const Kind = builder.enumType('ReportKind', { values: ['export', 'summary'] as const });
  const Format = builder.enumType('ReportFormat', { values: ['xlsx', 'pdf'] as const });
  const Every = builder.enumType('ReportEvery', { values: ['day', 'week', 'month'] as const });

  const Condition = builder
    .objectRef<ScheduleRow['filter'][number]>('ReportScheduleCondition')
    .implement({
      fields: (t) => ({ key: t.exposeString('key'), value: t.exposeString('value') }),
    });
  const Recipient = builder
    .objectRef<ScheduleRow['recipients'][number]>('ReportScheduleRecipient')
    .implement({
      fields: (t) => ({
        accountId: t.exposeID('accountId'),
        name: t.exposeString('name', { nullable: true }),
      }),
    });
  const LastRun = builder
    .objectRef<NonNullable<ScheduleRow['lastRun']>>('ReportScheduleLastRun')
    .implement({
      fields: (t) => ({
        period: t.exposeString('period'),
        missed: t.exposeInt('missed'),
        startedAt: t.exposeString('startedAt'),
        finishedAt: t.exposeString('finishedAt', { nullable: true }),
        outcome: t.exposeString('outcome', {
          nullable: true,
          description: 'sent, partial, failed or skipped; null while running or after a crash',
        }),
      }),
    });
  const Row = builder.objectRef<ScheduleRow>('ReportSchedule').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      ownerName: t.exposeString('ownerName', { nullable: true }),
      paused: t.exposeBoolean('paused'),
      segmentId: t.exposeID('segmentId', { nullable: true }),
      segmentName: t.exposeString('segmentName', { nullable: true }),
      filter: t.field({ type: [Condition], resolve: (r) => list(r.filter) }),
      kind: t.field({ type: Kind, resolve: (r) => r.kind }),
      format: t.field({ type: Format, nullable: true, resolve: (r) => r.format }),
      fields: t.stringList({ nullable: true, resolve: (r) => (r.fields ? list(r.fields) : null) }),
      reason: t.exposeString('reason', { nullable: true }),
      every: t.field({ type: Every, resolve: (r) => r.every }),
      weekday: t.exposeInt('weekday', { nullable: true }),
      day: t.exposeInt('day', { nullable: true }),
      hour: t.exposeInt('hour'),
      legalEntityId: t.exposeID('legalEntityId', { nullable: true }),
      recipients: t.field({ type: [Recipient], resolve: (r) => list(r.recipients) }),
      lastRun: t.field({ type: LastRun, nullable: true, resolve: (r) => r.lastRun }),
    }),
  });

  type View = ReportSchedulesView;
  const SegmentChoice = builder
    .objectRef<View['segments'][number]>('ReportSegmentChoice')
    .implement({
      fields: (t) => ({
        id: t.exposeID('id'),
        name: t.exposeString('name'),
        forExport: t.exposeBoolean('forExport'),
        forSummary: t.exposeBoolean('forSummary'),
      }),
    });
  const PersonChoice = builder.objectRef<View['people'][number]>('ReportPersonChoice').implement({
    fields: (t) => ({
      accountId: t.exposeID('accountId'),
      name: t.exposeString('name', { nullable: true }),
      workEmail: t.exposeString('workEmail', { nullable: true }),
    }),
  });
  const EntityChoice = builder
    .objectRef<View['legalEntities'][number]>('ReportLegalEntityChoice')
    .implement({ fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name') }) });
  const FieldChoice = builder.objectRef<View['fields'][number]>('ReportFieldChoice').implement({
    fields: (t) => ({
      key: t.exposeString('key'),
      label: t.exposeString('label'),
      section: t.exposeString('section'),
    }),
  });
  const Schedules = builder.objectRef<View>('PeopleReportSchedules').implement({
    fields: (t) => ({
      canManage: t.exposeBoolean('canManage'),
      schedules: t.field({ type: [Row], resolve: (v) => list(v.schedules) }),
      segments: t.field({ type: [SegmentChoice], resolve: (v) => list(v.segments) }),
      people: t.field({ type: [PersonChoice], resolve: (v) => list(v.people) }),
      legalEntities: t.field({ type: [EntityChoice], resolve: (v) => list(v.legalEntities) }),
      fields: t.field({
        type: [FieldChoice],
        description: 'What the viewer may export; a recipient who reads fewer gets fewer.',
        resolve: (v) => list(v.fields),
      }),
    }),
  });

  const RunRecipient = builder
    .objectRef<Run['recipients'][number]>('ReportRunRecipient')
    .implement({
      fields: (t) => ({
        accountId: t.exposeID('accountId', { nullable: true }),
        name: t.exposeString('name', { nullable: true }),
        outcome: t.exposeString('outcome', {
          description: 'sent, failed, not_eligible, or why it was refused or skipped',
        }),
      }),
    });
  const RunRef = builder.objectRef<Run>('ReportRun').implement({
    fields: (t) => ({
      period: t.exposeString('period'),
      missed: t.exposeInt('missed'),
      startedAt: t.exposeString('startedAt'),
      finishedAt: t.exposeString('finishedAt', { nullable: true }),
      outcome: t.exposeString('outcome', { nullable: true }),
      recipients: t.field({ type: [RunRecipient], resolve: (r) => list(r.recipients) }),
    }),
  });
  const Runs = builder.objectRef<ReportRunsView>('PeopleReportRuns').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      runs: t.field({ type: [RunRef], resolve: (v) => list(v.runs) }),
    }),
  });

  builder.queryFields((t) => ({
    peopleReportSchedules: t.field({
      type: Schedules,
      description: 'Scheduled reports and what their form may offer; HR and people_admin.',
      resolve: (_root, _args, ctx) => viaRest<View>(ctx, 'GET', '/v1/views/report-schedules'),
    }),
    peopleReportRuns: t.field({
      type: Runs,
      description: 'One scheduled report’s last 50 runs, newest first.',
      args: { id: t.arg.id({ required: true }) },
      resolve: (_root, args, ctx) =>
        viaRest<ReportRunsView>(
          ctx,
          'GET',
          `/v1/views/report-schedules/${encodeURIComponent(args.id)}`,
        ),
    }),
  }));

  const Saved = builder.objectRef<{ id: string }>('ReportScheduleSaved').implement({
    fields: (t) => ({ id: t.exposeID('id') }),
  });
  const Condit = builder.inputType('ReportConditionInput', {
    fields: (t) => ({
      key: t.string({ required: true }),
      value: t.string({ required: true }),
    }),
  });
  const scheduleArgs = (t: Parameters<Parameters<typeof builder.mutationFields>[0]>[0]) => ({
    name: t.arg.string({ required: true }),
    segmentId: t.arg.id({
      description: 'Or filter; neither is everybody each recipient may list.',
    }),
    filter: t.arg({ type: [Condit] }),
    kind: t.arg({ type: Kind, required: true }),
    format: t.arg({ type: Format }),
    fields: t.arg.stringList({ description: 'Absent is every field each recipient may read.' }),
    reason: t.arg.string(),
    every: t.arg({ type: Every, required: true }),
    weekday: t.arg.int({ description: 'With week: 1 is Monday.' }),
    day: t.arg.int({ description: 'With month: 1 to 28.' }),
    hour: t.arg.int({ required: true }),
    legalEntityId: t.arg.id(),
    recipients: t.arg.idList({ required: true }),
    idempotencyKey: t.arg.string({ required: true }),
  });
  type Args = {
    name: string;
    segmentId?: string | null | undefined;
    filter?: readonly { key: string; value: string }[] | null | undefined;
    kind: 'export' | 'summary';
    format?: 'xlsx' | 'pdf' | null | undefined;
    fields?: readonly string[] | null | undefined;
    reason?: string | null | undefined;
    every: 'day' | 'week' | 'month';
    weekday?: number | null | undefined;
    day?: number | null | undefined;
    hour: number;
    legalEntityId?: string | null | undefined;
    recipients: readonly (string | number)[];
  };
  /** The flat arguments as REST's `ScheduleBody`; REST refuses what does not fit. */
  const body = (a: Args) => ({
    name: a.name,
    audience:
      a.segmentId != null
        ? { segmentId: a.segmentId }
        : { filter: Object.fromEntries((a.filter ?? []).map((c) => [c.key, c.value])) },
    report:
      a.kind === 'summary'
        ? { kind: 'summary' }
        : {
            kind: 'export',
            format: a.format ?? 'xlsx',
            fields: a.fields ?? null,
            reason: a.reason ?? null,
          },
    cadence:
      a.every === 'week'
        ? { every: 'week', weekday: a.weekday ?? 1, hour: a.hour }
        : a.every === 'month'
          ? { every: 'month', day: a.day ?? 1, hour: a.hour }
          : { every: 'day', hour: a.hour },
    legalEntityId: a.legalEntityId ?? null,
    recipients: a.recipients.map(String),
  });
  const at = (id: string, action = '') => `/v1/report-schedules/${encodeURIComponent(id)}${action}`;

  builder.mutationFields((t) => ({
    createReportSchedule: t.field({
      type: Saved,
      description:
        'Schedule a report. Each run is built as each recipient, so each gets only what they may see.',
      args: scheduleArgs(t),
      resolve: async (_root, { idempotencyKey, ...args }, ctx) => {
        const made = await viaRest<{ id: string }>(ctx, 'POST', '/v1/report-schedules', {
          body: body(args),
          key: idempotencyKey,
        });
        return { id: made.id };
      },
    }),
    updateReportSchedule: t.field({
      type: Saved,
      description: 'Change a scheduled report; whoever saves it owns it.',
      args: { id: t.arg.id({ required: true }), ...scheduleArgs(t) },
      resolve: async (_root, { idempotencyKey, id, ...args }, ctx) => {
        await viaRest(ctx, 'PUT', at(id), { body: body(args), key: idempotencyKey });
        return { id };
      },
    }),
    ...Object.fromEntries(
      (['pause', 'resume', 'delete'] as const).map((action) => [
        `${action}ReportSchedule`,
        t.field({
          type: Saved,
          args: {
            id: t.arg.id({ required: true }),
            idempotencyKey: t.arg.string({ required: true }),
          },
          resolve: async (_root, args, ctx) => {
            await viaRest(
              ctx,
              action === 'delete' ? 'DELETE' : 'POST',
              at(args.id, action === 'delete' ? '' : `/${action}`),
              { ...(action === 'delete' ? {} : { body: {} }), key: args.idempotencyKey },
            );
            return { id: args.id };
          },
        }),
      ]),
    ),
  }));
}
