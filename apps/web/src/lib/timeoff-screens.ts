import 'server-only';

import { timeOff } from './people';
import type { ScreenLoad, ScreenQuery } from './people-screens';
import { aroundRequest, calendarWindow, clashOf } from './timeoff-calendar-views';
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

export async function loadScreen(
  component: string,
  query: ScreenQuery,
  path = '',
): Promise<ScreenLoad> {
  switch (component) {
    case 'Overview':
      return overview();
    // The manager's (TOF-068 to TOF-073).
    case 'Approvals':
      return approvals(path, query);
    case 'Delegation':
      return read('TimeOffDelegation');
    case 'TeamCalendar':
      return teamCalendar(path, query);
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
