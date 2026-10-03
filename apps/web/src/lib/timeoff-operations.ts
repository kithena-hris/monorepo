/**
 * Every GraphQL operation the tenant app sends Time Off, through the router
 * (TOF-060): People's rule (`people-operations.ts`), for the second area.
 *
 * One query per screen, named for it, and one mutation per write, each asking
 * for the whole of its answer. A fixed list, and the only one: the router's
 * safelist (`apps/gateway/persisted/`) is generated from this file and
 * People's (`pnpm --filter @kithena/gateway persist`), so an operation that is
 * not here is refused before Time Off sees it. The browser never chooses one:
 * the page loader (`timeoff-screens.ts`) and the server actions
 * (`app/(app)/time-off/actions.ts`) name them.
 *
 * A write's idempotency key is `$key`, as People's are, so `lib/people.ts`
 * gives each call a fresh one. Its `input` is the REST route's JSON body.
 *
 * Plain text, no `server-only`: the generator reads it too.
 */

export const OPERATIONS = {
  /** T34: approval rules, automatic approval and team minimums; HR */
  TimeOffApprovalSettings: `query TimeOffApprovalSettings {
    timeOffApprovalSettings {
      autoApproval { oneDayAboveMinimum shortenOrCancel sickUnderDays } rules { approvers leaveTypes subject when } teams { minimum { atLeast unit } teamKey teamName }
    }
  }`,

  /** T16: waiting for the caller (clear and look closer), coming up, or decided */
  TimeOffApprovals: `query TimeOffApprovals($tab: String) {
    timeOffApprovals(tab: $tab) {
      clear { category displayName leaveTypeKey leaveTypeName personId requestId requestedAt span { endsHalfDay from startsHalfDay to } spans { from to } status waitingOn workingDays } items { category displayName leaveTypeKey leaveTypeName personId requestId requestedAt span { endsHalfDay from startsHalfDay to } spans { from to } status waitingOn workingDays } lookCloser { item { category displayName leaveTypeKey leaveTypeName personId requestId requestedAt span { endsHalfDay from startsHalfDay to } spans { from to } status waitingOn workingDays } reason { amount days rule } } tab why { requestId text { ai text } }
    }
  }`,

  /** T33: breaks, limits, overtime and the default schedule; HR */
  TimeOffAttendanceSettings: `query TimeOffAttendanceSettings {
    timeOffAttendanceSettings {
      defaultSchedule rules { breakAfterMinutes breakMinutes overtime { becomes multiplier } restMinutes weeklyMaxMinutes }
    }
  }`,

  /** MT20: where the days of one leave type went this leave year */
  TimeOffBalance: `query TimeOffBalance($leaveTypeKey: String!, $personId: String) {
    timeOffBalance(leaveTypeKey: $leaveTypeKey, personId: $personId) {
      balance { allowance booked colorToken icon leaveTypeKey left name unit used yearly } entries { amount effectiveOn entryId kind leaveTypeKey occurredAt personId policyVersion reason requestId supersedes unit }
    }
  }`,

  /** T14: one day — who is off, holidays and coverage */
  TimeOffCalendarDay: `query TimeOffCalendarDay($date: String!, $scope: String, $teamKey: String) {
    timeOffCalendarDay(date: $date, scope: $scope, teamKey: $teamKey) {
      coverage { below checked date in of required } entries { leaveTypeKey personId requestId span { endsHalfDay from startsHalfDay to } status } from holidays { date locationKey name } people { displayName personId teamKey teamName } to
    }
  }`,

  /** T12: a month of the team’s, the company’s or the caller’s time off */
  TimeOffCalendarMonth: `query TimeOffCalendarMonth($month: String!, $scope: String, $teamKey: String) {
    timeOffCalendarMonth(month: $month, scope: $scope, teamKey: $teamKey) {
      coverage { below checked date in of required } entries { leaveTypeKey personId requestId span { endsHalfDay from startsHalfDay to } status } from holidays { date locationKey name } people { displayName personId teamKey teamName } to
    }
  }`,

  /** T13: people by days over a range, with the coverage row */
  TimeOffCalendarTimeline: `query TimeOffCalendarTimeline($from: String!, $scope: String, $teamKey: String, $to: String!) {
    timeOffCalendarTimeline(from: $from, scope: $scope, teamKey: $teamKey, to: $to) {
      coverage { below checked date in of required } entries { leaveTypeKey personId requestId span { endsHalfDay from startsHalfDay to } status } from holidays { date locationKey name } people { displayName personId teamKey teamName } to
    }
  }`,

  /** The year: how many people are off each day */
  TimeOffCalendarYear: `query TimeOffCalendarYear($scope: String, $teamKey: String, $year: Int!) {
    timeOffCalendarYear(scope: $scope, teamKey: $teamKey, year: $year) {
      days { date off } year
    }
  }`,

  /** T19: who covers for the caller, whom they may choose, and whom they cover for */
  TimeOffDelegation: `query TimeOffDelegation {
    timeOffDelegation {
      approverId candidates { displayName personId } coveringFor { approverId approverName automatic range { from to } } delegation { automatic delegateId delegateName range { from to } salaryRelated } escalatesTo { displayName personId }
    }
  }`,

  /** T36: holiday calendars, and what each work location observes in a year; HR */
  TimeOffHolidaySettings: `query TimeOffHolidaySettings($year: Int!) {
    timeOffHolidaySettings(year: $year) {
      layers { holidays { date name } key level name weekendRule } locations { holidays { date layer movedFrom name } layerKeys locationKey } packs { country reviewed version } year
    }
  }`,

  /** MT21: the holidays the caller’s work location observes */
  TimeOffHolidays: `query TimeOffHolidays($year: Int!) {
    timeOffHolidays(year: $year) {
      bridges { away { days from to } from holidays { date name } text { ai text } to used } holidays { date layer movedFrom name } locationKey year
    }
  }`,

  /** T30: one leave type and every version of its policies; HR */
  TimeOffLeaveTypeSetting: `query TimeOffLeaveTypeSetting($leaveTypeKey: String!) {
    timeOffLeaveTypeSetting(key: $leaveTypeKey) {
      leaveType { definition { appliesTo { clauses combine } approvalRuleKey category colorToken icon key name { default translations } paid requiresNote { afterDays } statutory tracked unit visibility } deleted hidden policyIds } policies { id versions { definition { allowance { days fromYears } appliesTo { clauses combine } carryOver { maxDays useBy { day month } } earning keepEarningOnParental leaveTypeKey negativeBalance { approvers atYearEnd limit onLeaving } proRata probationMonths requests { blockBelowMinimum halfDays showWhoIsOff } year { day month } } effectiveFrom status version } }
    }
  }`,

  /** T29: every leave type; HR */
  TimeOffLeaveTypeSettings: `query TimeOffLeaveTypeSettings {
    timeOffLeaveTypeSettings {
      leaveTypes { definition { appliesTo { clauses combine } approvalRuleKey category colorToken icon key name { default translations } paid requiresNote { afterDays } statutory tracked unit visibility } deleted hidden policyIds } packs { country reviewed version }
    }
  }`,

  /** T6: the caller’s requests, upcoming, past or cancelled */
  TimeOffMyRequests: `query TimeOffMyRequests($tab: String) {
    timeOffMyRequests(tab: $tab) {
      items { category displayName leaveTypeKey leaveTypeName personId requestId requestedAt span { endsHalfDay from startsHalfDay to } spans { from to } status waitingOn workingDays } tab
    }
  }`,

  /** T31: each policy’s negative balance rule; HR */
  TimeOffNegativeBalanceSettings: `query TimeOffNegativeBalanceSettings {
    timeOffNegativeBalanceSettings {
      policies { leaveTypeKey leaveTypeName policyId rule { approvers atYearEnd limit onLeaving } status version }
    }
  }`,

  /** T1: the clock, the balances, what is coming up and who is off today */
  TimeOffOverview: `query TimeOffOverview {
    timeOffOverview {
      balances { allowance booked colorToken icon leaveTypeKey left name unit used yearly } bridges { away { days from to } from holidays { date name } text { ai text } to used } clock { state today { breakMinutes date flags overtimeMinutes plannedMinutes segments { from kind to } status workedMinutes } workModel } comingUp { category displayName leaveTypeKey leaveTypeName personId requestId requestedAt span { endsHalfDay from startsHalfDay to } spans { from to } status waitingOn workingDays } member { displayName firstName locationKey managerPersonId personId teamKey teamName timeZone } teamToday { displayName leaveTypeKey personId span { endsHalfDay from startsHalfDay to } }
    }
  }`,

  /** T11: a sent plan with its checklist and rules check; HR and the manager */
  TimeOffParentalCase: `query TimeOffParentalCase($planId: String!) {
    timeOffParentalCase(planId: $planId) {
      canApprove checklist { key module on status } managerName member { displayName firstName locationKey managerPersonId personId teamKey teamName timeZone } plan { approvedAt birth blocks { from kind leaveTypeKey paidBy payPercent to workingDays } childDate children dueDate entitlement { companyAfterYears companyWeeks flexibleBefore flexibleWeeks law laterBefore laterWeeks mandatoryWeeks noticeDays paidBy payPercent startsFrom vacationAccrues } handover { coveredBy work } keptWeeks planId problems { code message } reminders { blockFrom remindOn } role sentAt singleParent status teamSees }
    }
  }`,

  /** T8–T10: the caller’s parental plan, and the entitlement the answers asked about would give; nothing is saved */
  TimeOffParentalPlan: `query TimeOffParentalPlan($childDate: String, $children: Int, $role: String, $singleParent: Boolean) {
    timeOffParentalPlan(childDate: $childDate, children: $children, role: $role, singleParent: $singleParent) {
      managerName member { displayName firstName locationKey managerPersonId personId teamKey teamName timeZone } plan { approvedAt birth blocks { from kind leaveTypeKey paidBy payPercent to workingDays } childDate children dueDate entitlement { companyAfterYears companyWeeks flexibleBefore flexibleWeeks law laterBefore laterWeeks mandatoryWeeks noticeDays paidBy payPercent startsFrom vacationAccrues } handover { coveredBy work } keptWeeks planId problems { code message } reminders { blockFrom remindOn } role sentAt singleParent status teamSees } preview { companyAfterYears companyWeeks flexibleBefore flexibleWeeks law laterBefore laterWeeks mandatoryWeeks noticeDays paidBy payPercent startsFrom vacationAccrues } supported
    }
  }`,

  /** T30: what publishing a policy's draft would do to each member, folded; HR */
  TimeOffPolicyPreview: `query TimeOffPolicyPreview($policyId: String!) {
    timeOffPolicyPreview(policyId: $policyId) {
      draftVersion effectiveFrom members { allowance { current draft } displayName left { current draft } lostAtYearEnd { current draft } personId } yearEnd
    }
  }`,

  /** One request, for its member, an approver or HR */
  TimeOffRequest: `query TimeOffRequest($requestId: String!) {
    timeOffRequest(requestId: $requestId) {
      canAnswer canCancel canChange canDecide chain escalated mine note notePresent pendingChange { endsHalfDay from startsHalfDay to } proposals { index spans { from to } workingDays } request { category displayName leaveTypeKey leaveTypeName personId requestId requestedAt span { endsHalfDay from startsHalfDay to } spans { from to } status waitingOn workingDays } sickNoteFileId step
    }
  }`,

  /** T17: one request with the balance, the team and the rule an approver weighs */
  TimeOffRequestDecision: `query TimeOffRequestDecision($requestId: String!) {
    timeOffRequestDecision(requestId: $requestId) {
      alternatives { absence { from to } affects coverage { below checked date in of required } dates kind message { ai text } spans { from to } swapped { in out } teammate { displayName personId } } balance { after before } belowMinimum { below checked date in of required } canDecide clash { ai text } lastTaken { from to } member { displayName firstName locationKey managerPersonId personId teamKey teamName timeZone } note othersOff { displayName leaveTypeKey personId span { endsHalfDay from startsHalfDay to } } request { category displayName leaveTypeKey leaveTypeName personId requestId requestedAt span { endsHalfDay from startsHalfDay to } spans { from to } status waitingOn workingDays } triage { group reason { amount days rule } } whatToKnow { ai text }
    }
  }`,

  /** T3, T5: the types the caller may ask for and, given dates, what the request would mean; nothing is saved */
  TimeOffRequestPanel: `query TimeOffRequestPanel($endsHalfDay: Boolean, $from: String, $leaveTypeKey: String, $startsHalfDay: Boolean, $to: String) {
    timeOffRequestPanel(endsHalfDay: $endsHalfDay, from: $from, leaveTypeKey: $leaveTypeKey, startsHalfDay: $startsHalfDay, to: $to) {
      leaveTypes { category colorToken icon key left name requiresNoteAfterDays tracked unit } preview { approver { displayName personId } approvers balance { after before } belowMinimum { below checked date in of required } blocked daysAway { days from to } negative { approvers days kind limit nextYearStartsAt shorten { days endsHalfDay to } unpaid { days } } span { endsHalfDay from startsHalfDay to workingDays } }
    }
  }`,

  /** T22: the caller’s reports, live, and what needs them */
  TimeOffTeamRightNow: `query TimeOffTeamRightNow {
    timeOffTeamRightNow {
      needsYou { date displayName kind minutes personId punch { at id kind reason recordedAt source supersedes workModel } } people { displayName personId state today { breakMinutes date flags overtimeMinutes plannedMinutes segments { from kind to } status workedMinutes } workModel }
    }
  }`,

  /** T20: a timesheet by week or month, the caller’s own unless a member is named */
  TimeOffTimesheet: `query TimeOffTimesheet($from: String!, $personId: String, $to: String!) {
    timeOffTimesheet(from: $from, personId: $personId, to: $to) {
      corrections { needsManager punch { at id kind reason recordedAt source supersedes workModel } } days { breakMinutes date flags overtimeMinutes plannedMinutes segments { from kind to } status workedMinutes } member { displayName firstName locationKey managerPersonId personId teamKey teamName timeZone } open { date lastPunchAt } overtime { date minutes outcome } punches { at id kind reason recordedAt source supersedes workModel } restBreaches { date restMinutes } weeks { flags monday overtimeMinutes plannedMinutes workedMinutes }
    }
  }`,

  /** Whether the caller approves anyone, is HR, and the counts on Requests and Attendance (TOF-058a) */
  TimeOffViewer: `query TimeOffViewer {
    timeOffViewer {
      approves counts { attendanceExceptions requestsWaiting } hrAdmin
    }
  }`,

  /** Take one of the suggested dates, which approves them, or keep your own */
  AnswerSuggestedTimeOffDates: `mutation AnswerSuggestedTimeOffDates($key: String!, $input: JSON!, $requestId: String!) {
    answerSuggestedTimeOffDates(idempotencyKey: $key, input: $input, requestId: $requestId) {
      status
    }
  }`,

  /** T8: the four answers and what teammates see; starts or re-answers a private draft */
  AnswerTimeOffParental: `mutation AnswerTimeOffParental($key: String!, $input: JSON!) {
    answerTimeOffParental(idempotencyKey: $key, input: $input) {
      planId
    }
  }`,

  /** T11: approve a sent plan after the rules check; HR */
  ApproveTimeOffParentalPlan: `mutation ApproveTimeOffParentalPlan($key: String!, $planId: String!) {
    approveTimeOffParentalPlan(idempotencyKey: $key, planId: $planId) {
      status
    }
  }`,

  /** Approve several; only the ones triage calls clear, the rest are refused with why */
  ApproveTimeOffRequests: `mutation ApproveTimeOffRequests($key: String!, $input: JSON!) {
    approveTimeOffRequests(idempotencyKey: $key, input: $input) {
      approved { next requestId status } refused { code reason { amount days rule } requestId }
    }
  }`,

  /** The layers a work location observes, most general first; HR */
  AssignTimeOffHolidayCalendars: `mutation AssignTimeOffHolidayCalendars($key: String!, $input: JSON!, $locationKey: String!) {
    assignTimeOffHolidayCalendars(idempotencyKey: $key, input: $input, locationKey: $locationKey) {
      ok
    }
  }`,

  /** A schedule for some members: fixed, flexible, seasonal or rotating; HR */
  AssignTimeOffSchedule: `mutation AssignTimeOffSchedule($key: String!, $input: JSON!) {
    assignTimeOffSchedule(idempotencyKey: $key, input: $input) {
      ok
    }
  }`,

  /** Cancel an approved request, or withdraw one nobody has decided */
  CancelTimeOffRequest: `mutation CancelTimeOffRequest($key: String!, $requestId: String!) {
    cancelTimeOffRequest(idempotencyKey: $key, requestId: $requestId) {
      status
    }
  }`,

  /** Change, hide, show or delete a leave type; a statutory one is only hidden; HR */
  ChangeTimeOffLeaveType: `mutation ChangeTimeOffLeaveType($key: String!, $input: JSON!, $leaveTypeKey: String!) {
    changeTimeOffLeaveType(idempotencyKey: $key, input: $input, key: $leaveTypeKey) {
      ok
    }
  }`,

  /** Move approved dates; the old ones stay booked until the new ones are approved */
  ChangeTimeOffRequest: `mutation ChangeTimeOffRequest($key: String!, $input: JSON!, $requestId: String!) {
    changeTimeOffRequest(idempotencyKey: $key, input: $input, requestId: $requestId) {
      status
    }
  }`,

  /** Send a month to Payroll: post its days, lock it, publish timeoff.period.closed; HR */
  CloseTimeOffPayPeriod: `mutation CloseTimeOffPayPeriod($key: String!, $month: String!) {
    closeTimeOffPayPeriod(idempotencyKey: $key, month: $month) {
      from members periodId to
    }
  }`,

  /** A punch made afterwards: replacing one, or one never made; the member’s own or HR’s */
  CorrectTimeOffPunch: `mutation CorrectTimeOffPunch($key: String!, $input: JSON!) {
    correctTimeOffPunch(idempotencyKey: $key, input: $input) {
      needsManager punch { at id kind reason recordedAt source supersedes workModel }
    }
  }`,

  /** Approve a day’s overtime as comp time or pay, or decline it */
  DecideTimeOffOvertime: `mutation DecideTimeOffOvertime($key: String!, $input: JSON!) {
    decideTimeOffOvertime(idempotencyKey: $key, input: $input) {
      date minutes outcome personId
    }
  }`,

  /** Approve or decline at the step waiting on the caller */
  DecideTimeOffRequest: `mutation DecideTimeOffRequest($key: String!, $input: JSON!, $requestId: String!) {
    decideTimeOffRequest(idempotencyKey: $key, input: $input, requestId: $requestId) {
      next requestId status
    }
  }`,

  /** A new leave type; its key never changes; HR */
  DefineTimeOffLeaveType: `mutation DefineTimeOffLeaveType($key: String!, $input: JSON!) {
    defineTimeOffLeaveType(idempotencyKey: $key, input: $input) {
      key
    }
  }`,

  /** A policy for a leave type, as a draft; HR */
  DraftTimeOffPolicy: `mutation DraftTimeOffPolicy($key: String!, $input: JSON!) {
    draftTimeOffPolicy(idempotencyKey: $key, input: $input) {
      policyId
    }
  }`,

  /** T9: the draft’s blocks as the parent left them, and every rule they break */
  EditTimeOffParentalBlocks: `mutation EditTimeOffParentalBlocks($key: String!, $input: JSON!, $planId: String!) {
    editTimeOffParentalBlocks(idempotencyKey: $key, input: $input, planId: $planId) {
      problems { code message }
    }
  }`,

  /** Members from CSV or JSON when People is absent: a dry run, then all rows or none; HR */
  ImportTimeOffMembers: `mutation ImportTimeOffMembers($key: String!, $input: JSON!) {
    importTimeOffMembers(idempotencyKey: $key, input: $input) {
      created dryRun errors { field message row } rows updated
    }
  }`,

  /** A signed, revocable iCalendar feed token for a scope */
  IssueTimeOffCalendarFeed: `mutation IssueTimeOffCalendarFeed($key: String!, $input: JSON!) {
    issueTimeOffCalendarFeed(idempotencyKey: $key, input: $input) {
      token
    }
  }`,

  /** Publish the draft from a date: balances re-fold and timeoff.policy.published goes out; HR */
  PublishTimeOffPolicy: `mutation PublishTimeOffPolicy($key: String!, $input: JSON!, $policyId: String!) {
    publishTimeOffPolicy(idempotencyKey: $key, input: $input, policyId: $policyId) {
      refolded version
    }
  }`,

  /** Clock in, start or end a break, clock out — no location is ever stored */
  PunchTimeOffClock: `mutation PunchTimeOffClock($key: String!, $input: JSON!) {
    punchTimeOffClock(idempotencyKey: $key, input: $input) {
      punch { at id kind reason recordedAt source supersedes workModel } state
    }
  }`,

  /** The baby arrived: the mandatory weeks move to the birth; the parent or HR */
  RecordTimeOffParentalBirth: `mutation RecordTimeOffParentalBirth($key: String!, $input: JSON!, $planId: String!) {
    recordTimeOffParentalBirth(idempotencyKey: $key, input: $input, planId: $planId) {
      ok
    }
  }`,

  /** Nobody covers for an approver any more */
  RemoveTimeOffDelegation: `mutation RemoveTimeOffDelegation($approverId: String!, $key: String!) {
    removeTimeOffDelegation(approverId: $approverId, idempotencyKey: $key) {
      ok
    }
  }`,

  /** Remove a holiday layer; HR */
  RemoveTimeOffHolidayCalendar: `mutation RemoveTimeOffHolidayCalendar($key: String!, $calendarKey: String!) {
    removeTimeOffHolidayCalendar(idempotencyKey: $key, key: $calendarKey) {
      ok
    }
  }`,

  /** Send a request; sick leave under the threshold is approved as it is recorded */
  RequestTimeOff: `mutation RequestTimeOff($key: String!, $input: JSON!) {
    requestTimeOff(idempotencyKey: $key, input: $input) {
      noteRequired requestId status
    }
  }`,

  /** Replace the draft, or start the next version’s; HR */
  ReviseTimeOffPolicy: `mutation ReviseTimeOffPolicy($key: String!, $input: JSON!, $policyId: String!) {
    reviseTimeOffPolicy(idempotencyKey: $key, input: $input, policyId: $policyId) {
      version
    }
  }`,

  /** Every feed the caller issued stops working */
  RevokeTimeOffCalendarFeeds: `mutation RevokeTimeOffCalendarFeeds($key: String!) {
    revokeTimeOffCalendarFeeds(idempotencyKey: $key) {
      ok
    }
  }`,

  /** A layer of holidays: national, regional or city; HR */
  SaveTimeOffHolidayCalendar: `mutation SaveTimeOffHolidayCalendar($key: String!, $input: JSON!, $calendarKey: String!) {
    saveTimeOffHolidayCalendar(idempotencyKey: $key, input: $input, key: $calendarKey) {
      ok
    }
  }`,

  /** T10: who covers what while the parent is away, and what teammates see */
  SaveTimeOffParentalHandover: `mutation SaveTimeOffParentalHandover($key: String!, $input: JSON!, $planId: String!) {
    saveTimeOffParentalHandover(idempotencyKey: $key, input: $input, planId: $planId) {
      ok
    }
  }`,

  /** T10: send the plan to HR and the manager; refused while a rule is broken */
  SendTimeOffParentalPlan: `mutation SendTimeOffParentalPlan($key: String!, $planId: String!) {
    sendTimeOffParentalPlan(idempotencyKey: $key, planId: $planId) {
      status
    }
  }`,

  /** T34: who approves what, and what is approved automatically; HR */
  SetTimeOffApprovalRules: `mutation SetTimeOffApprovalRules($key: String!, $input: JSON!) {
    setTimeOffApprovalRules(idempotencyKey: $key, input: $input) {
      ok
    }
  }`,

  /** T33: breaks, rest, the weekly limit and what overtime becomes; HR */
  SetTimeOffAttendanceRules: `mutation SetTimeOffAttendanceRules($key: String!, $input: JSON!) {
    setTimeOffAttendanceRules(idempotencyKey: $key, input: $input) {
      ok
    }
  }`,

  /** Who covers for an approver: they set it, or HR does */
  SetTimeOffDelegation: `mutation SetTimeOffDelegation($approverId: String!, $key: String!, $input: JSON!) {
    setTimeOffDelegation(approverId: $approverId, idempotencyKey: $key, input: $input) {
      ok
    }
  }`,

  /** T31: going below zero, as a revision of the policy, published like any other; HR */
  SetTimeOffNegativeBalanceRule: `mutation SetTimeOffNegativeBalanceRule($key: String!, $input: JSON!, $policyId: String!) {
    setTimeOffNegativeBalanceRule(idempotencyKey: $key, input: $input, policyId: $policyId) {
      version
    }
  }`,

  /** How many of a team must be in, or none; HR */
  SetTimeOffTeamMinimum: `mutation SetTimeOffTeamMinimum($key: String!, $input: JSON!, $teamKey: String!) {
    setTimeOffTeamMinimum(idempotencyKey: $key, input: $input, teamKey: $teamKey) {
      ok
    }
  }`,

  /** Give the tail back; approved automatically */
  ShortenTimeOffRequest: `mutation ShortenTimeOffRequest($key: String!, $input: JSON!, $requestId: String!) {
    shortenTimeOffRequest(idempotencyKey: $key, input: $input, requestId: $requestId) {
      releasedDays
    }
  }`,

  /** Suggest other dates instead of declining */
  SuggestTimeOffDates: `mutation SuggestTimeOffDates($key: String!, $input: JSON!, $requestId: String!) {
    suggestTimeOffDates(idempotencyKey: $key, input: $input, requestId: $requestId) {
      status
    }
  }`,
} as const;

export type OperationName = keyof typeof OPERATIONS;
