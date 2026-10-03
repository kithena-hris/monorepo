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
    case 'ParentalPlan':
      return parental(query.params['step'] ?? 'plan');
    case 'ParentalCase':
      return read('TimeOffParentalCase', { planId: query.params['id'] ?? null });
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
