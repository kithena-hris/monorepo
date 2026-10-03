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

/* ------------------------------------------------ the employee's screens -- */
/* TOF-062 to TOF-067: request, my requests, a balance's ledger, holidays.     */

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
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
 * address names none it can read), with the days that bridge one to a
 * weekend, never one already booked.
 */
async function holidaysWhereYouWork(param: string | undefined): Promise<ScreenLoad> {
  const today = todayUtc();
  const year = /^\d{4}$/.test(param ?? '') ? Number(param) : Number(today.slice(0, 4));
  const [answer, upcoming] = await Promise.all([
    read('TimeOffHolidays', { year }),
    timeOff<{ items: readonly { span: { from: string; to: string } }[] }>('TimeOffMyRequests', {
      tab: 'upcoming',
    }),
  ]);
  if (answer.status !== 'ready') return answer;
  const data = answer.data as { holidays: Holiday[] };
  const booked = upcoming.ok ? upcoming.data.items.map((r) => r.span) : [];
  return {
    status: 'ready',
    data: { ...data, bridges: bridgeDays(data.holidays, today, booked, Infinity), today },
  };
}
