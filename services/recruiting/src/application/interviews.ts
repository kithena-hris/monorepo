import { randomBytes } from 'node:crypto';
import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { Instant, Rating, Recommendation } from '@kithena/contracts';

import { may } from '../domain/access/access.js';
import {
  debrief,
  decideDebrief,
  moveInterview,
  submitScorecard,
  visibleScorecards,
  type Debrief,
  type DebriefDecision,
  type InterviewState,
  type Scorecard,
} from '../domain/interview/interview.js';
import { freeSlots, ics, OFFICE_WEEK, type Availability } from '../domain/interview/slots.js';
import { calendarBusy, putOnCalendar, takeOffCalendar } from './calendars.js';
import { tellInterviewers } from './chat.js';
import {
  asPerson,
  event,
  forbidden,
  jobFacts,
  nameOf,
  notFound,
  publish,
  type Ctx,
} from './context.js';
import { sha256, portalLink } from './intake.js';
import { asksOf, newAsk, saveAsk, type Agenda, type Ask } from './asks.js';
import { emailFor, emailValues } from './emails.js';
import { loadApplication, render, sendNow } from './moves.js';
import type { InterviewRecord, PlannedInterview, WorkingHours } from './ports.js';
import { generalSettings } from './setup.js';

/**
 * Interviews (PRD §16, REC-051, REC-052): slots from working hours, booking
 * with an `.ics`, the candidate's self-scheduling link, the kit, scorecards
 * kept independent, and the debrief's decision.
 */

/** Away days by interviewer, as the shell passes them from Time Off (PRD §28); absent means none known. */
export type Absences = Readonly<Record<string, readonly string[]>>;

/**
 * When each person works, as the shell reads it from Time Off: their own
 * schedule or the company's week, in their zone. Used for anyone who has not
 * set working hours in Recruiting; without either, the office week in UTC.
 */
export type Weeks = Readonly<
  Record<
    string,
    {
      readonly timeZone: string;
      readonly week: Readonly<Record<string, readonly (readonly [number, number])[]>>;
    }
  >
>;

/** The company's holidays, as the shell reads them from Time Off: no one is booked on one. */
export interface Holiday {
  readonly date: string;
  readonly name: string;
}

/** Each interviewer's away days with every holiday added: nobody is offered on either. */
function withHolidays(
  people: readonly string[],
  away: Absences,
  holidays: readonly Holiday[],
): Absences {
  const dates = holidays.map((h) => h.date);
  return Object.fromEntries(people.map((p) => [p, [...(away[p] ?? []), ...dates]]));
}

/** Everyone the interview needs: the interviewers and whoever arranges it, once each. */
const withOrganiser = (interviewers: readonly string[], organiser: string | null | undefined) =>
  organiser == null || interviewers.includes(organiser)
    ? [...interviewers]
    : [...interviewers, organiser];

/**
 * Everyone who must be free, each in their own working week and zone: their
 * own Recruiting hours, else Time Off's week, else the office week in UTC;
 * not on a day away; not in an interview or a meeting on their Google or
 * Microsoft 365 calendar.
 */
async function availability(
  ctx: Ctx,
  people: readonly string[],
  from: Instant,
  to: Instant,
  away: Absences,
  weeks: Weeks = {},
): Promise<Availability[]> {
  const out: Availability[] = [];
  for (const personId of people) {
    const hours = await ctx.tx.workingHours.get(personId);
    const busy = (await ctx.tx.interviews.forInterviewer(personId, from, to))
      .filter((i) => i.state === 'scheduled')
      .map(
        (i) =>
          [
            i.startsAt,
            new Date(Date.parse(i.startsAt) + i.minutes * 60_000).toISOString(),
          ] as const,
      )
      .concat(await calendarBusy(ctx, personId, from, to));
    const known = weeks[personId];
    out.push({
      personId,
      timeZone: hours?.timeZone ?? known?.timeZone ?? 'UTC',
      week: hours?.week ?? known?.week ?? OFFICE_WEEK,
      away: away[personId] ?? [],
      busy,
    });
  }
  return out;
}

async function planned(ctx: Ctx, jobId: string, key: string): Promise<PlannedInterview | null> {
  return (await ctx.tx.jobs.plan(jobId)).find((p) => p.key === key) ?? null;
}

export async function slotsFor(
  ctx: Ctx,
  applicationId: string,
  planKey: string,
  from: Instant,
  to: Instant,
  away: Absences = {},
  weeks: Weeks = {},
): Promise<Result<readonly string[]>> {
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'interview.schedule')) return err(forbidden());
  const plan = await planned(ctx, loaded.value.app.jobId, planKey);
  if (plan === null) return err(notFound('interview in the plan'));
  return ok(
    freeSlots(
      await availability(
        ctx,
        withOrganiser(plan.interviewerIds, ctx.caller.personId),
        from,
        to,
        away,
        weeks,
      ),
      from,
      to,
      plan.minutes,
      30,
      ctx.at,
    ),
  );
}

/**
 * R16 in one answer: the interviews in the job's plan, the one chosen, and
 * its free slots across the week asked for (default: from today, five days).
 */
export async function scheduleScreen(
  ctx: Ctx,
  applicationId: string,
  planKey: string | undefined,
  from: Instant | undefined,
  away: Absences = {},
  holidays: readonly Holiday[] = [],
  weeks: Weeks = {},
): Promise<
  Result<{
    candidate: { id: string; name: string };
    job: { id: string; title: string };
    plan: readonly PlannedInterview[];
    planKey: string | null;
    from: Instant;
    to: Instant;
    slots: readonly string[];
    names: Readonly<Record<string, string>>;
    /** What the candidate has been asked (times proposed, a change wanted), newest first. */
    asks: readonly Ask[];
    booked: readonly InterviewRecord[];
    /** A Meet (or Teams, or Zoom) link can be made at booking: a calendar is connected or delegated. */
    meet: boolean;
    /** The holidays in view, named, for the calendar to strike. */
    holidays: readonly Holiday[];
    /** Who among the interviewers is away when, for the link the candidate gets. */
    away: Absences;
    /** The interviewers' working weeks from Time Off, kept with the link too. */
    weeks: Weeks;
    /** Whoever is arranging it, free alongside the interviewers; the shell reads their week too. */
    organiser: string | null;
  }>
> {
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'interview.schedule')) return err(forbidden());
  const plan = await ctx.tx.jobs.plan(loaded.value.app.jobId);
  const chosen = plan.find((p) => p.key === planKey) ?? plan[0] ?? null;
  // A month of days at once: the screen's calendar marks the days with a slot and lists one day's times.
  const start = from ?? (`${ctx.today}T00:00:00.000Z` as Instant);
  const end = new Date(Date.parse(start) + 35 * 86_400_000).toISOString() as Instant;
  // The recruiter arranging it is one of the people who must be free.
  const people = withOrganiser(chosen?.interviewerIds ?? [], ctx.caller.personId);
  const off = withHolidays(people, away, holidays);
  const slots =
    chosen === null
      ? ok([] as readonly string[])
      : await slotsFor(ctx, applicationId, chosen.key, start, end, off, weeks);
  if (!slots.ok) return slots;
  const candidate = await ctx.tx.candidates.get(loaded.value.app.candidateId);
  const job = await ctx.tx.jobs.get(loaded.value.app.jobId);
  return ok({
    candidate: { id: candidate?.id ?? '', name: candidate?.name ?? '' },
    job: { id: job?.id ?? '', title: job?.title ?? '' },
    plan,
    planKey: chosen?.key ?? null,
    from: start,
    to: end,
    slots: slots.value,
    names: await namesOf(
      ctx,
      plan.flatMap((p) => p.interviewerIds),
    ),
    asks: (await asksOf(ctx, applicationId)).toReversed(),
    booked: (await ctx.tx.interviews.forApplication(applicationId)).filter(
      (i) => i.state === 'scheduled',
    ),
    meet: await canMakeVideo(ctx, chosen?.interviewerIds ?? []),
    holidays: holidays.filter((h) => h.date >= start.slice(0, 10) && h.date < end.slice(0, 10)),
    away: Object.fromEntries(people.map((p) => [p, away[p] ?? []])),
    organiser: ctx.caller.personId,
    weeks: Object.fromEntries(
      people.flatMap((p) => {
        const w = weeks[p];
        return w === undefined ? [] : [[p, w] as const];
      }),
    ),
  });
}

/** Whether booking will yield a video link: Workspace delegation, or one interviewer's own calendar or Zoom. */
async function canMakeVideo(ctx: Ctx, interviewerIds: readonly string[]): Promise<boolean> {
  if (ctx.deps.workspaceCalendar !== undefined) return true;
  if ((ctx.deps.connections ?? []).length === 0) return false;
  for (const id of interviewerIds) if ((await ctx.tx.connections.list(id)).length > 0) return true;
  return false;
}

export interface Booking {
  readonly planKey: string;
  readonly startsAt: Instant;
  readonly interviewerIds?: readonly string[] | undefined;
  /** Neither a place nor a link: a Meet (or Teams, or Zoom) is made on the organiser's calendar. */
  readonly place: string | null;
  readonly videoUrl: string | null;
  /** What the interview is about: the calendar event's description and part of the invitation. */
  readonly agenda?: Agenda | null | undefined;
}

export async function bookInterview(
  ctx: Ctx,
  applicationId: string,
  booking: Booking,
  by: 'team' | 'candidate',
): Promise<Result<InterviewRecord>> {
  const app = await ctx.tx.applications.get(applicationId);
  if (app === null) return err(notFound('application'));
  const plan = await planned(ctx, app.jobId, booking.planKey);
  if (plan === null) return err(notFound('interview in the plan'));
  const interviewerIds = booking.interviewerIds ?? plan.interviewerIds;
  if (interviewerIds.length === 0)
    return err(failure('NO_INTERVIEWERS', 'Name the interviewers in the plan first'));
  const end = new Date(Date.parse(booking.startsAt) + plan.minutes * 60_000).toISOString();
  const free = freeSlots(
    await availability(ctx, interviewerIds, booking.startsAt, end as Instant, {}),
    booking.startsAt,
    end,
    plan.minutes,
    1,
  );
  if (by === 'candidate' && free[0] !== new Date(booking.startsAt).toISOString())
    return err(failure('SLOT_TAKEN', 'That time has just been taken; choose another'));
  const interview: InterviewRecord = {
    id: ctx.deps.newId(),
    applicationId,
    planKey: plan.key,
    title: plan.title,
    startsAt: booking.startsAt,
    minutes: plan.minutes,
    interviewerIds,
    state: 'scheduled',
    place: booking.place,
    videoUrl: booking.videoUrl,
  };
  const job = await ctx.tx.jobs.get(app.jobId);
  if (booking.agenda != null) await ctx.tx.settings.set(`agenda:${interview.id}`, booking.agenda);
  const videoUrl = await putOnCalendar(ctx, interview, {
    title: `${plan.title}: ${job?.title ?? ''}`,
    startsAt: booking.startsAt,
    minutes: plan.minutes,
    description: booking.agenda?.text ?? 'Scheduled in Kithena Recruiting.',
  });
  const booked = videoUrl === null ? interview : { ...interview, videoUrl };
  await ctx.tx.interviews.save(booked);
  await publish(
    ctx,
    event(
      ctx,
      'recruiting.interview.scheduled',
      { type: 'Interview', id: interview.id },
      { interviewId: interview.id, applicationId, interviewerIds, startsAt: booking.startsAt },
    ),
  );
  await invite(ctx, booked, false);
  const candidate = await ctx.tx.candidates.get(app.candidateId);
  await tellInterviewers(ctx, booked, candidate?.name ?? 'a candidate');
  return ok(booked);
}

async function invite(ctx: Ctx, interview: InterviewRecord, cancelled: boolean): Promise<void> {
  const app = await ctx.tx.applications.get(interview.applicationId);
  const candidate = app === null ? null : await ctx.tx.candidates.get(app.candidateId);
  const settings = await generalSettings(ctx);
  const job = app === null ? null : await ctx.tx.jobs.get(app.jobId);
  if (candidate === null) return;
  const where = interview.videoUrl ?? interview.place;
  const invitation = ics({
    uid: `${interview.id}@kithena`,
    start: interview.startsAt,
    minutes: interview.minutes,
    title: `${interview.title}: ${job?.title ?? ''} at ${settings.companyName}`,
    description: where === null ? '' : `Where: ${where}`,
    location: where,
    organizerEmail: settings.replyAddress ?? 'no-reply@kithena.com',
    stamp: ctx.at,
    cancelled,
  });
  const when = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: candidate.timeZone ?? 'UTC',
  }).format(new Date(interview.startsAt));
  // Sent now, not by the next sweep: a candidate waits on this one. The words are
  // the company's confirmation template when it has one (`emails.ts`).
  if (cancelled) {
    await sendNow(
      ctx,
      candidate,
      interview.applicationId,
      `Cancelled: ${interview.title} with ${settings.companyName}`,
      `Hello ${candidate.name},\n\nThis interview is cancelled.\n\n${invitation}`,
    );
    return;
  }
  const loaded = await loadApplication(ctx, interview.applicationId);
  const words = await emailFor(ctx, 'interview_confirmation', candidate.language);
  const values = loaded.ok
    ? await emailValues(ctx, loaded.value)
    : {
        candidate: candidate.name,
        first_name: candidate.name.split(' ')[0] ?? candidate.name,
        job: job?.title ?? '',
        company: settings.companyName,
        link: await portalLink(ctx, candidate.id),
      };
  const agenda = (await ctx.tx.settings.get(`agenda:${interview.id}`)) as Agenda | null;
  const filled = {
    ...values,
    interview: `${interview.title}, ${when} (${candidate.timeZone ?? 'UTC'})`,
    where: where ?? 'To be confirmed',
  };
  await sendNow(
    ctx,
    candidate,
    interview.applicationId,
    render(words.subject, filled),
    `${render(words.body, filled)}${agenda === null ? '' : `\n\nAgenda\n${agenda.text}`}\n\n${invitation}`,
  );
}

export async function scheduleInterview(
  ctx: Ctx,
  applicationId: string,
  booking: Booking,
): Promise<Result<InterviewRecord>> {
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'interview.schedule')) return err(forbidden());
  return bookInterview(ctx, applicationId, booking, 'team');
}

/** A self-scheduling link (PRD §16.4): the candidate picks a slot that fits every interviewer. */
export async function selfScheduleLink(
  ctx: Ctx,
  applicationId: string,
  planKey: string,
  away: Absences = {},
  holidays: readonly Holiday[] = [],
  weeks: Weeks = {},
): Promise<Result<string>> {
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'interview.schedule')) return err(forbidden());
  if ((await planned(ctx, loaded.value.app.jobId, planKey)) === null)
    return err(notFound('interview in the plan'));
  const token = randomBytes(24).toString('base64url');
  // The days off known now go with the link: the candidate's page has no Time Off to ask.
  await ctx.tx.settings.set(`schedule:${sha256(token)}`, {
    applicationId,
    planKey,
    away,
    holidays,
    weeks,
    // Whoever sent it: their calendar's meetings block a time the candidate may pick.
    recruiterId: ctx.caller.personId,
    expiresAt: new Date(Date.parse(ctx.at) + 14 * 86_400_000).toISOString(),
  });
  const company = (await generalSettings(ctx)).companySlug;
  const link = `${ctx.deps.jobsOrigin}/schedule/${company}#${token}`;
  await sendNow(
    ctx,
    loaded.value.candidate,
    applicationId,
    `Appointment requested: choose a time with ${(await generalSettings(ctx)).companyName}`,
    `Hello ${loaded.value.candidate.name},\n\nPlease pick up to ten times that suit you, and we will confirm one:\n${link}\n\nThe link works for fourteen days.`,
  );
  return ok(link);
}

interface Link {
  readonly applicationId: string;
  readonly planKey: string;
  readonly away?: Absences;
  readonly holidays?: readonly Holiday[];
  readonly weeks?: Weeks;
  readonly recruiterId?: string | null;
  readonly expiresAt: string;
}

async function linkOf(ctx: Ctx, token: string): Promise<Link | null> {
  const held = (await ctx.tx.settings.get(`schedule:${sha256(token)}`)) as Link | null;
  return held === null || held.expiresAt < ctx.at ? null : held;
}

/** The candidate's side of the link: the slots for the next two weeks. */
export async function linkSlots(
  ctx: Ctx,
  token: string,
): Promise<
  Result<{
    slots: readonly string[];
    minutes: number;
    title: string;
    holidays: readonly Holiday[];
    /** How many times the candidate gives: ten, or every free one when there are fewer. */
    wanted: number;
    /** Whose calendars the times fit: the recruiter who shared the link, then the interviewers. */
    organiser: string | null;
    interviewers: readonly string[];
  }>
> {
  const link = await linkOf(ctx, token);
  if (link === null) return err(notFound('link'));
  const app = await ctx.tx.applications.get(link.applicationId);
  const plan = app === null ? null : await planned(ctx, app.jobId, link.planKey);
  if (app === null || plan === null || app.outcome !== 'active') return err(notFound('link'));
  const from = new Date(Date.parse(ctx.at) + 86_400_000).toISOString() as Instant;
  const to = new Date(Date.parse(ctx.at) + 15 * 86_400_000).toISOString() as Instant;
  const holidays = link.holidays ?? [];
  const people = withOrganiser(plan.interviewerIds, link.recruiterId);
  const slots = freeSlots(
    await availability(
      ctx,
      people,
      from,
      to,
      withHolidays(people, link.away ?? {}, holidays),
      link.weeks ?? {},
    ),
    from,
    to,
    plan.minutes,
    30,
    ctx.at,
  );
  return ok({
    slots,
    minutes: plan.minutes,
    title: plan.title,
    holidays: holidays.filter((h) => h.date >= from.slice(0, 10) && h.date < to.slice(0, 10)),
    wanted: Math.min(10, slots.length),
    organiser: link.recruiterId == null ? null : ((await nameOf(ctx, link.recruiterId)) ?? null),
    interviewers: (
      await Promise.all(
        plan.interviewerIds
          .filter((p) => p !== link.recruiterId)
          .map(async (p) => (await nameOf(ctx, p)) ?? null),
      )
    ).filter((n): n is string => n !== null),
  });
}

/**
 * The candidate's side of the link (PRD §16.4): up to ten times that suit
 * them, from the slots that fit every interviewer. The team hears at once
 * and books one of them; the invitation then carries the link and agenda.
 */
export async function offerAvailability(
  ctx: Ctx,
  token: string,
  times: readonly Instant[],
): Promise<Result<Ask>> {
  const link = await linkOf(ctx, token);
  if (link === null) return err(notFound('link'));
  const offered = await linkSlots(ctx, token);
  if (!offered.ok) return offered;
  const chosen = [...new Set(times)].toSorted();
  const wanted = offered.value.wanted;
  if (chosen.length !== wanted || wanted === 0)
    return err(
      failure(
        'TIMES',
        `Choose ${String(wanted)} time${wanted === 1 ? '' : 's'}, so the team can find one that fits`,
      ),
    );
  const stale = chosen.find((t) => !offered.value.slots.includes(t));
  if (stale !== undefined)
    return err(failure('SLOT_TAKEN', 'One of those times has just gone; choose again'));
  const app = await ctx.tx.applications.get(link.applicationId);
  const candidate = app === null ? null : await ctx.tx.candidates.get(app.candidateId);
  if (app === null || candidate === null) return err(notFound('link'));
  const ask = await saveAsk(
    ctx,
    newAsk(ctx, app.id, {
      kind: 'availability',
      by: null,
      label: offered.value.title,
      planKey: link.planKey,
      times: chosen,
    }),
  );
  const settings = await generalSettings(ctx);
  await sendNow(
    ctx,
    candidate,
    app.id,
    `Received: your times for the ${offered.value.title.toLowerCase()} with ${settings.companyName}`,
    `Hello ${candidate.name},\n\nThank you. ${settings.companyName} has the ${String(chosen.length)} time${chosen.length === 1 ? '' : 's'} you offered and will confirm one of them by email, with the link or the address.\n\nYour page:\n${await portalLink(ctx, candidate.id)}`,
  );
  const job = await ctx.tx.jobs.get(app.jobId);
  const facts = await jobFacts(ctx, job as never);
  const zone = 'UTC';
  for (const personId of new Set(facts.team.map((t) => t.personId))) {
    const member = await ctx.tx.members.get(personId as never);
    if (!member?.workEmail) continue;
    ctx.mail.push({
      to: member.workEmail,
      subject: `${candidate.name} offered ${String(chosen.length)} time${chosen.length === 1 ? '' : 's'} for the ${offered.value.title}`,
      text: `${candidate.name} (${job?.title ?? ''}) can do:\n${chosen.map((t) => `- ${new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: zone }).format(new Date(t))} (${zone})`).join('\n')}\n\nPick one on the Schedule screen and the invitation goes out with the link and the agenda.`,
      dedupeKey: `availability:${ask.id}:${member.workEmail}`,
    });
  }
  return ok(ask);
}

/** The team books one of the times the candidate offered; the ask is answered by it. */
export async function bookFromAvailability(
  ctx: Ctx,
  applicationId: string,
  askId: string,
  input: {
    readonly startsAt: Instant;
    readonly place: string | null;
    readonly videoUrl: string | null;
    readonly agenda: Agenda | null;
  },
): Promise<Result<InterviewRecord>> {
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'interview.schedule')) return err(forbidden());
  const ask = (await asksOf(ctx, applicationId)).find((a) => a.id === askId);
  if (ask === undefined || ask.kind !== 'availability' || ask.state !== 'open')
    return err(notFound('request'));
  if (!ask.times.includes(input.startsAt))
    return err(failure('NOT_OFFERED', 'Choose one of the times the candidate offered'));
  const booked = await bookInterview(
    ctx,
    applicationId,
    { planKey: ask.planKey ?? '', ...input },
    'team',
  );
  if (!booked.ok) return booked;
  await saveAsk(ctx, {
    ...ask,
    state: 'answered',
    answeredAt: ctx.at,
    answer: { time: input.startsAt, text: null },
    interviewId: booked.value.id,
  });
  return booked;
}

export async function setInterviewState(
  ctx: Ctx,
  interviewId: string,
  to: InterviewState,
): Promise<Result<InterviewRecord>> {
  const interview = await ctx.tx.interviews.get(interviewId);
  if (interview === null) return err(notFound('interview'));
  const loaded = await loadApplication(ctx, interview.applicationId);
  if (!loaded.ok) return loaded;
  const onIt =
    ctx.viewer.personId !== null && interview.interviewerIds.includes(ctx.viewer.personId);
  if (!may(ctx.viewer, loaded.value.facts, 'interview.schedule') && !(onIt && to === 'completed'))
    return err(forbidden());
  const moved = moveInterview(interview, to);
  if (!moved.ok) return moved;
  const next = { ...interview, ...moved.value };
  await ctx.tx.interviews.save(next);
  const payload = {
    interviewId,
    applicationId: interview.applicationId,
    interviewerIds: interview.interviewerIds,
    startsAt: interview.startsAt,
  };
  if (to === 'completed')
    await publish(
      ctx,
      event(ctx, 'recruiting.interview.completed', { type: 'Interview', id: interviewId }, payload),
    );
  if (to === 'cancelled') {
    await publish(
      ctx,
      event(ctx, 'recruiting.interview.cancelled', { type: 'Interview', id: interviewId }, payload),
    );
    await takeOffCalendar(ctx, interviewId);
    await invite(ctx, next, true);
  }
  return ok(next);
}

/* ----------------------------------------------------------- scorecards -- */

async function competenciesOf(
  ctx: Ctx,
  jobId: string,
  planKey: string,
): Promise<{ key: string; name: string; description: string; questions: readonly string[] }[]> {
  const plan = await planned(ctx, jobId, planKey);
  const job = await ctx.tx.jobs.get(jobId);
  const templateId = plan?.scorecardTemplateId ?? job?.scorecardTemplateId ?? null;
  const template = templateId === null ? null : await ctx.tx.scorecardTemplates.get(templateId);
  const all = template?.competencies ?? [];
  const owned = plan?.competencies ?? [];
  return all
    .filter((c) => owned.length === 0 || owned.includes(c.key))
    .map((c) => ({ key: c.key, name: c.name, description: c.description, questions: c.questions }));
}

export interface ScorecardInput {
  readonly ratings: Readonly<Record<string, Rating>>;
  readonly recommendation: Recommendation | null;
  readonly notes: string | null;
  readonly submit: boolean;
}

export async function saveScorecard(
  ctx: Ctx,
  interviewId: string,
  input: ScorecardInput,
): Promise<Result<Scorecard>> {
  const person = asPerson(ctx);
  if (!person.ok) return person;
  const interview = await ctx.tx.interviews.get(interviewId);
  if (interview === null || !interview.interviewerIds.includes(person.value))
    return err(notFound('interview'));
  const app = await ctx.tx.applications.get(interview.applicationId);
  if (app === null) return err(notFound('interview'));
  const held = (await ctx.tx.interviews.scorecards(interviewId)).find(
    (c) => c.interviewerId === person.value,
  );
  if (held?.submittedAt != null)
    return err(failure('ALREADY_SUBMITTED', 'This scorecard is already in'));
  const draft: Scorecard = {
    interviewId,
    interviewerId: person.value,
    ratings: input.ratings,
    recommendation: input.recommendation,
    submittedAt: null,
  };
  let card = draft;
  if (input.submit) {
    const submitted = submitScorecard(
      draft,
      await competenciesOf(ctx, app.jobId, interview.planKey),
      ctx.at,
    );
    if (!submitted.ok) return submitted;
    card = submitted.value;
  }
  await ctx.tx.interviews.saveScorecard({ ...card, notes: input.notes });
  if (card.submittedAt !== null && card.recommendation !== null) {
    await publish(
      ctx,
      event(
        ctx,
        'recruiting.scorecard.submitted',
        { type: 'Interview', id: interviewId },
        {
          interviewId,
          applicationId: app.id,
          interviewerId: person.value,
          recommendation: card.recommendation,
        },
      ),
    );
  }
  return ok(card);
}

/** The interviewer's kit (R15): the interview, their competencies, and the scorecards they may see. */
export async function kit(
  ctx: Ctx,
  interviewId: string,
): Promise<
  Result<{
    interview: InterviewRecord;
    competencies: readonly {
      key: string;
      name: string;
      description: string;
      questions: readonly string[];
    }[];
    scorecards: readonly Scorecard[];
    candidate: { id: string; name: string };
    job: { id: string; title: string };
    names: Readonly<Record<string, string>>;
    me: string;
  }>
> {
  const person = asPerson(ctx);
  if (!person.ok) return person;
  const interview = await ctx.tx.interviews.get(interviewId);
  if (interview === null) return err(notFound('interview'));
  const loaded = await loadApplication(ctx, interview.applicationId);
  if (!loaded.ok) return loaded;
  const onIt = interview.interviewerIds.includes(person.value);
  const team = may(ctx.viewer, loaded.value.facts, 'scorecards.all');
  if (!onIt && !team) return err(notFound('interview'));
  const cards = await ctx.tx.interviews.scorecards(interviewId);
  const candidate = await ctx.tx.candidates.get(loaded.value.app.candidateId);
  const job = await ctx.tx.jobs.get(loaded.value.app.jobId);
  return ok({
    interview,
    competencies: await competenciesOf(ctx, loaded.value.app.jobId, interview.planKey),
    scorecards: visibleScorecards(
      cards,
      team ? { kind: 'hiring_team' } : { kind: 'interviewer', personId: person.value },
    ),
    candidate: { id: candidate?.id ?? '', name: candidate?.name ?? '' },
    job: { id: job?.id ?? '', title: job?.title ?? '' },
    names: await namesOf(ctx, interview.interviewerIds),
    me: person.value,
  });
}

async function namesOf(ctx: Ctx, ids: readonly string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of new Set(ids)) out[id] = (await nameOf(ctx, id)) ?? id;
  return out;
}

export async function debriefOf(
  ctx: Ctx,
  applicationId: string,
): Promise<
  Result<
    Debrief & {
      competencies: readonly { key: string; name: string }[];
      names: Readonly<Record<string, string>>;
      candidate: { id: string; name: string };
      job: { id: string; title: string };
      decider: boolean;
    }
  >
> {
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'scorecards.all')) return err(forbidden());
  const interviews = await ctx.tx.interviews.forApplication(applicationId);
  const cards = await ctx.tx.interviews.forApplicationScorecards(applicationId);
  const competencies = new Map<string, { key: string; name: string }>();
  for (const i of interviews)
    for (const c of await competenciesOf(ctx, loaded.value.app.jobId, i.planKey))
      competencies.set(c.key, c);
  const expected = interviews
    .filter((i) => i.state === 'completed')
    .reduce((n, i) => n + i.interviewerIds.length, 0);
  const candidate = await ctx.tx.candidates.get(loaded.value.app.candidateId);
  const job = await ctx.tx.jobs.get(loaded.value.app.jobId);
  return ok({
    ...debrief([...competencies.values()], cards, expected),
    competencies: [...competencies.values()].map((c) => ({ key: c.key, name: c.name })),
    names: await namesOf(
      ctx,
      cards.map((c) => c.interviewerId),
    ),
    candidate: { id: candidate?.id ?? '', name: candidate?.name ?? '' },
    job: { id: job?.id ?? '', title: job?.title ?? '' },
    decider: loaded.value.facts.team.some(
      (t) => t.role === 'hiring_manager' && t.personId === ctx.viewer.personId,
    ),
  });
}

export async function decide(
  ctx: Ctx,
  applicationId: string,
  decision: DebriefDecision,
  reason: string,
): Promise<Result<DebriefDecision>> {
  const person = asPerson(ctx);
  if (!person.ok) return person;
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  const manager = loaded.value.facts.team.find((t) => t.role === 'hiring_manager')?.personId ?? '';
  const decided = decideDebrief(person.value, manager, decision, reason);
  if (!decided.ok) return decided;
  await ctx.tx.settings.set(`decision:${applicationId}:${ctx.at}`, {
    decision,
    reason,
    by: person.value,
  });
  return ok(decision);
}

/* ----------------------------------------------------------- references -- */

/** The candidate names a referee on their page (PRD §17.1); the referee is never contacted before. */
export async function nameReferee(
  ctx: Ctx,
  candidateId: string,
  applicationId: string,
  name: string,
  email: string,
  relationship: string | null,
): Promise<Result<string>> {
  const app = await ctx.tx.applications.get(applicationId);
  if (app?.candidateId !== candidateId) return err(notFound('application'));
  const token = randomBytes(24).toString('base64url');
  const id = ctx.deps.newId();
  await ctx.tx.references.save({
    id,
    applicationId,
    refereeName: name,
    refereeEmail: email,
    relationship,
    tokenHash: sha256(token),
    state: 'named',
    answers: null,
    requestedAt: null,
    completedAt: null,
  });
  await ctx.tx.settings.set(`reference_token:${id}`, token);
  return ok(id);
}

export async function requestReference(
  ctx: Ctx,
  referenceId: string,
  applicationId: string,
): Promise<Result<true>> {
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'candidate.message')) return err(forbidden());
  const ref = (await ctx.tx.references.forApplication(applicationId)).find(
    (r) => r.id === referenceId,
  );
  if (ref === undefined) return err(notFound('reference'));
  const token = (await ctx.tx.settings.get(`reference_token:${ref.id}`)) as string | null;
  if (token === null) return err(notFound('reference'));
  const settings = await generalSettings(ctx);
  ctx.mail.push({
    to: ref.refereeEmail,
    subject: `A reference for ${loaded.value.candidate.name}`,
    text: `Hello ${ref.refereeName},\n\n${loaded.value.candidate.name} named you as a referee for a role at ${settings.companyName}. It takes a few minutes and needs no account:\n${ctx.deps.jobsOrigin}/reference/${settings.companySlug}#${token}`,
    dedupeKey: `reference:${ref.id}`,
  });
  await ctx.tx.references.save({ ...ref, state: 'requested', requestedAt: ctx.at });
  return ok(true);
}

export async function answerReference(
  ctx: Ctx,
  token: string,
  answers: Readonly<Record<string, string>>,
): Promise<Result<true>> {
  const ref = await ctx.tx.references.byToken(sha256(token));
  if (ref === null || ref.state === 'completed') return err(notFound('reference'));
  await ctx.tx.references.save({ ...ref, state: 'completed', answers, completedAt: ctx.at });
  return ok(true);
}

/** The caller's working hours, which slots are offered from when no calendar is connected (§16.4). */
export async function myWorkingHours(ctx: Ctx): Promise<Result<WorkingHours>> {
  const person = asPerson(ctx);
  if (!person.ok) return person;
  return ok(
    (await ctx.tx.workingHours.get(person.value)) ?? {
      personId: person.value,
      timeZone: 'UTC',
      week: OFFICE_WEEK,
    },
  );
}

export async function saveWorkingHours(
  ctx: Ctx,
  input: Omit<WorkingHours, 'personId'>,
): Promise<Result<WorkingHours>> {
  const person = asPerson(ctx);
  if (!person.ok) return person;
  for (const ranges of Object.values(input.week))
    for (const [from, to] of ranges)
      if (from >= to) return err(failure('HOURS_ORDER', 'Each range ends after it starts'));
  const hours = { ...input, personId: person.value };
  await ctx.tx.workingHours.save(hours);
  return ok(hours);
}
