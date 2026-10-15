import * as z from 'zod';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { adverseImpact, type ImpactRow, type Person } from '../domain/fairness/impact.js';
import { furthestCategory } from '../domain/pipeline/application.js';
import { adminOnly, notFound, type Ctx } from './context.js';
import { generalSettings } from './setup.js';

/**
 * Voluntary self-ID and the fairness checks (PRD §22.6, §24.4, REC-123).
 * Asked after the application is sent, never on the form; sealed per
 * application; read only here, to count, by an administrator, never by a
 * hiring team or a model. A group under five people is never shown.
 */

const GENDER = ['woman', 'man', 'non_binary', 'self_described', 'undisclosed'] as const;
/** EEO-1 race and ethnicity. */
const ETHNICITY = [
  'hispanic_or_latino',
  'white',
  'black_or_african_american',
  'native_hawaiian_or_pacific_islander',
  'asian',
  'american_indian_or_alaska_native',
  'two_or_more_races',
  'undisclosed',
] as const;

export const SelfId = z.object({
  gender: z.enum(GENDER).optional(),
  ethnicity: z.enum(ETHNICITY).optional(),
});
export type SelfId = z.infer<typeof SelfId>;

const offNow = () => failure('SELF_ID_OFF', 'Your company does not ask this');

async function own(ctx: Ctx, candidateId: string, applicationId: string) {
  const app = await ctx.tx.applications.get(applicationId);
  return app?.candidateId === candidateId ? app : null;
}

/** Which questions the candidate's page asks, with every answer optional. */
export async function selfIdQuestions(
  ctx: Ctx,
  candidateId: string,
  applicationId: string,
): Promise<Result<{ gender: readonly string[] | null; ethnicity: readonly string[] | null }>> {
  if ((await own(ctx, candidateId, applicationId)) === null) return err(notFound('application'));
  const on = (await generalSettings(ctx)).selfId;
  const sealed = ctx.deps.sealer !== undefined;
  return ok({
    gender: sealed && on.gender ? GENDER : null,
    ethnicity: sealed && on.ethnicity ? ETHNICITY : null,
  });
}

export async function saveSelfId(
  ctx: Ctx,
  candidateId: string,
  applicationId: string,
  answers: SelfId,
): Promise<Result<true>> {
  if ((await own(ctx, candidateId, applicationId)) === null) return err(notFound('application'));
  const on = (await generalSettings(ctx)).selfId;
  const sealer = ctx.deps.sealer;
  if (sealer === undefined || (!on.gender && !on.ethnicity)) return err(offNow());
  // Only what the company asks is kept, whatever was sent.
  const kept: SelfId = {
    ...(on.gender && answers.gender !== undefined ? { gender: answers.gender } : {}),
    ...(on.ethnicity && answers.ethnicity !== undefined ? { ethnicity: answers.ethnicity } : {}),
  };
  await ctx.tx.selfIds.save(
    applicationId,
    sealer.seal(new TextEncoder().encode(JSON.stringify(kept)), applicationId),
  );
  return ok(true);
}

const RANK: Readonly<Record<string, number>> = {
  applied: 0,
  screening: 1,
  interview: 2,
  assessment: 3,
  works_council: 4,
  offer: 5,
  hired: 6,
};
const STAGES = [
  { rank: 1, name: 'Screening' },
  { rank: 2, name: 'Interview' },
  { rank: 5, name: 'Offer' },
  { rank: 6, name: 'Hired' },
];

export interface Fairness {
  readonly all: readonly ImpactRow[];
  /** Decisions where an evidence matrix had been read, and where none had (§22.6). */
  readonly aiAssisted: readonly ImpactRow[];
  readonly notAssisted: readonly ImpactRow[];
}

export async function fairness(
  ctx: Ctx,
  category: 'gender' | 'ethnicity',
): Promise<Result<Fairness>> {
  const allowed = adminOnly(ctx);
  if (!allowed.ok) return allowed;
  const sealer = ctx.deps.sealer;
  if (sealer === undefined) return err(offNow());
  const people: Person[] = [];
  for (const row of await ctx.tx.selfIds.all()) {
    const opened = sealer.open(row.sealed, row.applicationId);
    const said =
      opened === null ? null : SelfId.safeParse(JSON.parse(new TextDecoder().decode(opened)));
    const group = said?.success === true ? said.data[category] : undefined;
    if (group === undefined || group === 'undisclosed') continue;
    const app = await ctx.tx.applications.get(row.applicationId);
    if (app === null) continue;
    const reached = furthestCategory(app, await ctx.tx.jobs.stages(app.jobId));
    const ai = (await ctx.tx.assessments.forApplication(app.id)).some(
      (a) => a.feature === 'matrix',
    );
    people.push({ group, reachedRank: RANK[reached] ?? 0, ai });
  }
  return ok({
    all: adverseImpact(people, STAGES),
    aiAssisted: adverseImpact(people, STAGES, (p) => p.ai),
    notAssisted: adverseImpact(people, STAGES, (p) => !p.ai),
  });
}
