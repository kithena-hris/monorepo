import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { Instant } from '@kithena/contracts';

import { may } from '../domain/access/access.js';
import { asksOf, newAsk, saveAsk, type Agenda, type Ask } from './asks.js';
import { forbidden, jobFacts, notFound, type Ctx } from './context.js';
import { portalLink } from './intake.js';
import { bookInterview, byDay, keepAgenda } from './interviews.js';
import { loadApplication, sendNow, type Loaded } from './moves.js';
import type { ApplicationRecord } from './ports.js';
import { tellMembers } from './notify.js';
import { generalSettings } from './setup.js';

/**
 * The loop between the team and a candidate that neither side should wait
 * on (PRD §10.5, §16.4): times proposed and one chosen, information asked
 * and answered, a booked time questioned. Every step emails the other side
 * at once and lands on the candidate's page.
 */

const fmt = (iso: string, timeZone: string): string =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone }).format(
    new Date(iso),
  );

/** Everyone on the hiring team with a work address, the asker first. */
/** The team hears of a candidate's answer by email only where each member asked to (`notify.ts`). */
async function tellTeam(
  ctx: Ctx,
  loaded: Loaded,
  first: string | null,
  subject: string,
  text: string,
  dedupe: string,
): Promise<void> {
  await tellMembers(
    ctx,
    [first, ...loaded.facts.team.map((t) => t.personId)],
    subject,
    text,
    dedupe,
  );
}

const jobTitle = async (ctx: Ctx, loaded: Loaded): Promise<string> =>
  (await ctx.tx.jobs.get(loaded.app.jobId))?.title ?? 'the role';

/** Where the team opens it: the tenant app when its address is known (as the chat app's links), else the path. */
async function candidateLink(ctx: Ctx, loaded: Loaded): Promise<string> {
  const path = `/recruiting/candidates/${loaded.candidate.id}?application=${loaded.app.id}&tab=process`;
  const base = ctx.deps.chat?.appBase;
  return base === undefined
    ? path
    : `${base.replace('{slug}', (await generalSettings(ctx)).companySlug)}${path}`;
}

/** R16: offer the candidate one or several fixed times; they pick one or ask for others. */
export async function proposeSlots(
  ctx: Ctx,
  applicationId: string,
  input: {
    readonly planKey: string;
    readonly times: readonly Instant[];
    readonly place: string | null;
    readonly videoUrl: string | null;
    readonly note: string | null;
    readonly agenda: Agenda | null;
    readonly interviewerIds?: readonly string[] | undefined;
  },
): Promise<Result<Ask>> {
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'interview.schedule')) return err(forbidden());
  const plan = (await ctx.tx.jobs.plan(loaded.value.app.jobId)).find(
    (p) => p.key === input.planKey,
  );
  if (plan === undefined) return err(notFound('interview in the plan'));
  const times = [...new Set(input.times)].toSorted();
  if (times.length === 0) return err(failure('NO_TIMES', 'Offer at least one time'));
  const ask = await saveAsk(
    ctx,
    newAsk(ctx, applicationId, {
      kind: 'slots',
      label: plan.title,
      detail: input.note,
      planKey: plan.key,
      times,
      place: input.place,
      videoUrl: input.videoUrl,
      agenda: input.agenda,
      ...(input.interviewerIds === undefined ? {} : { interviewerIds: input.interviewerIds }),
    }),
  );
  await keepAgenda(ctx, loaded.value.app.jobId, plan.key, input.agenda);
  const { candidate } = loaded.value;
  const settings = await generalSettings(ctx);
  const zone = candidate.timeZone ?? 'UTC';
  await sendNow(
    ctx,
    candidate,
    applicationId,
    `Appointment requested: ${plan.title} with ${settings.companyName}`,
    `Hello ${candidate.name.split(' ')[0] ?? candidate.name},\n\n${settings.companyName} would like to meet you for a ${plan.title.toLowerCase()} (${String(plan.minutes)} minutes)${input.note === null ? '.' : `: ${input.note}`}\n\nPick the time that suits you, or ask for others if none does.`,
    {
      heading: `Choose a time for your ${plan.title.toLowerCase()}`,
      times: { title: `Times offered · ${zone}`, days: byDay(times, zone, plan.minutes) },
      action: { label: 'Choose a time', href: await portalLink(ctx, candidate.id) },
    },
  );
  return ok(ask);
}

/** The team asks the candidate for something: a document, a date, an answer. */
export async function requestInformation(
  ctx: Ctx,
  applicationId: string,
  input: { readonly label: string; readonly detail: string | null },
): Promise<Result<Ask>> {
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'candidate.message')) return err(forbidden());
  const label = input.label.trim();
  if (label === '') return err(failure('LABEL_REQUIRED', 'Say what you need'));
  const ask = await saveAsk(
    ctx,
    newAsk(ctx, applicationId, { kind: 'info', label, detail: input.detail }),
  );
  const { candidate } = loaded.value;
  const settings = await generalSettings(ctx);
  await sendNow(
    ctx,
    candidate,
    applicationId,
    `${settings.companyName} needs something from you: ${label}`,
    `Hello ${candidate.name.split(' ')[0] ?? candidate.name},\n\nFor your application to ${await jobTitle(ctx, loaded.value)}, ${settings.companyName} asks:\n\n${label}${input.detail === null ? '' : `\n${input.detail}`}`,
    {
      heading: 'A question about your application',
      action: { label: 'Answer', href: await portalLink(ctx, candidate.id) },
    },
  );
  return ok(ask);
}

/** The candidate's own application: no viewer check, since the token already proved who they are. */
async function loadAsCandidate(ctx: Ctx, app: ApplicationRecord): Promise<Loaded | null> {
  const job = await ctx.tx.jobs.get(app.jobId);
  const candidate = await ctx.tx.candidates.get(app.candidateId);
  if (job === null || candidate === null) return null;
  return {
    app,
    facts: await jobFacts(ctx, job),
    stages: await ctx.tx.jobs.stages(app.jobId),
    candidate,
  };
}

async function askOfCandidate(
  ctx: Ctx,
  candidateId: string,
  askId: string,
): Promise<{ ask: Ask; loaded: Loaded } | null> {
  for (const app of await ctx.tx.applications.forCandidate(candidateId)) {
    const ask = (await asksOf(ctx, app.id)).find((a) => a.id === askId);
    if (ask === undefined) continue;
    const loaded = await loadAsCandidate(ctx, app);
    return loaded === null ? null : { ask, loaded };
  }
  return null;
}

/**
 * The candidate answers from their page: a time (booked at once, invitation
 * sent) or none of them with a note, or the information asked for. The
 * candidate gets an acknowledgement and the team hears the same minute.
 */
export async function answerAsk(
  ctx: Ctx,
  candidateId: string,
  askId: string,
  input: { readonly time: Instant | null; readonly text: string | null },
): Promise<Result<Ask>> {
  const found = await askOfCandidate(ctx, candidateId, askId);
  if (found === null || found.ask.state !== 'open') return err(notFound('request'));
  const { ask, loaded } = found;
  const settings = await generalSettings(ctx);
  const text = input.text?.trim() === '' ? null : (input.text ?? null);
  if (ask.kind === 'slots' && input.time !== null) {
    if (!ask.times.includes(input.time))
      return err(failure('NOT_OFFERED', 'Choose one of the times offered'));
    const booked = await bookInterview(
      ctx,
      ask.applicationId,
      {
        planKey: ask.planKey ?? '',
        startsAt: input.time,
        place: ask.place,
        videoUrl: ask.videoUrl,
        agenda: ask.agenda,
        ...(ask.interviewerIds === undefined ? {} : { interviewerIds: ask.interviewerIds }),
      },
      'team',
    );
    if (!booked.ok) return booked;
    const done = await saveAsk(ctx, {
      ...ask,
      state: 'answered',
      answeredAt: ctx.at,
      answer: { time: input.time, text },
      interviewId: booked.value.id,
    });
    await tellTeam(
      ctx,
      loaded,
      ask.by,
      `${loaded.candidate.name} booked: ${ask.label}, ${fmt(input.time, 'UTC')} UTC`,
      `${loaded.candidate.name} chose ${fmt(input.time, 'UTC')} (UTC) for the ${ask.label.toLowerCase()} for ${await jobTitle(ctx, loaded)}.${text === null ? '' : `\n\nThey added: ${text}`}\n\nThe invitations are out. See it in Recruiting:\n${await candidateLink(ctx, loaded)}`,
      `ask-booked:${ask.id}`,
    );
    return ok(done);
  }
  if (ask.kind === 'info' && text === null)
    return err(failure('ANSWER_REQUIRED', 'Write your answer'));
  const done = await saveAsk(ctx, {
    ...ask,
    state: 'answered',
    answeredAt: ctx.at,
    answer: { time: null, text },
  });
  await sendNow(
    ctx,
    loaded.candidate,
    ask.applicationId,
    ask.kind === 'slots'
      ? `Received: we will offer other times for your ${ask.label.toLowerCase()}`
      : `Received: ${ask.label}`,
    `Hello ${loaded.candidate.name},\n\nThank you. ${settings.companyName} has your ${ask.kind === 'slots' ? 'reply and will come back with other times' : 'answer'}.\n\nYour page:\n${await portalLink(ctx, loaded.candidate.id)}`,
  );
  await tellTeam(
    ctx,
    loaded,
    ask.by,
    ask.kind === 'slots'
      ? `${loaded.candidate.name} needs other times for ${ask.label}`
      : `${loaded.candidate.name} answered: ${ask.label}`,
    `${loaded.candidate.name} (${await jobTitle(ctx, loaded)})${ask.kind === 'slots' ? ' could not make any of the times offered.' : ' answered:'}${text === null ? '' : `\n\n${text}`}\n\nIn Recruiting:\n${await candidateLink(ctx, loaded)}`,
    `ask-answered:${ask.id}`,
  );
  return ok(done);
}

/** The candidate asks for a booked interview to move; the team reschedules or cancels. */
export async function requestChange(
  ctx: Ctx,
  candidateId: string,
  interviewId: string,
  reason: string,
): Promise<Result<Ask>> {
  const interview = await ctx.tx.interviews.get(interviewId);
  const app = interview === null ? null : await ctx.tx.applications.get(interview.applicationId);
  if (interview === null || app?.candidateId !== candidateId || interview.state !== 'scheduled')
    return err(notFound('interview'));
  const loaded = await loadAsCandidate(ctx, app);
  if (loaded === null) return err(notFound('interview'));
  const open = (await asksOf(ctx, app.id)).find(
    (a) => a.kind === 'change' && a.interviewId === interviewId && a.state === 'open',
  );
  if (open !== undefined) return ok(open);
  const why = reason.trim();
  if (why === '') return err(failure('REASON_REQUIRED', 'Say why, in a line'));
  const ask = await saveAsk(
    ctx,
    newAsk(ctx, app.id, {
      kind: 'change',
      by: null,
      label: interview.title,
      detail: why,
      interviewId,
      planKey: interview.planKey,
    }),
  );
  const settings = await generalSettings(ctx);
  const zone = loaded.candidate.timeZone ?? 'UTC';
  await sendNow(
    ctx,
    loaded.candidate,
    app.id,
    `Received: a new time for your ${interview.title.toLowerCase()} with ${settings.companyName}`,
    `Hello ${loaded.candidate.name},\n\nWe have asked ${settings.companyName} to move your ${interview.title.toLowerCase()} from ${fmt(interview.startsAt, zone)} (${zone}). Until they do, that time stands. You will hear from them with new times.`,
  );
  await tellTeam(
    ctx,
    loaded,
    null,
    `${loaded.candidate.name} asks to move the ${interview.title}`,
    `${loaded.candidate.name} (${await jobTitle(ctx, loaded)}) asks for a different time for the ${interview.title.toLowerCase()} on ${fmt(interview.startsAt, 'UTC')} (UTC):\n\n${why}\n\nPropose new times or cancel it in Recruiting:\n${await candidateLink(ctx, loaded)}`,
    `change:${ask.id}`,
  );
  return ok(ask);
}

/** The team closes an ask it has dealt with (other times sent, the change made). */
export async function closeAsk(
  ctx: Ctx,
  applicationId: string,
  askId: string,
): Promise<Result<Ask>> {
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'interview.schedule')) return err(forbidden());
  const ask = (await asksOf(ctx, applicationId)).find((a) => a.id === askId);
  if (ask === undefined) return err(notFound('request'));
  return ok(await saveAsk(ctx, { ...ask, state: 'closed' }));
}
