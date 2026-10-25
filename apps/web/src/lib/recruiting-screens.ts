import 'server-only';

import { currentTenant } from './branding';
import { onboarding, recruiting, timeOff } from './people';
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

/** A page with an offer open over it (`?offer=`): read with the page, so the modal arrives with it. */
async function withOffer(load: ScreenLoad, offerId: string | undefined): Promise<ScreenLoad> {
  if (load.status !== 'ready' || offerId === undefined || offerId === '') return load;
  const offer = await read('RecruitingOffer', { offerId });
  return {
    ...load,
    data: { ...(load.data as object), openOffer: offer.status === 'ready' ? offer.data : null },
  };
}

/**
 * A hired candidate's onboarding plan, from Onboarding when the company has
 * it and the reader may see it: each hired application's plan id, so the
 * profile links the plan. Nothing when it cannot be read.
 */
async function withPlans(load: ScreenLoad): Promise<ScreenLoad> {
  if (load.status !== 'ready') return load;
  const data = load.data as { applications?: { applicationId: string; outcome: string }[] } | null;
  const hired = new Set(
    (data?.applications ?? []).filter((a) => a.outcome === 'hired').map((a) => a.applicationId),
  );
  if (hired.size === 0) return load;
  const board = await onboarding<{
    rows: { id: string; source: string | null; externalId: string | null }[];
  }>('OnboardingBoard', { state: null });
  if (!board.ok) return load;
  const plans: Record<string, string> = {};
  for (const r of board.data.rows)
    if (r.source === 'recruiting' && r.externalId !== null && hired.has(r.externalId))
      plans[r.externalId] = r.id;
  return { ...load, data: { ...(load.data as object), plans } };
}

/** When each interviewer works, from Time Off: their own week or the company's, in their zone. */
async function workingWeeks(
  personIds: readonly string[],
): Promise<Record<string, { timeZone: string; week: Record<string, [number, number][]> }>> {
  if (personIds.length === 0) return {};
  const answer = await timeOff<{
    weeks: {
      personId: string;
      timeZone: string;
      days: { weekday: number; start: number; end: number }[];
    }[];
  }>('TimeOffWorkingWeeks', { personIds: personIds.join(',') });
  if (!answer.ok) return {};
  return Object.fromEntries(
    answer.data.weeks.map((w) => [
      w.personId,
      {
        timeZone: w.timeZone,
        week: Object.fromEntries(w.days.map((d) => [String(d.weekday), [[d.start, d.end]]])),
      },
    ]),
  );
}

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

/** The candidate open over the board, with their onboarding plan when they are hired. */
async function spotlightOf(load: ScreenLoad): Promise<unknown> {
  const withPlan = await withPlans(load);
  return withPlan.status === 'ready' ? withPlan.data : null;
}

export async function loadScreen(component: string, query: ScreenQuery): Promise<ScreenLoad> {
  const s = query.search;
  const id = query.params['id'] ?? '';
  switch (component) {
    case 'Home':
      return read('RecruitingHome');
    case 'Jobs':
      return read('RecruitingJobs');
    case 'Requisitions':
    case 'Requisition':
    case 'RequisitionApproval':
      return read('RecruitingRequisitions');
    case 'JobSetup':
      return id === 'new' ? read('RecruitingNewJob') : read('RecruitingJob', { jobId: id });
    case 'Pipeline': {
      // The application open over the board is read beside it, so the overlay arrives with the page.
      const [board, spotlight] = await Promise.all([
        read('RecruitingPipeline', {
          jobId: id,
          q: or(s['q']),
          stage: or(s['stage']),
          source: or(s['source']),
          sort: or(s['sort']),
        }),
        s['candidate'] === undefined || s['candidate'] === ''
          ? Promise.resolve(null)
          : read('RecruitingCandidate', { candidateId: s['candidate'] }),
      ]);
      return withOffer(
        board.status !== 'ready'
          ? board
          : {
              status: 'ready',
              data: {
                ...(board.data as object),
                spotlight: spotlight === null ? null : await spotlightOf(spotlight),
              },
            },
        s['offer'],
      );
    }
    case 'Candidates':
      return read('RecruitingCandidates', { q: or(s['q']), tag: or(s['tag']) });
    case 'Candidate':
      return withOffer(
        await withPlans(await read('RecruitingCandidate', { candidateId: id })),
        s['offer'],
      );
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
      const variables = {
        applicationId: id,
        planKey: or(s['plan']),
        from: s['week'] === undefined ? null : `${s['week']}T00:00:00.000Z`,
        away: JSON.stringify(off.away),
        holidays: JSON.stringify(off.holidays),
        // The interviewers chosen on the screen, kept in the address.
        interviewers: or(s['with']),
      };
      const first = await read('RecruitingSlots', variables);
      // The interviewers are known only once Recruiting has answered; their weeks then come
      // from Time Off and the slots are drawn again inside them.
      // ponytail: two reads of Recruiting; one when Recruiting learns the weeks by event.
      if (first.status !== 'ready') return first;
      const data = first.data as { organiser: string | null; interviewers: string[] };
      const ids = [...data.interviewers, ...(data.organiser === null ? [] : [data.organiser])];
      const weeks = await workingWeeks(ids);
      return Object.keys(weeks).length === 0
        ? first
        : read('RecruitingSlots', { ...variables, weeks: JSON.stringify(weeks) });
    }
    case 'Offers':
      return withOffer(await read('RecruitingOffers'), s['offer']);
    case 'Offer':
      if (id !== 'new') return read('RecruitingOffer', { offerId: id });
      return s['application'] === undefined
        ? { status: 'none' }
        : read('RecruitingOfferStart', { applicationId: s['application'] });
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
    case 'Settings': {
      // With the company as Kithena knows it, so the careers page starts from its name and address.
      const [load, tenant] = await Promise.all([read('RecruitingSettings'), currentTenant()]);
      return load.status !== 'ready' || tenant === null
        ? load
        : {
            ...load,
            data: {
              ...(load.data as Record<string, unknown>),
              company: {
                name: tenant.branding.displayName,
                slug: tenant.slug,
                logoUrl: tenant.branding.logoUrl,
                themeId: tenant.branding.themeId,
              },
            },
          };
    }
    default:
      return { status: 'none' };
  }
}
