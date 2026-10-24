import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { may } from '../domain/access/access.js';
import { mayStartBackgroundCheck } from '../domain/prehire/background.js';
import { forbidden, notFound, type Ctx, mailWords } from './context.js';
import { loadApplication } from './moves.js';
import { decidePrehireCondition } from './offers.js';

/**
 * Assessments and background checks through their ports (PRD §15.3, §17.2,
 * REC-138). What a provider says is kept on the application; a person
 * decides what it means. A clear background check meets the pre-hire's
 * condition when it has one; anything else is for a person to read, as the
 * US adverse-action process requires.
 */

export interface AssessmentRecord {
  readonly provider: string;
  readonly externalId: string;
  readonly url: string;
  readonly scoreBp: number | null;
  readonly reportUrl: string | null;
}

export interface CheckRecord {
  readonly provider: string;
  readonly externalId: string;
  readonly state: 'pending' | 'clear' | 'consider';
}

const none = (what: string) => failure('NO_PROVIDER', `No ${what} provider is set up yet`);

export async function sendAssessment(
  ctx: Ctx,
  applicationId: string,
  packageKey: string,
): Promise<Result<AssessmentRecord>> {
  const provider = ctx.deps.assessmentProvider;
  if (provider === undefined) return err(none('assessment'));
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'pipeline.move')) return err(forbidden());
  const invited = await provider.invite({
    applicationId,
    email: loaded.value.candidate.email,
    packageKey,
  });
  if (!invited.ok) return invited;
  const record: AssessmentRecord = {
    provider: provider.name,
    ...invited.value,
    scoreBp: null,
    reportUrl: null,
  };
  await ctx.tx.settings.set(`assessment:${applicationId}`, record);
  const { t } = await mailWords(ctx);
  ctx.mail.push({
    to: loaded.value.candidate.email,
    subject: t('email.assessment.subject', 'Your assessment'),
    text: t(
      'email.assessment.text',
      'Hello {{name}},\n\nThe next step is an assessment. Start it here:\n{{link}}',
      { name: loaded.value.candidate.name, link: invited.value.url },
    ),
    dedupeKey: `assessment:${applicationId}:${invited.value.externalId}`,
  });
  return ok(record);
}

export async function refreshAssessment(
  ctx: Ctx,
  applicationId: string,
): Promise<Result<AssessmentRecord>> {
  const provider = ctx.deps.assessmentProvider;
  if (provider === undefined) return err(none('assessment'));
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'candidate.profile')) return err(forbidden());
  const held = (await ctx.tx.settings.get(
    `assessment:${applicationId}`,
  )) as AssessmentRecord | null;
  if (held === null) return err(notFound('assessment'));
  const result = await provider.result(held.externalId);
  const next = result === null ? held : { ...held, ...result };
  await ctx.tx.settings.set(`assessment:${applicationId}`, next);
  return ok(next);
}

export async function startBackgroundCheck(
  ctx: Ctx,
  applicationId: string,
): Promise<Result<CheckRecord>> {
  const provider = ctx.deps.backgroundChecks;
  if (provider === undefined) return err(none('background check'));
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'offer.edit')) return err(forbidden());
  const job = await ctx.tx.jobs.get(loaded.value.app.jobId);
  const entity = job?.entityId == null ? null : await ctx.tx.entities.get(job.entityId);
  if (entity === null) return err(notFound('entity'));
  const allowed = mayStartBackgroundCheck(
    entity.country,
    (await ctx.tx.prehires.get(applicationId)) !== null,
  );
  if (!allowed.ok)
    return err(
      failure(
        'CHECK_NOT_ALLOWED',
        allowed.reason === 'after_offer'
          ? 'A background check starts only after the offer is accepted'
          : 'Here a check is lawful only where a law requires it for the role; do it outside Kithena',
      ),
    );
  const started = await provider.start({
    applicationId,
    email: loaded.value.candidate.email,
    country: entity.country,
  });
  if (!started.ok) return started;
  const record: CheckRecord = {
    provider: provider.name,
    externalId: started.value.externalId,
    state: 'pending',
  };
  await ctx.tx.settings.set(`background_check:${applicationId}`, record);
  return ok(record);
}

export async function refreshBackgroundCheck(
  ctx: Ctx,
  applicationId: string,
): Promise<Result<CheckRecord>> {
  const provider = ctx.deps.backgroundChecks;
  if (provider === undefined) return err(none('background check'));
  const loaded = await loadApplication(ctx, applicationId);
  if (!loaded.ok) return loaded;
  if (!may(ctx.viewer, loaded.value.facts, 'offer.edit')) return err(forbidden());
  const held = (await ctx.tx.settings.get(
    `background_check:${applicationId}`,
  )) as CheckRecord | null;
  if (held === null) return err(notFound('background check'));
  const next = { ...held, state: await provider.status(held.externalId) };
  await ctx.tx.settings.set(`background_check:${applicationId}`, next);
  const prehire = await ctx.tx.prehires.get(applicationId);
  const open = prehire?.conditions.some((c) => c.kind === 'background_check' && c.state === 'open');
  if (next.state === 'clear' && open === true) {
    const met = await decidePrehireCondition(ctx, applicationId, 'background_check', 'met', null);
    if (!met.ok) return met;
  }
  return ok(next);
}
