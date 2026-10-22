import type { Instant } from '@kithena/contracts';

import { nextWorkingMorning } from '../domain/pipeline/pipeline.js';
import type { Ctx } from './context.js';

/**
 * When a knockout's rejection is due (PRD §15.2): written at intake, read by
 * the minute job in `knockouts.ts`. Its own module so intake can schedule
 * without reaching the rejection's moves and emails, which reach intake.
 */

const DUE = 'knockouts-due';

export interface KnockoutDue {
  readonly applicationId: string;
  readonly at: Instant;
}

export async function dueKnockouts(ctx: Ctx): Promise<readonly KnockoutDue[]> {
  return ((await ctx.tx.settings.get(DUE)) as KnockoutDue[] | null) ?? [];
}

export async function keepDueKnockouts(ctx: Ctx, due: readonly KnockoutDue[]): Promise<void> {
  await ctx.tx.settings.set(DUE, due);
}

/** At intake: when the rejection will be told. */
export async function scheduleKnockout(
  ctx: Ctx,
  applicationId: string,
  timeZone: string,
): Promise<Instant> {
  const at = nextWorkingMorning(new Date(ctx.at), timeZone).toISOString() as Instant;
  await keepDueKnockouts(ctx, [
    ...(await dueKnockouts(ctx)).filter((d) => d.applicationId !== applicationId),
    { applicationId, at },
  ]);
  return at;
}

/** When a knocked-out application will be rejected; null when none is pending. */
export async function knockoutDueAt(ctx: Ctx, applicationId: string): Promise<Instant | null> {
  return (await dueKnockouts(ctx)).find((d) => d.applicationId === applicationId)?.at ?? null;
}
