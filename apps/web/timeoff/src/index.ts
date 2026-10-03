/**
 * The only file federation exposes. Everything else in this remote is
 * internal; the names exported here are what `public/routes.json` may point at.
 *
 * Each is `framed`: the host's breadcrumb, tabs and actions join the screen's
 * own header (`./frame.tsx`). A screen is a placeholder until its ticket
 * lands (`docs/timeoff-build-plan.md`); the overview is TOF-061's.
 */
import './styles.css';

import { TeamNow as TeamNowScreen } from './attendance/team-now';
import { Timesheet as TimesheetScreen } from './attendance/timesheet';
import { framed } from './frame';
import { Overview as OverviewScreen } from './overview/overview';
import { placeholder } from './placeholder';

export const Overview = framed(OverviewScreen);
export const RequestTimeOff = framed(placeholder('Request time off'));
export const DescribeRequest = framed(placeholder('Describe it'));
export const MyRequests = framed(placeholder('My requests'));
export const RequestDetail = framed(placeholder('Request'));
export const Approvals = framed(placeholder('Requests'));
export const TeamCalendar = framed(placeholder('Calendar'));
export const Attendance = framed(placeholder('Attendance'));
// TOF-059, TOF-074 to TOF-077: the clock in the shell's top bar (a slot, not a
// screen: no frame), my timesheet and the team right now.
export { TopBarClock } from './clock/clock';
export const Timesheet = framed(TimesheetScreen);
export const TeamNow = framed(TeamNowScreen);
export const Balance = framed(placeholder('Balance'));
export const Holidays = framed(placeholder('Holidays'));
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
