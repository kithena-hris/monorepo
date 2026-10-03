import 'server-only';

import { timeOff } from './people';
import type { ScreenLoad, ScreenQuery } from './people-screens';
import type { OperationName } from './timeoff-operations';
import { bridgeDays, upcomingHolidays, type Holiday } from './timeoff-views';

/**
 * The data each Time Off screen is drawn from, fetched on the server before
 * the page is sent, through the router, as the person signed in (TOF-060):
 * People's way (`people-screens.ts`), for the second area.
 *
 * One `case` per screen the remote's manifest names, each the screen's own
 * query (`timeoff-operations.ts`) and whatever it is drawn beside. The answer
 * crosses to the remote as its `Loadable`, untouched beyond what is said
 * here; a screen without a case starts from its own first state. Later
 * screens add a case.
 */

async function read(
  name: OperationName,
  variables: Record<string, unknown> = {},
): Promise<ScreenLoad> {
  const answer = await timeOff<unknown>(name, variables);
  return answer.ok
    ? { status: 'ready', data: answer.data }
    : answer.code === 'UNREACHABLE'
      ? { status: 'error', message: answer.message, unreachable: true }
      : { status: 'error', message: answer.message, code: answer.code };
}

export async function loadScreen(component: string, query: ScreenQuery): Promise<ScreenLoad> {
  switch (component) {
    case 'Overview':
      return overview();
    // Settings (TOF-078 to TOF-083), HR only: Time Off refuses anyone else.
    case 'LeaveTypes':
      return leaveTypes();
    case 'LeaveType':
      return leaveType(query);
    case 'NegativeBalance':
      return read('TimeOffNegativeBalanceSettings');
    case 'AttendanceSettings':
      return read('TimeOffAttendanceSettings');
    case 'ApprovalSettings':
      return approvalSettings();
    case 'HolidaySettings':
      return holidaySettings(query);
    default:
      return { status: 'none' };
  }
}

/**
 * T1, MT1: the overview, and beside it the holidays where the person works,
 * this year's and next (Coming up crosses New Year in December), for what is
 * coming up and the days that bridge a holiday to a weekend. `now` is when
 * it was asked, so the clock card's timer starts from the server's minute.
 * A holiday read Time Off refuses leaves the holidays out, not the page.
 */
async function overview(): Promise<ScreenLoad> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const year = now.getUTCFullYear();
  const [base, ...years] = await Promise.all([
    read('TimeOffOverview'),
    timeOff<{ holidays: Holiday[] }>('TimeOffHolidays', { year }),
    timeOff<{ holidays: Holiday[] }>('TimeOffHolidays', { year: year + 1 }),
  ]);
  if (base.status !== 'ready') return base;
  const holidays = years.flatMap((a) => (a.ok ? a.data.holidays : []));
  const data = base.data as { comingUp: readonly { span: { from: string; to: string } }[] };
  return {
    status: 'ready',
    data: {
      ...data,
      holidays: upcomingHolidays(holidays, today),
      bridges: bridgeDays(
        holidays,
        today,
        data.comingUp.map((r) => r.span),
      ),
      now: now.toISOString(),
    },
  };
}

/* ------------------------------------------------------------- settings -- */

type Data = Record<string, unknown>;

/** Both reads' data joined, or the first answer that was not ready. */
function both(a: ScreenLoad, b: ScreenLoad, join: (a: Data, b: Data) => Data): ScreenLoad {
  if (a.status !== 'ready') return a;
  if (b.status !== 'ready') return b;
  return { status: 'ready', data: join(a.data as Data, b.data as Data) };
}

/** T29: every leave type, and the approval rules that say who approves each. */
async function leaveTypes(): Promise<ScreenLoad> {
  const [types, approvals] = await Promise.all([
    read('TimeOffLeaveTypeSettings'),
    read('TimeOffApprovalSettings'),
  ]);
  return both(types, approvals, (t, a) => ({ ...t, rules: a['rules'] }));
}

/**
 * T30: one leave type, the policy chosen in the address (`?policy=`, else its
 * first), and when that policy has a draft, what publishing it would do,
 * folded by Time Off. `?as=` is whose view of it to show.
 */
async function leaveType({ params, search }: ScreenQuery): Promise<ScreenLoad> {
  const setting = await read('TimeOffLeaveTypeSetting', { leaveTypeKey: params['id'] ?? '' });
  if (setting.status !== 'ready') return setting;
  const data = setting.data as {
    policies: readonly { id: string; versions: readonly { status: string }[] }[];
  };
  const policy = data.policies.find((p) => p.id === search['policy']) ?? data.policies[0];
  const preview =
    policy?.versions.at(-1)?.status === 'draft'
      ? await read('TimeOffPolicyPreview', { policyId: policy.id })
      : null;
  return {
    status: 'ready',
    data: {
      ...data,
      policyId: policy?.id ?? null,
      // A preview Time Off refused leaves the preview out, not the page.
      preview: preview?.status === 'ready' ? preview.data : null,
      as: search['as'] ?? null,
    },
  };
}

/** T34: the rules and minimums, and the leave types they name. */
async function approvalSettings(): Promise<ScreenLoad> {
  const [approvals, types] = await Promise.all([
    read('TimeOffApprovalSettings'),
    read('TimeOffLeaveTypeSettings'),
  ]);
  return both(approvals, types, (a, t) => ({ ...a, leaveTypes: t['leaveTypes'] }));
}

/** T36: the year in the address (this year without one) and the location in `?location=`. */
async function holidaySettings({ params, search }: ScreenQuery): Promise<ScreenLoad> {
  const thisYear = new Date().getUTCFullYear();
  const year = /^\d{4}$/.test(params['year'] ?? '') ? Number(params['year']) : thisYear;
  const answer = await read('TimeOffHolidaySettings', { year });
  if (answer.status !== 'ready') return answer;
  return {
    status: 'ready',
    data: { ...(answer.data as Data), thisYear, location: search['location'] ?? null },
  };
}
