import {
  err,
  failure,
  ok,
  type DomainFailure,
  type PendingEvent,
  type Result,
} from '@kithena/domain-kit';
import type { CalendarDate, Instant } from '@kithena/contracts';

import type { JobFacts, Viewer } from '../domain/access/access.js';
import type { Caller, Deps, JobRecord, Member, Tx } from './ports.js';

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
      admin: await tx.admins.has(caller.accountId),
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

export const publish = (ctx: Ctx, ...events: PendingEvent[]): Promise<void> =>
  ctx.tx.outbox.publish(events);

export const notFound = (what = 'that'): DomainFailure => failure('NOT_FOUND', `No such ${what}`);
export const forbidden = (message = 'You cannot do this'): DomainFailure =>
  failure('FORBIDDEN', message);

export const adminOnly = (ctx: Ctx): Result<true> =>
  ctx.viewer.admin ? ok(true) : err(forbidden('Only a recruiting administrator can do this'));

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
export async function deliver(
  deps: Deps,
  tenantId: Caller['tenantId'],
  mail: readonly Outgoing[],
): Promise<void> {
  if (deps.mailer === undefined) return;
  for (const m of mail) {
    try {
      await deps.mailer.send({
        tenantId,
        to: m.to,
        subject: m.subject,
        text: m.text,
        replyTo: null,
        dedupeKey: m.dedupeKey,
      });
    } catch {
      // ponytail: a lost notice is retried by nothing; a delivery queue when one is missed.
    }
  }
}
