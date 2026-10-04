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

/** A line of text and who wrote it: `ai` only when a model did (PRD §14.1, `assist/written.ts`). */
export const WrittenView = named('TimeOffWritten', z.object({ text: z.string(), ai: z.boolean() }));

/** Days that join a holiday to the days off around it (T1, MT1, MT21), and the line about them. */
export const BridgeView = named(
  'TimeOffBridge',
  z.object({
    /** The working days to ask for. */
    from: CalendarDate,
    to: CalendarDate,
    used: z.int(),
    away: named('TimeOffBreak', z.object({ from: CalendarDate, to: CalendarDate, days: z.int() })),
    holidays: z.array(
      named('TimeOffBridgedHoliday', z.object({ date: CalendarDate, name: z.string() })),
    ),
    text: WrittenView,
  }),
);

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
    /** A kiosk's clock this far off when it sent the punch, in seconds: an exception (§11.9). */
    clockSkewSeconds: z.int().nullable(),
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
    /** The best bridge days ahead, two at most (TOF-085). */
    bridges: z.array(BridgeView),
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
    /** What the manager wrote with the suggested dates (TOF-099b), while they wait. */
    proposalMessage: z.string().nullable(),
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
    /** The year's bridge days still ahead, in date order (TOF-085). */
    bridges: z.array(BridgeView),
  }),
);

/** T4, MT8: a sentence read as choices, and the dates the domain found for them (TOF-090). */
export const DescribedView = named(
  'TimeOffDescribed',
  z.object({
    sentence: z.string().nullable(),
    understood: named(
      'TimeOffUnderstood',
      z.object({
        leaveTypeKey: LeaveTypeKey.nullable(),
        leaveTypeName: z.string().nullable(),
        days: z.int(),
        /** `YYYY-MM`, or `null` for the next three months. */
        month: z.string().nullable(),
        nextToHoliday: z.boolean(),
        avoidShort: z.boolean(),
        /** Whether a model read the sentence; the rules did otherwise. */
        ai: z.boolean(),
      }),
    ),
    leaveTypes: z.array(
      named('TimeOffTypeChoice', z.object({ key: LeaveTypeKey, name: z.string() })),
    ),
    /** What is left of the type, `null` when it is not tracked. */
    left: DayAmount.nullable(),
    options: z.array(
      named(
        'TimeOffDateOption',
        z.object({
          from: CalendarDate,
          to: CalendarDate,
          used: z.int(),
          away: z.object({ from: CalendarDate, to: CalendarDate, days: z.int() }).meta({
            title: 'TimeOffOptionBreak',
          }),
          holidays: z.array(
            z
              .object({ date: CalendarDate, name: z.string() })
              .meta({ title: 'TimeOffOptionHoliday' }),
          ),
          short: z.array(CoverageDay),
          fewest: z
            .object({ in: z.int(), of: z.int() })
            .meta({ title: 'TimeOffFewest' })
            .nullable(),
          /** Whether the balance covers it, and what it would leave. */
          fits: z.boolean(),
          leftAfter: DayAmount.nullable(),
          line: WrittenView,
        }),
      ),
    ),
  }),
);

/* --------------------------------------------------------------- manager -- */

export const PersonRef = named(
  'TimeOffPersonRef',
  z.object({ personId: PersonId, displayName: z.string() }),
);

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
    /** Waiting for me: each request's one line, clear or not (TOF-086). */
    why: z.array(named('TimeOffWhy', z.object({ requestId: z.uuid(), text: WrittenView }))),
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
    /** The member's last approved or taken time off before these dates (§9.4). */
    lastTaken: RangeView.nullable(),
    /**
     * What to do about a clash with the team minimum (§9.5, §9.6), ranked by
     * the domain: the requester's own changes first, then none, then asking a
     * teammate. Each with its days and their coverage. Empty when nothing
     * clashes in a team with a minimum, or the request waits on nobody.
     */
    alternatives: z.array(
      named(
        'TimeOffAlternative',
        z.object({
          kind: z.enum(['swap_days', 'next_clean_week', 'approve_as_asked', 'ask_teammate']),
          affects: z.enum(['requester', 'nobody', 'teammate']),
          dates: z.array(CalendarDate),
          spans: z.array(RangeView),
          coverage: z.array(CoverageDay),
          /** `swap_days`: the clash days out, and the days in. */
          swapped: z.object({ out: z.array(CalendarDate), in: z.array(CalendarDate) }).nullable(),
          /** `ask_teammate`: whose approved time off would move, and which. */
          teammate: PersonRef.nullable(),
          absence: RangeView.nullable(),
          /** The requester's own options: the message to send with them, editable (TOF-088). */
          message: WrittenView.nullable(),
        }),
      ),
    ),
    /** What to know's closing line: whether it might be fine, and on what (TOF-087). */
    whatToKnow: WrittenView,
    /** Why a clash matters and what fixing it costs (T15, TOF-088); `null` with nothing to fix. */
    clash: WrittenView.nullable(),
  }),
);

export const DelegationView = named(
  'TimeOffDelegation',
  z.object({
    /** The caller, whose delegate this is: the approver a change is for. */
    approverId: PersonId,
    /** Where a request nobody decides goes after three working days: the caller's manager. */
    escalatesTo: PersonRef.nullable(),
    delegation: z
      .object({
        delegateId: PersonId,
        delegateName: z.string(),
        range: RangeView.nullable(),
        automatic: z.boolean(),
        salaryRelated: z.boolean(),
      })
      .nullable(),
    candidates: z.array(PersonRef),
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
        z.object({
          personId: PersonId,
          displayName: z.string(),
          teamKey: TeamKey.nullable(),
          teamName: z.string().nullable(),
        }),
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
    open: z.array(
      named(
        'TimeOffOpenDay',
        z.object({
          date: CalendarDate,
          lastPunchAt: Instant,
          /** When they probably finished, from their own evidence; only for themselves (TOF-089). */
          suggestion: named(
            'TimeOffFinishSuggestion',
            z.object({
              at: Instant,
              time: z.string(),
              /** Whether a model chose it among the domain's candidates. */
              ai: z.boolean(),
              evidence: z.array(
                named(
                  'TimeOffEvidence',
                  z.object({
                    source: z.enum(['calendar', 'kithena']),
                    at: Instant,
                    what: z.string(),
                  }),
                ),
              ),
            }),
          ).nullable(),
        }),
      ),
    ),
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
    /** Today, in a sentence: what is normal and what needs the manager (TOF-091). */
    sentence: WrittenView,
  }),
);

/** T23 (TOF-095): what needs HR in attendance over a period, oldest first. */
export const ExceptionsView = named(
  'TimeOffAttendanceExceptions',
  z.object({
    from: CalendarDate,
    to: CalendarDate,
    /** The rest the rules require between days, which a short rest is short of. */
    restMinutes: z.int(),
    items: z.array(
      named(
        'TimeOffAttendanceException',
        z.object({
          kind: z.enum(['missed_clock_out', 'short_rest', 'overtime_waiting', 'worked_on_holiday']),
          date: CalendarDate,
          /** The rest taken, the overtime waiting, or the time worked on the holiday. */
          minutes: z.int().nullable(),
          holiday: z.string().nullable(),
          personId: PersonId,
          displayName: z.string(),
          teamName: z.string().nullable(),
        }),
      ),
    ),
  }),
);

/**
 * T24 (TOF-096): a month per team and in total, and who is late for
 * Payroll. Hours as minutes; no punch time and no location.
 */
export const PayPeriodView = named(
  'TimeOffPayPeriod',
  z.object({
    from: CalendarDate,
    to: CalendarDate,
    closedAt: Instant.nullable(),
    teams: z.array(
      named(
        'TimeOffPayPeriodTeam',
        z.object({
          team: TeamKey,
          teamName: z.string().nullable(),
          people: z.int(),
          waiting: z.int(),
          paidMinutes: z.int(),
          compMinutes: z.int(),
          paidAs: z.enum(['comp', 'paid', 'mixed']).nullable(),
        }),
      ),
    ),
    totals: named(
      'TimeOffPayPeriodTotals',
      z.object({
        paidMinutes: z.int(),
        compMinutes: z.int(),
        unpaidDays: DayAmount,
        unpaidPeople: z.int(),
        negativePeople: z.int(),
        negativeBalanceDays: DayAmount,
      }),
    ),
    late: z.array(
      named(
        'TimeOffLateForPayroll',
        z.object({
          personId: PersonId,
          displayName: z.string(),
          team: TeamKey,
          openDays: z.int(),
          overtimeWaitingMinutes: z.int(),
        }),
      ),
    ),
  }),
);

/**
 * T27, T28 (TOF-097): the month in points, written from the domain's
 * numbers; six months of trends (sick leave a total only for a scope at or
 * above the cohort minimum); the teams large enough to describe; and the
 * people behind every point.
 */
export const InsightsView = named(
  'TimeOffInsights',
  z.object({
    asOf: CalendarDate,
    scope: z.enum(['company', 'team']),
    cohortMinimum: z.int(),
    points: z.array(
      named(
        'TimeOffInsightPoint',
        z.object({
          kind: z.enum(['unbooked', 'no_break', 'missed_clock_outs', 'overtime']),
          figure: z.string(),
          text: z.string(),
          /** A model wrote `text` (PRD §14.1). */
          ai: z.boolean(),
          sources: z.array(z.string()),
          personIds: z.array(PersonId),
        }),
      ),
    ),
    months: z.array(
      named(
        'TimeOffInsightMonth',
        z.object({
          month: z.string(),
          vacation: DayAmount,
          personal: DayAmount,
          sick: DayAmount.nullable(),
          missedClockOuts: z.int(),
          overtimeMinutes: z.int(),
        }),
      ),
    ),
    teams: z.array(
      named(
        'TimeOffInsightTeam',
        z.object({
          team: TeamKey,
          teamName: z.string().nullable(),
          people: z.int(),
          daysTaken: DayAmount,
          overtimeMinutes: z.int(),
          left: DayAmount,
        }),
      ),
    ),
    hiddenTeams: z.int(),
    people: z.array(
      named(
        'TimeOffInsightPerson',
        z.object({
          personId: PersonId,
          displayName: z.string(),
          teamName: z.string().nullable(),
          left: DayAmount,
          losesAtYearEnd: DayAmount,
          lastDayOff: CalendarDate.nullable(),
        }),
      ),
    ),
  }),
);

/** T28 (TOF-098): who would be nudged, and one of their messages exactly as it would go. */
export const NudgeView = named(
  'TimeOffNudge',
  z.object({
    since: CalendarDate.nullable(),
    recipients: z.array(
      named(
        'TimeOffNudgeRecipient',
        z.object({ personId: PersonId, displayName: z.string(), reachable: z.boolean() }),
      ),
    ),
    preview: named(
      'TimeOffNudgePreview',
      z.object({
        personId: PersonId,
        displayName: z.string(),
        heading: z.string(),
        lede: z.string(),
        /** A model wrote the words (PRD §14.1). */
        ai: z.boolean(),
      }),
    ).nullable(),
  }),
);

/** A file to download, as base64: the inspector's record as CSV or PDF. */
export const FileView = named(
  'TimeOffFile',
  z.object({ name: z.string(), contentType: z.string(), base64: z.string() }),
);

/**
 * The attendance Requests tab (TOF-099): what the caller's reports need from
 * them, and the caller's own overtime of the last month, newest first.
 */
export const AttendanceRequestsView = named(
  'TimeOffAttendanceRequests',
  z.object({
    overtime: named(
      'TimeOffOvertimePolicy',
      z.object({
        becomes: z.enum(['comp', 'paid', 'choose']),
        multiplier: z.string(),
      }),
    ),
    needsYou: z.array(RightNowView.shape.needsYou.element),
    mine: z.array(
      named(
        'TimeOffMyOvertime',
        z.object({
          date: CalendarDate,
          minutes: z.int(),
          status: z.enum(['waiting', 'comp', 'paid', 'declined']),
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

/** A country pack the tenant's statutory types or holidays came from, and whether a lawyer signed it off. */
const PackView = named(
  'TimeOffCountryPack',
  z.object({ country: z.string(), version: z.int(), reviewed: z.boolean() }),
);

/** The company's own parental weeks, booked as one leave type (T8, TOF-099a); 0 for none. */
export const ParentalCompanyBody = named(
  'TimeOffParentalCompany',
  z.strictObject({
    extraWeeks: z.int().min(0).max(52),
    afterServiceYears: z.int().min(0).max(50),
    leaveTypeKey: LeaveTypeKey,
  }),
);

export const LeaveTypesView = named(
  'TimeOffSettingsLeaveTypes',
  z.object({
    leaveTypes: z.array(LeaveTypeRow),
    packs: z.array(PackView),
    parentalCompany: ParentalCompanyBody.nullable(),
  }),
);

const PolicyDefinitionView = PolicyDefinition.meta({ title: 'TimeOffPolicyDefinition' });

const PolicyVersionView = named(
  'TimeOffPolicyVersion',
  z.object({
    version: z.int(),
    status: z.enum(['draft', 'published']),
    effectiveFrom: CalendarDate.nullable(),
    definition: PolicyDefinitionView,
  }),
);

/** T32: a policy written in plain words, read into the ordinary form (TOF-094). */
export const PolicyReadView = named(
  'TimeOffPolicyRead',
  z.object({
    text: z.string().nullable(),
    leaveTypeKey: LeaveTypeKey.nullable(),
    leaveTypes: z.array(
      named('TimeOffPolicyTypeChoice', z.object({ key: LeaveTypeKey, name: z.string() })),
    ),
    /** Whether a model read the text; the rules did otherwise. */
    ai: z.boolean(),
    /** "Understood as": each rule of the form, said, with the amount HR can change. */
    rules: z.array(
      named(
        'TimeOffUnderstoodRule',
        z.object({
          key: z.enum(['allowance', 'probation', 'carry_over', 'negative']),
          label: z.string(),
          value: z.string(),
          amount: z.string(),
        }),
      ),
    ),
    /** The one question the text cannot answer; `null` when it answers everything. */
    question: named(
      'TimeOffOpenQuestion',
      z.object({
        key: z.enum(['day_kind', 'earning']),
        title: z.string(),
        body: WrittenView,
        options: z.array(
          named('TimeOffAnswer', z.object({ value: z.string(), label: z.string() })),
        ),
      }),
    ).nullable(),
    /** The ordinary draft it would create, `null` until the text says enough. */
    definition: PolicyDefinitionView.nullable(),
    problems: z.array(
      named('TimeOffReadProblem', z.object({ path: z.string(), message: z.string() })),
    ),
  }),
);

export const LeaveTypeSettingView = named(
  'TimeOffSettingsLeaveType',
  z.object({
    leaveType: LeaveTypeRow,
    policies: z.array(
      named('TimeOffPolicy', z.object({ id: z.uuid(), versions: z.array(PolicyVersionView) })),
    ),
    /** The countries and work locations members are in: what a policy can apply to (TOF-099a). */
    places: named(
      'TimeOffPlaces',
      z.object({ countries: z.array(z.string()), locations: z.array(LocationKey) }),
    ),
  }),
);

/** One amount now and under the draft. */
const AmountChange = named(
  'TimeOffAmountChange',
  z.object({ current: DayAmount, draft: DayAmount }),
);

/**
 * T30: what publishing the draft would do to each member the draft or the
 * version in effect reaches, folded over this leave year
 * (`domain/policy/preview.ts`). `effectiveFrom` is the leave year's first
 * day, the date to publish from for the whole year to follow the draft.
 * `draftVersion` is `null` when there is no draft, and `members` empty.
 */
export const PolicyPreviewView = named(
  'TimeOffPolicyPreview',
  z.object({
    draftVersion: z.int().nullable(),
    effectiveFrom: CalendarDate,
    yearEnd: CalendarDate,
    members: z.array(
      named(
        'TimeOffMemberPreview',
        z.object({
          personId: PersonId,
          displayName: z.string(),
          allowance: AmountChange,
          left: AmountChange,
          lostAtYearEnd: AmountChange,
        }),
      ),
    ),
    /**
     * TOF-093: the draft running beside the version in effect for a month,
     * each folded to `asOf` (today, or the run's last day once it is over);
     * `null` when no run was started. HR's only.
     */
    shadow: named(
      'TimeOffShadowRun',
      z.object({
        from: CalendarDate,
        to: CalendarDate,
        asOf: CalendarDate,
        members: z.array(
          named(
            'TimeOffMemberShadow',
            z.object({
              personId: PersonId,
              displayName: z.string(),
              credited: AmountChange,
              balance: AmountChange,
            }),
          ),
        ),
      }),
    ).nullable(),
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

/** T34's "If nobody decides" (TOF-099a): after how many working days, to whom, reminded when. */
export const EscalationBody = named(
  'TimeOffEscalation',
  z.strictObject({
    afterWorkingDays: z.int().min(1).max(20),
    to: z.enum(['manager', 'hr']),
    /** Minutes after midnight in the member's zone. */
    remindAt: z
      .int()
      .min(0)
      .max(24 * 60 - 1),
  }),
);

export const ApprovalsSettingsView = named(
  'TimeOffSettingsApprovals',
  z.object({
    rules: z.array(ApprovalRuleBody),
    autoApproval: AutoApprovalBody,
    escalation: EscalationBody,
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
    packs: z.array(PackView),
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

/** T36's assistant card: a year drafted from a list HR supplied, never saved by itself (TOF-112). */
export const HolidayDraftView = named(
  'TimeOffHolidayDraft',
  z.object({
    layerKey: z.string(),
    layerName: z.string(),
    year: z.int(),
    days: z.array(
      named(
        'TimeOffDraftedHoliday',
        z.object({
          date: CalendarDate,
          name: z.string(),
          /** Not confirmed yet: left for HR, never saved with the rest. */
          confirmed: z.boolean(),
          /** The calendar already has a holiday that day. */
          known: z.boolean(),
        }),
      ),
    ),
    /** Lines with no date in the year: shown, not guessed at. */
    skipped: z.array(z.string()),
    summary: WrittenView,
    /** Whether a model said which lines are confirmed. */
    ai: z.boolean(),
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
    /** Whether Time Off holds a member for the caller: somebody People has hired, who may request. */
    member: z.boolean(),
    counts: z.object({ requestsWaiting: z.int(), attendanceExceptions: z.int() }),
  }),
);

/* -------------------------------------------------------------- parental -- */

export const ParentRoleView = z.enum(['birth_parent', 'other_parent', 'adopting']);
export const TeamSeesView = z.enum(['type', 'away']);
export const BlockKindView = z.enum(['mandatory', 'flexible', 'vacation', 'company', 'later']);

/** What a parent is entitled to (T8), every number the domain's. */
export const ParentalEntitlementView = named(
  'TimeOffParentalEntitlement',
  z.object({
    law: z.string(),
    mandatoryWeeks: z.int(),
    flexibleWeeks: z.int(),
    flexibleBefore: CalendarDate,
    laterWeeks: z.int(),
    laterBefore: CalendarDate,
    startsFrom: CalendarDate,
    /** Who pays the statutory weeks: `social_security` in Spain. */
    paidBy: z.string(),
    payPercent: z.int(),
    companyWeeks: z.int(),
    /** The service the company asks before adding its weeks; `null` when it adds none. */
    companyAfterYears: z.int().nullable(),
    vacationAccrues: z.boolean(),
    noticeDays: z.int(),
  }),
);

export const HandoverView = named(
  'TimeOffHandoverItem',
  z.object({ work: z.string().min(1).max(200), coveredBy: z.string().min(1).max(200) }),
);

/** A parental plan as its screens read it (T9–T11, MT11, MT12). */
export const ParentalPlanView = named(
  'TimeOffParentalPlan',
  z.object({
    planId: z.uuid(),
    status: z.enum(['draft', 'submitted', 'approved']),
    role: ParentRoleView,
    childDate: CalendarDate,
    dueDate: CalendarDate.nullable(),
    birth: CalendarDate.nullable(),
    singleParent: z.boolean(),
    children: z.int(),
    teamSees: TeamSeesView,
    handover: z.array(HandoverView),
    blocks: z.array(
      named(
        'TimeOffParentalBlock',
        z.object({
          kind: BlockKindView,
          leaveTypeKey: LeaveTypeKey,
          from: CalendarDate,
          to: CalendarDate,
          workingDays: DayAmount,
          /** Who pays while away: the pack's payer for statutory weeks, the employer otherwise. */
          paidBy: z.string(),
          payPercent: z.int(),
        }),
      ),
    ),
    /** Later weeks not booked: "kept for later". */
    keptWeeks: z.number(),
    reminders: z.array(
      named('TimeOffNoticeReminder', z.object({ blockFrom: CalendarDate, remindOn: CalendarDate })),
    ),
    /** Every rule the plan breaks, from the domain; none means it can be sent. */
    problems: z.array(
      named('TimeOffPlanProblem', z.object({ code: z.string(), message: z.string() })),
    ),
    entitlement: ParentalEntitlementView,
    sentAt: Instant.nullable(),
    approvedAt: Instant.nullable(),
    /** Why the plan has this shape (TOF-092), from week counts only. */
    explanation: WrittenView,
  }),
);

/**
 * The parent's own steps (T8–T10): their plan, if they have one, and the
 * entitlement for the answers asked about, worked out without saving.
 */
export const ParentalScreenView = named(
  'TimeOffParentalScreen',
  z.object({
    member: MemberView.nullable(),
    managerName: z.string().nullable(),
    /** Whether the member's country has a pack to plan from. */
    supported: z.boolean(),
    plan: ParentalPlanView.nullable(),
    preview: ParentalEntitlementView.nullable(),
  }),
);

/** HR's view of the case (T11): the plan, its checklist, its rules check and its audience. */
export const ParentalCaseView = named(
  'TimeOffParentalCase',
  z.object({
    member: MemberView,
    managerName: z.string().nullable(),
    plan: ParentalPlanView,
    checklist: z.array(
      named(
        'TimeOffCaseStep',
        z.object({
          key: z.enum([
            'entitlement',
            'manager_told',
            'certificate',
            'payroll',
            'benefits',
            'birth_certificate',
          ]),
          status: z.enum(['done', 'todo', 'scheduled', 'elsewhere']),
          /** The module a step belongs to, linked rather than done here. */
          module: z.enum(['payroll', 'benefits']).nullable(),
          on: CalendarDate.nullable(),
        }),
      ),
    ),
    canApprove: z.boolean(),
  }),
);

/* ----------------------------------------------------------------- kiosk -- */

/** A kiosk as HR sees it (TOF-107): never its token, nor the token's hash. */
export const KioskView = named(
  'TimeOffKiosk',
  z.object({
    id: z.uuid(),
    name: z.string(),
    locationKey: LocationKey,
    lastSeenAt: Instant.nullable(),
    revokedAt: Instant.nullable(),
  }),
);

/** A kiosk just registered, with the token it is shown this once. */
export const KioskRegisteredView = named(
  'TimeOffKioskRegistered',
  z.object({ deviceId: z.uuid(), token: z.string() }),
);

/** The personal QR a member's phone shows a kiosk, and when it stops working. */
export const KioskQrView = named(
  'TimeOffKioskQr',
  z.object({ token: z.string(), expiresAt: Instant, personId: PersonId }),
);

/** What a kiosk shows at its top: its own name and where it is. */
export const KioskStatusView = named(
  'TimeOffKioskStatus',
  z.object({ name: z.string(), locationName: z.string().nullable() }),
);

/** Who tapped, by first name, and what the tap would do. Nothing else crosses to a kiosk. */
export const KioskIdentityView = named(
  'TimeOffKioskIdentity',
  z.object({ firstName: z.string(), kind: PunchKind }),
);

/** Each tap of a synced queue: punched, already synced, or refused and why. */
export const KioskSyncView = named(
  'TimeOffKioskSync',
  z.object({
    results: z.array(
      named(
        'TimeOffKioskSyncResult',
        z.object({
          sequence: z.int(),
          outcome: z.enum(['punched', 'duplicate', 'refused']),
          kind: PunchKind.optional(),
          firstName: z.string().optional(),
          at: Instant.optional(),
          code: z.string().optional(),
        }),
      ),
    ),
  }),
);

/* ---------------------------------------------------------- integrations -- */

export const IntegrationProviderView = z.enum(['google', 'microsoft', 'slack', 'teams']);

/** What a chat answer may say about private leave (assistant PRD §11.4): HR's switch. */
export const ChatAnswersBody = named(
  'TimeOffChatAnswers',
  z.strictObject({ namesPrivateLeave: z.boolean() }),
);

/** T35: calendars, chat apps, kiosks, country packs and the modules that would read Time Off. */
export const IntegrationsView = named(
  'TimeOffIntegrations',
  z.object({
    integrations: z.array(
      named(
        'TimeOffIntegration',
        z.object({
          provider: IntegrationProviderView,
          kind: z.enum(['calendar', 'chat']),
          available: z.boolean(),
          configured: z.boolean(),
          connected: z.boolean(),
          connectedAt: Instant.nullable(),
          account: z.string().nullable(),
        }),
      ),
    ),
    kiosks: z.array(KioskView),
    locations: z.array(
      named(
        'TimeOffKioskLocation',
        z.object({ locationKey: LocationKey, name: z.string().nullable() }),
      ),
    ),
    packs: z.array(
      named(
        'TimeOffIntegrationPack',
        z.object({ country: z.string(), reviewed: z.boolean(), inUse: z.boolean() }),
      ),
    ),
    modules: z.array(
      named('TimeOffConsumingModule', z.object({ key: z.string(), events: z.array(z.string()) })),
    ),
    chatAnswers: ChatAnswersBody,
  }),
);

/** HR's list of sent parental plans (TOF-099c): waiting for HR first, then approved. */
export const ParentalCasesView = named(
  'TimeOffParentalCases',
  z.object({
    cases: z.array(
      named(
        'TimeOffParentalCaseRow',
        z.object({
          planId: z.uuid(),
          personId: PersonId,
          displayName: z.string(),
          teamName: z.string().nullable(),
          status: z.enum(['submitted', 'approved']),
          sentAt: Instant.nullable(),
          /** The first and last day booked; the weeks kept for later are not. */
          from: CalendarDate.nullable(),
          to: CalendarDate.nullable(),
        }),
      ),
    ),
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
export type WrittenView = View<typeof WrittenView>;
export type DescribedView = View<typeof DescribedView>;
export type PolicyReadView = View<typeof PolicyReadView>;
export type HolidayDraftView = View<typeof HolidayDraftView>;
export type BridgeView = View<typeof BridgeView>;
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
export type AttendanceRequestsView = View<typeof AttendanceRequestsView>;
export type LeaveTypesView = View<typeof LeaveTypesView>;
export type LeaveTypeSettingView = View<typeof LeaveTypeSettingView>;
export type PolicyPreviewView = View<typeof PolicyPreviewView>;
export type NegativeBalanceView = View<typeof NegativeBalanceView>;
export type AttendanceSettingsView = View<typeof AttendanceSettingsView>;
export type ApprovalsSettingsView = View<typeof ApprovalsSettingsView>;
export type HolidaySettingsView = View<typeof HolidaySettingsView>;
export type ViewerView = View<typeof ViewerView>;
export type ParentalEntitlementView = View<typeof ParentalEntitlementView>;
export type ParentalPlanView = View<typeof ParentalPlanView>;
export type ParentalScreenView = View<typeof ParentalScreenView>;
export type ParentalCaseView = View<typeof ParentalCaseView>;
export type ParentalCasesView = View<typeof ParentalCasesView>;
