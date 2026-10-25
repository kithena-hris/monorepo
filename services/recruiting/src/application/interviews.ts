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
import {
  freeSlots,
  ics,
  OFFICE_WEEK,
  slotGrid,
  type Availability,
} from '../domain/interview/slots.js';
import { calendarBusy, putOnCalendar, takeOffCalendar, watchMeetCall } from './calendars.js';
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
  mailWords,
} from './context.js';
import { sha256, portalLink } from './intake.js';
import { asksOf, newAsk, saveAsk, type Agenda, type Ask } from './asks.js';
import { appUrl, inboxTask, tellMembers } from './notify.js';
import { emailFor, emailValues } from './emails.js';
import { loadApplication, render, sendNow, type Loaded } from './moves.js';
import type {
  InterviewRecord,
  MailAttachment,
  MailParts,
  PlannedInterview,
  WorkingHours,
} from './ports.js';
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
  interviewers: readonly string[] | null = null,
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
        withOrganiser(interviewers ?? plan.interviewerIds, ctx.caller.personId),
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
  interviewers: readonly string[] | null = null,
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
    /** Who runs it: the ones chosen on the screen, else the plan's, else the job's hiring team. */
    interviewers: readonly string[];
    /** Everyone who could be asked to interview, to choose from. */
    members: readonly { personId: string; name: string }[];
    /** The agenda last written for this interview of this job, to start from. */
    agenda: Agenda | null;
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
  // Who runs it: chosen here, else the plan's, else the job's hiring manager and interviewers.
  const team = loaded.value.facts.team
    .filter((t) => t.role === 'hiring_manager' || t.role === 'interviewer')
    .map((t) => t.personId);
  const panel =
    interviewers !== null && interviewers.length > 0
      ? [...new Set(interviewers)]
      : (chosen?.interviewerIds.length ?? 0) > 0
        ? (chosen?.interviewerIds ?? [])
        : [...new Set(team)];
  // The recruiter arranging it is one of the people who must be free.
  const people = withOrganiser(panel, ctx.caller.personId);
  const off = withHolidays(people, away, holidays);
  const slots =
    chosen === null
      ? ok([] as readonly string[])
      : await slotsFor(ctx, applicationId, chosen.key, start, end, off, weeks, panel);
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
    meet: await canMakeVideo(ctx, panel),
    holidays: holidays.filter((h) => h.date >= start.slice(0, 10) && h.date < end.slice(0, 10)),
    away: Object.fromEntries(people.map((p) => [p, away[p] ?? []])),
    organiser: ctx.caller.personId,
    interviewers: panel,
    members: (await ctx.tx.members.list())
      .filter((m) => m.status !== 'left')
      .map((m) => ({ personId: m.personId, name: m.displayName }))
      .toSorted((a, b) => a.name.localeCompare(b.name)),
    agenda:
      chosen === null
        ? null
        : ((await ctx.tx.settings.get(
            agendaKey(loaded.value.app.jobId, chosen.key),
          )) as Agenda | null),
    weeks: Object.fromEntries(
      people.flatMap((p) => {
        const w = weeks[p];
        return w === undefined ? [] : [[p, w] as const];
      }),
    ),
  });
}

/** The agenda last written for an interview of a job: where the next one starts from. */
const agendaKey = (jobId: string, planKey: string): string => `agenda:${jobId}:${planKey}`;

/** Keep the agenda written for an interview of a job, so the next schedule of it starts there. */
export async function keepAgenda(
  ctx: Ctx,
  jobId: string,
  planKey: string,
  agenda: Agenda | null | undefined,
): Promise<void> {
  if (agenda != null && agenda.text.trim() !== '')
    await ctx.tx.settings.set(agendaKey(jobId, planKey), agenda);
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
  const { t } = await mailWords(ctx);
  const app = await ctx.tx.applications.get(applicationId);
  if (app === null) return err(notFound('application'));
  const plan = await planned(ctx, app.jobId, booking.planKey);
  if (plan === null) return err(notFound('interview in the plan'));
  // Who runs it: chosen on the screen, else the plan's, else the job's hiring manager and interviewers.
  const job0 = await ctx.tx.jobs.get(app.jobId);
  const team =
    job0 === null
      ? []
      : (await jobFacts(ctx, job0)).team
          .filter((t) => t.role === 'hiring_manager' || t.role === 'interviewer')
          .map((t) => t.personId);
  const interviewerIds =
    booking.interviewerIds !== undefined && booking.interviewerIds.length > 0
      ? booking.interviewerIds
      : plan.interviewerIds.length > 0
        ? plan.interviewerIds
        : [...new Set(team)];
  if (interviewerIds.length === 0)
    return err(failure('NO_INTERVIEWERS', 'Choose who runs this interview'));
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
  await keepAgenda(ctx, app.jobId, plan.key, booking.agenda);
  const videoUrl = await putOnCalendar(ctx, interview, {
    title: `${plan.title}: ${job?.title ?? ''}`,
    startsAt: booking.startsAt,
    minutes: plan.minutes,
    description: booking.agenda?.text ?? 'Scheduled in Kithena Recruiting.',
  });
  const booked = videoUrl === null ? interview : { ...interview, videoUrl };
  await ctx.tx.interviews.save(booked);
  await endsAt(ctx, booked);
  await listenFrom(ctx, booked);
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
  await inviteTeam(
    ctx,
    booked,
    candidate?.name ?? t('email.interviews.a_candidate', 'a candidate'),
    false,
  );
  await tellInterviewers(
    ctx,
    booked,
    candidate?.name ?? t('email.interviews.a_candidate', 'a candidate'),
  );
  return ok(booked);
}

/** Where the team opens a page: the tenant app when its address is known, else nothing to link. */
async function teamLink(ctx: Ctx, path: string): Promise<string | null> {
  return appUrl(ctx, path);
}

/** The interview's meeting link, when it is one a calendar can open. */
const meetingLink = (interview: InterviewRecord): string | null =>
  interview.videoUrl?.startsWith('https://') === true ? interview.videoUrl : null;

/** The invitation's description: how to join, where, and what it is about. */
function describe(
  t: Awaited<ReturnType<typeof mailWords>>['t'],
  where: string | null,
  link: string | null,
  agenda: Agenda | null,
): string {
  return [
    link === null ? null : t('email.interviews.join_at', 'Join the meeting: {{link}}', { link }),
    where === null || where === link
      ? null
      : t('email.interviews.where', 'Where: {{where}}', { where }),
    agenda?.text ?? null,
  ]
    .filter((line): line is string => line !== null && line !== '')
    .join('\n\n');
}

/** Everyone taking part, as the invitation names them: the candidate, then the panel. */
async function participants(
  ctx: Ctx,
  interview: InterviewRecord,
  candidate: { readonly email: string; readonly name: string } | null,
): Promise<{ email: string; name: string }[]> {
  const out = candidate === null ? [] : [{ email: candidate.email, name: candidate.name }];
  for (const id of new Set(interview.interviewerIds)) {
    const member = await ctx.tx.members.get(id as never);
    if (member?.workEmail) out.push({ email: member.workEmail, name: member.displayName });
  }
  return out;
}

/** The list with this one in it, once: whoever booked it is invited whether on the panel or not. */
const withFirst = (
  everyone: readonly { email: string; name: string }[],
  one: { email: string; name: string },
): { email: string; name: string }[] => [
  ...everyone,
  ...(everyone.some((a) => a.email.toLowerCase() === one.email.toLowerCase()) ? [] : [one]),
];

/**
 * Everyone on the panel hears too, by email, with what the candidate is
 * sent: when, where, the meeting link and what it is about, and the
 * invitation for their calendar when Kithena did not put it there already.
 * Whoever booked it hears as well, interviewer or not. An invitation is not
 * a notification, so it goes whatever someone chose for those.
 */
async function inviteTeam(
  ctx: Ctx,
  interview: InterviewRecord,
  candidateName: string,
  cancelled: boolean,
): Promise<void> {
  const { t, language } = await mailWords(ctx);
  const settings = await generalSettings(ctx);
  const app = await ctx.tx.applications.get(interview.applicationId);
  const job = app === null ? null : await ctx.tx.jobs.get(app.jobId);
  const where = interview.videoUrl ?? interview.place;
  const agenda = (await ctx.tx.settings.get(`agenda:${interview.id}`)) as Agenda | null;
  const onCalendar = (await ctx.tx.settings.get(`calendar-event:${interview.id}`)) !== null;
  const candidate = app === null ? null : await ctx.tx.candidates.get(app.candidateId);
  const link = meetingLink(interview);
  const everyone = await participants(ctx, interview, candidate);
  const title = t('email.interviews.team_title', '{{title}} with {{name}}', {
    title: interview.title,
    name: candidateName,
  });
  // Each their own, so their mail client offers it as their invitation.
  const invitation = (attendee: { email: string; name: string }) =>
    ics({
      uid: `${interview.id}@kithena`,
      start: interview.startsAt,
      minutes: interview.minutes,
      title,
      description: describe(t, where, link, agenda),
      location: where,
      url: link,
      organizerEmail: settings.replyAddress ?? 'no-reply@kithena.com',
      stamp: ctx.at,
      cancelled,
      sequence: sequenceAt(ctx.at),
      attendees: withFirst(everyone, attendee),
    });
  const when = `${new Intl.DateTimeFormat(language, {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(interview.startsAt))} (UTC)`;
  const video = link;
  const page = await teamLink(ctx, `/recruiting/interviews/${interview.id}`);
  const subject = cancelled
    ? t('email.interviews.team_cancelled', 'Cancelled: {{title}}', { title })
    : t('email.interviews.team_booked', 'Booked: {{title}}', { title });
  const text = [
    cancelled
      ? t('email.interviews.team_cancelled_body', 'This interview is cancelled.')
      : t(
          'email.interviews.team_booked_body',
          'You are on the panel for this interview. The candidate has the same invitation.',
        ),
    `${t('email.interviews.when', 'When')}: ${when}`,
    `${t('email.interviews.where_2', 'Where')}: ${where ?? t('email.interviews.to_be_confirmed', 'To be confirmed')}`,
    ...(job === null ? [] : [`${t('email.interviews.role', 'Role')}: ${job.title}`]),
    ...(agenda === null ? [] : [`${t('email.interviews.agenda', 'Agenda')}\n${agenda.text}`]),
  ].join('\n\n');
  const people = [
    ...interview.interviewerIds,
    ...(ctx.caller.personId === null ? [] : [ctx.caller.personId]),
  ];
  const sent = new Set<string>();
  for (const id of new Set(people)) {
    const member = await ctx.tx.members.get(id as never);
    const email = member?.workEmail;
    if (!email || sent.has(email)) continue;
    sent.add(email);
    ctx.mail.push({
      to: email,
      subject,
      text,
      dedupeKey: `interview:${interview.id}:${cancelled ? 'cancelled' : `${interview.startsAt}:${sha256(where ?? '').slice(0, 12)}`}:${email}`,
      // Already on their calendar when Kithena put it there; else the invitation to add.
      ...(onCalendar
        ? {}
        : { attachments: [inviteFile(invitation({ email, name: member.displayName }))] }),
      companyName: settings.companyName,
      parts: {
        themeId: settings.themeId,
        logoUrl: settings.logoUrl,
        heading: subject,
        facts: [
          { label: t('email.interviews.when', 'When'), value: when },
          {
            label: t('email.interviews.length', 'Length'),
            value: t('email.interviews.minutes', '{{minutes}} minutes', {
              minutes: interview.minutes,
            }),
          },
          {
            label: t('email.interviews.where_2', 'Where'),
            value: where ?? t('email.interviews.to_be_confirmed', 'To be confirmed'),
          },
          ...(agenda === null
            ? []
            : [{ label: t('email.interviews.agenda', 'Agenda'), value: agenda.text }]),
        ],
        ...(video === null || cancelled
          ? {}
          : {
              action: {
                label: t('email.interviews.join_the_meeting', 'Join the meeting'),
                href: video,
              },
            }),
        ...(page === null
          ? {}
          : {
              secondary: {
                label: t('email.interviews.open_in_kithena', 'Open in Kithena'),
                href: page,
              },
            }),
      },
    });
  }
}

async function invite(ctx: Ctx, interview: InterviewRecord, cancelled: boolean): Promise<void> {
  const { t } = await mailWords(ctx);
  const app = await ctx.tx.applications.get(interview.applicationId);
  const candidate = app === null ? null : await ctx.tx.candidates.get(app.candidateId);
  const settings = await generalSettings(ctx);
  const job = app === null ? null : await ctx.tx.jobs.get(app.jobId);
  if (candidate === null) return;
  const where = interview.videoUrl ?? interview.place;
  const link = meetingLink(interview);
  const agenda = (await ctx.tx.settings.get(`agenda:${interview.id}`)) as Agenda | null;
  const invitation = ics({
    uid: `${interview.id}@kithena`,
    start: interview.startsAt,
    minutes: interview.minutes,
    title: t('email.interviews.at', '{{title}}: {{value}} at {{companyName}}', {
      title: interview.title,
      value: job?.title ?? '',
      companyName: settings.companyName,
    }),
    description: describe(t, where, link, agenda),
    location: where,
    url: link,
    organizerEmail: settings.replyAddress ?? 'no-reply@kithena.com',
    stamp: ctx.at,
    cancelled,
    sequence: sequenceAt(ctx.at),
    attendees: await participants(ctx, interview, candidate),
  });
  const attachments = [inviteFile(invitation)];
  const when = new Intl.DateTimeFormat((await mailWords(ctx)).language, {
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
      t('email.interviews.cancelled_with', 'Cancelled: {{title}} with {{companyName}}', {
        title: interview.title,
        companyName: settings.companyName,
      }),
      t(
        'email.interviews.hello_this_interview_is_cancelled',
        'Hello {{name}},\n\nThis interview is cancelled.',
        { name: candidate.name },
      ),
      {},
      attachments,
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
  const zone = candidate.timeZone ?? 'UTC';
  const video = link;
  const page = values['link'] ?? '';
  await sendNow(
    ctx,
    candidate,
    interview.applicationId,
    render(words.subject, filled),
    `${render(words.body, filled)}${agenda === null ? '' : `\n\nAgenda\n${agenda.text}`}`,
    {
      heading: t('email.interviews.your_is_booked', 'Your {{title}} is booked', {
        title: interview.title.toLowerCase(),
      }),
      facts: [
        { label: t('email.interviews.when', 'When'), value: `${when} (${zone})` },
        {
          label: t('email.interviews.length', 'Length'),
          value: t('email.interviews.minutes', '{{minutes}} minutes', {
            minutes: interview.minutes,
          }),
        },
        {
          label: t('email.interviews.where_2', 'Where'),
          value: where ?? t('email.interviews.to_be_confirmed', 'To be confirmed'),
        },
        ...(job === null ? [] : [{ label: t('email.interviews.role', 'Role'), value: job.title }]),
      ],
      ...(video === null
        ? {}
        : {
            action: {
              label: t('email.interviews.join_the_meeting', 'Join the meeting'),
              href: video,
            },
          }),
      ...(page.startsWith('https://')
        ? {
            secondary: {
              label: t('email.interviews.ask_for_a_different_time', 'Ask for a different time'),
              href: page,
            },
          }
        : {}),
    },
    attachments,
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

/** Times as a person reads them at a glance: each day once, its times beside it, in one zone. */
export function byDay(
  times: readonly string[],
  timeZone: string,
  minutes: number,
  language = 'en-GB',
): { day: string; times: string[] }[] {
  const day = new Intl.DateTimeFormat(language, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  });
  const hour = new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit', timeZone });
  const out: { day: string; times: string[] }[] = [];
  for (const t of [...times].toSorted()) {
    const d = day.format(new Date(t));
    const range = `${hour.format(new Date(t))} – ${hour.format(new Date(Date.parse(t) + minutes * 60_000))}`;
    const held = out.find((x) => x.day === d);
    if (held === undefined) out.push({ day: d, times: [range] });
    else held.times.push(range);
  }
  return out;
}

/** A zone the browser named, when the platform knows it; anything else is ignored. */
function knownZone(zone: string | null): string | null {
  if (zone === null) return null;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

/** Where an interview happens, who runs it and what it is about, chosen when the link is sent and kept for the booking. */
export interface Setting {
  readonly place: string | null;
  readonly videoUrl: string | null;
  readonly agenda: Agenda | null;
  readonly interviewerIds?: readonly string[];
}

interface Link extends Partial<Setting> {
  readonly applicationId: string;
  readonly planKey: string;
  readonly away?: Absences;
  readonly holidays?: readonly Holiday[];
  readonly weeks?: Weeks;
  readonly recruiterId?: string | null;
  /** Times the candidate gave before and the team could not make: never offered again. */
  readonly excluded?: readonly string[];
  readonly expiresAt: string;
}

/** Make and keep a link; the token goes in an email, only its hash is kept. */
async function issueLink(ctx: Ctx, link: Omit<Link, 'expiresAt'>): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  await ctx.tx.settings.set(`schedule:${sha256(token)}`, {
    ...link,
    expiresAt: new Date(Date.parse(ctx.at) + 14 * 86_400_000).toISOString(),
  });
  const company = (await generalSettings(ctx)).companySlug;
  return `${ctx.deps.jobsOrigin}/schedule/${company}#${token}`;
}

/**
 * A self-scheduling link (PRD §16.4): the candidate gives ten times that fit
 * everyone; the recruiter who sent it books one from their Inbox. Where it
 * happens and the agenda are chosen now and go with the booking.
 */
export async function selfScheduleLink(
  ctx: Ctx,
  applicationId: string,
  planKey: string,
  away: Absences = {},
  holidays: readonly Holiday[] = [],
  weeks: Weeks = {},
  setting: Setting = { place: null, videoUrl: null, agenda: null },
): Promise<Result<string>> {
  const { t } = await mailWords(ctx);
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'interview.schedule')) return err(forbidden());
  const plan = await planned(ctx, loaded.value.app.jobId, planKey);
  if (plan === null) return err(notFound('interview in the plan'));
  await keepAgenda(ctx, loaded.value.app.jobId, planKey, setting.agenda);
  // The days off known now go with the link: the candidate's page has no Time Off to ask.
  const link = await issueLink(ctx, {
    applicationId,
    planKey,
    away,
    holidays,
    weeks,
    // Whoever sent it: their calendar's meetings block a time, and they choose from what comes back.
    recruiterId: ctx.caller.personId,
    ...setting,
  });
  const { candidate } = loaded.value;
  // The company's words when it wrote its own in settings, else Kithena's.
  const words = await emailFor(ctx, 'interview_invitation', candidate.language);
  const filled = {
    ...(await emailValues(ctx, loaded.value)),
    interview: plan.title.toLowerCase(),
  };
  await sendNow(
    ctx,
    candidate,
    applicationId,
    render(words.subject, filled),
    render(words.body, filled),
    {
      heading: t('email.interviews.choose_times_for_your', 'Choose times for your {{title}}', {
        title: plan.title.toLowerCase(),
      }),
      facts: [
        { label: t('email.interviews.interview', 'Interview'), value: plan.title },
        {
          label: t('email.interviews.length_2', 'Length'),
          value: t('email.interviews.minutes_2', '{{minutes}} minutes', { minutes: plan.minutes }),
        },
        ...(setting.videoUrl !== null || setting.place === null
          ? [
              {
                label: t('email.interviews.where_3', 'Where'),
                value:
                  setting.place ??
                  t(
                    'email.interviews.video_call_the_link_comes_with',
                    'Video call; the link comes with the invitation',
                  ),
              },
            ]
          : [{ label: t('email.interviews.where_4', 'Where'), value: setting.place }]),
      ],
      action: { label: t('email.interviews.choose_my_times', 'Choose my times'), href: link },
    },
  );
  return ok(link);
}

async function linkOf(ctx: Ctx, token: string): Promise<Link | null> {
  const held = (await ctx.tx.settings.get(`schedule:${sha256(token)}`)) as Link | null;
  return held === null || held.expiresAt <= ctx.at ? null : held;
}

/** The open availability that came through this link, if the candidate gave times already. */
async function openThrough(ctx: Ctx, applicationId: string, hash: string): Promise<Ask | null> {
  return (
    (await asksOf(ctx, applicationId)).find(
      (a) => a.kind === 'availability' && a.state === 'open' && a.linkHash === hash,
    ) ?? null
  );
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
    /** The times the candidate gave through this link already: shown picked, to change. */
    chosen: readonly string[];
    /** How many times they gave before that the team could not make, and left out now. */
    excluded: number;
    /**
     * Times inside everyone's working day that are gone: booked by another
     * interview, or ruled out by the team. Shown greyed out, never chosen.
     */
    taken: readonly string[];
    /** An interview already booked for this step, when there is one. */
    booked: string | null;
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
  const panel =
    link.interviewerIds !== undefined && link.interviewerIds.length > 0
      ? link.interviewerIds
      : plan.interviewerIds;
  const people = withOrganiser(panel, link.recruiterId);
  const excluded = new Set(link.excluded ?? []);
  const calendars = await availability(
    ctx,
    people,
    from,
    to,
    withHolidays(people, link.away ?? {}, holidays),
    link.weeks ?? {},
  );
  const grid = slotGrid(calendars, from, to, plan.minutes, 30, ctx.at, [...excluded]);
  const slots = grid.filter((s) => !s.taken).map((s) => s.at);
  const open = await openThrough(ctx, app.id, sha256(token));
  const booked = (await ctx.tx.interviews.forApplication(app.id)).find(
    (i) => i.planKey === plan.key && i.state === 'scheduled',
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
        panel
          .filter((p) => p !== link.recruiterId)
          .map(async (p) => (await nameOf(ctx, p)) ?? null),
      )
    ).filter((n): n is string => n !== null),
    chosen: (open?.times ?? []).filter((t) => slots.includes(t)),
    excluded: excluded.size,
    taken: grid.filter((s) => s.taken).map((s) => s.at),
    booked: booked?.startsAt ?? null,
  });
}

/**
 * Who chooses from what the candidate gave: the recruiter who sent the link,
 * and the job's recruiters and hiring manager beside them, so a link sent
 * from an account with no person, or a job with no recruiter named, still
 * reaches someone. The first to book closes it for all.
 */
async function ownersOf(ctx: Ctx, link: Link, applicationId: string): Promise<string[]> {
  const app = await ctx.tx.applications.get(applicationId);
  const job = app === null ? null : await ctx.tx.jobs.get(app.jobId);
  const team =
    job === null
      ? []
      : (await jobFacts(ctx, job)).team
          .filter((t) => t.role === 'recruiter' || t.role === 'hiring_manager')
          .map((t) => t.personId);
  return [...new Set([...(link.recruiterId == null ? [] : [link.recruiterId]), ...team])];
}

/**
 * The candidate's side of the link (PRD §16.4): ten times that suit them,
 * from the slots that fit everyone. Given again through the same link, the
 * new times replace the old, and so does the recruiter's Inbox task. The
 * candidate is thanked with their times laid out by day and a way back to
 * change them; the recruiter hears, by email if they asked to.
 */
export async function offerAvailability(
  ctx: Ctx,
  token: string,
  times: readonly Instant[],
  timeZone: string | null = null,
): Promise<Result<Ask>> {
  const { t } = await mailWords(ctx);
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
  const hash = sha256(token);
  // Given again: the times before are replaced, and so is the task that asked for a choice.
  const before = await openThrough(ctx, app.id, hash);
  if (before !== null)
    await saveAsk(ctx, { ...before, state: 'closed', closedBecause: 'replaced' });
  const ask = await saveAsk(
    ctx,
    newAsk(ctx, app.id, {
      kind: 'availability',
      by: null,
      label: offered.value.title,
      planKey: link.planKey,
      times: chosen,
      place: link.place ?? null,
      videoUrl: link.videoUrl ?? null,
      agenda: link.agenda ?? null,
      ...(link.interviewerIds === undefined ? {} : { interviewerIds: link.interviewerIds }),
      owners: await ownersOf(ctx, link, app.id),
      linkHash: hash,
    }),
  );
  const settings = await generalSettings(ctx);
  const zone = knownZone(timeZone) ?? candidate.timeZone ?? 'UTC';
  const company = settings.companySlug;
  const first = candidate.name.split(' ')[0] ?? candidate.name;
  await sendNow(
    ctx,
    candidate,
    app.id,
    before === null
      ? t(
          'email.interviews.received_your_times_for_the_with',
          'Received: your times for the {{title}} with {{companyName}}',
          { title: offered.value.title.toLowerCase(), companyName: settings.companyName },
        )
      : t(
          'email.interviews.updated_your_new_times_for_the',
          'Updated: your new times for the {{title}} with {{companyName}}',
          { title: offered.value.title.toLowerCase(), companyName: settings.companyName },
        ),
    t(
      'email.interviews.hello_thank_you_has_the_times',
      'Hello {{first}},\n\nThank you. {{companyName}} has the {{length}} times you gave{{value}}, and will confirm one of them by email with the meeting link and what it is about.\n\nPlans changed? Change your times until then.',
      {
        first,
        companyName: settings.companyName,
        length: chosen.length,
        value:
          before === null
            ? ''
            : t('email.interviews.in_place_of_the_ones_before', ', in place of the ones before'),
      },
    ),
    {
      heading:
        before === null
          ? t('email.interviews.we_have_your_times', 'We have your times')
          : t('email.interviews.we_have_your_new_times', 'We have your new times'),
      times: {
        title: t('email.interviews.your_times', 'Your {{length}} times · {{zone}}', {
          length: chosen.length,
          zone,
        }),
        days: byDay(chosen, zone, offered.value.minutes, (await mailWords(ctx)).language),
      },
      action: {
        label: t('email.interviews.change_my_times', 'Change my times'),
        href: `${ctx.deps.jobsOrigin}/schedule/${company}#${token}`,
      },
    },
  );
  const job = await ctx.tx.jobs.get(app.jobId);
  await tellMembers(
    ctx,
    ask.owners ?? [],
    t('email.interviews.times_for_the', '{{name}} {{value}} {{length}} times for the {{title}}', {
      name: candidate.name,
      value: before === null ? 'gave' : 'changed',
      length: chosen.length,
      title: offered.value.title,
    }),
    t(
      'email.interviews.choose_one_of_the_times',
      '{{name}} ({{value}}) gave the times below. Choose one, offer other times, or ask for more: the invitation then goes to everyone with the meeting link and the agenda.',
      { name: candidate.name, value: job?.title ?? '' },
    ),
    `availability:${ask.id}`,
    await taskParts(ctx, `recruiting:choose-time:${ask.id}`, {
      heading: t('email.interviews.choose_a_time_heading', 'Choose a time for {{name}}', {
        name: candidate.name,
      }),
      times: {
        title: t('email.interviews.their_times_utc', 'Their {{length}} times · UTC', {
          length: chosen.length,
        }),
        days: byDay(chosen, 'UTC', offered.value.minutes, (await mailWords(ctx)).language),
      },
      action: t('email.interviews.choose_a_time', 'Choose a time'),
    }),
  );
  return ok(ask);
}

/**
 * The invitation's SEQUENCE: seconds since 1970, so each one sent replaces the
 * one before in the calendar it was added to.
 * ponytail: overflows a 32-bit SEQUENCE in 2038; a stored counter then.
 */
const sequenceAt = (at: string): number => Math.floor(Date.parse(at) / 1000);

/** An invitation as the email's attachment: drawn by Gmail and Outlook as one, with Add to calendar. */
const inviteFile = (text: string): MailAttachment => ({
  filename: 'invite.ics',
  base64: Buffer.from(text, 'utf8').toString('base64'),
});

/** An email's parts for an Inbox task: its button opens that task, on the company's host. */
async function taskParts(
  ctx: Ctx,
  itemId: string,
  parts: Omit<MailParts, 'action'> & { readonly action: string },
): Promise<MailParts> {
  const href = await appUrl(ctx, inboxTask(itemId));
  const { action, ...rest } = parts;
  return href === null ? rest : { ...rest, action: { label: action, href } };
}

/**
 * The team books one of the times the candidate gave. Where and the agenda
 * are the ones chosen when the link was sent, unless given now; an interview
 * already booked for the same step is moved, not doubled.
 */
export async function bookFromAvailability(
  ctx: Ctx,
  applicationId: string,
  askId: string,
  input: {
    readonly startsAt: Instant;
    readonly place?: string | null | undefined;
    readonly videoUrl?: string | null | undefined;
    readonly agenda?: Agenda | null | undefined;
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
  const earlier = (await ctx.tx.interviews.forApplication(applicationId)).find(
    (i) => i.planKey === ask.planKey && i.state === 'scheduled',
  );
  if (earlier !== undefined) {
    await ctx.tx.interviews.save({ ...earlier, state: 'rescheduled' });
    await ctx.deps.interviewEnds?.drop(ctx.caller.tenantId, earlier.id).catch(() => undefined);
    await takeOffCalendar(ctx, earlier.id);
  }
  const booked = await bookInterview(
    ctx,
    applicationId,
    {
      planKey: ask.planKey ?? '',
      startsAt: input.startsAt,
      place: input.place === undefined ? ask.place : input.place,
      videoUrl: input.videoUrl === undefined ? ask.videoUrl : input.videoUrl,
      agenda: input.agenda === undefined ? ask.agenda : input.agenda,
      ...(ask.interviewerIds === undefined ? {} : { interviewerIds: ask.interviewerIds }),
    },
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

/**
 * None of the candidate's times works for the team: ask for more. The times
 * given are never offered again, the old link stops working, and the
 * candidate gets a new one, with those times shown as the ones that did not
 * work, so they choose around them.
 */
export async function requestMoreTimes(
  ctx: Ctx,
  applicationId: string,
  askId: string,
  note: string | null,
): Promise<Result<string>> {
  const { t } = await mailWords(ctx);
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'interview.schedule')) return err(forbidden());
  const ask = (await asksOf(ctx, applicationId)).find((a) => a.id === askId);
  if (ask === undefined || ask.kind !== 'availability' || ask.state !== 'open')
    return err(notFound('request'));
  const key = ask.linkHash == null ? null : `schedule:${ask.linkHash}`;
  const old = key === null ? null : ((await ctx.tx.settings.get(key)) as Link | null);
  const plan = await planned(ctx, loaded.value.app.jobId, ask.planKey ?? '');
  if (old === null || key === null || plan === null) return err(notFound('link'));
  await ctx.tx.settings.set(key, { ...old, expiresAt: ctx.at });
  await saveAsk(ctx, { ...ask, state: 'closed', closedBecause: 'more_times' });
  const { expiresAt: _ended, ...kept } = old;
  const link = await issueLink(ctx, {
    ...kept,
    excluded: [...new Set([...(old.excluded ?? []), ...ask.times])],
  });
  const settings = await generalSettings(ctx);
  const { candidate } = loaded.value;
  const zone = candidate.timeZone ?? 'UTC';
  await sendNow(
    ctx,
    candidate,
    applicationId,
    t(
      'email.interviews.more_times_please_your_with',
      'More times, please: your {{title}} with {{companyName}}',
      { title: plan.title.toLowerCase(), companyName: settings.companyName },
    ),
    t(
      'email.interviews.hello_thank_you_for_your_times',
      "Hello {{value}},\n\nThank you for your times. The team cannot make any of them, so please choose others. The ones below are left out, as are holidays and the team's time off.{{value2}}",
      {
        value: candidate.name.split(' ')[0] ?? candidate.name,
        value2: note === null || note.trim() === '' ? '' : `\n\n${note.trim()}`,
      },
    ),
    {
      heading: t(
        'email.interviews.could_you_give_us_other_times',
        'Could you give us other times?',
      ),
      times: {
        title: t('email.interviews.these_did_not_work', 'These did not work'),
        days: byDay(ask.times, zone, plan.minutes, (await mailWords(ctx)).language),
        note: t('email.interviews.times_in', 'Times in {{zone}}.', { zone }),
      },
      action: { label: t('email.interviews.choose_other_times', 'Choose other times'), href: link },
    },
  );
  return ok(link);
}

/**
 * The meeting link for a booked interview, when none was made for it (no
 * calendar connected) or it changed: the candidate and the panel get the
 * invitation again with it, replacing the one they have.
 */
export async function setInterviewLink(
  ctx: Ctx,
  interviewId: string,
  videoUrl: string,
): Promise<Result<InterviewRecord>> {
  const interview = await ctx.tx.interviews.get(interviewId);
  if (interview === null) return err(notFound('interview'));
  const loaded = await loadApplication(ctx, interview.applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'interview.schedule')) return err(forbidden());
  if (interview.state !== 'scheduled')
    return err(failure('NOT_SCHEDULED', 'Only a booked interview takes a meeting link'));
  if (!/^https:\/\/\S+$/u.test(videoUrl))
    return err(failure('LINK', 'A meeting link starts with https://'));
  const next = { ...interview, videoUrl, place: null };
  await ctx.tx.interviews.save(next);
  await invite(ctx, next, false);
  await inviteTeam(ctx, next, loaded.value.candidate.name, false);
  return ok(next);
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
  if (to === 'completed') {
    await publish(
      ctx,
      event(ctx, 'recruiting.interview.completed', { type: 'Interview', id: interviewId }, payload),
    );
    // Marked done by hand: the scorecards are owed now, as at the end of its time.
    await ctx.deps.interviewEnds?.drop(ctx.caller.tenantId, interviewId).catch(() => undefined);
    await askForScorecards(ctx, next);
  }
  if (to === 'cancelled') {
    await ctx.deps.interviewEnds?.drop(ctx.caller.tenantId, interviewId).catch(() => undefined);
    await publish(
      ctx,
      event(ctx, 'recruiting.interview.cancelled', { type: 'Interview', id: interviewId }, payload),
    );
    await takeOffCalendar(ctx, interviewId);
    await invite(ctx, next, true);
    await inviteTeam(ctx, next, loaded.value.candidate.name, true);
  }
  return ok(next);
}

/** When an interview ends, by its booked start and length. */
const endOf = (interview: InterviewRecord): number =>
  Date.parse(interview.startsAt) + interview.minutes * 60_000;

/**
 * Set the timer at the interview's end (`InterviewEnds`): it fires the moment
 * the interview is over. A timer that cannot be set leaves the interview to
 * be marked done by hand, or caught at the next start, never lost.
 */
async function endsAt(ctx: Ctx, interview: InterviewRecord): Promise<void> {
  await ctx.deps.interviewEnds
    ?.at(ctx.caller.tenantId, interview.id, new Date(endOf(interview)).toISOString())
    .catch(() => undefined);
}

const MEET = /^https:\/\/meet\.google\.com\//u;
const HOUR = 3_600_000;

/**
 * A Meet interview's call is heard as it ends: an hour before it starts, the
 * timer subscribes to the call (`listenToCall`). Earlier, a subscription would
 * only wait, and Google's last a few days at most.
 */
async function listenFrom(ctx: Ctx, interview: InterviewRecord): Promise<void> {
  if (ctx.deps.meetEvents === undefined || !MEET.test(interview.videoUrl ?? '')) return;
  await ctx.deps.interviewEnds
    ?.watch(
      ctx.caller.tenantId,
      interview.id,
      new Date(Date.parse(interview.startsAt) - HOUR).toISOString(),
    )
    .catch(() => undefined);
}

/**
 * Hear the Meet call end (Google Workspace Events): subscribe to it, remember
 * which interview its space is, and move the booked-end timer two hours on, so
 * it only answers for a call nobody joined, which never ends. Not heard (a
 * Workspace that has not allowed reading Meet spaces), the booked end stands.
 */
export async function listenToCall(ctx: Ctx, interviewId: string): Promise<boolean> {
  const meet = ctx.deps.meetEvents;
  const interview = await ctx.tx.interviews.get(interviewId);
  if (meet === undefined || interview === null || interview.state !== 'scheduled') return false;
  const ttl = Math.ceil((endOf(interview) + 6 * HOUR - Date.parse(ctx.at)) / 1000);
  const watched = await watchMeetCall(ctx, interview, meet.topic, ttl);
  if (watched === null) return false;
  await meet.remember(watched.space, { tenantId: ctx.caller.tenantId, interviewId }, ttl);
  await ctx.deps.interviewEnds
    ?.at(ctx.caller.tenantId, interviewId, new Date(endOf(interview) + 2 * HOUR).toISOString())
    .catch(() => undefined);
  return true;
}

/**
 * The interview is over: it moves to completed and each interviewer is asked
 * for their scorecard, by email and in their Inbox, due a day later (PRD
 * §16.5). Run by the timer at its end, so nobody presses a button for the
 * scorecards to be owed. One cancelled, moved or already done is left alone.
 */
export async function completeInterview(
  ctx: Ctx,
  interviewId: string,
  /** Meet said the call ended: done now, whatever the booked end, once it has started. */
  callEnded = false,
): Promise<boolean> {
  const interview = await ctx.tx.interviews.get(interviewId);
  if (interview === null || interview.state !== 'scheduled') return false;
  const now = Date.parse(ctx.at);
  if (callEnded ? Date.parse(interview.startsAt) > now : endOf(interview) > now) return false;
  const moved = moveInterview(interview, 'completed');
  if (!moved.ok) return false;
  const done = { ...interview, ...moved.value };
  await ctx.tx.interviews.save(done);
  await publish(
    ctx,
    event(
      ctx,
      'recruiting.interview.completed',
      { type: 'Interview', id: interview.id },
      {
        interviewId: interview.id,
        applicationId: interview.applicationId,
        interviewerIds: interview.interviewerIds,
        startsAt: interview.startsAt,
      },
    ),
  );
  await askForScorecards(ctx, done);
  return true;
}

/**
 * Interviews that ended while nothing was running to hear it: asked once,
 * when Recruiting starts, never on a clock.
 */
export async function completeEndedInterviews(ctx: Ctx): Promise<number> {
  const since = new Date(Date.parse(ctx.at) - 3 * 86_400_000).toISOString() as Instant;
  let done = 0;
  for (const interview of await ctx.tx.interviews.startingBetween(since, ctx.at)) {
    if (await completeInterview(ctx, interview.id)) done += 1;
  }
  return done;
}

/** Each interviewer's scorecard, asked for by email; its button opens the task in their Inbox. */
async function askForScorecards(ctx: Ctx, interview: InterviewRecord): Promise<void> {
  const { t, language } = await mailWords(ctx);
  const app = await ctx.tx.applications.get(interview.applicationId);
  const candidate = app === null ? null : await ctx.tx.candidates.get(app.candidateId);
  const due = new Intl.DateTimeFormat(language, {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(endOf(interview) + 24 * 3_600_000));
  const subject = t('email.interviews.scorecard_due', 'Your scorecard: {{title}} with {{name}}', {
    title: interview.title,
    name: candidate?.name ?? t('email.interviews.a_candidate', 'a candidate'),
  });
  const parts = await taskParts(ctx, `recruiting:scorecard:${interview.id}`, {
    heading: subject,
    facts: [
      { label: t('email.interviews.interview', 'Interview'), value: interview.title },
      { label: t('email.interviews.due', 'Due'), value: `${due} (UTC)` },
    ],
    action: t('email.interviews.write_my_scorecard', 'Write my scorecard'),
  });
  for (const id of new Set(interview.interviewerIds)) {
    const email = (await ctx.tx.members.get(id as never))?.workEmail;
    if (!email) continue;
    ctx.mail.push({
      to: email,
      subject,
      text: t(
        'email.interviews.scorecard_due_body',
        'The interview is over. Rate each competency and give your recommendation by {{due}} (UTC). You see the others’ scorecards once yours is in.',
        { due },
      ),
      dedupeKey: `scorecard-due:${interview.id}:${email}`,
      parts,
    });
  }
}

/* ----------------------------------------------------------- scorecards -- */

export async function competenciesOf(
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
      interview.startsAt,
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
    /** Whether the viewer books it, so may give its meeting link. */
    schedules: boolean;
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
    schedules: may(ctx.viewer, loaded.value.facts, 'interview.schedule'),
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
    decider: decidersOf(loaded.value.facts).includes(ctx.viewer.personId ?? ''),
  });
}

/** Who records a debrief's decision: the job's recruiters and its hiring manager. */
const decidersOf = (facts: Loaded['facts']): string[] =>
  facts.team
    .filter((t) => t.role === 'recruiter' || t.role === 'hiring_manager')
    .map((t) => t.personId);

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
  const decided = decideDebrief(person.value, decidersOf(loaded.value.facts), decision, reason);
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
  const { t } = await mailWords(ctx);
  ctx.mail.push({
    to: ref.refereeEmail,
    subject: t('email.reference.subject', 'A reference for {{candidate}}', {
      candidate: loaded.value.candidate.name,
    }),
    text: t(
      'email.reference.text',
      'Hello {{name}},\n\n{{candidate}} named you as a referee for a role at {{company}}. It takes a few minutes and needs no account:\n{{link}}',
      {
        name: ref.refereeName,
        candidate: loaded.value.candidate.name,
        company: settings.companyName,
        link: `${ctx.deps.jobsOrigin}/reference/${settings.companySlug}#${token}`,
      },
    ),
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
