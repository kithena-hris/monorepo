/**
 * The only file federation exposes. Everything else in this remote is
 * internal; the names exported here are what `public/routes.json` may point at.
 *
 * Each is `framed`: the host's breadcrumb, tabs and actions join the screen's
 * own header (`./frame.tsx`). A screen is a placeholder until its ticket
 * lands (`docs/timeoff-build-plan.md`); the overview is TOF-061's, the
 * employee's screens TOF-062 to TOF-067's, the approvals, delegation and
 * calendar TOF-068 to TOF-073's, and the parental steps and case TOF-104 to
 * TOF-106's.
 */
import './styles.css';

import { Exceptions as ExceptionsScreen } from './attendance/exceptions';
import { AttendanceRequests as AttendanceRequestsScreen } from './attendance/requests';
import { PayPeriod as PayPeriodScreen } from './attendance/pay-period';
import { TeamNow as TeamNowScreen } from './attendance/team-now';
import { Timesheet as TimesheetScreen } from './attendance/timesheet';
import { Approvals as ApprovalsScreen } from './approvals/approvals';
import { Delegation as DelegationScreen } from './approvals/delegation';
import { TeamCalendar as TeamCalendarScreen } from './calendar/calendar';
import { Balance as BalanceScreen } from './balance/balance';
import { framed } from './frame';
import { Holidays as HolidaysScreen } from './holidays/holidays';
import { Insights as InsightsScreen } from './insights/insights';
import { Overview as OverviewScreen } from './overview/overview';
import { ParentalCase as ParentalCaseScreen } from './parental/case';
import { ParentalPlan as ParentalPlanScreen } from './parental/plan';
import { placeholder } from './placeholder';
import { ApprovalSettings as ApprovalSettingsScreen } from './settings/approval-settings';
import { AttendanceSettings as AttendanceSettingsScreen } from './settings/attendance-settings';
import { HolidaySettings as HolidaySettingsScreen } from './settings/holiday-settings';
import { LeaveType as LeaveTypeScreen } from './settings/leave-type';
import { LeaveTypes as LeaveTypesScreen } from './settings/leave-types';
import { NegativeBalance as NegativeBalanceScreen } from './settings/negative-balance';
import { RequestTimeOff as RequestScreen } from './request/request';
import { MyRequests as RequestsScreen } from './requests/requests';

export const Overview = framed(OverviewScreen);
export const RequestTimeOff = framed(RequestScreen);
export const DescribeRequest = framed(placeholder('Describe it'));
// One screen, three tabs and a request's own address: each name is what the
// shell's loader reads to know which (`lib/timeoff-screens.ts`).
export const MyRequestsUpcoming = framed(RequestsScreen);
export const MyRequestsPast = framed(RequestsScreen);
export const MyRequestsCancelled = framed(RequestsScreen);
export const RequestDetail = framed(RequestsScreen);
export const Approvals = framed(ApprovalsScreen);
export const Delegation = framed(DelegationScreen);
export const TeamCalendar = framed(TeamCalendarScreen);
export const Attendance = framed(placeholder('Attendance'));
// TOF-059, TOF-074 to TOF-077: the clock in the shell's top bar (a slot, not a
// screen: no frame), my timesheet and the team right now.
export { TopBarClock } from './clock/clock';
export const Timesheet = framed(TimesheetScreen);
export const TeamNow = framed(TeamNowScreen);
// HR operations (TOF-095 onwards).
export const AttendanceRequests = framed(AttendanceRequestsScreen);
export const Exceptions = framed(ExceptionsScreen);
export const PayPeriod = framed(PayPeriodScreen);
export const Balance = framed(BalanceScreen);
export const Holidays = framed(HolidaysScreen);
export const ParentalPlan = framed(ParentalPlanScreen);
export const ParentalCase = framed(ParentalCaseScreen);
export const Insights = framed(InsightsScreen);
export const LeaveTypes = framed(LeaveTypesScreen);
export const LeaveType = framed(LeaveTypeScreen);
export const DescribePolicy = framed(placeholder('Write a policy in plain words'));
export const NegativeBalance = framed(NegativeBalanceScreen);
export const AttendanceSettings = framed(AttendanceSettingsScreen);
export const ApprovalSettings = framed(ApprovalSettingsScreen);
export const HolidaySettings = framed(HolidaySettingsScreen);
export const Integrations = framed(placeholder('Integrations'));
