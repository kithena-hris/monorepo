/**
 * The only file federation exposes. Everything else in this remote is
 * internal; the names exported here are what `public/routes.json` may point at.
 *
 * Each is `framed`: the host's breadcrumb, tabs and actions join the screen's
 * own header (`./frame.tsx`). A screen is a placeholder until its ticket
 * lands (`docs/timeoff-build-plan.md`); the overview is TOF-061's, the
 * employee's screens TOF-062 to TOF-067's, and the approvals, delegation and
 * calendar TOF-068 to TOF-073's.
 */
import './styles.css';

import { Approvals as ApprovalsScreen } from './approvals/approvals';
import { Delegation as DelegationScreen } from './approvals/delegation';
import { TeamCalendar as TeamCalendarScreen } from './calendar/calendar';
import { Balance as BalanceScreen } from './balance/balance';
import { framed } from './frame';
import { Holidays as HolidaysScreen } from './holidays/holidays';
import { Overview as OverviewScreen } from './overview/overview';
import { placeholder } from './placeholder';
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
export const Balance = framed(BalanceScreen);
export const Holidays = framed(HolidaysScreen);
export const ParentalPlan = framed(placeholder('Plan parental leave'));
export const ParentalCase = framed(placeholder('Parental leave'));
export const Insights = framed(placeholder('Insights'));
export const LeaveTypes = framed(placeholder('Leave types'));
export const LeaveType = framed(placeholder('Leave type'));
export const DescribePolicy = framed(placeholder('Write a policy in plain words'));
export const NegativeBalance = framed(placeholder('Negative balance'));
export const AttendanceSettings = framed(placeholder('Attendance'));
export const ApprovalSettings = framed(placeholder('Approvals'));
export const HolidaySettings = framed(placeholder('Holidays'));
export const Integrations = framed(placeholder('Integrations'));
