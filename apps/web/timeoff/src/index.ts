/**
 * The only file federation exposes. Everything else in this remote is
 * internal; the names exported here are what `public/routes.json` may point at.
 *
 * Each is `framed`: the host's breadcrumb, tabs and actions join the screen's
 * own header (`./frame.tsx`). A screen is a placeholder until its ticket
 * lands (`docs/timeoff-build-plan.md`); the overview is TOF-061's.
 */
import './styles.css';

import { framed } from './frame';
import { Overview as OverviewScreen } from './overview/overview';
import { placeholder } from './placeholder';
import { ApprovalSettings as ApprovalSettingsScreen } from './settings/approval-settings';
import { AttendanceSettings as AttendanceSettingsScreen } from './settings/attendance-settings';
import { HolidaySettings as HolidaySettingsScreen } from './settings/holiday-settings';
import { LeaveType as LeaveTypeScreen } from './settings/leave-type';
import { LeaveTypes as LeaveTypesScreen } from './settings/leave-types';
import { NegativeBalance as NegativeBalanceScreen } from './settings/negative-balance';

export const Overview = framed(OverviewScreen);
export const RequestTimeOff = framed(placeholder('Request time off'));
export const DescribeRequest = framed(placeholder('Describe it'));
export const MyRequests = framed(placeholder('My requests'));
export const RequestDetail = framed(placeholder('Request'));
export const Approvals = framed(placeholder('Requests'));
export const TeamCalendar = framed(placeholder('Calendar'));
export const Attendance = framed(placeholder('Attendance'));
export const Balance = framed(placeholder('Balance'));
export const Holidays = framed(placeholder('Holidays'));
export const ParentalPlan = framed(placeholder('Plan parental leave'));
export const ParentalCase = framed(placeholder('Parental leave'));
export const Insights = framed(placeholder('Insights'));
export const LeaveTypes = framed(LeaveTypesScreen);
export const LeaveType = framed(LeaveTypeScreen);
export const DescribePolicy = framed(placeholder('Write a policy in plain words'));
export const NegativeBalance = framed(NegativeBalanceScreen);
export const AttendanceSettings = framed(AttendanceSettingsScreen);
export const ApprovalSettings = framed(ApprovalSettingsScreen);
export const HolidaySettings = framed(HolidaySettingsScreen);
export const Integrations = framed(placeholder('Integrations'));
