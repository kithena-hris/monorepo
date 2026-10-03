import * as z from 'zod';
import {
  AttendanceWorkModel,
  CalendarDate,
  ClockState,
  DayAmount,
  Instant,
  LeaveCategory,
  LeaveTypeDefinition,
  LeaveTypeKey,
  LeaveUnit,
  LedgerEntry,
  LocationKey,
  NegativeBalanceRule,
  PersonId,
  PolicyDefinition,
  PunchKind,
  PunchSource,
  RequestStatus,
  TeamKey,
} from '@kithena/contracts';

/**
 * What each screen reads, as Zod (PRD §15.2, TOF-044, TOF-046).
 *
 * One definition per shape, and every transport is generated from it: the
 * REST answer and its OpenAPI schema, and the subgraph's output type
 * (`graphql/zod.ts`). A `title` names the type wherever it is shared; a
 * nested object without one is named after the field that holds it.
 *
 * Unions are flattened into one object with nullable fields wherever a
 * screen reads them, because a GraphQL union needs a type per member and
 * these are small; the settings definitions, whose unions are the policy
 * language, cross as JSON.
 */

const named = <T extends z.ZodType>(title: string, schema: T): T => schema.meta({ title });

/* ---------------------------------------------------------------- shared -- */

export const SpanView = named(
  'TimeOffSpan',
  z.object({
    from: CalendarDate,
    to: CalendarDate,
    startsHalfDay: z.boolean(),
    endsHalfDay: z.boolean(),
  }),
);

export const RangeView = named('TimeOffRange', z.object({ from: CalendarDate, to: CalendarDate }));

export const MemberView = named(
  'TimeOffMember',
  z.object({
    personId: PersonId,
    displayName: z.string(),
    firstName: z.string(),
    teamKey: TeamKey.nullable(),
    teamName: z.string().nullable(),
    locationKey: LocationKey.nullable(),
    timeZone: z.string(),
    managerPersonId: PersonId.nullable(),
  }),
);

export const BalanceView = named(
  'TimeOffBalance',
  z.object({
    leaveTypeKey: LeaveTypeKey,
    name: z.string(),
    unit: LeaveUnit,
    colorToken: z.string(),
    icon: z.string(),
    left: DayAmount,
    used: DayAmount,
    booked: DayAmount,
    /** Credited so far this leave year. */
    allowance: DayAmount,
    /** What the policy grants for the whole year, for "of 25". */
    yearly: DayAmount.nullable(),
  }),
);

export const RequestItem = named(
  'TimeOffRequestItem',
  z.object({
    requestId: z.uuid(),
    personId: PersonId,
    displayName: z.string(),
    leaveTypeKey: LeaveTypeKey,
    leaveTypeName: z.string(),
    category: LeaveCategory,
    status: RequestStatus,
    span: SpanView,
    /** More than one run when other dates were accepted (T18). */
    spans: z.array(RangeView),
    workingDays: DayAmount,
    requestedAt: Instant,
    /** The role whose turn it is, while it waits on an approver. */
    waitingOn: z.enum(['manager', 'hr']).nullable(),
  }),
);

export const CoverageDay = named(
  'TimeOffCoverageDay',
  z.object({
    date: CalendarDate,
    in: z.int(),
    of: z.int(),
    required: z.int(),
    checked: z.boolean(),
    below: z.boolean(),
  }),
);

export const PreviewView = named(
  'TimeOffRequestPreview',
  z.object({
    span: SpanView.extend({ workingDays: DayAmount }),
    daysAway: z.object({ from: CalendarDate, to: CalendarDate, days: DayAmount }),
    balance: z.object({ before: DayAmount, after: DayAmount }).nullable(),
    belowMinimum: z.array(CoverageDay),
    blocked: z.boolean(),
    negative: z.object({
      kind: z.enum(['fits', 'borrow', 'refused']),
      /** How far below zero, when borrowing. */
      days: DayAmount.nullable(),
      nextYearStartsAt: DayAmount.nullable(),
      /** The furthest it may go, when refused. */
      limit: DayAmount.nullable(),
      approvers: z.array(z.enum(['manager', 'hr'])),
      unpaid: z.object({ days: DayAmount }).nullable(),
      shorten: z.object({ to: CalendarDate, endsHalfDay: z.boolean(), days: DayAmount }).nullable(),
    }),
    approvers: z.array(z.enum(['manager', 'hr'])),
    /** "Send to Marco". */
    approver: z.object({ personId: PersonId, displayName: z.string() }).nullable(),
  }),
);

export const DayView = named(
  'TimeOffDay',
  z.object({
    date: CalendarDate,
    status: z.enum(['complete', 'live', 'open', 'planned', 'absent']),
    workedMinutes: z.int().nullable(),
    breakMinutes: z.int(),
    plannedMinutes: z.int(),
    overtimeMinutes: z.int(),
    segments: z.array(
      named(
        'TimeOffDaySegment',
        z.object({
          kind: z.enum(['worked', 'break', 'overtime', 'missing', 'planned', 'live']),
          from: z.int(),
          to: z.int(),
        }),
      ),
    ),
    flags: z.array(z.enum(['break_missing', 'core_hours_missed'])),
  }),
);

export const PunchView = named(
  'TimeOffPunch',
  z.object({
    id: z.uuid(),
    at: Instant,
    recordedAt: Instant,
    kind: PunchKind,
    source: PunchSource,
    workModel: AttendanceWorkModel,
    supersedes: z.uuid().nullable(),
    reason: z.string().nullable(),
  }),
);

/* -------------------------------------------------------------- employee -- */

export const OverviewView = named(
  'TimeOffOverview',
  z.object({
    /** `null` for an HR account that is not itself a member. */
    member: MemberView.nullable(),
    clock: z
      .object({
        state: ClockState,
        workModel: AttendanceWorkModel.nullable(),
        today: DayView,
      })
      .nullable(),
    balances: z.array(BalanceView),
    comingUp: z.array(RequestItem),
    teamToday: z.array(
      named(
        'TimeOffWhoIsOff',
        z.object({
          personId: PersonId,
          displayName: z.string(),
          /** `null` when the caller sees "Off" and nothing else. */
          leaveTypeKey: LeaveTypeKey.nullable(),
          span: SpanView,
        }),
      ),
    ),
  }),
);

export const RequestPanelView = named(
  'TimeOffRequestPanel',
  z.object({
    leaveTypes: z.array(
      named(
        'TimeOffRequestableType',
        z.object({
          key: LeaveTypeKey,
          name: z.string(),
          category: LeaveCategory,
          unit: LeaveUnit,
          tracked: z.boolean(),
          colorToken: z.string(),
          icon: z.string(),
          left: DayAmount.nullable(),
          requiresNoteAfterDays: z.int().nullable(),
        }),
      ),
    ),
    preview: PreviewView.nullable(),
  }),
);

export const MyRequestsView = named(
  'TimeOffMyRequests',
  z.object({ tab: z.enum(['upcoming', 'past', 'cancelled']), items: z.array(RequestItem) }),
);

export const RequestDetailView = named(
  'TimeOffRequestDetail',
  z.object({
    request: RequestItem,
    note: z.string().nullable(),
    /** Whether a sick note is attached; the file itself only to its member and HR. */
    notePresent: z.boolean(),
    sickNoteFileId: z.uuid().nullable(),
    pendingChange: SpanView.nullable(),
    proposals: z.array(
      named(
        'TimeOffProposal',
        z.object({ index: z.int(), spans: z.array(RangeView), workingDays: DayAmount }),
      ),
    ),
    chain: z.array(z.enum(['manager', 'hr'])),
    step: z.int(),
    escalated: z.boolean(),
    mine: z.boolean(),
    canChange: z.boolean(),
    canCancel: z.boolean(),
    canAnswer: z.boolean(),
    canDecide: z.boolean(),
  }),
);

export const BalanceLedgerView = named(
  'TimeOffBalanceLedger',
  z.object({
    balance: BalanceView,
    entries: z.array(LedgerEntry.meta({ title: 'TimeOffLedgerEntry' })),
  }),
);

export const HolidaysView = named(
  'TimeOffHolidays',
  z.object({
    year: z.int(),
    locationKey: LocationKey.nullable(),
    holidays: z.array(
      named(
        'TimeOffHoliday',
        z.object({
          date: CalendarDate,
          name: z.string(),
          layer: z.string(),
          movedFrom: CalendarDate.nullable(),
        }),
      ),
    ),
  }),
);

/* --------------------------------------------------------------- manager -- */

export const LookCloserReason = named(
  'TimeOffLookCloser',
  z.object({
    rule: z.enum([
      'below_zero',
      'over_banked',
      'below_minimum',
      'protected_period',
      'sick_over_threshold',
    ]),
    /** Days below zero, hours short, or sick days, by rule. */
    amount: z.string().nullable(),
    days: z.array(CalendarDate),
  }),
);

export const ApprovalsView = named(
  'TimeOffApprovals',
  z.object({
    tab: z.enum(['waiting', 'coming_up', 'decided']),
    clear: z.array(RequestItem),
    lookCloser: z.array(
      named('TimeOffLookCloserItem', z.object({ item: RequestItem, reason: LookCloserReason })),
    ),
    items: z.array(RequestItem),
  }),
);

export const DecisionView = named(
  'TimeOffRequestDecision',
  z.object({
    request: RequestItem,
    member: MemberView,
    note: z.string().nullable(),
    /** What was left before this request, and after it. */
    balance: z.object({ before: DayAmount, after: DayAmount }).nullable(),
    belowMinimum: z.array(CoverageDay),
    triage: z.object({
      group: z.enum(['clear', 'look_closer']),
      reason: LookCloserReason.nullable(),
    }),
    /** Teammates off on any of these days, as the caller may see them. */
    othersOff: z.array(
      named(
        'TimeOffOtherOff',
        z.object({
          personId: PersonId,
          displayName: z.string(),
          leaveTypeKey: LeaveTypeKey.nullable(),
          span: SpanView,
        }),
      ),
    ),
    canDecide: z.boolean(),
  }),
);

export const DelegationView = named(
  'TimeOffDelegation',
  z.object({
    delegation: z
      .object({
        delegateId: PersonId,
        delegateName: z.string(),
        range: RangeView.nullable(),
        automatic: z.boolean(),
        salaryRelated: z.boolean(),
      })
      .nullable(),
    candidates: z.array(
      named('TimeOffPersonRef', z.object({ personId: PersonId, displayName: z.string() })),
    ),
    coveringFor: z.array(
      named(
        'TimeOffCover',
        z.object({
          approverId: PersonId,
          approverName: z.string(),
          range: RangeView.nullable(),
          automatic: z.boolean(),
        }),
      ),
    ),
  }),
);

export const CalendarView = named(
  'TimeOffCalendar',
  z.object({
    from: CalendarDate,
    to: CalendarDate,
    people: z.array(
      named(
        'TimeOffCalendarPerson',
        z.object({ personId: PersonId, displayName: z.string(), teamKey: TeamKey.nullable() }),
      ),
    ),
    entries: z.array(
      named(
        'TimeOffCalendarEntry',
        z.object({
          requestId: z.uuid(),
          personId: PersonId,
          span: SpanView,
          status: RequestStatus,
          /** `null`: the caller sees "Off" and nothing else (sick, parental). */
          leaveTypeKey: LeaveTypeKey.nullable(),
        }),
      ),
    ),
    holidays: z.array(
      named(
        'TimeOffCalendarHoliday',
        z.object({ date: CalendarDate, name: z.string(), locationKey: LocationKey }),
      ),
    ),
    coverage: z.array(CoverageDay),
  }),
);

export const YearView = named(
  'TimeOffCalendarYear',
  z.object({
    year: z.int(),
    days: z.array(named('TimeOffDayOff', z.object({ date: CalendarDate, off: z.int() }))),
  }),
);

export const TimesheetView = named(
  'TimeOffTimesheet',
  z.object({
    member: MemberView,
    days: z.array(DayView),
    weeks: z.array(
      named(
        'TimeOffWeek',
        z.object({
          monday: CalendarDate,
          workedMinutes: z.int(),
          plannedMinutes: z.int(),
          overtimeMinutes: z.int(),
          flags: z.array(z.enum(['weekly_max_exceeded'])),
        }),
      ),
    ),
    open: z.array(named('TimeOffOpenDay', z.object({ date: CalendarDate, lastPunchAt: Instant }))),
    restBreaches: z.array(
      named('TimeOffRestBreach', z.object({ date: CalendarDate, restMinutes: z.int() })),
    ),
    overtime: z.array(
      named(
        'TimeOffOvertimeDecision',
        z.object({
          date: CalendarDate,
          minutes: z.int(),
          outcome: z.enum(['comp', 'paid', 'declined']),
        }),
      ),
    ),
    punches: z.array(PunchView),
    corrections: z.array(
      named('TimeOffCorrection', z.object({ punch: PunchView, needsManager: z.boolean() })),
    ),
  }),
);

export const RightNowView = named(
  'TimeOffTeamRightNow',
  z.object({
    people: z.array(
      named(
        'TimeOffRightNowPerson',
        z.object({
          personId: PersonId,
          displayName: z.string(),
          state: ClockState,
          workModel: AttendanceWorkModel.nullable(),
          today: DayView,
        }),
      ),
    ),
    needsYou: z.array(
      named(
        'TimeOffNeedsYou',
        z.object({
          kind: z.enum(['correction', 'overtime']),
          personId: PersonId,
          displayName: z.string(),
          punch: PunchView.nullable(),
          date: CalendarDate,
          minutes: z.int().nullable(),
        }),
      ),
    ),
  }),
);

/* -------------------------------------------------------------- settings -- */

const LeaveTypeRow = named(
  'TimeOffLeaveTypeSetting',
  z.object({
    definition: LeaveTypeDefinition.meta({ title: 'TimeOffLeaveTypeDefinition' }),
    hidden: z.boolean(),
    deleted: z.boolean(),
    policyIds: z.array(z.uuid()),
  }),
);

export const LeaveTypesView = named(
  'TimeOffSettingsLeaveTypes',
  z.object({ leaveTypes: z.array(LeaveTypeRow) }),
);

const PolicyVersionView = named(
  'TimeOffPolicyVersion',
  z.object({
    version: z.int(),
    status: z.enum(['draft', 'published']),
    effectiveFrom: CalendarDate.nullable(),
    definition: PolicyDefinition.meta({ title: 'TimeOffPolicyDefinition' }),
  }),
);

export const LeaveTypeSettingView = named(
  'TimeOffSettingsLeaveType',
  z.object({
    leaveType: LeaveTypeRow,
    policies: z.array(
      named('TimeOffPolicy', z.object({ id: z.uuid(), versions: z.array(PolicyVersionView) })),
    ),
  }),
);

export const NegativeBalanceView = named(
  'TimeOffSettingsNegativeBalance',
  z.object({
    policies: z.array(
      named(
        'TimeOffNegativeBalancePolicy',
        z.object({
          policyId: z.uuid(),
          leaveTypeKey: LeaveTypeKey,
          leaveTypeName: z.string(),
          version: z.int(),
          status: z.enum(['draft', 'published']),
          rule: NegativeBalanceRule.meta({ title: 'TimeOffNegativeBalanceRule' }).nullable(),
        }),
      ),
    ),
  }),
);

export const AttendanceRulesBody = named(
  'TimeOffAttendanceRules',
  z.strictObject({
    breakAfterMinutes: z.int().min(0),
    breakMinutes: z.int().min(0),
    restMinutes: z.int().min(0),
    weeklyMaxMinutes: z.int().min(0),
    overtime: z.strictObject({
      becomes: z.enum(['comp', 'paid', 'choose']),
      multiplier: z.string().regex(/^\d+(\.\d+)?$/u),
    }),
  }),
);

export const AttendanceSettingsView = named(
  'TimeOffSettingsAttendance',
  z.object({
    rules: AttendanceRulesBody,
    /** The schedule a member without one works (JSON: the schedule's own shape). */
    defaultSchedule: z.unknown(),
  }),
);

export const ApprovalRuleBody = named(
  'TimeOffApprovalRule',
  z.strictObject({
    subject: z.enum(['request', 'plan', 'timesheet']),
    leaveTypes: z.array(LeaveTypeKey).nullable(),
    when: z.enum(['always', 'below_zero', 'unpaid']),
    approvers: z.array(z.enum(['manager', 'hr'])).min(1),
  }),
);

export const AutoApprovalBody = named(
  'TimeOffAutoApproval',
  z.strictObject({
    shortenOrCancel: z.boolean(),
    sickUnderDays: z.int().min(1).nullable(),
    oneDayAboveMinimum: z.boolean(),
  }),
);

export const TeamMinimumBody = named(
  'TimeOffTeamMinimum',
  z.strictObject({ atLeast: z.int(), unit: z.enum(['people', 'percent']) }),
);

export const ApprovalsSettingsView = named(
  'TimeOffSettingsApprovals',
  z.object({
    rules: z.array(ApprovalRuleBody),
    autoApproval: AutoApprovalBody,
    teams: z.array(
      named(
        'TimeOffTeamSetting',
        z.object({
          teamKey: TeamKey,
          teamName: z.string().nullable(),
          minimum: TeamMinimumBody.nullable(),
        }),
      ),
    ),
  }),
);

export const HolidayLayerBody = named(
  'TimeOffHolidayLayer',
  z.strictObject({
    key: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/u),
    name: z.string().trim().min(1).max(200),
    level: z.enum(['national', 'regional', 'city']),
    weekendRule: z.enum(['move_to_monday', 'none']),
    holidays: z.array(
      named(
        'TimeOffHolidayLayerDay',
        z.strictObject({ date: CalendarDate, name: z.string().trim().min(1).max(200) }),
      ),
    ),
  }),
);

export const HolidaySettingsView = named(
  'TimeOffSettingsHolidays',
  z.object({
    year: z.int(),
    layers: z.array(HolidayLayerBody),
    locations: z.array(
      named(
        'TimeOffLocationHolidays',
        z.object({
          locationKey: LocationKey,
          layerKeys: z.array(z.string()),
          holidays: z.array(
            z
              .object({
                date: CalendarDate,
                name: z.string(),
                layer: z.string(),
                movedFrom: CalendarDate.nullable(),
              })
              .meta({ title: 'TimeOffResolvedHoliday' }),
          ),
        }),
      ),
    ),
  }),
);

/* ---------------------------------------------------------------- viewer -- */

/**
 * What the shell asks once a page for the Time Off area (TOF-058a): whether
 * the caller approves anyone — a fact of the org graph Time Off projects, not
 * a role an admin grants — whether they are HR, and the counts on Requests
 * and Attendance.
 */
export const ViewerView = named(
  'TimeOffViewer',
  z.object({
    approves: z.boolean(),
    hrAdmin: z.boolean(),
    counts: z.object({ requestsWaiting: z.int(), attendanceExceptions: z.int() }),
  }),
);

/** A view as a use case builds it: readonly all the way down, as the domain's values are. */
type DeepReadonly<T> = T extends readonly (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends string | number | boolean | null | undefined
    ? T
    : { readonly [K in keyof T]: DeepReadonly<T[K]> };
export type View<S extends z.ZodType> = DeepReadonly<z.output<S>>;

export type SpanView = View<typeof SpanView>;
export type MemberView = View<typeof MemberView>;
export type BalanceView = View<typeof BalanceView>;
export type RequestItem = View<typeof RequestItem>;
export type PreviewView = View<typeof PreviewView>;
export type DayView = View<typeof DayView>;
export type PunchView = View<typeof PunchView>;
export type OverviewView = View<typeof OverviewView>;
export type RequestPanelView = View<typeof RequestPanelView>;
export type MyRequestsView = View<typeof MyRequestsView>;
export type RequestDetailView = View<typeof RequestDetailView>;
export type BalanceLedgerView = View<typeof BalanceLedgerView>;
export type HolidaysView = View<typeof HolidaysView>;
export type ApprovalsView = View<typeof ApprovalsView>;
export type DecisionView = View<typeof DecisionView>;
export type DelegationView = View<typeof DelegationView>;
export type CalendarView = View<typeof CalendarView>;
export type YearView = View<typeof YearView>;
export type TimesheetView = View<typeof TimesheetView>;
export type RightNowView = View<typeof RightNowView>;
export type LeaveTypesView = View<typeof LeaveTypesView>;
export type LeaveTypeSettingView = View<typeof LeaveTypeSettingView>;
export type NegativeBalanceView = View<typeof NegativeBalanceView>;
export type AttendanceSettingsView = View<typeof AttendanceSettingsView>;
export type ApprovalsSettingsView = View<typeof ApprovalsSettingsView>;
export type HolidaySettingsView = View<typeof HolidaySettingsView>;
export type ViewerView = View<typeof ViewerView>;
