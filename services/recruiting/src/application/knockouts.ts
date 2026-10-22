import { currentStage } from '../domain/pipeline/application.js';
import type { Ctx } from './context.js';
import { dueKnockouts, keepDueKnockouts } from './knockout-schedule.js';
import { emailFor, emailValues } from './emails.js';
import { loadApplication, rejectApplication, render, sendNow } from './moves.js';
import { generalSettings } from './setup.js';

/**
 * A knockout the company let reject on its own (PRD §15.2): the application
 * is rejected, and the candidate told, the next working day at 09:00 in their
 * zone, never the moment they apply. Until then the team sees it flagged and
 * may move it on; a moved or decided application is left alone.
 */

/** Every minute, as the system: reject what is due and still untouched, and tell the candidate. */
export async function rejectDueKnockouts(ctx: Ctx): Promise<number> {
  const all = await dueKnockouts(ctx);
  const now = all.filter((d) => d.at <= ctx.at);
  if (now.length === 0) return 0;
  const settings = await generalSettings(ctx);
  const reason = settings.rejectionReasons.includes('knockout')
    ? 'knockout'
    : (settings.rejectionReasons[0] ?? 'knockout');
  let rejected = 0;
  for (const d of now) {
    const loaded = await loadApplication(ctx, d.applicationId);
    // Moved on, decided or withdrawn since: the team's call stands.
    if (
      !loaded.ok ||
      loaded.value.app.outcome !== 'active' ||
      currentStage(loaded.value.app) !== loaded.value.stages[0]?.id
    )
      continue;
    const done = await rejectApplication(
      ctx,
      d.applicationId,
      { reasonKey: reason, templateId: null, send: 'none', poolId: null },
      true,
    );
    if (!done.ok) continue;
    const message = await emailFor(ctx, 'rejection', loaded.value.app.language);
    const values = await emailValues(ctx, loaded.value);
    await sendNow(
      ctx,
      loaded.value.candidate,
      d.applicationId,
      render(message.subject, values),
      render(message.body, values),
    );
    rejected += 1;
  }
  await keepDueKnockouts(
    ctx,
    all.filter((d) => d.at > ctx.at),
  );
  return rejected;
}
