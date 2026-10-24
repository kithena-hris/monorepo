import {
  err,
  failure,
  ok,
  wordsIn,
  type DomainFailure,
  type PendingEvent,
  type Result,
} from '@kithena/domain-kit';
import type { CalendarDate, Instant } from '@kithena/contracts';

import type { JobFacts, Viewer } from '../domain/access/access.js';
import { tellBoards } from './board-dispositions.js';
import type { Caller, Deps, JobRecord, MailParts, MailWords, Member, Tx } from './ports.js';

/**
 * What every use case starts from: who is asking, as the domain's `Viewer`,
 * today, and the envelope its events share. Documents' shape.
 *
 * ponytail: "today" is UTC's; a candidate's or a location's zone where a
 * date shown to them matters (interviews carry instants, so they do not).
 */

export interface Outgoing {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly dedupeKey: string;
  readonly companyName?: string;
  readonly parts?: MailParts;
}

export interface Ctx {
  readonly deps: Deps;
  readonly tx: Tx;
  readonly caller: Caller;
  readonly viewer: Viewer;
  readonly member: Member | null;
  readonly today: CalendarDate;
  readonly at: Instant;
  /** Emails to send once the transaction commits (`deliver`), never inside it. */
  readonly mail: Outgoing[];
}

const ENGLISH: MailWords = { language: 'en-US', t: wordsIn('en-US', {}) };

/**
 * The words an email is written in: the company's language, as messaging
 * answers it. US English with no mailer, or when it cannot be asked.
 */
export async function mailWords(ctx: Pick<Ctx, 'deps' | 'caller'>): Promise<MailWords> {
  return (await ctx.deps.mailer?.words?.(ctx.caller.tenantId).catch(() => null)) ?? ENGLISH;
}

/** The caller behind the public API: a candidate, with no account in this tenant. */
export const PUBLIC_ACCOUNT = 'public';
/** Callers that are no account in this tenant, so never looked up as an admin. */
const NO_ACCOUNT = new Set([PUBLIC_ACCOUNT, 'system']);

export async function contextOf(
  deps: Deps,
  tx: Tx,
  caller: Caller,
  mail: Outgoing[] = [],
): Promise<Ctx> {
  const member = caller.personId === null ? null : await tx.members.get(caller.personId);
  return {
    deps,
    tx,
    caller,
    member,
    mail,
    viewer: {
      personId: caller.personId,
      accountId: caller.accountId,
      admin: !NO_ACCOUNT.has(caller.accountId) && (await tx.admins.has(caller.accountId)),
      fairness: (((await tx.settings.get('fairness_accounts')) as string[] | null) ?? []).includes(
        caller.accountId,
      ),
    },
    today: deps.clock.date('UTC'),
    at: deps.clock.instant(),
  };
}

export function event(
  ctx: Pick<Ctx, 'deps' | 'caller' | 'at' | 'today'>,
  name: string,
  aggregate: { type: string; id: string },
  payload: unknown,
  effectiveFrom?: CalendarDate,
): PendingEvent {
  return {
    eventId: ctx.deps.newId(),
    eventName: name,
    eventVersion: 1,
    tenantId: ctx.caller.tenantId,
    occurredAt: ctx.at,
    effectiveFrom: effectiveFrom ?? ctx.today,
    aggregate: { ...aggregate, version: 0 },
    actor:
      ctx.caller.accountId === 'system'
        ? { kind: 'system', process: 'recruiting' }
        : { kind: 'user', userId: ctx.caller.accountId },
    correlationId: ctx.caller.correlationId,
    causationId: null,
    payload,
  };
}

export const publish = async (ctx: Ctx, ...events: PendingEvent[]): Promise<void> => {
  await ctx.tx.outbox.publish(events);
  await tellBoards(ctx, events);
};

export const notFound = (what = 'that'): DomainFailure => failure('NOT_FOUND', `No such ${what}`);
export const forbidden = (message = 'You cannot do this'): DomainFailure =>
  failure('FORBIDDEN', message);

export const adminOnly = (ctx: Ctx): Result<true> =>
  ctx.viewer.admin ? ok(true) : err(forbidden('Only a recruiting administrator can do this'));

/**
 * Talent pools are the recruiters' (PRD §13): an administrator, or a person
 * who is a recruiter on at least one job. Anyone else in the company would
 * otherwise read every pooled candidate's name and email.
 */
export async function recruiterOnly(ctx: Ctx): Promise<Result<true>> {
  if (ctx.viewer.admin) return ok(true);
  const person = ctx.viewer.personId;
  if (person !== null)
    for (const jobId of await ctx.tx.jobs.onTeam(person))
      if (
        (await ctx.tx.jobs.team(jobId)).some((t) => t.personId === person && t.role === 'recruiter')
      )
        return ok(true);
  return err(forbidden('Only a recruiter can do this'));
}

export async function jobFacts(ctx: Ctx, job: JobRecord): Promise<JobFacts> {
  return { id: job.id, team: await ctx.tx.jobs.team(job.id), confidential: job.confidential };
}

/** The job, or NOT_FOUND whether it is missing or the viewer may not see it. */
export async function loadJob(
  ctx: Ctx,
  jobId: string,
): Promise<Result<{ job: JobRecord; facts: JobFacts }>> {
  const job = await ctx.tx.jobs.get(jobId);
  if (job === null) return err(notFound('job'));
  const facts = await jobFacts(ctx, job);
  if (!ctx.viewer.admin && !facts.team.some((t) => t.personId === ctx.viewer.personId))
    return err(notFound('job'));
  return ok({ job, facts });
}

/** The person's name as the company knows them, for events and screens. */
export async function nameOf(ctx: Ctx, personId: string | null): Promise<string | null> {
  if (personId === null) return null;
  const member = await ctx.tx.members.get(personId as never);
  return member?.displayName ?? null;
}

/** The one place the caller's person id is required. */
export function asPerson(ctx: Ctx): Result<string> {
  return ctx.caller.personId === null
    ? err(forbidden('This needs a member of the company'))
    : ok(ctx.caller.personId);
}

/** Send what a transaction queued, after it committed; a failed email never undoes the work. */
/** The company's name, logo and theme, from its settings; nothing when they cannot be read. */
async function companyBrand(
  deps: Deps,
  tenantId: Caller['tenantId'],
): Promise<{ readonly companyName: string | null; readonly parts: MailParts }> {
  try {
    const general = (await deps.uow.run(tenantId, (tx) => tx.settings.get('general'))) as {
      companyName?: unknown;
      logoUrl?: unknown;
      themeId?: unknown;
    } | null;
    const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
    const logoUrl = text(general?.logoUrl);
    const themeId = text(general?.themeId);
    return {
      companyName: text(general?.companyName),
      parts: { ...(logoUrl === null ? {} : { logoUrl }), ...(themeId === null ? {} : { themeId }) },
    };
  } catch {
    return { companyName: null, parts: {} };
  }
}

export async function deliver(
  deps: Deps,
  tenantId: Caller['tenantId'],
  mail: readonly Outgoing[],
): Promise<void> {
  if (deps.mailer === undefined || mail.length === 0) return;
  // Every email in the company's name, with its logo and colours: a candidate
  // hears from the company they applied to, never from Kithena. Read once, for
  // the emails that did not say; one that did keeps its own.
  const brand = await companyBrand(deps, tenantId);
  for (const m of mail) {
    try {
      await deps.mailer.send({
        tenantId,
        to: m.to,
        subject: m.subject,
        text: m.text,
        replyTo: null,
        dedupeKey: m.dedupeKey,
        ...((m.companyName ?? brand.companyName) === null
          ? {}
          : { companyName: m.companyName ?? brand.companyName ?? '' }),
        parts: { ...brand.parts, ...m.parts },
      });
    } catch {
      // ponytail: a lost notice is retried by nothing; a delivery queue when one is missed.
    }
  }
}
