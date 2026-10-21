import 'server-only';

import { recruiting, timeOff } from './people';
import type { ScreenLoad, ScreenQuery } from './people-screens';
import type { OperationName } from './recruiting-operations';

/**
 * The data each Recruiting screen is drawn from, fetched on the server
 * before the page is sent, through the router, as the person signed in
 * (REC-070): Documents' way. Every filter is the address.
 */

async function read(
  name: OperationName,
  variables: Record<string, unknown> = {},
): Promise<ScreenLoad> {
  const answer = await recruiting<unknown>(name, variables);
  return answer.ok
    ? { status: 'ready', data: answer.data }
    : answer.code === 'UNREACHABLE'
      ? { status: 'error', message: answer.message, unreachable: true }
      : { status: 'error', message: answer.message, code: answer.code };
}

const or = (value: string | undefined): string | null =>
  value === undefined || value === '' ? null : value;

/** The leave that keeps someone away, as Time Off names it. */
const AWAY = new Set(['pending', 'approved', 'taken', 'change_pending']);

/**
 * The days nobody should be offered an interview on, from Time Off when the
 * company has it (PRD §28): the holidays of the reader's own calendar and
 * of every location the company timeline shows, and each person's approved
 * or pending leave. Recruiting never asks Time Off itself; without it, or
 * without the right to read the timeline, the screen simply knows less.
 */
async function daysOff(from: string): Promise<{
  readonly away: Record<string, string[]>;
  readonly holidays: { date: string; name: string }[];
}> {
  const to = new Date(Date.parse(`${from}T00:00:00Z`) + 35 * 86_400_000).toISOString().slice(0, 10);
  const years = [...new Set([from.slice(0, 4), to.slice(0, 4)])].map(Number);
  type Timeline = {
    entries: {
      personId: string;
      status: string;
      span: { from: string; to: string };
    }[];
    holidays: { date: string; name: string }[];
  };
  const [timeline, ...mine] = await Promise.all([
    timeOff<Timeline>('TimeOffCalendarTimeline', { scope: 'company', from, to }),
    ...years.map((year) =>
      timeOff<{ holidays: { date: string; name: string }[] }>('TimeOffHolidays', { year }),
    ),
  ]);
  const holidays = new Map<string, string>();
  for (const answer of mine)
    if (answer.ok) for (const h of answer.data.holidays) holidays.set(h.date, h.name);
  const away: Record<string, string[]> = {};
  if (timeline.ok) {
    for (const h of timeline.data.holidays) if (!holidays.has(h.date)) holidays.set(h.date, h.name);
    for (const e of timeline.data.entries) {
      if (!AWAY.has(e.status)) continue;
      const days = (away[e.personId] ??= []);
      for (
        let d = Date.parse(`${e.span.from}T00:00:00Z`);
        d <= Date.parse(`${e.span.to}T00:00:00Z`);
        d += 86_400_000
      )
        days.push(new Date(d).toISOString().slice(0, 10));
    }
  }
  return {
    away,
    holidays: [...holidays.entries()]
      .filter(([date]) => date >= from && date <= to)
      .map(([date, name]) => ({ date, name })),
  };
}

export async function loadScreen(component: string, query: ScreenQuery): Promise<ScreenLoad> {
  const s = query.search;
  const id = query.params['id'] ?? '';
  switch (component) {
    case 'Home':
    case 'Jobs':
      return read('RecruitingHome');
    case 'Requisitions':
    case 'Requisition':
    case 'RequisitionApproval':
      return read('RecruitingRequisitions');
    case 'JobSetup':
      return id === 'new' ? { status: 'none' } : read('RecruitingJob', { jobId: id });
    case 'Pipeline':
      return read('RecruitingPipeline', {
        jobId: id,
        q: or(s['q']),
        stage: or(s['stage']),
        source: or(s['source']),
        sort: or(s['sort']),
      });
    case 'Candidates':
      return read('RecruitingCandidates', { q: or(s['q']), tag: or(s['tag']) });
    case 'Candidate':
      return read('RecruitingCandidate', { candidateId: id });
    case 'Pools':
      return read('RecruitingPools', { poolId: or(query.params['id']) });
    case 'Interviews':
      return read('RecruitingInterviews');
    case 'Kit':
      return read('RecruitingKit', { interviewId: id });
    case 'Debrief':
      return read('RecruitingDebrief', { applicationId: id });
    case 'Schedule': {
      const from = s['week'] ?? new Date().toISOString().slice(0, 10);
      const off = await daysOff(from);
      return read('RecruitingSlots', {
        applicationId: id,
        planKey: or(s['plan']),
        from: s['week'] === undefined ? null : `${s['week']}T00:00:00.000Z`,
        away: JSON.stringify(off.away),
        holidays: JSON.stringify(off.holidays),
      });
    }
    case 'Offers':
      return read('RecruitingOffers');
    case 'Offer':
      return id === 'new' ? { status: 'none' } : read('RecruitingOffer', { offerId: id });
    case 'OfferApproval':
    case 'Contract':
      return read('RecruitingOffer', { offerId: id });
    case 'Board':
      return read('RecruitingBoard');
    case 'Analytics':
    case 'AnalyticsTile':
      return read('RecruitingAnalytics', {
        period: or(s['period']),
        jobId: or(s['job']),
        department: or(s['department']),
        source: or(s['source']),
      });
    case 'Agencies':
    case 'Settings':
      return read('RecruitingSettings');
    default:
      return { status: 'none' };
  }
}
