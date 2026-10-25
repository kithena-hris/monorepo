import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { addDays } from '../domain/dates.js';
import { approvalState } from '../domain/requisition/requisition.js';
import type { Ctx } from './context.js';
import { editable } from './jobs.js';
import type { ChatMessage, InterviewRecord } from './ports.js';
import { appUrl } from './notify.js';
import { generalSettings } from './setup.js';

/**
 * Recruiting in the company's chat app (PRD §26.3, REC-137): a daily digest
 * of new applicants into a job's channel, a reminder to each interviewer
 * whose scorecard is still owed, an approver asked with an Approve button,
 * and interviewers told of a booked interview and its call. Nothing here
 * changes what Recruiting decides: Approve runs `decideOffer` or
 * `decideRequisition` as the approver, with every rule the screen has, and a
 * rejection, which needs a reason, is made in Kithena through the link.
 *
 * Off without `deps.chat`; a message that does not go fails nothing.
 *
 * ponytail: sent inside the use case's transaction, like the calendars; move
 * to the outbox if Slack is ever slow enough to hold a lock that matters.
 */

/** An Approve lasts two weeks; an approval still waiting by then is chased in Kithena. */
const APPROVE_DAYS = 14;
export const SEALED_FOR = (tenantId: string): string => `chat-approve:${tenantId}`;
/** A Slack channel id, as its "Copy link" ends: C or G and letters and digits. */
const CHANNEL = /^[CG][A-Z0-9]{8,12}$/u;

export interface Press {
  readonly kind: 'offer' | 'requisition';
  readonly id: string;
  readonly personId: string;
  readonly until: string;
}

async function link(ctx: Ctx, path: string): Promise<string | null> {
  return appUrl(ctx, path);
}

async function tell(ctx: Ctx, message: ChatMessage): Promise<void> {
  await ctx.deps.chat?.send(ctx.caller.tenantId, message);
}

const emailOf = async (ctx: Ctx, personId: string) =>
  (await ctx.tx.members.get(personId as never))?.workEmail ?? null;

/**
 * Asks whoever an approval now waits on, once a step: an Approve sealed to
 * each of them, and the approval in Kithena to reject or read more.
 */
export async function askApprovers(
  ctx: Ctx,
  kind: Press['kind'],
  id: string,
  text: string,
  path: string,
): Promise<void> {
  const sealer = ctx.deps.sealer;
  const approval = await ctx.tx.approvals.open(kind, id);
  if (ctx.deps.chat === undefined || sealer === undefined || approval === null) return;
  const state = approvalState(approval.steps, approval.decisions);
  const asked = `chat-asked:${approval.id}:${String(state.step)}`;
  if (state.outcome !== 'pending' || (await ctx.tx.settings.get(asked)) !== null) return;
  await ctx.tx.settings.set(asked, ctx.at);
  const company = (await generalSettings(ctx)).companySlug;
  const url = await link(ctx, path);
  for (const personId of state.waitingOn) {
    const email = await emailOf(ctx, personId);
    if (email === null) continue;
    const press: Press = { kind, id, personId, until: addDays(ctx.today, APPROVE_DAYS) };
    const sealed = sealer.seal(
      new TextEncoder().encode(JSON.stringify(press)),
      SEALED_FOR(ctx.caller.tenantId),
    );
    await tell(ctx, {
      to: { email },
      text,
      // The relay names no company, so the value does, as a calendar's state does.
      approve: `${company}.${Buffer.from(sealed).toString('base64url')}`,
      links: url === null ? [] : [{ label: 'Open in Kithena', url }],
    });
  }
}

/** Tells a booked interview's interviewers when it is and how to join. */
export async function tellInterviewers(
  ctx: Ctx,
  interview: InterviewRecord,
  candidateName: string,
): Promise<void> {
  if (ctx.deps.chat === undefined) return;
  const where =
    interview.videoUrl === null
      ? interview.place === null
        ? ''
        : `, at ${interview.place}`
      : '. Join from the link';
  const page = await link(ctx, `/recruiting/interviews/${interview.id}`);
  for (const personId of interview.interviewerIds) {
    const email = await emailOf(ctx, personId);
    if (email === null) continue;
    await tell(ctx, {
      to: { email },
      text: `Interview booked: ${interview.title} with ${candidateName}, ${interview.startsAt.slice(0, 10)} at ${interview.startsAt.slice(11, 16)} UTC${where}.`,
      links: [
        ...(interview.videoUrl?.startsWith('https://') === true
          ? [{ label: 'Join the call', url: interview.videoUrl }]
          : []),
        ...(page === null ? [] : [{ label: 'Open in Kithena', url: page }]),
      ],
    });
  }
}

/** Where a job's new applicants are posted: a channel Kithena was invited to, or none. */
export async function setJobChannel(
  ctx: Ctx,
  jobId: string,
  channel: string | null,
): Promise<Result<{ channel: string | null }>> {
  const held = await editable(ctx, jobId);
  if (!held.ok) return held;
  if (channel !== null && !CHANNEL.test(channel))
    return err(
      failure('INVALID', 'Paste the channel ID from the channel’s details, like C0123456789'),
    );
  await ctx.tx.settings.set(`chat-channel:${jobId}`, channel);
  return ok({ channel });
}

export async function jobChannel(ctx: Ctx, jobId: string): Promise<string | null> {
  const channel = await ctx.tx.settings.get(`chat-channel:${jobId}`);
  return typeof channel === 'string' ? channel : null;
}

/**
 * The daily part: yesterday's new applicants into each open job's channel,
 * and a reminder to each interviewer whose scorecard for yesterday's
 * interviews is not in.
 *
 * ponytail: reads each open job's applications; a `receivedBetween` query
 * when a company's jobs hold thousands.
 */
export async function chatDaily(ctx: Ctx): Promise<void> {
  if (ctx.deps.chat === undefined) return;
  const yesterday = addDays(ctx.today, -1);
  const from = `${yesterday}T00:00:00.000Z`;
  const to = `${ctx.today}T00:00:00.000Z`;
  for (const job of await ctx.tx.jobs.list()) {
    const channel = job.state === 'open' ? await jobChannel(ctx, job.id) : null;
    if (channel === null) continue;
    const fresh = (await ctx.tx.applications.forJob(job.id)).filter(
      (a) => a.createdAt >= from && a.createdAt < to,
    );
    if (fresh.length === 0) continue;
    const url = await link(ctx, `/recruiting/jobs/${job.id}`);
    await tell(ctx, {
      to: { channel },
      text: `${String(fresh.length)} new ${fresh.length === 1 ? 'applicant' : 'applicants'} for ${job.title} yesterday.`,
      links: url === null ? [] : [{ label: 'Review them', url }],
    });
  }
  for (const interview of await ctx.tx.interviews.startingBetween(from as never, to as never)) {
    if (interview.state === 'cancelled' || interview.state === 'rescheduled') continue;
    const cards = await ctx.tx.interviews.scorecards(interview.id);
    const url = await link(ctx, `/recruiting/interviews/${interview.id}`);
    for (const personId of interview.interviewerIds) {
      if (cards.some((c) => c.interviewerId === personId && c.submittedAt !== null)) continue;
      const email = await emailOf(ctx, personId);
      if (email === null) continue;
      await tell(ctx, {
        to: { email },
        text: `Your scorecard for ${interview.title} yesterday is still to do.`,
        links: url === null ? [] : [{ label: 'Fill it in', url }],
      });
    }
  }
}
