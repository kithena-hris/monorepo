import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { CandidateDetails, Instant } from '@kithena/contracts';

import { may } from '../domain/access/access.js';
import { asksOf, newAsk, saveAsk, type Agenda, type Ask } from './asks.js';
import { forbidden, jobFacts, notFound, type Ctx, mailWords } from './context.js';
import { portalLink } from './intake.js';
import { bookInterview, byDay, keepAgenda } from './interviews.js';
import { loadApplication, sendNow, type Loaded } from './moves.js';
import type { ApplicationRecord } from './ports.js';
import { appUrl, tellMembers } from './notify.js';
import { generalSettings } from './setup.js';

/**
 * The loop between the team and a candidate that neither side should wait
 * on (PRD §10.5, §16.4): times proposed and one chosen, information asked
 * and answered, a booked time questioned. Every step emails the other side
 * at once and lands on the candidate's page.
 */

const fmt = (iso: string, timeZone: string, language = 'en-GB'): string =>
  new Intl.DateTimeFormat(language, { dateStyle: 'full', timeStyle: 'short', timeZone }).format(
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
  return (await appUrl(ctx, path)) ?? path;
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
  const { t } = await mailWords(ctx);
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
  // The team offering its own times answers the candidate's: their task leaves the Inbox, their link closes.
  for (const given of await asksOf(ctx, applicationId)) {
    if (given.kind !== 'availability' || given.state !== 'open' || given.planKey !== plan.key)
      continue;
    await saveAsk(ctx, { ...given, state: 'closed', closedBecause: 'dealt_with' });
    if (given.linkHash != null) {
      const key = `schedule:${given.linkHash}`;
      const held = (await ctx.tx.settings.get(key)) as Record<string, unknown> | null;
      if (held !== null) await ctx.tx.settings.set(key, { ...held, expiresAt: ctx.at });
    }
  }
  const { candidate } = loaded.value;
  const settings = await generalSettings(ctx);
  const zone = candidate.timeZone ?? 'UTC';
  await sendNow(
    ctx,
    candidate,
    applicationId,
    t(
      'email.requests.appointment_requested_with',
      'Appointment requested: {{title}} with {{companyName}}',
      { title: plan.title, companyName: settings.companyName },
    ),
    t(
      'email.requests.hello_would_like_to_meet_you',
      'Hello {{value}},\n\n{{companyName}} would like to meet you for a {{title}} ({{minutes}} minutes){{value2}}\n\nPick the time that suits you, or ask for others if none does.',
      {
        value: candidate.name.split(' ')[0] ?? candidate.name,
        companyName: settings.companyName,
        title: plan.title.toLowerCase(),
        minutes: plan.minutes,
        value2: input.note === null ? '.' : `: ${input.note}`,
      },
    ),
    {
      heading: t('email.requests.choose_a_time_for_your', 'Choose a time for your {{title}}', {
        title: plan.title.toLowerCase(),
      }),
      times: {
        title: t('email.requests.times_offered', 'Times offered · {{zone}}', { zone }),
        days: byDay(times, zone, plan.minutes, (await mailWords(ctx)).language),
      },
      action: {
        label: t('email.requests.choose_a_time', 'Choose a time'),
        href: await portalLink(ctx, candidate.id),
      },
    },
  );
  return ok(ask);
}

/**
 * The team asks a candidate who accepted the offer for what only they know
 * and their record needs (`CandidateDetails`), before the contract: it
 * states them for the candidate to check, and People takes them with the
 * hire. One open at a time; once the contract is out, it is too late to ask.
 */
export async function requestDetails(ctx: Ctx, applicationId: string): Promise<Result<Ask>> {
  const { t } = await mailWords(ctx);
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'candidate.message')) return err(forbidden());
  const offer = (await ctx.tx.offers.forApplication(applicationId)).find(
    (o) => o.state === 'accepted',
  );
  if (offer === undefined)
    return err(failure('NOT_ACCEPTED', 'Their details are asked once they accept the offer'));
  const contract = await ctx.tx.contracts.forOffer(offer.id);
  if (contract !== null && (contract.state === 'out_for_signature' || contract.state === 'signed'))
    return err(failure('CONTRACT_SENT', 'The contract is already out; ask before it is sent'));
  const open = (await asksOf(ctx, applicationId)).find(
    (a) => a.kind === 'details' && a.state === 'open',
  );
  if (open !== undefined) return ok(open);
  const label = t('email.requests.details_label', 'Your details for the contract');
  const ask = await saveAsk(ctx, newAsk(ctx, applicationId, { kind: 'details', label }));
  const { candidate } = loaded.value;
  const settings = await generalSettings(ctx);
  await sendNow(
    ctx,
    candidate,
    applicationId,
    t('email.requests.details_subject', '{{companyName}} needs a few details for your contract', {
      companyName: settings.companyName,
    }),
    t(
      'email.requests.details_body',
      'Hello {{name}},\n\nBefore your contract is drawn up, {{companyName}} needs a few details only you know: your date of birth, your home address and how to reach you. The contract states them for you to check before you sign.\n\nYour page:\n{{link}}',
      {
        name: candidate.name.split(' ')[0] ?? candidate.name,
        companyName: settings.companyName,
        link: await portalLink(ctx, candidate.id),
      },
    ),
    {
      heading: t('email.requests.details_heading', 'A few details for your contract'),
      facts: [{ label: t('email.requests.about', 'About'), value: label }],
    },
  );
  return ok(ask);
}

/** What the candidate gave in their latest answered details request; null when never asked or not yet answered. */
export async function detailsOf(
  ctx: Ctx,
  applicationId: string,
): Promise<CandidateDetails | null> {
  const answered = (await asksOf(ctx, applicationId)).filter(
    (a) => a.kind === 'details' && a.state === 'answered',
  );
  return answered.at(-1)?.answer?.details ?? null;
}

/** The team asks the candidate for something: a document, a date, an answer. */
export async function requestInformation(
  ctx: Ctx,
  applicationId: string,
  input: { readonly label: string; readonly detail: string | null },
): Promise<Result<Ask>> {
  const { t } = await mailWords(ctx);
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
    t(
      'email.requests.needs_something_from_you',
      '{{companyName}} needs something from you: {{label}}',
      { companyName: settings.companyName, label },
    ),
    t(
      'email.requests.hello_for_your_application_to_asks',
      'Hello {{value}},\n\nFor your application to {{value2}}, {{companyName}} asks:\n\n{{label}}{{value3}}',
      {
        value: candidate.name.split(' ')[0] ?? candidate.name,
        value2: await jobTitle(ctx, loaded.value),
        companyName: settings.companyName,
        label,
        value3: input.detail === null ? '' : `\n${input.detail}`,
      },
    ),
    {
      heading: t(
        'email.requests.a_question_about_your_application',
        'A question about your application',
      ),
      action: {
        label: t('email.requests.answer', 'Answer'),
        href: await portalLink(ctx, candidate.id),
      },
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
  input: {
    readonly time: Instant | null;
    readonly text: string | null;
    readonly details?: CandidateDetails | null;
  },
): Promise<Result<Ask>> {
  const { t } = await mailWords(ctx);
  const found = await askOfCandidate(ctx, candidateId, askId);
  if (found === null || found.ask.state !== 'open') return err(notFound('request'));
  const { ask, loaded } = found;
  const settings = await generalSettings(ctx);
  const text = input.text?.trim() === '' ? null : (input.text ?? null);
  if (ask.kind === 'details') {
    const details = input.details ?? null;
    if (details === null) return err(failure('DETAILS_REQUIRED', 'Fill in your details'));
    const done = await saveAsk(ctx, {
      ...ask,
      state: 'answered',
      answeredAt: ctx.at,
      answer: { time: null, text: null, details },
    });
    await tellTeam(
      ctx,
      loaded,
      ask.by,
      t('email.requests.details_given_subject', '{{name}} gave their details', {
        name: loaded.candidate.name,
      }),
      t(
        'email.requests.details_given_body',
        '{{name}} gave their details for the contract for {{job}}. The contract states them for them to check.\n\n{{link}}',
        {
          name: loaded.candidate.name,
          job: await jobTitle(ctx, loaded),
          link: await candidateLink(ctx, loaded),
        },
      ),
      `ask-details:${ask.id}`,
    );
    return ok(done);
  }
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
      t('email.requests.booked_utc', '{{name}} booked: {{label}}, {{fmt}} UTC', {
        name: loaded.candidate.name,
        label: ask.label,
        fmt: fmt(input.time, 'UTC', (await mailWords(ctx)).language),
      }),
      t(
        'email.requests.chose_utc_for_the_for_the',
        '{{name}} chose {{fmt}} (UTC) for the {{label}} for {{value}}.{{value2}}\n\nThe invitations are out. See it in Recruiting:\n{{value3}}',
        {
          name: loaded.candidate.name,
          fmt: fmt(input.time, 'UTC', (await mailWords(ctx)).language),
          label: ask.label.toLowerCase(),
          value: await jobTitle(ctx, loaded),
          value2:
            text === null
              ? ''
              : t('email.requests.they_added', '\n\nThey added: {{text}}', { text }),
          value3: await candidateLink(ctx, loaded),
        },
      ),
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
      ? t(
          'email.requests.received_we_will_offer_other_times',
          'Received: we will offer other times for your {{label}}',
          { label: ask.label.toLowerCase() },
        )
      : t('email.requests.received', 'Received: {{label}}', { label: ask.label }),
    t(
      'email.requests.hello_thank_you_has_your_your',
      'Hello {{name}},\n\nThank you. {{companyName}} has your {{value}}.\n\nYour page:\n{{value2}}',
      {
        name: loaded.candidate.name,
        companyName: settings.companyName,
        value:
          ask.kind === 'slots'
            ? t(
                'email.requests.reply_and_will_come_back_with',
                'reply and will come back with other times',
              )
            : 'answer',
        value2: await portalLink(ctx, loaded.candidate.id),
      },
    ),
    {
      heading:
        ask.kind === 'slots'
          ? t('email.requests.other_times_heading', 'We will offer other times')
          : t('email.requests.received_heading', 'Received, thank you'),
      facts: [{ label: t('email.requests.about', 'About'), value: ask.label }],
    },
  );
  await tellTeam(
    ctx,
    loaded,
    ask.by,
    ask.kind === 'slots'
      ? t('email.requests.needs_other_times_for', '{{name}} needs other times for {{label}}', {
          name: loaded.candidate.name,
          label: ask.label,
        })
      : t('email.requests.answered', '{{name}} answered: {{label}}', {
          name: loaded.candidate.name,
          label: ask.label,
        }),
    t(
      'email.requests.in_recruiting',
      '{{name}} ({{value}}){{value2}}{{value3}}\n\nIn Recruiting:\n{{value4}}',
      {
        name: loaded.candidate.name,
        value: await jobTitle(ctx, loaded),
        value2:
          ask.kind === 'slots'
            ? t(
                'email.requests.could_not_make_any_of_the',
                ' could not make any of the times offered.',
              )
            : ' answered:',
        value3: text === null ? '' : `\n\n${text}`,
        value4: await candidateLink(ctx, loaded),
      },
    ),
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
  const { t } = await mailWords(ctx);
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
    t(
      'email.requests.received_a_new_time_for_your',
      'Received: a new time for your {{title}} with {{companyName}}',
      { title: interview.title.toLowerCase(), companyName: settings.companyName },
    ),
    t(
      'email.requests.hello_we_have_asked_to_move',
      'Hello {{name}},\n\nWe have asked {{companyName}} to move your {{title}} from {{fmt}} ({{zone}}). Until they do, that time stands. You will hear from them with new times.',
      {
        name: loaded.candidate.name,
        companyName: settings.companyName,
        title: interview.title.toLowerCase(),
        fmt: fmt(interview.startsAt, zone, (await mailWords(ctx)).language),
        zone,
      },
    ),
    {
      heading: t('email.requests.move_heading', 'We asked to move your interview'),
      facts: [
        { label: t('email.requests.interview', 'Interview'), value: interview.title },
        {
          label: t('email.requests.until_then', 'Until then'),
          value: `${fmt(interview.startsAt, zone, (await mailWords(ctx)).language)} (${zone})`,
        },
        ...(why.trim() === ''
          ? []
          : [{ label: t('email.requests.why', 'Why'), value: why.trim() }]),
      ],
    },
  );
  await tellTeam(
    ctx,
    loaded,
    null,
    t('email.requests.asks_to_move_the', '{{name}} asks to move the {{title}}', {
      name: loaded.candidate.name,
      title: interview.title,
    }),
    t(
      'email.requests.asks_for_a_different_time_for',
      '{{name}} ({{value}}) asks for a different time for the {{title}} on {{fmt}} (UTC):\n\n{{why}}\n\nPropose new times or cancel it in Recruiting:\n{{value2}}',
      {
        name: loaded.candidate.name,
        value: await jobTitle(ctx, loaded),
        title: interview.title.toLowerCase(),
        fmt: fmt(interview.startsAt, 'UTC', (await mailWords(ctx)).language),
        why,
        value2: await candidateLink(ctx, loaded),
      },
    ),
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
