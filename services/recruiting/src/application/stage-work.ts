import { currentStage } from '../domain/pipeline/application.js';
import { asksOf, saveAsk } from './asks.js';
import type { Ctx } from './context.js';
import { draftOnArrival, withdrawOpenOffers } from './offers.js';

/**
 * What a stage takes with it when a candidate moves (R10). The work of a step
 * belongs to that step: leaving it closes the times still asked of the
 * candidate for it, and their link with them; going back before the offer
 * stage withdraws the offer that was open; arriving at the offer stage opens
 * one, filled from the job. Coming back to a step is a new visit with its own
 * work, never the old work reopened. Run after every move, before the next
 * stage asks for its interview (`interviewOnEntry`).
 */
export async function stageWork(
  ctx: Ctx,
  applicationId: string,
): Promise<{ readonly offerId: string | null }> {
  const app = await ctx.tx.applications.get(applicationId);
  if (app === null || app.outcome !== 'active') return { offerId: null };
  const stages = await ctx.tx.jobs.stages(app.jobId);
  const here = currentStage(app);
  const at = stages.findIndex((s) => s.id === here);
  const plans = await ctx.tx.jobs.plan(app.jobId);
  for (const ask of await asksOf(ctx, applicationId)) {
    if (ask.state !== 'open' || (ask.kind !== 'slots' && ask.kind !== 'availability')) continue;
    if (plans.find((p) => p.key === ask.planKey)?.stageId === here) continue;
    await saveAsk(ctx, { ...ask, state: 'closed', closedBecause: 'moved_on' });
    if (ask.linkHash != null) {
      const key = `schedule:${ask.linkHash}`;
      const held = (await ctx.tx.settings.get(key)) as Record<string, unknown> | null;
      if (held !== null) await ctx.tx.settings.set(key, { ...held, expiresAt: ctx.at });
    }
  }
  const offerAt = stages.findIndex((s) => s.category === 'offer');
  if (offerAt !== -1 && at < offerAt) await withdrawOpenOffers(ctx, applicationId);
  return {
    offerId: stages[at]?.category === 'offer' ? await draftOnArrival(ctx, applicationId) : null,
  };
}
