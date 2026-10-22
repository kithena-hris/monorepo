import type { Instant } from '@kithena/contracts';

import { currentStage } from '../domain/pipeline/application.js';
import { nextWorkingMorning } from '../domain/pipeline/pipeline.js';
import type { Ctx } from './context.js';
import { emailFor, emailValues } from './emails.js';
import { loadApplication, rejectApplication, render, sendNow } from './moves.js';
import { generalSettings } from './setup.js';

/**
 * A knockout the company let reject on its own (PRD §15.2): the application
 * is rejected, and the candidate told, the next working day at 09:00 in their
 * zone, never the moment they apply. Until then the team sees it flagged and
 * may move it on; a moved or decided application is left alone.
 */

const DUE = 'knockouts-due';

interface Due {
  readonly applicationId: string;
  readonly at: Instant;
}

async function due(ctx: Ctx): Promise<readonly Due[]> {
  return ((await ctx.tx.settings.get(DUE)) as Due[] | null) ?? [];
}

/** At intake: when the rejection will be told. */
export async function scheduleKnockout(
  ctx: Ctx,
  applicationId: string,
  timeZone: string,
): Promise<Instant> {
  const at = nextWorkingMorning(new Date(ctx.at), timeZone).toISOString() as Instant;
  await ctx.tx.settings.set(DUE, [
    ...(await due(ctx)).filter((d) => d.applicationId !== applicationId),
    { applicationId, at },
  ]);
  return at;
}

/** When a knocked-out application will be rejected; null when none is pending. */
export async function knockoutDueAt(ctx: Ctx, applicationId: string): Promise<Instant | null> {
  return (await due(ctx)).find((d) => d.applicationId === applicationId)?.at ?? null;
}

/** Every minute, as the system: reject what is due and still untouched, and tell the candidate. */
export async function rejectDueKnockouts(ctx: Ctx): Promise<number> {
  const all = await due(ctx);
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
  await ctx.tx.settings.set(
    DUE,
    all.filter((d) => d.at > ctx.at),
  );
  return rejected;
}
