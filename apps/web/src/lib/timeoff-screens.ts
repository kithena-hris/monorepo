import 'server-only';

import { timeOff } from './people';
import type { ScreenLoad, ScreenQuery } from './people-screens';
import { aroundRequest, calendarWindow, clashOf } from './timeoff-calendar-views';
import type { OperationName } from './timeoff-operations';
import { upcomingHolidays, type Holiday } from './timeoff-views';

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

export async function loadScreen(
  component: string,
  query: ScreenQuery,
  path = '',
): Promise<ScreenLoad> {
  switch (component) {
    case 'Overview':
      return overview();
    // Parental leave (TOF-104 to TOF-106).
    case 'ParentalPlan':
      return parental(query.params['step'] ?? 'plan');
    case 'ParentalCase':
      return read('TimeOffParentalCase', { planId: query.params['id'] ?? null });
    // The manager's (TOF-068 to TOF-073).
    case 'Approvals':
      return approvals(path, query);
    case 'Delegation':
      return read('TimeOffDelegation');
    case 'TeamCalendar':
      return teamCalendar(path, query);
    // The employee's screens (TOF-062 to TOF-067).
    case 'RequestTimeOff':
      return requestPanel(query.search);
    case 'MyRequestsUpcoming':
      return myRequests('upcoming');
    case 'MyRequestsPast':
      return myRequests('past');
    case 'MyRequestsCancelled':
      return myRequests('cancelled');
    case 'RequestDetail':
      return requestDetail(query.params['id'] ?? '');
    case 'Balance':
      return read('TimeOffBalance', { leaveTypeKey: query.params['type'] ?? '' });
    case 'Holidays':
      return holidaysWhereYouWork(query.params['year']);
    // TOF-059, TOF-074, TOF-077: the clock and attendance.
    case 'TopBarClock':
      return topBarClock();
    case 'Timesheet':
      return timesheet(query.search);
    case 'TeamNow':
      return teamNow();
    // Settings (TOF-078 to TOF-083), HR only: Time Off refuses anyone else.
    case 'LeaveTypes':
      return leaveTypeSettings();
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
 * T8–T10, MT11, MT12: the person's plan, with the step the address names
 * (`about`, `plan`, `handover`, `send`), so the screen draws that step.
 */
async function parental(step: string): Promise<ScreenLoad> {
  const base = await read('TimeOffParentalPlan');
  return base.status === 'ready'
    ? { status: 'ready', data: { ...(base.data as object), step } }
    : base;
}

/**
 * T1, MT1: the overview, with its bridge days (Time Off's, TOF-085), and
 * beside it the holidays where the person works, this year's and next
 * (Coming up crosses New Year in December). `now` is when it was asked, so
 * the clock card's timer starts from the server's minute. A holiday read
 * Time Off refuses leaves the holidays out, not the page.
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
  return {
    status: 'ready',
    data: {
      ...(base.data as object),
      holidays: upcomingHolidays(holidays, today),
      now: now.toISOString(),
    },
  };
}

/* ------------------------------------------------------------ attendance -- */

/** A calendar date `days` after `date`, both `YYYY-MM-DD`. */
const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** The Monday on or before `date`. */
const mondayOf = (date: string): string =>
  addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * T2: the clock in the top bar, on every page. Its punches are the last
 * week's and the day after today in UTC, so the person's own today is in it
 * wherever they are, and the clock's state is the last of them.
 * ponytail: a clock left running for more than a week shows as out (its open
 * day is the timesheet's to fix); a clock read of Time Off's own would carry
 * the state whatever its age.
 */
async function topBarClock(): Promise<ScreenLoad> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const sheet = await read('TimeOffTimesheet', { from: addDays(today, -7), to: addDays(today, 1) });
  return sheet.status === 'ready'
    ? { status: 'ready', data: { ...(sheet.data as object), now: now.toISOString() } }
    : sheet;
}

/**
 * T20, MT17: my timesheet for a week (`?week=2026-09-28`, any day of it) or a
 * month (`?month=2026-09`), this week by default. `?fix=2026-09-30` opens that
 * day's missed clock-out (T21), as a morning notification links to it. An
 * address that is neither is this week, said above the page.
 */
async function timesheet(search: Readonly<Record<string, string>>): Promise<ScreenLoad> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const { week, month, fix } = search;
  const period =
    month !== undefined && MONTH.test(month)
      ? {
          kind: 'month' as const,
          from: `${month}-01`,
          to: addDays(`${addDays(`${month}-01`, 31).slice(0, 7)}-01`, -1),
        }
      : {
          kind: 'week' as const,
          from: mondayOf(week !== undefined && DATE.test(week) ? week : today),
        };
  const range = period.kind === 'week' ? { ...period, to: addDays(period.from, 6) } : period;
  const refused =
    (month !== undefined && !MONTH.test(month)) ||
    (month === undefined && week !== undefined && !DATE.test(week));
  const sheet = await read('TimeOffTimesheet', { from: range.from, to: range.to });
  if (sheet.status !== 'ready') return sheet;
  return {
    status: 'ready',
    data: {
      ...(sheet.data as object),
      period: range,
      fix: fix !== undefined && DATE.test(fix) ? fix : null,
      now: now.toISOString(),
    },
    ...(refused ? { notice: `“${month ?? week ?? ''}” is not a week or a month` } : {}),
  };
}

/**
 * T22, MT19: the caller's reports right now, and today's calendar for the
 * team beside it, for who is away and until when. A calendar Time Off
 * refuses leaves nobody away, not the page.
 */
async function teamNow(): Promise<ScreenLoad> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const [board, calendar] = await Promise.all([
    read('TimeOffTeamRightNow'),
    timeOff<{ entries: unknown[] }>('TimeOffCalendarDay', { date: today }),
  ]);
  if (board.status !== 'ready') return board;
  return {
    status: 'ready',
    data: {
      ...(board.data as object),
      away: calendar.ok ? calendar.data.entries : [],
      now: now.toISOString(),
    },
  };
}

/* ------------------------------------------- the manager's, TOF-068 to TOF-073 -- */

interface Span {
  readonly from: string;
  readonly to: string;
}
interface CalendarAnswer {
  readonly entries: readonly { requestId: string; status: string; span: Span }[];
  readonly coverage: readonly { date: string; below: boolean }[];
}
interface DecisionAnswer {
  readonly request: { readonly span: Span };
  readonly member: { readonly teamKey: string | null };
}

/** How each leave type looks: the request panel's list, or none for an account that is not a member. */
async function leaveTypes(): Promise<unknown[]> {
  const panel = await timeOff<{ leaveTypes: unknown[] }>('TimeOffRequestPanel');
  return panel.ok ? panel.data.leaveTypes : [];
}

/** One request with its team around the dates (T17), or `null` when Time Off refuses it. */
async function decisionOf(requestId: string): Promise<Record<string, unknown> | null> {
  const answer = await timeOff<DecisionAnswer>('TimeOffRequestDecision', { requestId });
  if (!answer.ok) return null;
  const { teamKey } = answer.data.member;
  const team =
    teamKey === null
      ? null
      : await timeOff<unknown>('TimeOffCalendarTimeline', {
          scope: 'team',
          teamKey,
          ...aroundRequest(answer.data.request.span),
        });
  return { ...answer.data, team: team?.ok === true ? team.data : null };
}

const TABS: Readonly<Record<string, 'waiting' | 'coming_up' | 'decided'>> = {
  waiting: 'waiting',
  'coming-up': 'coming_up',
  decided: 'decided',
};

/**
 * T16–T18: the tab the address names, the leave types' looks, and, under
 * Waiting for me, the request it opens (`/time-off/approvals/waiting/:id`)
 * with its team around the dates. `now` is when it was asked, for "Sent
 * yesterday".
 */
async function approvals(path: string, query: ScreenQuery): Promise<ScreenLoad> {
  const tab = TABS[path.split('/')[3] ?? ''] ?? 'waiting';
  const id = tab === 'waiting' ? (query.params['id'] ?? null) : null;
  const [base, types, decision] = await Promise.all([
    read('TimeOffApprovals', { tab }),
    leaveTypes(),
    id === null ? null : decisionOf(id),
  ]);
  if (base.status !== 'ready') return base;
  return {
    status: 'ready',
    data: { ...(base.data as object), types, decision, now: new Date().toISOString() },
  };
}

const SCOPES = new Set(['team', 'company', 'me']);

/**
 * T12–T15, MT13, MT14: the view the address names; the scope and team, the
 * month and the phone's week, or the year, from the query (the types,
 * holidays and day open are the screen's to apply); and on the timeline,
 * the waiting request that breaks the minimum with the fixes for it.
 */
async function teamCalendar(path: string, query: ScreenQuery): Promise<ScreenLoad> {
  const view = path.endsWith('/timeline') ? 'timeline' : path.endsWith('/year') ? 'year' : 'month';
  const scope = SCOPES.has(query.search['scope'] ?? '')
    ? (query.search['scope'] ?? 'team')
    : 'team';
  const teamKey = scope === 'team' ? (query.search['team'] ?? null) : null;
  const today = new Date().toISOString().slice(0, 10);
  const window = calendarWindow(query.search, today);
  const asked = { scope, ...(teamKey === null ? {} : { teamKey }) };
  const [answer, types] = await Promise.all([
    view === 'year'
      ? read('TimeOffCalendarYear', { ...asked, year: window.year })
      : read('TimeOffCalendarTimeline', { ...asked, from: window.from, to: window.to }),
    leaveTypes(),
  ]);
  if (answer.status !== 'ready') return answer;
  const calendar = view === 'year' ? null : (answer.data as CalendarAnswer);
  const clash =
    calendar === null || view !== 'timeline' ? null : clashOf(calendar, query.search['request']);
  return {
    status: 'ready',
    data: {
      view,
      scope,
      teamKey,
      month: window.month,
      week: window.week,
      year: window.year,
      today,
      calendar,
      days: view === 'year' ? (answer.data as { days: unknown[] }).days : null,
      types,
      clash: clash === null ? null : await decisionOf(clash),
    },
  };
}

/* ------------------------------------------------ the employee's screens -- */
/* TOF-062 to TOF-067: request, my requests, a balance's ledger, holidays.     */

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const dayIn = (value: string | undefined): string | null =>
  value !== undefined && DAY.test(value) ? value : null;
const todayUtc = (): string => new Date().toISOString().slice(0, 10);

/**
 * T3, T5, MT5–MT7, MT9: the request panel over the overview. What is asked
 * is the address's — `type`, `from`, `to`, `half` (the last day a half day),
 * `month` on show and a phone's `step` — so every change the person makes is
 * this read again, and the preview is Time Off's, never the browser's. Beside
 * it the team's month for the calendar's dots and clash days, and the year's
 * holidays to strike through. Dates Time Off refuses (the end before the
 * start) are said in the panel, which is drawn without them.
 */
async function requestPanel(search: Readonly<Record<string, string>>): Promise<ScreenLoad> {
  const today = todayUtc();
  const type = search['type'] === undefined || search['type'] === '' ? null : search['type'];
  const from = dayIn(search['from']);
  const to = dayIn(search['to']) ?? from;
  const half = search['half'] === '1';
  const step = ['type', 'dates', 'review'].includes(search['step'] ?? '') ? search['step'] : null;
  const month = MONTH.test(search['month'] ?? '')
    ? (search['month'] ?? '')
    : (from ?? today).slice(0, 7);
  const dated = type !== null && from !== null && to !== null;
  const asked = dated
    ? { leaveTypeKey: type, from, to, endsHalfDay: half }
    : type === null
      ? {}
      : { leaveTypeKey: type };
  const [behind, first, team, year] = await Promise.all([
    overview(),
    read('TimeOffRequestPanel', asked),
    timeOff<unknown>('TimeOffCalendarMonth', { month, scope: 'team' }),
    timeOff<{ holidays: Holiday[] }>('TimeOffHolidays', { year: Number(month.slice(0, 4)) }),
  ]);
  let panel = first;
  let problem: string | null = null;
  if (panel.status === 'error' && panel.unreachable !== true && dated) {
    problem = panel.message;
    panel = await read('TimeOffRequestPanel', { leaveTypeKey: type });
  }
  if (panel.status !== 'ready') return panel;
  return {
    status: 'ready',
    data: {
      ...(panel.data as object),
      overview: behind.status === 'ready' ? behind.data : null,
      asked: { type, from, to, half, step, month },
      team: team.ok ? team.data : null,
      holidays: year.ok ? year.data.holidays : [],
      today,
      problem,
    },
  };
}

const LIVE = new Set(['pending', 'approved', 'counter_proposed', 'change_pending']);
type Tab = 'upcoming' | 'past' | 'cancelled';
interface Item {
  readonly requestId: string;
  readonly status: string;
  readonly span: { readonly to: string };
}

/**
 * T6: a tab of the caller's requests and, for the desk's second column, the
 * first of them in full. The list is the page; a request Time Off will not
 * show leaves the column empty, not the page.
 */
async function myRequests(tab: Tab): Promise<ScreenLoad> {
  const list = await read('TimeOffMyRequests', { tab });
  if (list.status !== 'ready') return list;
  const { items } = list.data as { items: readonly Item[] };
  const first = items[0];
  const selected =
    first === undefined
      ? null
      : await timeOff<unknown>('TimeOffRequest', { requestId: first.requestId });
  return {
    status: 'ready',
    data: {
      tab,
      items,
      selected: selected?.ok === true ? selected.data : null,
      single: false,
      today: todayUtc(),
    },
  };
}

/**
 * T6's detail, MT10: one request at its own address, and beside it at a
 * desk the caller's tab it belongs to. An approver or HR opening someone
 * else's request gets the request alone.
 */
async function requestDetail(requestId: string): Promise<ScreenLoad> {
  const one = await read('TimeOffRequest', { requestId });
  if (one.status !== 'ready') return one;
  const detail = one.data as { mine: boolean; request: Item };
  const today = todayUtc();
  const { status, span } = detail.request;
  const tab: Tab = ['cancelled', 'withdrawn'].includes(status)
    ? 'cancelled'
    : LIVE.has(status) && span.to >= today
      ? 'upcoming'
      : 'past';
  const list = detail.mine
    ? await timeOff<{ items: readonly Item[] }>('TimeOffMyRequests', { tab })
    : null;
  return {
    status: 'ready',
    data: {
      tab,
      items: list?.ok === true ? list.data.items : [],
      selected: detail,
      single: true,
      today,
    },
  };
}

/**
 * MT21: the holidays where the caller works in a year (this year when the
 * address names none it can read), with the bridge days Time Off found.
 */
async function holidaysWhereYouWork(param: string | undefined): Promise<ScreenLoad> {
  const today = todayUtc();
  const year = /^\d{4}$/.test(param ?? '') ? Number(param) : Number(today.slice(0, 4));
  const answer = await read('TimeOffHolidays', { year });
  return answer.status === 'ready'
    ? { status: 'ready', data: { ...(answer.data as object), today } }
    : answer;
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
async function leaveTypeSettings(): Promise<ScreenLoad> {
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
