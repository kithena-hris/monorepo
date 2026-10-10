import { createHash } from 'node:crypto';
import * as z from 'zod';
import { err, failure, ok, type DomainFailure, type Result } from '@kithena/domain-kit';
import {
  AttendanceWorkModel,
  CalendarDate,
  ClockState,
  DateSpan,
  DayAmount,
  InboxAnswer,
  Instant,
  LeaveRequestInput,
  LeaveTypeDefinition,
  LeaveTypeKey,
  LocationKey,
  NegativeBalanceRule,
  PersonId,
  PolicyDefinition,
  PunchInput,
  PunchKind,
  RequestStatus,
  TeamKey,
} from '@kithena/contracts';

import {
  changeLeaveType,
  defineLeaveType,
  draftPolicy,
  publishPolicy,
  revisePolicy,
  setNegativeBalanceRule,
  saveHolidayCalendar,
  removeHolidayCalendar,
  assignHolidayCalendars,
  setApprovalRules,
  setTeamMinimum,
  setAttendanceRules,
  assignSchedule,
  setParentalCompany,
  startShadowRun,
  stopShadowRun,
} from '../application/admin/admin.js';
import {
  answerCounter,
  batchApprove,
  counterPropose,
  decideRequest,
} from '../application/approval/decide.js';
import {
  adjustBalance,
  balanceAdjustments,
  decideBalanceAdjustment,
  type AdjustmentView,
} from '../application/admin/adjustments.js';
import { setDelegation } from '../application/approval/escalation.js';
import { timeOffInbox } from '../application/screens/inbox.js';
import { setChatAnswers } from '../application/settings/chat.js';
import { describeRequest } from '../application/assist/describe.js';
import { holidayDraft } from '../application/assist/holiday-draft.js';
import { readPolicyProse } from '../application/assist/policy-prose.js';
import {
  attendanceExceptions,
  closePayPeriod,
  correctPunch,
  decideOvertime,
  payPeriodScreen,
  punch,
  remindPayPeriod,
} from '../application/attendance/attendance.js';
import { inspectorExport } from '../application/attendance/inspector-files.js';
import { insights } from '../application/insights/insights.js';
import { nudgePreview, sendNudges } from '../application/insights/nudge.js';
import { calendarFeed, issueFeedToken, revokeFeeds } from '../application/calendar/ical.js';
import {
  issueKioskQr,
  kioskDevices,
  kioskIdentify,
  kioskPunches,
  kioskStatus,
  registerKiosk,
  revokeKiosk,
  setKioskCredential,
} from '../application/attendance/kiosk.js';
import { importMembers } from '../application/member/import.js';
import { issueScimConnection, revokeScimConnection } from '../application/member/scim.js';
import { approveFromChat } from '../application/reach/chat.js';
import {
  completeIntegration,
  connectIntegration,
  connectMyIntegration,
  disconnectIntegration,
  integrationsScreen,
} from '../application/reach/integrations.js';
import {
  answerParental,
  approveParentalPlan,
  editParentalBlocks,
  parentalCase,
  parentalCases,
  parentalScreen,
  recordParentalBirth,
  saveParentalHandover,
  sendParentalPlan,
} from '../application/parental/parental.js';
import type { Caller, Deps, StoredKey, UnitOfWork } from '../application/ports.js';
import {
  cancelRequest,
  nudgeRequest,
  changeRequest,
  sendRequest,
  shortenRequest,
} from '../application/request/request.js';
import {
  balanceLedger,
  holidays,
  myRequests,
  overview,
  personBalances,
  requestDetail,
  requestPanel,
} from '../application/screens/employee.js';
import {
  approvals,
  attendanceRequestsScreen,
  calendar,
  calendarYear,
  delegation,
  punchView,
  reasonView,
  requestDecision,
  rightNowScreen,
  timesheetScreen,
  viewer,
} from '../application/screens/manager.js';
import {
  approvalsSettings,
  attendanceSettings,
  holidaySettings,
  leaveTypeSetting,
  leaveTypesSettings,
  negativeBalanceSettings,
  policyPreview,
} from '../application/screens/settings.js';
import {
  ApprovalRuleBody,
  ApprovalsSettingsView,
  ApprovalsView,
  AttendanceRequestsView,
  AttendanceRulesBody,
  AttendanceSettingsView,
  AutoApprovalBody,
  ChatAnswersBody,
  BalanceLedgerView,
  BalanceView,
  BlockKindView,
  CalendarView,
  DecisionView,
  DelegationView,
  DescribedView,
  EscalationBody,
  ExceptionsView,
  FileView,
  HolidayDraftView,
  HolidayLayerBody,
  HolidaySettingsView,
  HolidaysView,
  HandoverView,
  InsightsView,
  IntegrationProviderView,
  IntegrationsView,
  KioskIdentityView,
  KioskQrView,
  KioskRegisteredView,
  KioskStatusView,
  KioskSyncView,
  KioskView,
  LeaveTypeSettingView,
  LeaveTypesView,
  LookCloserReason,
  MyRequestsView,
  NegativeBalanceView,
  NudgeView,
  OverviewView,
  ParentalCasesView,
  ParentalCaseView,
  ParentalCompanyBody,
  ParentalScreenView,
  ParentRoleView,
  PayPeriodView,
  PolicyPreviewView,
  PolicyReadView,
  PunchView,
  RequestDetailView,
  RequestPanelView,
  RightNowView,
  TeamMinimumBody,
  TeamSeesView,
  TimesheetView,
  ViewerView,
  YearView,
  type View,
} from '../application/screens/views.js';
import type { Schedule } from '../domain/attendance/schedule.js';
import { addDays, addMonths } from '../domain/days.js';
import { ParentalPlanId } from '../domain/parental/plan.js';
import { LeaveRequestId } from '../domain/request/leave-request.js';
import { PolicyId } from '../domain/policy/policy.js';
import type { CallerFrom } from './caller.js';

/**
 * REST v1 for Time Off (PRD §18, TOF-046): `/v1/timeoff/...`.
 *
 * **One table, three transports.** Every route below names its parameters,
 * its body and its answer in Zod, and its use case. The dispatcher parses
 * with those schemas; `openapi.ts` prints them; the subgraph (`graphql/`)
 * builds a query or a mutation from each and reaches it in-process, so a
 * GraphQL write is this route's write — the same parse, the same key, the
 * same refusal. None of them decides who may see or do anything: the
 * application layer does, and every route only maps a `DomainFailure` to a
 * status.
 *
 * **Idempotency, as People.** Every write carries `Idempotency-Key`. The key,
 * the request's hash and the answer are saved in the write's own
 * transaction (`keyed`), so the write and the record of it commit together;
 * a retry with the same key and body is answered with the stored answer and
 * runs nothing, and the same key with a different body is refused. The
 * answer is stored, unlike People's resource id, because a Time Off answer
 * is a status or an id rather than somebody's record.
 */

export interface RestRequest {
  readonly method: string;
  /** Path and query, e.g. `/v1/timeoff/approvals?tab=waiting`. */
  readonly url: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

export interface RestResponse {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}

export interface RestDeps {
  readonly deps: Deps;
  readonly callerFrom: CallerFrom;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface Route {
  /** The subgraph's field: a query for a GET, a mutation otherwise. */
  readonly name: string;
  readonly method: Method;
  /** `{name}` for a path parameter. */
  readonly path: string;
  readonly summary: string;
  /** Path parameters and, on a GET, the query string. */
  readonly params: z.ZodObject;
  readonly body: z.ZodType | null;
  readonly answer: z.ZodType;
  readonly status: number;
  /** Not on the subgraph: the calendar feed (a token, no caller) and Person's own read. */
  readonly graphql: boolean;
  /** Reached with a signed token rather than through the router. */
  readonly public: boolean;
  readonly run: (
    deps: Deps,
    caller: Caller,
    input: {
      readonly params: unknown;
      readonly body: unknown;
      /** A public route's `Authorization: Bearer` token; `null` on every other. */
      readonly bearer: string | null;
      /** A public route's request as it came: a provider signs its raw body. */
      readonly raw: RawRequest;
    },
  ) => Promise<Result<unknown>>;
  /** The use case's answer as the route's; applied in the write's transaction too, for the key. */
  readonly shape: (value: unknown) => unknown;
}

const NoParams = z.object({});

interface RawRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: string;
}

function route<P extends z.ZodObject, B extends z.ZodType | null, A extends z.ZodType, V>(def: {
  readonly name: string;
  readonly method: Method;
  readonly path: string;
  readonly summary: string;
  readonly params?: P;
  readonly body?: B;
  readonly answer: A;
  readonly status?: number;
  readonly graphql?: false;
  readonly public?: true;
  readonly run: (
    deps: Deps,
    caller: Caller,
    input: {
      readonly params: z.output<P>;
      readonly body: B extends z.ZodType ? z.output<B> : undefined;
      readonly bearer: string | null;
      readonly raw: RawRequest;
    },
  ) => Promise<Result<V>>;
  readonly shape: (value: V) => View<A>;
}): Route {
  return {
    name: def.name,
    method: def.method,
    path: def.path,
    summary: def.summary,
    params: def.params ?? NoParams,
    body: def.body ?? null,
    answer: def.answer,
    status: def.status ?? 200,
    graphql: def.graphql === undefined,
    public: def.public === true,
    run: def.run as Route['run'],
    shape: def.shape as Route['shape'],
  };
}

const same = <T>(value: T): T => value;

/* ------------------------------------------------------------- contract -- */

const Scope = z.enum(['team', 'company', 'me']);
const ScopeParams = { scope: Scope.default('team'), teamKey: TeamKey.optional() };
const RequestParams = z.object({ requestId: LeaveRequestId });
const Year = z.int().min(2000).max(2100);
const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u, 'a month, such as 2026-10');

export const Done = z.object({ ok: z.literal(true) }).meta({ title: 'TimeOffDone' });
const done = () => ({ ok: true as const });

const Range = z
  .strictObject({ from: CalendarDate, to: CalendarDate })
  .refine((r) => r.from <= r.to, { message: 'A range cannot end before it starts', path: ['to'] });

export const ChangeBody = z.strictObject({ span: DateSpan });
export const ShortenBody = z.strictObject({
  to: CalendarDate,
  endsHalfDay: z.boolean().default(false),
});
export const DecisionBody = z.strictObject({
  decision: z.enum(['approve', 'decline']),
  reason: z.string().max(1000).nullable().default(null),
});
export const CounterBody = z.strictObject({
  proposals: z
    .array(z.strictObject({ spans: z.array(Range).min(1).max(10) }))
    .min(1)
    .max(3),
  /** What the manager writes with the dates (T18, TOF-099b). */
  message: z.string().max(1000).nullable().default(null),
});
export const AnswerBody = z.strictObject({
  /** Which suggestion to take; `null` keeps the member's own dates. */
  accept: z.int().min(0).nullable(),
});
export const BatchBody = z.strictObject({ requestIds: z.array(LeaveRequestId).min(1).max(100) });
export const DelegationBody = z.strictObject({
  delegateId: PersonId,
  range: Range.nullable().default(null),
  automatic: z.boolean().default(false),
  salaryRelated: z.boolean().default(false),
});
export const FeedBody = z.strictObject({ scope: Scope });
export const CorrectionBody = z.strictObject({
  personId: PersonId,
  /** The punch this replaces; `null` for one never made (a forgotten clock-out). */
  supersedes: z.uuid().nullable(),
  at: Instant,
  kind: PunchKind,
  workModel: AttendanceWorkModel.optional(),
  reason: z.string().max(1000).nullable().default(null),
});
export const OvertimeBody = z.strictObject({
  personId: PersonId,
  date: CalendarDate,
  approve: z.boolean(),
  choice: z.enum(['comp', 'paid']).nullable().default(null),
});
/** A balance changed by hand: always with a reason, signed, and from today unless said. */
export const AdjustmentBody = z.strictObject({
  personId: PersonId,
  leaveTypeKey: LeaveTypeKey,
  amount: DayAmount,
  effectiveOn: CalendarDate.nullable().default(null),
  reason: z.string().max(500),
});
export const AdjustmentDecisionBody = z.strictObject({
  approve: z.boolean(),
  note: z.string().max(500).nullable().default(null),
});
const AdjustmentAnswer = z
  .object({
    adjustmentId: z.uuid(),
    personId: PersonId,
    displayName: z.string(),
    leaveTypeKey: LeaveTypeKey,
    leaveTypeName: z.string(),
    unit: z.enum(['day', 'hour']),
    amount: DayAmount,
    effectiveOn: CalendarDate,
    reason: z.string(),
    proposedAt: Instant,
    status: z.enum(['pending', 'approved', 'declined']),
    decidedAt: Instant.nullable(),
    note: z.string().nullable(),
    canDecide: z.boolean(),
  })
  .meta({ title: 'TimeOffBalanceAdjustment' });
const adjustmentView = (v: AdjustmentView): z.output<typeof AdjustmentAnswer> => ({
  adjustmentId: v.adjustmentId,
  personId: v.personId,
  displayName: v.displayName,
  leaveTypeKey: v.leaveTypeKey,
  leaveTypeName: v.leaveTypeName,
  unit: v.unit,
  amount: v.amount,
  effectiveOn: v.effectiveOn,
  reason: v.reason,
  proposedAt: v.proposedAt as Instant,
  status: v.status,
  decidedAt: v.decidedAt as Instant | null,
  note: v.note,
  canDecide: v.canDecide,
});
const AdjustmentWritten = z
  .object({
    adjustmentId: z.uuid(),
    status: z.enum(['pending', 'approved', 'declined']),
  })
  .meta({ title: 'TimeOffBalanceAdjusted' });

/** What a member taps a kiosk with: a badge number, a PIN, or the QR their phone shows. */
export const KioskCredentialBody = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('badge'),
    value: z
      .string()
      .trim()
      .regex(/^[\x21-\x7e]{1,64}$/u, 'a badge number'),
  }),
  z.strictObject({
    kind: z.literal('pin'),
    value: z.string().regex(/^\d{6}$/u, '6 digits'),
  }),
  z.strictObject({ kind: z.literal('qr'), value: z.string().min(1).max(1000) }),
]);
export const KioskIdentifyBody = z.strictObject({ credential: KioskCredentialBody });
export const KioskPunchesBody = z.strictObject({
  /** The kiosk's clock when it sends, which its skew is read from. */
  sentAt: Instant,
  punches: z
    .array(
      z.strictObject({
        sequence: z.int().min(1),
        at: Instant,
        credential: KioskCredentialBody,
      }),
    )
    .min(1)
    .max(500),
});
export const KioskBody = z.strictObject({
  name: z.string().trim().min(1).max(120),
  locationKey: LocationKey,
});
export const KioskCredentialSetBody = z.strictObject({
  /** `null` takes it away. A badge is any printable code; a PIN 6 digits. */
  value: z.string().trim().min(1).max(64).nullable(),
});
const KioskParams = z.object({ deviceId: z.uuid() });
const ProviderParams = z.object({ provider: IntegrationProviderView });
const ConnectAnswer = z
  .object({ url: z.string().nullable() })
  .meta({ title: 'TimeOffIntegrationConnect' });
export const ConnectBody = z.strictObject({
  /** The integrations page to come back to once the provider has answered. */
  back: z.url({ protocol: /^https?$/u }),
});
export const ImportBody = z.strictObject({
  format: z.enum(['csv', 'json']),
  content: z.string().max(5_000_000),
  /** Says what would happen and writes nothing. On unless switched off. */
  dryRun: z.boolean().default(true),
});
export const LeaveTypeBody = LeaveTypeDefinition.extend({
  visibility: LeaveTypeDefinition.shape.visibility.optional(),
});
export const LeaveTypeChangeBody = z.union([
  z.strictObject({ kind: z.literal('update'), changes: LeaveTypeDefinition.partial() }),
  z.strictObject({ kind: z.enum(['hide', 'show', 'delete']) }),
]);
export const NegativeRuleBody = z.strictObject({ rule: NegativeBalanceRule.nullable() });
export const PublishBody = z.strictObject({ effectiveFrom: CalendarDate });
export const LayerBody = HolidayLayerBody.omit({ key: true });
export const AssignBody = z.strictObject({ layerKeys: z.array(z.string()).max(10) });
export const ApprovalRulesBody = z.strictObject({
  rules: z.array(ApprovalRuleBody).max(50),
  autoApproval: AutoApprovalBody.optional(),
  escalation: EscalationBody.optional(),
});
export const MinimumBody = z.strictObject({ minimum: TeamMinimumBody.nullable() });
const Children = z.int().min(1).max(9);
export const ParentalAnswersBody = z.strictObject({
  role: ParentRoleView,
  childDate: CalendarDate,
  singleParent: z.boolean().default(false),
  children: Children.default(1),
  teamSees: TeamSeesView.default('type'),
});
export const ParentalBlocksBody = z.strictObject({
  blocks: z
    .array(z.strictObject({ kind: BlockKindView, from: CalendarDate, to: CalendarDate }))
    .max(20),
});
export const ParentalHandoverBody = z.strictObject({
  handover: z.array(HandoverView).max(30),
  teamSees: TeamSeesView,
});
export const BirthBody = z.strictObject({ birth: CalendarDate });
const PlanParams = z.object({ planId: ParentalPlanId });

const Minute = z
  .int()
  .min(0)
  .max(48 * 60);
const WorkWindow = z.strictObject({ start: Minute, end: Minute, breakMinutes: Minute });
const Week = z.partialRecord(z.enum(['1', '2', '3', '4', '5', '6', '7']), WorkWindow);
const MonthDayText = z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/u);
export const ScheduleBody: z.ZodType<Schedule> = z.lazy(() =>
  z.union([
    z.strictObject({ kind: z.literal('fixed'), name: z.string().min(1).max(100), week: Week }),
    z.strictObject({
      kind: z.literal('flexible'),
      name: z.string().min(1).max(100),
      week: Week,
      core: z.strictObject({ start: Minute, end: Minute }),
    }),
    z.strictObject({
      kind: z.literal('seasonal'),
      name: z.string().min(1).max(100),
      base: ScheduleBody,
      seasons: z
        .array(z.strictObject({ from: MonthDayText, to: MonthDayText, schedule: ScheduleBody }))
        .max(12),
    }),
    z.strictObject({
      kind: z.literal('rotating'),
      name: z.string().min(1).max(100),
      anchor: CalendarDate,
      cycle: z.array(WorkWindow.nullable()).min(1).max(56),
    }),
  ]),
);
export const AssignScheduleBody = z.strictObject({
  personIds: z.array(PersonId).min(1).max(1000),
  schedule: ScheduleBody,
});

const SentAnswer = z
  .object({ requestId: z.uuid(), status: RequestStatus, noteRequired: z.boolean() })
  .meta({ title: 'TimeOffRequestSent' });
const StatusAnswer = z.object({ status: RequestStatus }).meta({ title: 'TimeOffRequestStatus' });
const DecidedAnswer = z
  .object({
    requestId: z.uuid(),
    status: RequestStatus,
    next: z.enum(['manager', 'hr']).nullable(),
  })
  .meta({ title: 'TimeOffDecided' });
const BatchAnswer = z
  .object({
    approved: z.array(DecidedAnswer),
    refused: z.array(
      z
        .object({ requestId: z.uuid(), code: z.string(), reason: LookCloserReason.nullable() })
        .meta({ title: 'TimeOffBatchRefusal' }),
    ),
  })
  .meta({ title: 'TimeOffBatch' });
const ImportAnswer = z
  .object({
    dryRun: z.boolean(),
    rows: z.int(),
    errors: z.array(
      z
        .object({ row: z.int(), field: z.string(), message: z.string() })
        .meta({ title: 'TimeOffImportError' }),
    ),
    created: z.int(),
    updated: z.int(),
  })
  .meta({ title: 'TimeOffImportReport' });
const PlanStatusAnswer = z
  .object({ status: z.enum(['submitted', 'approved']) })
  .meta({ title: 'TimeOffParentalPlanStatus' });
const VersionAnswer = z.object({ version: z.int() }).meta({ title: 'TimeOffPolicyVersionNumber' });

/** The keys a caller sent, without the ones Zod left `undefined` (`exactOptionalPropertyTypes`). */
function present<T extends object>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}

const firstOf = (month: string) => CalendarDate.parse(`${month}-01`);

/** A number of days from the address: "28", "2.5". */
const DayText = z.string().regex(/^\d{1,3}(\.\d{1,3})?$/u, 'a number of days, such as 28 or 2.5');

/* --------------------------------------------------------------- routes -- */

const V1 = '/v1/timeoff';

/** Every route: the dispatcher's, the document's and the subgraph's. */
export const ROUTES: readonly Route[] = [
  /* ---------------------------------------------------------- screens -- */
  route({
    name: 'timeOffViewer',
    method: 'GET',
    path: `${V1}/viewer`,
    summary:
      'Whether the caller approves anyone, is HR, and the counts on Requests and Attendance (TOF-058a)',
    answer: ViewerView,
    run: (deps, caller) => viewer(deps)(caller),
    shape: same,
  }),
  route({
    name: 'timeOffOverview',
    method: 'GET',
    path: `${V1}/overview`,
    summary: 'T1: the clock, the balances, what is coming up and who is off today',
    answer: OverviewView,
    run: (deps, caller) => overview(deps)(caller),
    shape: same,
  }),
  route({
    name: 'timeOffRequestPanel',
    method: 'GET',
    path: `${V1}/request-panel`,
    summary:
      'T3, T5: the types the caller may ask for and, given dates, what the request would mean; nothing is saved',
    params: z.object({
      leaveTypeKey: LeaveTypeKey.optional(),
      from: CalendarDate.optional(),
      to: CalendarDate.optional(),
      startsHalfDay: z.boolean().optional(),
      endsHalfDay: z.boolean().optional(),
    }),
    answer: RequestPanelView,
    run: (deps, caller, { params }) => requestPanel(deps)(caller, params),
    shape: same,
  }),
  route({
    name: 'timeOffDescribe',
    method: 'GET',
    path: `${V1}/describe`,
    summary:
      'T4, MT8: a sentence read as choices the caller can change, and the best dates for them; nothing is saved',
    params: z.object({
      sentence: z.string().max(300).optional(),
      leaveTypeKey: LeaveTypeKey.optional(),
      days: z.int().min(1).max(30).optional(),
      month: z
        .string()
        .regex(/^(\d{4}-(0[1-9]|1[0-2]))?$/u, 'a month, such as 2026-10, or nothing')
        .optional(),
      nextToHoliday: z.boolean().optional(),
      avoidShort: z.boolean().optional(),
    }),
    answer: DescribedView,
    run: (deps, caller, { params }) => describeRequest(deps)(caller, params),
    shape: same,
  }),
  route({
    name: 'timeOffMyRequests',
    method: 'GET',
    path: `${V1}/my-requests`,
    summary: 'T6: the caller’s requests, upcoming, past or cancelled',
    params: z.object({ tab: z.enum(['upcoming', 'past', 'cancelled']).default('upcoming') }),
    answer: MyRequestsView,
    run: (deps, caller, { params }) => myRequests(deps)(caller, params),
    shape: same,
  }),
  route({
    name: 'timeOffRequest',
    method: 'GET',
    path: `${V1}/requests/{requestId}`,
    summary: 'One request, for its member, an approver or HR',
    params: RequestParams,
    answer: RequestDetailView,
    run: (deps, caller, { params }) => requestDetail(deps)(caller, params),
    shape: same,
  }),
  route({
    name: 'timeOffApprovals',
    method: 'GET',
    path: `${V1}/approvals`,
    summary: 'T16: waiting for the caller (clear and look closer), coming up, or decided',
    params: z.object({
      tab: z.enum(['waiting', 'coming_up', 'decided']).default('waiting'),
      /** Coming up and Decided: the page after this place (the last page's `next`). */
      after: z.string().max(100).optional(),
    }),
    answer: ApprovalsView,
    run: (deps, caller, { params }) => approvals(deps)(caller, params),
    shape: same,
  }),
  route({
    name: 'timeOffRequestDecision',
    method: 'GET',
    path: `${V1}/requests/{requestId}/decision`,
    summary: 'T17: one request with the balance, the team and the rule an approver weighs',
    params: RequestParams,
    answer: DecisionView,
    run: (deps, caller, { params }) => requestDecision(deps)(caller, params),
    shape: same,
  }),
  route({
    name: 'timeOffDelegation',
    method: 'GET',
    path: `${V1}/delegation`,
    summary: 'T19: who covers for the caller, whom they may choose, and whom they cover for',
    answer: DelegationView,
    run: (deps, caller) => delegation(deps)(caller),
    shape: same,
  }),
  route({
    name: 'timeOffCalendarMonth',
    method: 'GET',
    path: `${V1}/calendar/month`,
    summary: 'T12: a month of the team’s, the company’s or the caller’s time off',
    params: z.object({ ...ScopeParams, month: Month }),
    answer: CalendarView,
    run: (deps, caller, { params }) =>
      calendar(deps)(caller, {
        scope: params.scope,
        teamKey: params.teamKey ?? null,
        from: firstOf(params.month),
        to: addDays(addMonths(firstOf(params.month), 1), -1),
      }),
    shape: same,
  }),
  route({
    name: 'timeOffCalendarTimeline',
    method: 'GET',
    path: `${V1}/calendar/timeline`,
    summary: 'T13: people by days over a range, with the coverage row',
    params: z.object({ ...ScopeParams, from: CalendarDate, to: CalendarDate }),
    answer: CalendarView,
    run: (deps, caller, { params }) =>
      calendar(deps)(caller, { ...params, teamKey: params.teamKey ?? null }),
    shape: same,
  }),
  route({
    name: 'timeOffCalendarYear',
    method: 'GET',
    path: `${V1}/calendar/year`,
    summary: 'The year: how many people are off each day',
    params: z.object({ ...ScopeParams, year: Year }),
    answer: YearView,
    run: (deps, caller, { params }) => calendarYear(deps)(caller, params),
    shape: same,
  }),
  route({
    name: 'timeOffCalendarDay',
    method: 'GET',
    path: `${V1}/calendar/day`,
    summary: 'T14: one day — who is off, holidays and coverage',
    params: z.object({ ...ScopeParams, date: CalendarDate }),
    answer: CalendarView,
    run: (deps, caller, { params }) =>
      calendar(deps)(caller, {
        scope: params.scope,
        teamKey: params.teamKey ?? null,
        from: params.date,
        to: params.date,
      }),
    shape: same,
  }),
  route({
    name: 'timeOffTimesheet',
    method: 'GET',
    path: `${V1}/timesheet`,
    summary: 'T20: a timesheet by week or month, the caller’s own unless a member is named',
    params: z.object({ personId: PersonId.optional(), from: CalendarDate, to: CalendarDate }),
    answer: TimesheetView,
    run: (deps, caller, { params }) => timesheetScreen(deps)(caller, params),
    shape: same,
  }),
  route({
    name: 'timeOffTeamRightNow',
    method: 'GET',
    path: `${V1}/team-right-now`,
    summary: 'T22: the caller’s reports, live, and what needs them',
    answer: RightNowView,
    run: (deps, caller) => rightNowScreen(deps)(caller),
    shape: same,
  }),
  route({
    name: 'timeOffAttendanceExceptions',
    method: 'GET',
    path: `${V1}/attendance/exceptions`,
    summary:
      'T23: missed clock-outs, short rest, overtime waiting and holidays worked over a period; HR',
    params: z.object({ from: CalendarDate, to: CalendarDate }),
    answer: ExceptionsView,
    run: (deps, caller, { params }) => attendanceExceptions(deps)(caller, params),
    shape: same,
  }),
  route({
    name: 'timeOffInspectorRecord',
    method: 'GET',
    path: `${V1}/attendance/inspector-record`,
    summary:
      'The labour inspector’s daily record (start, end, breaks) per person for a period, as CSV or PDF in base64; HR',
    params: z.object({ from: CalendarDate, to: CalendarDate, format: z.enum(['csv', 'pdf']) }),
    answer: FileView,
    run: (deps, caller, { params }) => inspectorExport(deps)(caller, params),
    shape: same,
  }),
  route({
    name: 'timeOffAttendanceRequests',
    method: 'GET',
    path: `${V1}/attendance/requests`,
    summary:
      'The attendance Requests tab: overtime and late corrections the caller’s reports need from them, and the caller’s own overtime',
    answer: AttendanceRequestsView,
    run: (deps, caller) => attendanceRequestsScreen(deps)(caller),
    shape: same,
  }),
  route({
    name: 'timeOffInsights',
    method: 'GET',
    path: `${V1}/insights`,
    summary:
      'T27: the month in points, six months of trends, the teams large enough to describe and the people behind each point; HR or a manager',
    answer: InsightsView,
    run: (deps, caller) => insights(deps)(caller),
    shape: same,
  }),
  route({
    name: 'timeOffNudge',
    method: 'GET',
    path: `${V1}/insights/nudge`,
    summary:
      'T28: who has had no break, and the first one’s message as it would be sent; HR or a manager',
    params: z.object({
      balance: z.boolean().default(true),
      bridge: z.boolean().default(true),
      losing: z.boolean().default(false),
    }),
    answer: NudgeView,
    run: (deps, caller, { params }) => nudgePreview(deps)(caller, params),
    shape: same,
  }),
  route({
    name: 'timeOffPayPeriod',
    method: 'GET',
    path: `${V1}/pay-periods/{month}`,
    summary: 'T24: a month per team and in total, and who is late for Payroll; HR',
    params: z.object({ month: Month }),
    answer: PayPeriodView,
    run: (deps, caller, { params }) =>
      payPeriodScreen(deps)(caller, { from: firstOf(params.month) }),
    shape: same,
  }),
  route({
    name: 'timeOffBalance',
    method: 'GET',
    path: `${V1}/balances/{leaveTypeKey}`,
    summary: 'MT20: where the days of one leave type went this leave year',
    params: z.object({ leaveTypeKey: LeaveTypeKey, personId: PersonId.optional() }),
    answer: BalanceLedgerView,
    run: (deps, caller, { params }) => balanceLedger(deps)(caller, params),
    shape: same,
  }),
  route({
    name: 'timeOffHolidays',
    method: 'GET',
    path: `${V1}/holidays/{year}`,
    summary: 'MT21: the holidays the caller’s work location observes',
    params: z.object({ year: Year }),
    answer: HolidaysView,
    run: (deps, caller, { params }) => holidays(deps)(caller, params),
    shape: same,
  }),
  route({
    name: 'timeOffLeaveTypeSettings',
    method: 'GET',
    path: `${V1}/settings/leave-types`,
    summary: 'T29: every leave type; HR',
    answer: LeaveTypesView,
    run: (deps, caller) => leaveTypesSettings(deps)(caller),
    shape: same,
  }),
  route({
    name: 'timeOffLeaveTypeSetting',
    method: 'GET',
    path: `${V1}/settings/leave-types/{key}`,
    summary: 'T30: one leave type and every version of its policies; HR',
    params: z.object({ key: LeaveTypeKey }),
    answer: LeaveTypeSettingView,
    run: (deps, caller, { params }) => leaveTypeSetting(deps)(caller, params),
    shape: same,
  }),
  route({
    name: 'timeOffPolicyPreview',
    method: 'GET',
    path: `${V1}/settings/policies/{policyId}/preview`,
    summary:
      'T30: what publishing the draft would do to each member this leave year, folded; nothing is saved; HR',
    params: z.object({ policyId: PolicyId }),
    answer: PolicyPreviewView,
    run: (deps, caller, { params }) => policyPreview(deps)(caller, params),
    shape: same,
  }),
  route({
    name: 'timeOffPolicyRead',
    method: 'GET',
    path: `${V1}/settings/policies/read`,
    summary:
      'T32: a policy written in plain words, read into the ordinary form, with the one question it leaves open; nothing is saved; HR',
    params: z.object({
      text: z.string().max(2000).optional(),
      leaveTypeKey: LeaveTypeKey.optional(),
      dayKind: z.enum(['working', 'calendar']).optional(),
      earning: z.enum(['upfront', 'monthly']).optional(),
      allowance: DayText.optional(),
      carryOver: DayText.optional(),
      negative: DayText.optional(),
      probationMonths: z.int().min(0).max(24).optional(),
    }),
    answer: PolicyReadView,
    run: (deps, caller, { params }) => readPolicyProse(deps)(caller, params),
    shape: same,
  }),
  route({
    name: 'timeOffNegativeBalanceSettings',
    method: 'GET',
    path: `${V1}/settings/negative-balance`,
    summary: 'T31: each policy’s negative balance rule; HR',
    answer: NegativeBalanceView,
    run: (deps, caller) => negativeBalanceSettings(deps)(caller),
    shape: same,
  }),
  route({
    name: 'timeOffAttendanceSettings',
    method: 'GET',
    path: `${V1}/settings/attendance`,
    summary: 'T33: breaks, limits, overtime and the default schedule; HR',
    answer: AttendanceSettingsView,
    run: (deps, caller) => attendanceSettings(deps)(caller),
    shape: same,
  }),
  route({
    name: 'timeOffApprovalSettings',
    method: 'GET',
    path: `${V1}/settings/approvals`,
    summary: 'T34: approval rules, automatic approval and team minimums; HR',
    answer: ApprovalsSettingsView,
    run: (deps, caller) => approvalsSettings(deps)(caller),
    shape: same,
  }),
  route({
    name: 'timeOffHolidaySettings',
    method: 'GET',
    path: `${V1}/settings/holidays/{year}`,
    summary: 'T36: holiday calendars, and what each work location observes in a year; HR',
    params: z.object({ year: Year }),
    answer: HolidaySettingsView,
    run: (deps, caller, { params }) => holidaySettings(deps)(caller, params),
    shape: same,
  }),
  route({
    name: 'timeOffHolidayDraft',
    method: 'GET',
    path: `${V1}/settings/holidays/{year}/draft`,
    summary:
      'T36: a year of one calendar drafted from a list HR supplies; the unconfirmed days are marked; nothing is saved; HR',
    params: z.object({
      year: Year,
      layerKey: HolidayLayerBody.shape.key,
      source: z.string().min(1).max(4000),
    }),
    answer: HolidayDraftView,
    run: (deps, caller, { params }) => holidayDraft(deps)(caller, params),
    shape: same,
  }),
  route({
    name: 'timeOffParentalPlan',
    method: 'GET',
    path: `${V1}/parental`,
    summary:
      'T8–T10: the caller’s parental plan, and the entitlement the answers asked about would give; nothing is saved',
    params: z.object({
      role: ParentRoleView.optional(),
      childDate: CalendarDate.optional(),
      singleParent: z.boolean().optional(),
      children: Children.optional(),
    }),
    answer: ParentalScreenView,
    run: (deps, caller, { params }) => parentalScreen(deps)(caller, present(params)),
    shape: same,
  }),
  route({
    name: 'timeOffParentalCases',
    method: 'GET',
    path: `${V1}/parental/cases`,
    summary: 'HR’s list of sent parental plans, waiting first, then approved; HR',
    answer: ParentalCasesView,
    run: (deps, caller) => parentalCases(deps)(caller),
    shape: same,
  }),
  route({
    name: 'timeOffParentalCase',
    method: 'GET',
    path: `${V1}/parental/{planId}/case`,
    summary: 'T11: a sent plan with its checklist and rules check; HR and the manager',
    params: PlanParams,
    answer: ParentalCaseView,
    run: (deps, caller, { params }) => parentalCase(deps)(caller, params.planId),
    shape: same,
  }),
  route({
    name: 'timeOffPersonBalances',
    method: 'GET',
    path: `${V1}/people/{personId}/balances`,
    summary: 'A person’s balances: themselves, their approvers and HR; null for anybody else',
    params: z.object({ personId: PersonId }),
    answer: z.object({ balances: z.array(BalanceView).nullable() }),
    graphql: false,
    run: async (deps, caller, { params }) => {
      const found = await personBalances(deps)(caller, params.personId);
      return found.ok ? ok({ balances: found.value }) : found;
    },
    shape: same,
  }),

  /* --------------------------------------------------------- requests -- */
  route({
    name: 'requestTimeOff',
    method: 'POST',
    path: `${V1}/requests`,
    summary: 'Send a request; sick leave under the threshold is approved as it is recorded',
    body: LeaveRequestInput,
    answer: SentAnswer,
    status: 201,
    run: (deps, caller, { body }) => sendRequest(deps)(caller, body),
    shape: (v) => ({ requestId: v.requestId, status: v.status, noteRequired: v.noteRequired }),
  }),
  route({
    name: 'changeTimeOffRequest',
    method: 'POST',
    path: `${V1}/requests/{requestId}/change`,
    summary: 'Move approved dates; the old ones stay booked until the new ones are approved',
    params: RequestParams,
    body: ChangeBody,
    answer: StatusAnswer,
    run: (deps, caller, { params, body }) =>
      changeRequest(deps)(caller, { requestId: params.requestId, span: body.span }),
    shape: (v) => ({ status: v.status }),
  }),
  route({
    name: 'shortenTimeOffRequest',
    method: 'POST',
    path: `${V1}/requests/{requestId}/shorten`,
    summary: 'Give the tail back; approved automatically',
    params: RequestParams,
    body: ShortenBody,
    answer: z.object({ releasedDays: DayAmount }).meta({ title: 'TimeOffShortened' }),
    run: (deps, caller, { params, body }) =>
      shortenRequest(deps)(caller, { requestId: params.requestId, ...body }),
    shape: same,
  }),
  route({
    name: 'cancelTimeOffRequest',
    method: 'POST',
    path: `${V1}/requests/{requestId}/cancel`,
    summary: 'Cancel an approved request, or withdraw one nobody has decided',
    params: RequestParams,
    answer: StatusAnswer,
    run: (deps, caller, { params }) => cancelRequest(deps)(caller, params.requestId),
    shape: (v) => ({ status: v.status }),
  }),
  route({
    name: 'decideTimeOffRequest',
    method: 'POST',
    path: `${V1}/requests/{requestId}/decision`,
    summary: 'Approve or decline at the step waiting on the caller',
    params: RequestParams,
    body: DecisionBody,
    answer: DecidedAnswer,
    run: (deps, caller, { params, body }) =>
      decideRequest(deps)(caller, { requestId: params.requestId, ...body }),
    shape: same,
  }),
  route({
    name: 'suggestTimeOffDates',
    method: 'POST',
    path: `${V1}/requests/{requestId}/counter-proposal`,
    summary: 'Suggest other dates instead of declining, with a message for the member',
    params: RequestParams,
    body: CounterBody,
    answer: StatusAnswer,
    run: (deps, caller, { params, body }) =>
      counterPropose(deps)(caller, {
        requestId: params.requestId,
        proposals: body.proposals,
        message: body.message,
      }),
    shape: same,
  }),
  route({
    name: 'answerSuggestedTimeOffDates',
    method: 'POST',
    path: `${V1}/requests/{requestId}/counter-answer`,
    summary: 'Take one of the suggested dates, which approves them, or keep your own',
    params: RequestParams,
    body: AnswerBody,
    answer: StatusAnswer,
    run: (deps, caller, { params, body }) =>
      answerCounter(deps)(caller, { requestId: params.requestId, accept: body.accept }),
    shape: same,
  }),
  route({
    name: 'approveTimeOffRequests',
    method: 'POST',
    path: `${V1}/approvals:batch`,
    summary: 'Approve several; only the ones triage calls clear, the rest are refused with why',
    body: BatchBody,
    answer: BatchAnswer,
    run: (deps, caller, { body }) => batchApprove(deps)(caller, body.requestIds),
    shape: (v) => ({
      approved: [...v.approved],
      refused: v.refused.map((r) => ({
        requestId: r.requestId,
        code: r.code,
        reason: r.reason === null ? null : reasonView(r.reason),
      })),
    }),
  }),
  route({
    name: 'setTimeOffDelegation',
    method: 'PUT',
    path: `${V1}/delegations/{approverId}`,
    summary: 'Who covers for an approver: they set it, or HR does',
    params: z.object({ approverId: PersonId }),
    body: DelegationBody,
    answer: Done,
    run: (deps, caller, { params, body }) =>
      setDelegation(deps)(caller, { approverId: params.approverId, ...body }),
    shape: done,
  }),
  route({
    name: 'removeTimeOffDelegation',
    method: 'DELETE',
    path: `${V1}/delegations/{approverId}`,
    summary: 'Nobody covers for an approver any more',
    params: z.object({ approverId: PersonId }),
    answer: Done,
    run: (deps, caller, { params }) =>
      setDelegation(deps)(caller, { approverId: params.approverId, remove: true }),
    shape: done,
  }),

  /* --------------------------------------------------------- calendar -- */
  route({
    name: 'issueTimeOffCalendarFeed',
    method: 'POST',
    path: `${V1}/calendar/feeds`,
    summary: 'A signed, revocable iCalendar feed token for a scope',
    body: FeedBody,
    answer: z.object({ token: z.string() }).meta({ title: 'TimeOffCalendarFeed' }),
    status: 201,
    run: (deps, caller, { body }) => issueFeedToken(deps)(caller, body.scope),
    shape: same,
  }),
  route({
    name: 'revokeTimeOffCalendarFeeds',
    method: 'DELETE',
    path: `${V1}/calendar/feeds`,
    summary: 'Every feed the caller issued stops working',
    answer: Done,
    run: (deps, caller) => revokeFeeds(deps)(caller),
    shape: done,
  }),
  route({
    name: 'timeOffCalendarFeed',
    method: 'GET',
    path: `${V1}/calendar/feed.ics`,
    summary: 'The feed a calendar app polls: text/calendar, a month back and a year ahead',
    params: z.object({ token: z.string().min(1).max(2000) }),
    answer: z.string(),
    graphql: false,
    public: true,
    run: (deps, _caller, { params }) => calendarFeed(deps)(params.token),
    shape: same,
  }),

  /* ------------------------------------------------------- attendance -- */
  route({
    name: 'punchTimeOffClock',
    method: 'POST',
    path: `${V1}/punches`,
    summary: 'Clock in, start or end a break, clock out — no location is ever stored',
    body: PunchInput,
    answer: z.object({ punch: PunchView, state: ClockState }).meta({ title: 'TimeOffPunched' }),
    status: 201,
    run: (deps, caller, { body }) => punch(deps)(caller, body),
    shape: (v) => ({ punch: punchView(v.punch), state: v.state }),
  }),
  route({
    name: 'correctTimeOffPunch',
    method: 'POST',
    path: `${V1}/punches/corrections`,
    summary: 'A punch made afterwards: replacing one, or one never made; the member’s own or HR’s',
    body: CorrectionBody,
    answer: z
      .object({ punch: PunchView, needsManager: z.boolean() })
      .meta({ title: 'TimeOffPunchCorrected' }),
    status: 201,
    run: (deps, caller, { body: { workModel, ...body } }) =>
      correctPunch(deps)(caller, { ...body, ...present({ workModel }) }),
    shape: (v) => ({ punch: punchView(v.punch), needsManager: v.needsManager }),
  }),
  route({
    name: 'decideTimeOffOvertime',
    method: 'POST',
    path: `${V1}/overtime/decisions`,
    summary: 'Approve a day’s overtime as comp time or pay, or decline it',
    body: OvertimeBody,
    answer: z
      .object({
        personId: PersonId,
        date: CalendarDate,
        minutes: z.int(),
        outcome: z.enum(['comp', 'paid', 'declined']),
      })
      .meta({ title: 'TimeOffOvertimeDecided' }),
    run: (deps, caller, { body }) => decideOvertime(deps)(caller, body),
    shape: (v) => ({ personId: v.personId, date: v.date, minutes: v.minutes, outcome: v.outcome }),
  }),
  route({
    name: 'timeOffInbox',
    method: 'GET',
    path: `${V1}/inbox`,
    summary:
      'The Inbox’s Time Off items for the caller: approvals waiting on them, their own requests, decisions and days about to expire',
    answer: InboxAnswer.meta({ title: 'TimeOffInbox' }),
    run: (deps, caller) => timeOffInbox(deps)(caller),
    // `detail` is the kind’s own shape, JSON on the wire (`InboxItem`).
    shape: (v) => v as never,
  }),
  route({
    name: 'nudgeTimeOffRequest',
    method: 'POST',
    path: `${V1}/requests/{requestId}/nudge`,
    summary: 'Remind whoever has your request: once, after 48 hours of waiting',
    params: RequestParams,
    answer: z.object({ nudgedAt: Instant }).meta({ title: 'TimeOffNudged' }),
    run: (deps, caller, { params }) => nudgeRequest(deps)(caller, params.requestId),
    shape: same,
  }),
  route({
    name: 'timeOffBalanceAdjustments',
    method: 'GET',
    path: `${V1}/balance-adjustments`,
    summary:
      'Balances changed by hand: HR’s queue and the last 30 days; a manager sees the ones they asked for',
    answer: z
      .object({ hr: z.boolean(), items: z.array(AdjustmentAnswer) })
      .meta({ title: 'TimeOffBalanceAdjustments' }),
    run: (deps, caller) => balanceAdjustments(deps)(caller),
    shape: (v) => ({ hr: v.hr, items: v.items.map(adjustmentView) }),
  }),
  route({
    name: 'adjustTimeOffBalance',
    method: 'POST',
    path: `${V1}/balance-adjustments`,
    summary:
      'Add to or take from a balance, saying why: HR’s counts at once, a manager’s waits for HR',
    body: AdjustmentBody,
    answer: AdjustmentWritten,
    status: 201,
    run: (deps, caller, { body }) => adjustBalance(deps)(caller, body),
    shape: (v) => ({ adjustmentId: v.adjustmentId, status: v.status }),
  }),
  route({
    name: 'decideTimeOffBalanceAdjustment',
    method: 'POST',
    path: `${V1}/balance-adjustments/{adjustmentId}/decision`,
    summary: 'Approve or decline a balance adjustment a manager asked for; HR, never their own',
    params: z.object({ adjustmentId: z.uuid() }),
    body: AdjustmentDecisionBody,
    answer: AdjustmentWritten,
    run: (deps, caller, { params, body }) =>
      decideBalanceAdjustment(deps)(caller, { adjustmentId: params.adjustmentId, ...body }),
    shape: (v) => ({ adjustmentId: v.adjustmentId, status: v.status }),
  }),
  route({
    name: 'closeTimeOffPayPeriod',
    method: 'POST',
    path: `${V1}/pay-periods/{month}/close`,
    summary: 'Send a month to Payroll: post its days, lock it, publish timeoff.period.closed; HR',
    params: z.object({ month: Month }),
    answer: z
      .object({ periodId: z.uuid(), from: CalendarDate, to: CalendarDate, members: z.int() })
      .meta({ title: 'TimeOffPayPeriodClosed' }),
    run: (deps, caller, { params }) =>
      closePayPeriod(deps)(caller, { from: firstOf(params.month) }),
    shape: same,
  }),
  route({
    name: 'sendTimeOffNudges',
    method: 'POST',
    path: `${V1}/insights/nudge`,
    summary:
      'T28: send each person without a break their own message through messaging, once a day; HR or a manager',
    body: z.strictObject({
      include: z.strictObject({ balance: z.boolean(), bridge: z.boolean(), losing: z.boolean() }),
      companyName: z.string().trim().min(1).max(120),
      appOrigin: z.string().max(300),
    }),
    answer: z
      .object({ sent: z.int(), unreachable: z.int(), failed: z.int() })
      .meta({ title: 'TimeOffNudgesSent' }),
    run: (deps, caller, { body }) => sendNudges(deps)(caller, body),
    shape: same,
  }),
  route({
    name: 'remindTimeOffPayPeriod',
    method: 'POST',
    path: `${V1}/pay-periods/{month}/reminders`,
    summary:
      'Ask a team’s late members for their clock-outs, and their managers for the overtime waiting; HR',
    params: z.object({ month: Month }),
    body: z.strictObject({ teamKey: TeamKey.nullable().default(null) }),
    answer: z.object({ told: z.int() }).meta({ title: 'TimeOffReminded' }),
    run: (deps, caller, { params, body }) =>
      remindPayPeriod(deps)(caller, { from: firstOf(params.month), teamKey: body.teamKey }),
    shape: same,
  }),

  /* --------------------------------------------------------- parental -- */
  route({
    name: 'answerTimeOffParental',
    method: 'POST',
    path: `${V1}/parental`,
    summary: 'T8: the four answers and what teammates see; starts or re-answers a private draft',
    body: ParentalAnswersBody,
    answer: z.object({ planId: z.uuid() }).meta({ title: 'TimeOffParentalAnswered' }),
    run: (deps, caller, { body }) => answerParental(deps)(caller, body),
    shape: same,
  }),
  route({
    name: 'editTimeOffParentalBlocks',
    method: 'PUT',
    path: `${V1}/parental/{planId}/blocks`,
    summary: 'T9: the draft’s blocks as the parent left them, and every rule they break',
    params: PlanParams,
    body: ParentalBlocksBody,
    answer: z
      .object({
        problems: z.array(
          z.object({ code: z.string(), message: z.string() }).meta({ title: 'TimeOffPlanRule' }),
        ),
      })
      .meta({ title: 'TimeOffParentalBlocksSaved' }),
    run: (deps, caller, { params, body }) =>
      editParentalBlocks(deps)(caller, { planId: params.planId, blocks: body.blocks }),
    shape: (v) => ({ problems: v.problems.map((p) => ({ code: p.code, message: p.message })) }),
  }),
  route({
    name: 'saveTimeOffParentalHandover',
    method: 'PUT',
    path: `${V1}/parental/{planId}/handover`,
    summary: 'T10: who covers what while the parent is away, and what teammates see',
    params: PlanParams,
    body: ParentalHandoverBody,
    answer: Done,
    run: (deps, caller, { params, body }) =>
      saveParentalHandover(deps)(caller, { planId: params.planId, ...body }),
    shape: done,
  }),
  route({
    name: 'sendTimeOffParentalPlan',
    method: 'POST',
    path: `${V1}/parental/{planId}/send`,
    summary: 'T10: send the plan to HR and the manager; refused while a rule is broken',
    params: PlanParams,
    answer: PlanStatusAnswer,
    run: (deps, caller, { params }) => sendParentalPlan(deps)(caller, params.planId),
    shape: same,
  }),
  route({
    name: 'approveTimeOffParentalPlan',
    method: 'POST',
    path: `${V1}/parental/{planId}/approve`,
    summary: 'T11: approve a sent plan after the rules check; HR',
    params: PlanParams,
    answer: PlanStatusAnswer,
    run: (deps, caller, { params }) => approveParentalPlan(deps)(caller, params.planId),
    shape: same,
  }),
  route({
    name: 'recordTimeOffParentalBirth',
    method: 'POST',
    path: `${V1}/parental/{planId}/birth`,
    summary: 'The baby arrived: the mandatory weeks move to the birth; the parent or HR',
    params: PlanParams,
    body: BirthBody,
    answer: Done,
    run: (deps, caller, { params, body }) =>
      recordParentalBirth(deps)(caller, { planId: params.planId, birth: body.birth }),
    shape: done,
  }),

  /* ---------------------------------------------------------- members -- */
  route({
    name: 'importTimeOffMembers',
    method: 'POST',
    path: `${V1}/members:import`,
    summary: 'Members from CSV or JSON when People is absent: a dry run, then all rows or none; HR',
    body: ImportBody,
    answer: ImportAnswer,
    run: (deps, caller, { body }) => importMembers(deps)(caller, body),
    shape: (v) => ({ ...v, errors: [...v.errors] }),
  }),

  /* ------------------------------------------------------------ kiosk -- */
  route({
    name: 'timeOffKiosks',
    method: 'GET',
    path: `${V1}/kiosks`,
    summary: 'Every kiosk and when it was last seen; never a token; HR',
    answer: z.array(KioskView),
    run: (deps, caller) => kioskDevices(deps)(caller),
    shape: same,
  }),
  route({
    name: 'registerTimeOffKiosk',
    method: 'POST',
    path: `${V1}/kiosks`,
    summary: 'A kiosk for a location, and its token, shown this once; HR',
    body: KioskBody,
    answer: KioskRegisteredView,
    status: 201,
    run: (deps, caller, { body }) => registerKiosk(deps)(caller, body),
    shape: same,
  }),
  route({
    name: 'revokeTimeOffKiosk',
    method: 'POST',
    path: `${V1}/kiosks/{deviceId}/revoke`,
    summary: 'The kiosk’s token stops working at once; HR',
    params: KioskParams,
    answer: Done,
    run: (deps, caller, { params }) => revokeKiosk(deps)(caller, params.deviceId),
    shape: done,
  }),
  route({
    name: 'setTimeOffKioskCredential',
    method: 'PUT',
    path: `${V1}/members/{personId}/kiosk-credentials/{kind}`,
    summary: 'A member’s badge (HR) or PIN (theirs or HR’s), kept as a keyed hash; null removes it',
    params: z.object({ personId: PersonId, kind: z.enum(['badge', 'pin']) }),
    body: KioskCredentialSetBody,
    answer: Done,
    run: (deps, caller, { params, body }) => {
      if (params.kind === 'pin' && body.value !== null && !/^\d{6}$/u.test(body.value))
        return Promise.resolve(err(failure('BAD_REQUEST', 'A PIN is 6 digits', ['value'])));
      return setKioskCredential(deps)(caller, params.personId, params.kind, body.value);
    },
    shape: done,
  }),
  route({
    name: 'timeOffKioskQr',
    method: 'GET',
    path: `${V1}/kiosk-qr`,
    summary: 'The QR the caller’s phone shows a kiosk, good for a minute',
    answer: KioskQrView,
    run: (deps, caller) => issueKioskQr(deps)(caller),
    shape: same,
  }),
  route({
    name: 'timeOffKioskStatus',
    method: 'GET',
    path: `${V1}/kiosk/{deviceId}`,
    summary: 'The kiosk’s own name and location; its device token, never a person’s',
    params: KioskParams,
    answer: KioskStatusView,
    graphql: false,
    public: true,
    run: (deps, _caller, { params, bearer }) => kioskStatus(deps)(bearer ?? '', params.deviceId),
    shape: same,
  }),
  route({
    name: 'identifyAtTimeOffKiosk',
    method: 'POST',
    path: `${V1}/kiosk/{deviceId}/identify`,
    summary: 'Who tapped, by first name, and what the tap would do; writes nothing; device token',
    params: KioskParams,
    body: KioskIdentifyBody,
    answer: KioskIdentityView,
    graphql: false,
    public: true,
    run: (deps, _caller, { params, body, bearer }) =>
      kioskIdentify(deps)(bearer ?? '', params.deviceId, body.credential),
    shape: same,
  }),
  route({
    name: 'syncTimeOffKioskPunches',
    method: 'POST',
    path: `${V1}/kiosk/{deviceId}/punches`,
    summary:
      'The kiosk’s queue: each tap at its own instant, a replayed sequence punched once, skew flagged; device token',
    params: KioskParams,
    body: KioskPunchesBody,
    answer: KioskSyncView,
    graphql: false,
    public: true,
    run: (deps, _caller, { params, body, bearer }) =>
      kioskPunches(deps)(bearer ?? '', params.deviceId, body),
    shape: (v) => ({ results: [...v.results] }),
  }),

  /* ----------------------------------------------------- integrations -- */
  route({
    name: 'timeOffIntegrations',
    method: 'GET',
    path: `${V1}/integrations`,
    summary:
      'T35: calendars, chat apps, kiosks, country packs, and the modules that would read Time Off; HR',
    answer: IntegrationsView,
    run: (deps, caller) => integrationsScreen(deps)(caller),
    shape: (v) => ({
      integrations: [...v.integrations],
      kiosks: [...v.kiosks],
      locations: [...v.locations],
      packs: [...v.packs],
      modules: v.modules.map((m) => ({ key: m.key, events: [...m.events] })),
      chatAnswers: { ...v.chatAnswers },
    }),
  }),
  route({
    name: 'setTimeOffChatAnswers',
    method: 'PUT',
    path: `${V1}/integrations/chat-answers`,
    summary:
      'Whether a chat answer may name people on private leave (sick, parental): off by default, recorded with who and when; HR',
    body: ChatAnswersBody,
    answer: Done,
    run: (deps, caller, { body }) => setChatAnswers(deps)(caller, body),
    shape: done,
  }),
  route({
    name: 'connectTimeOffIntegration',
    method: 'POST',
    path: `${V1}/integrations/{provider}/connect`,
    summary:
      'The provider’s consent page, or the connection at once where access is granted in the company’s own admin console; HR',
    params: ProviderParams,
    body: ConnectBody,
    answer: ConnectAnswer,
    run: (deps, caller, { params, body }) =>
      connectIntegration(deps)(caller, params.provider, body.back),
    shape: same,
  }),
  route({
    name: 'connectMyTimeOffIntegration',
    method: 'POST',
    path: `${V1}/integrations/{provider}/connect-me`,
    summary:
      'A member’s own grant where the provider needs one (a chat status is the person’s to set); the caller, for themselves',
    params: ProviderParams,
    body: ConnectBody,
    answer: ConnectAnswer,
    run: (deps, caller, { params, body }) =>
      connectMyIntegration(deps)(caller, params.provider, body.back),
    shape: same,
  }),
  route({
    name: 'disconnectTimeOffIntegration',
    method: 'DELETE',
    path: `${V1}/integrations/{provider}`,
    summary: 'Forgets the company’s connection and every member’s grant; HR',
    params: ProviderParams,
    answer: Done,
    run: (deps, caller, { params }) => disconnectIntegration(deps)(caller, params.provider),
    shape: done,
  }),
  route({
    name: 'relayTimeOffSlackAction',
    method: 'POST',
    path: `${V1}/integrations/slack/relay`,
    summary:
      'A press on Approve or Decline in Slack, passed on by the Slack service with the pair’s secret (`x-internal-token`, not the router’s): Time Off’s signature checked, then decided as the approver it was sent to. Internal; never on the public tunnel',
    body: z.object({ tenantId: z.uuid(), value: z.string().max(2000) }),
    answer: z.object({ text: z.string() }).meta({ title: 'TimeOffChatAnswer' }),
    graphql: false,
    // Not the router's caller: the Slack service's own secret, checked by the adapter.
    public: true,
    run: (deps, _caller, { raw }) => approveFromChat(deps)('slack', raw),
    shape: same,
  }),
  route({
    name: 'completeTimeOffIntegration',
    method: 'GET',
    path: `${V1}/integrations/{provider}/callback`,
    summary:
      'Where a provider sends the browser back: checked against the state Time Off signed, stored, and redirected to the page HR came from',
    params: z.looseObject({ provider: IntegrationProviderView, state: z.string().max(4000) }),
    answer: z.object({ location: z.string() }),
    status: 302,
    graphql: false,
    public: true,
    run: (deps, _caller, { params }) => {
      const { provider, ...answer } = params;
      return completeIntegration(deps)(
        provider,
        Object.fromEntries(
          Object.entries(answer).filter((e): e is [string, string] => typeof e[1] === 'string'),
        ),
      );
    },
    shape: same,
  }),

  route({
    name: 'issueTimeOffScimConnection',
    method: 'POST',
    path: `${V1}/scim/connections`,
    summary:
      'A bearer token for an identity provider to provision members over SCIM 2.0 at /v1/timeoff/scim/v2, shown once; HR',
    answer: z.object({ id: z.uuid(), token: z.string() }).meta({ title: 'TimeOffScimConnection' }),
    status: 201,
    run: (deps, caller) => issueScimConnection(deps)(caller),
    shape: same,
  }),
  route({
    name: 'revokeTimeOffScimConnection',
    method: 'POST',
    path: `${V1}/scim/connections/{connectionId}/revoke`,
    summary: 'The identity provider’s token stops working at once; HR',
    params: z.object({ connectionId: z.uuid() }),
    answer: Done,
    run: (deps, caller, { params }) => revokeScimConnection(deps)(caller, params.connectionId),
    shape: done,
  }),

  /* --------------------------------------------------------- settings -- */
  route({
    name: 'defineTimeOffLeaveType',
    method: 'POST',
    path: `${V1}/leave-types`,
    summary: 'A new leave type; its key never changes; HR',
    body: LeaveTypeBody,
    answer: z.object({ key: LeaveTypeKey }).meta({ title: 'TimeOffLeaveTypeDefined' }),
    status: 201,
    run: (deps, caller, { body: { visibility, ...body } }) =>
      defineLeaveType(deps)(caller, { ...body, ...present({ visibility }) }),
    shape: (key) => ({ key }),
  }),
  route({
    name: 'changeTimeOffLeaveType',
    method: 'PATCH',
    path: `${V1}/leave-types/{key}`,
    summary: 'Change, hide, show or delete a leave type; a statutory one is only hidden; HR',
    params: z.object({ key: LeaveTypeKey }),
    body: LeaveTypeChangeBody,
    answer: Done,
    run: (deps, caller, { params, body }) =>
      changeLeaveType(deps)(
        caller,
        params.key,
        body.kind === 'update'
          ? { kind: 'update', changes: present(body.changes) }
          : { kind: body.kind },
      ),
    shape: done,
  }),
  route({
    name: 'draftTimeOffPolicy',
    method: 'POST',
    path: `${V1}/policies`,
    summary: 'A policy for a leave type, as a draft; HR',
    body: PolicyDefinition,
    answer: z.object({ policyId: z.uuid() }).meta({ title: 'TimeOffPolicyDrafted' }),
    status: 201,
    run: (deps, caller, { body }) => draftPolicy(deps)(caller, body),
    shape: (policyId) => ({ policyId }),
  }),
  route({
    name: 'reviseTimeOffPolicy',
    method: 'PUT',
    path: `${V1}/policies/{policyId}/draft`,
    summary: 'Replace the draft, or start the next version’s; HR',
    params: z.object({ policyId: PolicyId }),
    body: PolicyDefinition,
    answer: VersionAnswer,
    run: (deps, caller, { params, body }) => revisePolicy(deps)(caller, params.policyId, body),
    shape: (version) => ({ version }),
  }),
  route({
    name: 'setTimeOffNegativeBalanceRule',
    method: 'PUT',
    path: `${V1}/policies/{policyId}/negative-balance`,
    summary: 'T31: going below zero, as a revision of the policy, published like any other; HR',
    params: z.object({ policyId: PolicyId }),
    body: NegativeRuleBody,
    answer: VersionAnswer,
    run: (deps, caller, { params, body }) =>
      setNegativeBalanceRule(deps)(caller, params.policyId, body.rule),
    shape: (version) => ({ version }),
  }),
  route({
    name: 'publishTimeOffPolicy',
    method: 'POST',
    path: `${V1}/policies/{policyId}/publish`,
    summary:
      'Publish the draft from a date: balances re-fold and timeoff.policy.published goes out; HR',
    params: z.object({ policyId: PolicyId }),
    body: PublishBody,
    answer: z
      .object({ version: z.int(), refolded: z.int() })
      .meta({ title: 'TimeOffPolicyPublished' }),
    run: (deps, caller, { params, body }) =>
      publishPolicy(deps)(caller, params.policyId, body.effectiveFrom),
    shape: same,
  }),
  route({
    name: 'startTimeOffShadowRun',
    method: 'PUT',
    path: `${V1}/policies/{policyId}/shadow`,
    summary: 'Run the draft beside the policy in effect for a month, to compare balances; HR',
    params: z.object({ policyId: PolicyId }),
    answer: z.object({ from: CalendarDate, to: CalendarDate }).meta({ title: 'TimeOffShadow' }),
    run: (deps, caller, { params }) => startShadowRun(deps)(caller, params.policyId),
    shape: same,
  }),
  route({
    name: 'stopTimeOffShadowRun',
    method: 'DELETE',
    path: `${V1}/policies/{policyId}/shadow`,
    summary: 'Stop running the draft beside the policy in effect; HR',
    params: z.object({ policyId: PolicyId }),
    answer: Done,
    run: (deps, caller, { params }) => stopShadowRun(deps)(caller, params.policyId),
    shape: done,
  }),
  route({
    name: 'saveTimeOffHolidayCalendar',
    method: 'PUT',
    path: `${V1}/holiday-calendars/{key}`,
    summary: 'A layer of holidays: national, regional or city; HR',
    params: z.object({ key: HolidayLayerBody.shape.key }),
    body: LayerBody,
    answer: Done,
    run: (deps, caller, { params, body }) =>
      saveHolidayCalendar(deps)(caller, { key: params.key, ...body }),
    shape: done,
  }),
  route({
    name: 'removeTimeOffHolidayCalendar',
    method: 'DELETE',
    path: `${V1}/holiday-calendars/{key}`,
    summary: 'Remove a holiday layer; HR',
    params: z.object({ key: HolidayLayerBody.shape.key }),
    answer: Done,
    run: (deps, caller, { params }) => removeHolidayCalendar(deps)(caller, params.key),
    shape: done,
  }),
  route({
    name: 'assignTimeOffHolidayCalendars',
    method: 'PUT',
    path: `${V1}/locations/{locationKey}/holiday-calendars`,
    summary: 'The layers a work location observes, most general first; HR',
    params: z.object({ locationKey: LocationKey }),
    body: AssignBody,
    answer: Done,
    run: (deps, caller, { params, body }) =>
      assignHolidayCalendars(deps)(caller, params.locationKey, body.layerKeys),
    shape: done,
  }),
  route({
    name: 'setTimeOffApprovalRules',
    method: 'PUT',
    path: `${V1}/approval-rules`,
    summary:
      'T34: who approves what, what is approved automatically, and what happens if nobody decides; HR',
    body: ApprovalRulesBody,
    answer: Done,
    run: (deps, caller, { body }) =>
      setApprovalRules(deps)(caller, body.rules, body.autoApproval, body.escalation),
    shape: done,
  }),
  route({
    name: 'setTimeOffParentalCompany',
    method: 'PUT',
    path: `${V1}/settings/parental-company`,
    summary:
      'The company’s own parental weeks, after how many years, and the leave type they are booked as; 0 weeks for none; HR',
    body: ParentalCompanyBody,
    answer: Done,
    run: (deps, caller, { body }) => setParentalCompany(deps)(caller, body),
    shape: done,
  }),
  route({
    name: 'setTimeOffTeamMinimum',
    method: 'PUT',
    path: `${V1}/teams/{teamKey}/minimum`,
    summary: 'How many of a team must be in, or none; HR',
    params: z.object({ teamKey: TeamKey }),
    body: MinimumBody,
    answer: Done,
    run: (deps, caller, { params, body }) =>
      setTeamMinimum(deps)(caller, params.teamKey, body.minimum),
    shape: done,
  }),
  route({
    name: 'setTimeOffAttendanceRules',
    method: 'PUT',
    path: `${V1}/attendance-rules`,
    summary: 'T33: breaks, rest, the weekly limit and what overtime becomes; HR',
    body: AttendanceRulesBody,
    answer: Done,
    run: (deps, caller, { body }) => setAttendanceRules(deps)(caller, body),
    shape: done,
  }),
  route({
    name: 'assignTimeOffSchedule',
    method: 'PUT',
    path: `${V1}/schedules`,
    summary: 'A schedule for some members: fixed, flexible, seasonal or rotating; HR',
    body: AssignScheduleBody,
    answer: Done,
    run: (deps, caller, { body }) => assignSchedule(deps)(caller, body.personIds, body.schedule),
    shape: done,
  }),
];

/* ---------------------------------------------------------- dispatcher -- */

const STATUS: Record<string, number> = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  INVALID_TOKEN: 401,
  NOT_ENTITLED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_TRANSITION: 409,
  OVERLAP: 409,
  ALREADY_CLOSED: 409,
  BIRTH_ALREADY_RECORDED: 409,
  INVALID_ACTION: 401,
  EARLIER_PERIOD_OPEN: 409,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  IDEMPOTENCY_KEY_REUSED: 422,
  UNAVAILABLE: 503,
};

export function refused(error: DomainFailure): RestResponse {
  return {
    status: STATUS[error.code] ?? 422,
    body: {
      error: {
        code: error.code,
        message: error.message,
        ...(error.path ? { path: error.path } : {}),
      },
    },
  };
}

function parse<T>(schema: z.ZodType<T>, value: unknown): Result<T> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return ok(parsed.data);
  const issue = parsed.error.issues[0];
  return err(failure('BAD_REQUEST', issue?.message ?? 'invalid request', issue?.path.map(String)));
}

/** The schema under its optional, nullable and default wrappers. */
function base(schema: z.ZodType): z.ZodType {
  let s = schema;
  for (;;) {
    const def = s._zod.def as { type: string; innerType?: z.ZodType };
    if (
      def.innerType === undefined ||
      !['optional', 'nullable', 'default', 'prefault'].includes(def.type)
    )
      return s;
    s = def.innerType;
  }
}

/** Query and path text as the parameter's own type: `true`, `2026`. */
function coerce(params: z.ZodObject, raw: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, text] of Object.entries(raw)) {
    const field = params.shape[key] as z.ZodType | undefined;
    const type = field === undefined ? 'string' : (base(field)._zod.def as { type: string }).type;
    out[key] =
      type === 'boolean'
        ? text === 'true'
          ? true
          : text === 'false'
            ? false
            : text
        : type === 'number' && text.trim() !== '' && !Number.isNaN(Number(text))
          ? Number(text)
          : text;
  }
  return out;
}

const escape = (s: string) => s.replaceAll(/[.*+?^$()|[\]\\]/gu, '\\$&');

interface Compiled {
  readonly route: Route;
  readonly pattern: RegExp;
  readonly names: readonly string[];
}

function compile(r: Route): Compiled {
  const names: string[] = [];
  const source = r.path
    .split(/(\{[a-zA-Z]+\})/u)
    .map((part) => {
      const name = /^\{([a-zA-Z]+)\}$/u.exec(part)?.[1];
      if (name === undefined) return escape(part);
      names.push(name);
      return '([^/]+)';
    })
    .join('');
  return { route: r, pattern: new RegExp(`^${source}$`, 'u'), names };
}

/** Thrown inside a write's transaction when another request committed its key first. */
class Raced extends Error {}

/**
 * The deps a write runs with: the same unit of work, saving the key and the
 * answer in the write's own transaction — its first, which for every write
 * here is the only one.
 */
function keyed(uow: UnitOfWork, key: string, stored: (value: unknown) => StoredKey): UnitOfWork {
  let saved = false;
  return {
    run: (tenantId, fn) =>
      uow.run(tenantId, async (tx) => {
        const value = await fn(tx);
        if (!saved) {
          if (!(await tx.idempotency.save(key, stored(value)))) throw new Raced();
          saved = true;
        }
        return value;
      }),
  };
}

const KEY_REUSED = failure('IDEMPOTENCY_KEY_REUSED', 'This key was used for a different request');

export function restHandler(
  rest: RestDeps,
): (request: RestRequest) => Promise<RestResponse | null> {
  const compiled = ROUTES.map(compile);
  const { deps } = rest;

  const answer = (r: Route, result: Result<unknown>): RestResponse => {
    if (!result.ok) return refused(result.error);
    const body = r.shape(result.value);
    // A provider's callback sends the browser back where it came from.
    if (r.status === 302) {
      return {
        status: 302,
        body: '',
        headers: { location: (body as { location: string }).location },
      };
    }
    return typeof body === 'string'
      ? { status: r.status, body, headers: { 'content-type': 'text/calendar; charset=utf-8' } }
      : { status: r.status, body };
  };

  return async (request) => {
    const url = new URL(request.url, 'http://timeoff.internal');
    if (!url.pathname.startsWith(`${V1}/`)) return null;
    const matching = compiled.filter((c) => c.pattern.test(url.pathname));
    if (matching.length === 0) return refused(failure('NOT_FOUND', 'No such route'));
    const found = matching.find((c) => c.route.method === request.method);
    if (found === undefined) {
      return {
        status: 405,
        body: { error: { code: 'METHOD_NOT_ALLOWED', message: request.method } },
      };
    }
    const r = found.route;
    const values = found.pattern.exec(url.pathname) ?? [];
    const raw: Record<string, string> = {};
    found.names.forEach((name, i) => {
      raw[name] = decodeURIComponent(values[i + 1] ?? '');
    });
    if (r.method === 'GET') for (const [k, v] of url.searchParams) raw[k] ??= v;
    const params = parse(r.params, coerce(r.params, raw));
    if (!params.ok) return refused(params.error);

    /** The body, parsed by the route's schema; checked after who is asking and the key. */
    const bodyOf = (): Result<unknown> => {
      if (r.body === null) return ok(undefined);
      let json: unknown;
      try {
        json = request.body === '' ? {} : JSON.parse(request.body);
      } catch {
        return err(failure('BAD_REQUEST', 'The body is not JSON'));
      }
      return parse(r.body, json);
    };

    if (r.public) {
      // Reached with a token of its own (a feed's, a kiosk's), not through the router.
      const anonymous: Caller = {
        tenantId: '' as Caller['tenantId'],
        accountId: '',
        personId: null,
        correlationId: '',
      };
      const authorization = request.headers['authorization'];
      const bearer =
        typeof authorization === 'string' && authorization.startsWith('Bearer ')
          ? authorization.slice('Bearer '.length).trim()
          : null;
      const body = bodyOf();
      if (!body.ok) return refused(body.error);
      return answer(
        r,
        await r.run(deps, anonymous, {
          params: params.value,
          body: body.value,
          bearer,
          raw: { headers: request.headers, body: request.body },
        }),
      );
    }
    const caller = await rest.callerFrom(request);
    if (!caller.ok) return refused(caller.error);

    const writes = r.method !== 'GET';
    // Every write is keyed, checked before anything else so that no route can forget it.
    const key = request.headers['idempotency-key'];
    if (writes && (typeof key !== 'string' || key.length === 0 || key.length > 255)) {
      return refused(
        failure('IDEMPOTENCY_KEY_REQUIRED', 'Every write carries an Idempotency-Key header'),
      );
    }
    const parsedBody = bodyOf();
    if (!parsedBody.ok) return refused(parsedBody.error);
    const body = parsedBody.value;
    const input = { params: params.value, body, bearer: null, raw: { headers: {}, body: '' } };
    if (!writes || typeof key !== 'string')
      return answer(r, await r.run(deps, caller.value, input));

    const tenantId = caller.value.tenantId;
    // The caller is part of the request: one key reused by two people is two requests.
    const requestHash = createHash('sha256')
      .update(
        `${caller.value.accountId}\n${request.method} ${url.pathname}${url.search}\n${request.body}`,
      )
      .digest('hex');
    const replay = async (): Promise<RestResponse | null> => {
      const prior = await deps.uow.run(tenantId, (tx) => tx.idempotency.find(key));
      if (prior === null) return null;
      return prior.requestHash === requestHash
        ? { status: prior.status, body: prior.answer }
        : refused(KEY_REUSED);
    };
    const before = await replay();
    if (before !== null) return before;
    try {
      const result = await r.run(
        {
          ...deps,
          uow: keyed(deps.uow, key, (value) => ({
            requestHash,
            status: r.status,
            answer: JSON.parse(JSON.stringify(r.shape(value) ?? null)) as unknown,
          })),
        },
        caller.value,
        input,
      );
      return answer(r, result);
    } catch (error) {
      if (!(error instanceof Raced)) throw error;
      return (await replay()) ?? refused(KEY_REUSED);
    }
  };
}
