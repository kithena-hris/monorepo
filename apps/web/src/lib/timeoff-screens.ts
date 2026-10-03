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
    // TOF-059, TOF-074, TOF-077: the clock and attendance.
    case 'TopBarClock':
      return topBarClock();
    case 'Timesheet':
      return timesheet(query.search);
    case 'TeamNow':
      return teamNow();
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
