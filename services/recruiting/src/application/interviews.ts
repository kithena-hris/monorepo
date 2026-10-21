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
import { asPerson, event, forbidden, nameOf, notFound, publish, type Ctx } from './context.js';
import { sha256, portalLink } from './intake.js';
import { asksOf } from './asks.js';
import { emailFor, emailValues } from './emails.js';
import { loadApplication, render, sendNow } from './moves.js';
import type { Ask } from './asks.js';
import type { InterviewRecord, PlannedInterview, WorkingHours } from './ports.js';
import { generalSettings } from './setup.js';

/**
 * Interviews (PRD §16, REC-051, REC-052): slots from working hours, booking
 * with an `.ics`, the candidate's self-scheduling link, the kit, scorecards
 * kept independent, and the debrief's decision.
 */

/** Away days by interviewer, as the shell passes them from Time Off (PRD §28); absent means none known. */
export type Absences = Readonly<Record<string, readonly string[]>>;

async function availability(
  ctx: Ctx,
  people: readonly string[],
  from: Instant,
  to: Instant,
  away: Absences,
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
    out.push({
      personId,
      timeZone: hours?.timeZone ?? 'UTC',
      week: hours?.week ?? OFFICE_WEEK,
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
): Promise<Result<readonly string[]>> {
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'interview.schedule')) return err(forbidden());
  const plan = await planned(ctx, loaded.value.app.jobId, planKey);
  if (plan === null) return err(notFound('interview in the plan'));
  return ok(
    freeSlots(
      await availability(ctx, plan.interviewerIds, from, to, away),
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
  const slots =
    chosen === null
      ? ok([] as readonly string[])
      : await slotsFor(ctx, applicationId, chosen.key, start, end, away);
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
  });
}

export interface Booking {
  readonly planKey: string;
  readonly startsAt: Instant;
  readonly interviewerIds?: readonly string[] | undefined;
  readonly place: string | null;
  readonly videoUrl: string | null;
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
  const videoUrl = await putOnCalendar(ctx, interview, {
    title: `${plan.title}: ${job?.title ?? ''}`,
    startsAt: booking.startsAt,
    minutes: plan.minutes,
    description: 'Scheduled in Kithena Recruiting.',
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
    `${render(words.body, filled)}\n\n${invitation}`,
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
): Promise<Result<string>> {
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'interview.schedule')) return err(forbidden());
  if ((await planned(ctx, loaded.value.app.jobId, planKey)) === null)
    return err(notFound('interview in the plan'));
  const token = randomBytes(24).toString('base64url');
  await ctx.tx.settings.set(`schedule:${sha256(token)}`, {
    applicationId,
    planKey,
    expiresAt: new Date(Date.parse(ctx.at) + 14 * 86_400_000).toISOString(),
  });
  const company = (await generalSettings(ctx)).companySlug;
  const link = `${ctx.deps.jobsOrigin}/schedule/${company}#${token}`;
  await sendNow(
    ctx,
    loaded.value.candidate,
    applicationId,
    `Appointment requested: choose a time with ${(await generalSettings(ctx)).companyName}`,
    `Hello ${loaded.value.candidate.name},\n\nPlease choose a time that suits you:\n${link}\n\nThe link works for fourteen days.`,
  );
  return ok(link);
}

async function linkOf(
  ctx: Ctx,
  token: string,
): Promise<{ applicationId: string; planKey: string } | null> {
  const held = (await ctx.tx.settings.get(`schedule:${sha256(token)}`)) as {
    applicationId: string;
    planKey: string;
    expiresAt: string;
  } | null;
  return held === null || held.expiresAt < ctx.at ? null : held;
}

/** The candidate's side of the link: the slots for the next two weeks. */
export async function linkSlots(
  ctx: Ctx,
  token: string,
): Promise<Result<{ slots: readonly string[]; minutes: number; title: string }>> {
  const link = await linkOf(ctx, token);
  if (link === null) return err(notFound('link'));
  const app = await ctx.tx.applications.get(link.applicationId);
  const plan = app === null ? null : await planned(ctx, app.jobId, link.planKey);
  if (app === null || plan === null || app.outcome !== 'active') return err(notFound('link'));
  const from = new Date(Date.parse(ctx.at) + 86_400_000).toISOString() as Instant;
  const to = new Date(Date.parse(ctx.at) + 15 * 86_400_000).toISOString() as Instant;
  return ok({
    slots: freeSlots(
      await availability(ctx, plan.interviewerIds, from, to, {}),
      from,
      to,
      plan.minutes,
      30,
      ctx.at,
    ),
    minutes: plan.minutes,
    title: plan.title,
  });
}

export async function bookByLink(
  ctx: Ctx,
  token: string,
  startsAt: Instant,
): Promise<Result<InterviewRecord>> {
  const link = await linkOf(ctx, token);
  if (link === null) return err(notFound('link'));
  const existing = (await ctx.tx.interviews.forApplication(link.applicationId)).find(
    (i) => i.planKey === link.planKey && i.state === 'scheduled',
  );
  if (existing !== undefined) {
    // Rescheduling from the same link (PRD §16.4): the earlier one is marked rescheduled.
    await ctx.tx.interviews.save({ ...existing, state: 'rescheduled' });
    await takeOffCalendar(ctx, existing.id);
    await invite(ctx, existing, true);
  }
  return bookInterview(
    ctx,
    link.applicationId,
    { planKey: link.planKey, startsAt, place: null, videoUrl: null },
    'candidate',
  );
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
