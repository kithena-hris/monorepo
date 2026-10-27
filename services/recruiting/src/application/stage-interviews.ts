import type { Ctx } from './context.js';
import { bookInterview, selfScheduleLink } from './interviews.js';

const escape = (s: string): string =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/**
 * A candidate entering a step of the pipeline with an interview planned for
 * it is asked for it at once (R14): with one set time for everyone, the
 * interview is booked and the candidate and the panel are invited; otherwise
 * the candidate is sent a link to choose times that fit the panel, and the
 * recruiter books one of them from their Inbox. Either way the agenda and
 * where it happens go with it. An interview already booked for that step is
 * not asked for again. Nothing here stops the move: a booking that cannot be
 * made is left to be made by hand.
 */
export async function interviewOnEntry(
  ctx: Ctx,
  applicationId: string,
  stageId: string,
): Promise<void> {
  const app = await ctx.tx.applications.get(applicationId);
  if (app === null) return;
  const plan = (await ctx.tx.jobs.plan(app.jobId)).find((p) => p.stageId === stageId);
  if (plan === undefined) return;
  const held = await ctx.tx.interviews.forApplication(applicationId);
  if (held.some((i) => i.planKey === plan.key && i.state === 'scheduled')) return;
  const agenda =
    plan.agenda == null || plan.agenda.trim() === ''
      ? null
      : {
          text: plan.agenda,
          html: plan.agenda
            .split(/\n{2,}/u)
            .map((p) => `<p>${escape(p).replaceAll('\n', '<br>')}</p>`)
            .join(''),
        };
  const setting = { place: plan.place ?? null, videoUrl: plan.videoUrl ?? null, agenda };
  if (plan.mode === 'fixed') {
    if (plan.fixedAt == null || plan.fixedAt <= ctx.at) return;
    await bookInterview(
      ctx,
      applicationId,
      { planKey: plan.key, startsAt: plan.fixedAt, ...setting },
      'team',
    );
    return;
  }
  await selfScheduleLink(ctx, applicationId, plan.key, {}, [], {}, setting);
}

/**
 * Interviews still booked at steps a move went past: the screen asks whether
 * to cancel them, since the candidate has moved beyond them. Not cancelled
 * here: someone may still want to meet them.
 */
export async function leftBehind(
  ctx: Ctx,
  applicationId: string,
  to: string,
): Promise<{ id: string; title: string; startsAt: string }[]> {
  const app = await ctx.tx.applications.get(applicationId);
  if (app === null) return [];
  const stages = await ctx.tx.jobs.stages(app.jobId);
  const at = stages.findIndex((s) => s.id === to);
  const plan = await ctx.tx.jobs.plan(app.jobId);
  return (await ctx.tx.interviews.forApplication(applicationId)).flatMap((i) => {
    const planned = plan.find((p) => p.key === i.planKey);
    const step = stages.findIndex((s) => s.id === planned?.stageId);
    return i.state === 'scheduled' && planned !== undefined && step !== -1 && step < at
      ? [{ id: i.id, title: planned.title, startsAt: i.startsAt }]
      : [];
  });
}
