/**
 * What federation exposes to the browser: the same names as `index.ts`, each
 * screen in a chunk of its own (`./split.tsx`). `index.test.ts` holds the two
 * lists to each other; the server build and the tests use `index.ts`.
 */
import './styles.css';

import { framed } from './frame';
import { placeholder } from './placeholder';
import { split } from './split';

// In the shell's chrome on every page, and the kiosk's own full screen: not split.
export { TopBarClock } from './clock/clock';
export { Kiosk } from './kiosk/kiosk';

export const Overview = split(() => import('./overview/overview'), 'Overview');
export const RequestTimeOff = split(() => import('./request/request'), 'RequestTimeOff');
export const DescribeRequest = split(() => import('./request/describe'), 'DescribeRequest');
export const MyRequestsUpcoming = split(() => import('./requests/requests'), 'MyRequests');
export const MyRequestsPast = split(() => import('./requests/requests'), 'MyRequests');
export const MyRequestsCancelled = split(() => import('./requests/requests'), 'MyRequests');
export const RequestDetail = split(() => import('./requests/requests'), 'MyRequests');
export const Approvals = split(() => import('./approvals/approvals'), 'Approvals');
export const Delegation = split(() => import('./approvals/delegation'), 'Delegation');
export const TeamCalendar = split(() => import('./calendar/calendar'), 'TeamCalendar');
export const Attendance = framed(placeholder('Attendance'));
export const Timesheet = split(() => import('./attendance/timesheet'), 'Timesheet');
export const KioskCode = split(() => import('./kiosk/code'), 'KioskCode');
export const TeamNow = split(() => import('./attendance/team-now'), 'TeamNow');
export const AttendanceRequests = split(
  () => import('./attendance/requests'),
  'AttendanceRequests',
);
export const Exceptions = split(() => import('./attendance/exceptions'), 'Exceptions');
export const PayPeriod = split(() => import('./attendance/pay-period'), 'PayPeriod');
export const Balance = split(() => import('./balance/balance'), 'Balance');
export const Holidays = split(() => import('./holidays/holidays'), 'Holidays');
export const ParentalPlan = split(() => import('./parental/plan'), 'ParentalPlan');
export const ParentalCase = split(() => import('./parental/case'), 'ParentalCase');
export const ParentalCases = split(() => import('./parental/cases'), 'ParentalCases');
export const Insights = split(() => import('./insights/insights'), 'Insights');
export const LeaveTypes = split(() => import('./settings/leave-types'), 'LeaveTypes');
export const LeaveType = split(() => import('./settings/leave-type'), 'LeaveType');
export const DescribePolicy = split(() => import('./settings/describe-policy'), 'DescribePolicy');
export const NegativeBalance = split(
  () => import('./settings/negative-balance'),
  'NegativeBalance',
);
export const AttendanceSettings = split(
  () => import('./settings/attendance-settings'),
  'AttendanceSettings',
);
export const ApprovalSettings = split(
  () => import('./settings/approval-settings'),
  'ApprovalSettings',
);
export const HolidaySettings = split(
  () => import('./settings/holiday-settings'),
  'HolidaySettings',
);
export const Integrations = split(() => import('./settings/integrations'), 'Integrations');
