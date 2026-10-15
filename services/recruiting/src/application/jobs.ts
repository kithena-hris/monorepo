import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { LaunchCountry, PublicJob, PublicationTarget, WorkMode } from '@kithena/contracts';

import { jobPermissions, type TeamRole } from '../domain/access/access.js';
import { adChecks, adPasses, type AdPlace } from '../domain/ad/checks.js';
import { renderAd } from '../domain/ad/render.js';
import { validatePipeline, withWorksCouncil, type Stage } from '../domain/pipeline/pipeline.js';
import { isEligible } from '../domain/benefits/benefits.js';
import { asksPayHistory, defaultForm, validateForm, type FormField } from '../domain/form/form.js';
import {
  moveJob,
  moveTarget,
  requestPublication,
  slugFor,
  unpublishAll,
  type JobState,
  type Target,
} from '../domain/job/job.js';
import { asksPayHistory as questionnaireAsksPayHistory } from '../domain/screening/questionnaire.js';
import { event, forbidden, loadJob, notFound, publish, type Ctx } from './context.js';
import type { Criterion, JobAd, JobRecord, PlannedInterview } from './ports.js';
import { defaultTemplate, generalSettings } from './setup.js';

/**
 * Jobs, ads, the apply form and publishing (PRD §8, §9, REC-046). The public
 * projection is written in the same transaction (REC-043): a job is on
 * Kithena Jobs exactly when its careers page or search target is live.
 */

export interface NewJob {
  readonly id: string;
  readonly title: string;
  readonly internalTitle: string;
  readonly requisitionIds: readonly string[];
  readonly entityId: string | null;
  readonly locationIds: readonly string[];
  readonly department: string | null;
  readonly workMode: WorkMode;
  readonly openings: number;
  readonly languages: readonly string[];
  readonly hiringManagerId: string | null;
}

export async function createJob(ctx: Ctx, input: NewJob): Promise<Result<JobRecord>> {
  const settings = await generalSettings(ctx);
  // With requisitions on, a job opens from an approved one (PRD §7.1, S1); an administrator may still open one directly.
  if (settings.requisitionsOn && !ctx.viewer.admin) {
    if (input.requisitionIds.length === 0)
      return err(failure('REQUISITION_REQUIRED', 'Open a job from an approved requisition'));
    for (const id of input.requisitionIds) {
      const r = await ctx.tx.requisitions.get(id);
      if (r?.state !== 'approved')
        return err(failure('REQUISITION_NOT_APPROVED', 'The requisition is not approved'));
      if (r.hiringManagerId !== ctx.viewer.personId) return err(forbidden());
    }
  }
  const countries = await countriesOf(ctx, input.locationIds);
  const job: JobRecord = {
    id: input.id,
    internalTitle: input.internalTitle,
    title: input.title,
    requisitionIds: input.requisitionIds,
    department: input.department,
    countries,
    workMode: input.workMode,
    salaryShown: false,
    languages: input.languages.length === 0 ? ['en'] : input.languages,
    internalOnly: false,
    confidential: false,
    openings: input.openings,
    hired: 0,
    targetHireDate: null,
    state: 'draft',
    entityId: input.entityId,
    locationIds: input.locationIds,
    slug: slugFor(input.title, input.id),
    openedAt: null,
    createdAt: ctx.at,
    outline: { contractType: null, hours: 'full_time', seniority: null },
    salary: null,
    searchable: settings.searchable,
    benefitIds: [],
    scorecardTemplateId: null,
  };
  await ctx.tx.jobs.save(job);
  const team: { personId: string; role: TeamRole }[] = [];
  if (ctx.viewer.personId !== null) team.push({ personId: ctx.viewer.personId, role: 'recruiter' });
  if (input.hiringManagerId !== null)
    team.push({ personId: input.hiringManagerId, role: 'hiring_manager' });
  await ctx.tx.jobs.setTeam(job.id, team);
  // The job copies the template (PRD §12.1); a German entity with a works council gains its stage.
  const entity = input.entityId === null ? null : await ctx.tx.entities.get(input.entityId);
  const template = await defaultTemplate(ctx);
  const copy = template.map((s) => ({ ...s, id: ctx.deps.newId() }));
  await ctx.tx.jobs.setStages(
    job.id,
    entity?.country === 'DE' && entity.worksCouncil ? withWorksCouncil(copy, ctx.deps.newId) : copy,
  );
  await ctx.tx.jobs.setForm(job.id, defaultForm(), null);
  return ok(job);
}

async function countriesOf(ctx: Ctx, locationIds: readonly string[]): Promise<LaunchCountry[]> {
  const out = new Set<LaunchCountry>();
  for (const id of locationIds) {
    const location = await ctx.tx.locations.get(id);
    if (location !== null) out.add(location.country);
  }
  return [...out];
}

async function placesOf(ctx: Ctx, job: JobRecord): Promise<AdPlace[]> {
  const out: AdPlace[] = [];
  for (const id of job.locationIds) {
    const location = await ctx.tx.locations.get(id);
    if (location !== null) out.push({ country: location.country, region: location.region });
  }
  return out;
}

async function editable(ctx: Ctx, jobId: string): Promise<Result<JobRecord>> {
  const loaded = await loadJob(ctx, jobId);
  if (!loaded.ok) return loaded;
  if (!jobPermissions(ctx.viewer, loaded.value.facts).has('job.edit')) return err(forbidden());
  return ok(loaded.value.job);
}

export type JobDetails = Pick<
  JobRecord,
  | 'title'
  | 'internalTitle'
  | 'department'
  | 'locationIds'
  | 'workMode'
  | 'salaryShown'
  | 'languages'
  | 'internalOnly'
  | 'confidential'
  | 'openings'
  | 'targetHireDate'
  | 'outline'
  | 'salary'
  | 'searchable'
  | 'benefitIds'
  | 'scorecardTemplateId'
  | 'entityId'
>;

export async function saveJobDetails(
  ctx: Ctx,
  jobId: string,
  details: JobDetails,
): Promise<Result<JobRecord>> {
  const held = await editable(ctx, jobId);
  if (!held.ok) return held;
  if (details.openings < 1) return err(failure('OPENINGS', 'At least one opening'));
  if (details.salary !== null && details.salary.minMinor > details.salary.maxMinor) {
    return err(failure('SALARY_ORDER', 'The range’s lower end is above its upper end'));
  }
  const job: JobRecord = {
    ...held.value,
    ...details,
    countries: await countriesOf(ctx, details.locationIds),
  };
  await ctx.tx.jobs.save(job);
  await refreshProjection(ctx, job);
  return ok(job);
}

export async function setTeam(
  ctx: Ctx,
  jobId: string,
  team: readonly { personId: string; role: TeamRole }[],
): Promise<Result<true>> {
  const held = await editable(ctx, jobId);
  if (!held.ok) return held;
  if (!team.some((t) => t.role === 'hiring_manager'))
    return err(failure('HIRING_MANAGER', 'A job has a hiring manager'));
  for (const t of team)
    if ((await ctx.tx.members.get(t.personId as never)) === null)
      return err(failure('NOT_A_MEMBER', 'Everyone on the team works here'));
  await ctx.tx.jobs.setTeam(jobId, team);
  return ok(true);
}

export async function setStages(
  ctx: Ctx,
  jobId: string,
  stages: readonly Stage[],
): Promise<Result<readonly Stage[]>> {
  const held = await editable(ctx, jobId);
  if (!held.ok) return held;
  const valid = validatePipeline(stages);
  if (!valid.ok) return valid;
  // A stage with applications in it stays.
  const apps = await ctx.tx.applications.forJob(jobId);
  const ids = new Set(stages.map((s) => s.id));
  for (const app of apps) {
    const last = app.history.at(-1)?.to;
    if (last !== undefined && !ids.has(last))
      return err(failure('STAGE_IN_USE', 'A stage with candidates in it cannot be removed'));
  }
  await ctx.tx.jobs.setStages(jobId, stages);
  return ok(stages);
}

export async function saveForm(
  ctx: Ctx,
  jobId: string,
  fields: readonly FormField[],
  questionnaireId: string | null,
): Promise<Result<readonly FormField[]>> {
  const held = await editable(ctx, jobId);
  if (!held.ok) return held;
  const valid = validateForm(fields);
  if (!valid.ok) return valid;
  if (questionnaireId !== null) {
    const q = await ctx.tx.questionnaires.get(questionnaireId);
    if (q === null) return err(notFound('questionnaire'));
    const entity =
      held.value.entityId === null ? null : await ctx.tx.entities.get(held.value.entityId);
    if (
      entity?.country === 'DE' &&
      entity.worksCouncil &&
      q.worksCouncilConsentVersion !== q.version
    ) {
      return err(
        failure(
          'WORKS_COUNCIL_QUESTIONNAIRE',
          'The works council has not consented to this version of the questionnaire (§ 94 BetrVG)',
        ),
      );
    }
  }
  await ctx.tx.jobs.setForm(jobId, fields, questionnaireId);
  // The ad checks read the form (pay history, PRD §8.3): re-run them.
  for (const ad of await ctx.tx.jobs.ads(jobId))
    await saveAd(ctx, jobId, ad.language, ad.title, ad.doc);
  return ok(fields);
}

/** Save one language of the ad and run its checks (PRD §8.2, §8.3). */
export async function saveAd(
  ctx: Ctx,
  jobId: string,
  language: string,
  title: string,
  doc: unknown,
): Promise<Result<JobAd>> {
  const { html, plain } = renderAd(doc);
  const held = await editable(ctx, jobId);
  if (!held.ok) return held;
  const job = held.value;
  const settings = await generalSettings(ctx);
  const form = await ctx.tx.jobs.form(jobId);
  const questionnaire =
    form?.questionnaireId == null ? null : await ctx.tx.questionnaires.get(form.questionnaireId);
  const checks = adChecks(
    {
      title,
      language,
      body: plain,
      salaryShown: job.salaryShown && job.salary !== null,
      hasEqualOpportunityStatement:
        /equal opportunit|without regard to|igualdad de oportunidades|chancengleich/iu.test(plain),
    },
    await placesOf(ctx, job),
    {
      federalContractor: settings.federalContractor,
      asksPayHistory:
        asksPayHistory(form?.fields ?? []) ||
        (questionnaire !== null && questionnaireAsksPayHistory(questionnaire)),
    },
    ctx.today,
  );
  const ad: JobAd = { jobId, language, title, doc, html, plain, checks };
  await ctx.tx.jobs.saveAd(ad);
  if (!job.languages.includes(language))
    await ctx.tx.jobs.save({ ...job, languages: [...job.languages, language] });
  return ok(ad);
}

export async function setCriteria(
  ctx: Ctx,
  jobId: string,
  criteria: readonly Criterion[],
): Promise<Result<readonly Criterion[]>> {
  const held = await editable(ctx, jobId);
  if (!held.ok) return held;
  for (const c of criteria) {
    if (c.text.trim() === '' || c.weight < 1 || c.weight > 5)
      return err(failure('CRITERION', 'Each criterion has words and a weight from 1 to 5'));
  }
  await ctx.tx.jobs.setCriteria(jobId, criteria);
  return ok(criteria);
}

export async function setPlan(
  ctx: Ctx,
  jobId: string,
  plan: readonly PlannedInterview[],
): Promise<Result<readonly PlannedInterview[]>> {
  const held = await editable(ctx, jobId);
  if (!held.ok) return held;
  if (new Set(plan.map((p) => p.key)).size !== plan.length)
    return err(failure('PLAN_KEYS', 'Each interview in the plan is named once'));
  for (const p of plan)
    if (p.minutes < 5 || p.minutes > 480)
      return err(failure('PLAN_MINUTES', 'An interview lasts 5 minutes to 8 hours'));
  await ctx.tx.jobs.setPlan(jobId, plan);
  return ok(plan);
}

export async function moveJobState(
  ctx: Ctx,
  jobId: string,
  to: JobState,
): Promise<Result<JobRecord>> {
  const held = await editable(ctx, jobId);
  if (!held.ok) return held;
  const moved = moveJob(held.value, to);
  if (!moved.ok) return moved;
  const job: JobRecord = {
    ...held.value,
    ...moved.value,
    openedAt: to === 'open' && held.value.openedAt === null ? ctx.at : held.value.openedAt,
  };
  await ctx.tx.jobs.save(job);
  const ids = { jobId, requisitionIds: job.requisitionIds };
  if (to === 'open')
    await publish(ctx, event(ctx, 'recruiting.job.opened', { type: 'Job', id: jobId }, ids));
  if (to === 'closed' || to === 'filled' || to === 'on_hold') {
    await takeDown(ctx, job);
    if (to !== 'on_hold')
      await publish(ctx, event(ctx, `recruiting.job.${to}`, { type: 'Job', id: jobId }, ids));
  }
  return ok(job);
}

/** The URL a target lists the job at. */
async function urlFor(ctx: Ctx, job: JobRecord, target: PublicationTarget): Promise<string | null> {
  const company = (await generalSettings(ctx)).companySlug;
  const base = `${ctx.deps.jobsOrigin}/${company}/${job.slug}`;
  switch (target) {
    case 'careers_page':
    case 'kithena_jobs':
    case 'google_for_jobs':
      return base;
    case 'xml_feed':
      return `${ctx.deps.jobsOrigin}/feeds/${company}.xml`;
    case 'share_link':
      return `${base}?src=share`;
    default:
      return null;
  }
}

const SELF: ReadonlySet<PublicationTarget> = new Set([
  'careers_page',
  'kithena_jobs',
  'google_for_jobs',
  'xml_feed',
  'internal_board',
  'share_link',
]);

export async function publishTo(
  ctx: Ctx,
  jobId: string,
  target: PublicationTarget,
): Promise<Result<Target>> {
  const loaded = await loadJob(ctx, jobId);
  if (!loaded.ok) return loaded;
  if (!jobPermissions(ctx.viewer, loaded.value.facts).has('job.publish')) return err(forbidden());
  const job = loaded.value.job;
  const ads = await ctx.tx.jobs.ads(jobId);
  if (ads.length === 0 && target !== 'internal_board')
    return err(failure('NO_AD', 'Write the ad first'));
  const passed = ads.every((ad) => adPasses(ad.checks));
  const requested = requestPublication(job, await ctx.tx.jobs.targets(jobId), target, passed);
  if (!requested.ok) return requested;
  // Kithena publishes to its own targets at once; a board's adapter moves the rest (PRD §26.1).
  let listing = requested.value;
  if (SELF.has(target)) {
    const live = moveTarget(listing, 'live', ctx.at, {
      url: (await urlFor(ctx, job, target)) ?? '',
    });
    if (!live.ok) return live;
    listing = { ...live.value, url: live.value.url === '' ? null : live.value.url };
  }
  await ctx.tx.jobs.saveTarget(jobId, listing);
  if (listing.state === 'live') {
    await publish(
      ctx,
      event(
        ctx,
        'recruiting.job.published',
        { type: 'Job', id: jobId },
        { jobId, target, url: listing.url },
      ),
    );
  }
  await refreshProjection(ctx, job);
  return ok(listing);
}

export async function unpublish(ctx: Ctx, jobId: string): Promise<Result<readonly Target[]>> {
  const loaded = await loadJob(ctx, jobId);
  if (!loaded.ok) return loaded;
  if (!jobPermissions(ctx.viewer, loaded.value.facts).has('job.publish')) return err(forbidden());
  return ok(await takeDown(ctx, loaded.value.job));
}

async function takeDown(ctx: Ctx, job: JobRecord): Promise<readonly Target[]> {
  const before = await ctx.tx.jobs.targets(job.id);
  const after = unpublishAll(before);
  for (const [i, t] of after.entries()) {
    await ctx.tx.jobs.saveTarget(job.id, t);
    if (before[i]?.state === 'live')
      await publish(
        ctx,
        event(
          ctx,
          'recruiting.job.unpublished',
          { type: 'Job', id: job.id },
          { jobId: job.id, target: t.target },
        ),
      );
  }
  await ctx.tx.public.removeListing(job.id);
  return after;
}

const TS_LANGUAGE: Readonly<Record<string, string>> = {
  en: 'english',
  de: 'german',
  es: 'spanish',
};
export const tsConfigFor = (language: string): string => TS_LANGUAGE[language] ?? 'simple';

/** Rewrite the job's rows in `recruiting_public` from what is live (PRD §31.2). */
export async function refreshProjection(ctx: Ctx, job: JobRecord): Promise<void> {
  const targets = await ctx.tx.jobs.targets(job.id);
  const onSite = targets.some(
    (t) => (t.target === 'careers_page' || t.target === 'kithena_jobs') && t.state === 'live',
  );
  await ctx.tx.public.removeListing(job.id);
  if (!onSite || job.state !== 'open' || job.internalOnly) return;
  const settings = await generalSettings(ctx);
  const searchable =
    settings.searchable &&
    job.searchable &&
    targets.some((t) => t.target === 'kithena_jobs' && t.state === 'live');
  const stages = await ctx.tx.jobs.stages(job.id);
  const form = await ctx.tx.jobs.form(job.id);
  const ads = await ctx.tx.jobs.ads(job.id);
  const places = [];
  for (const id of job.locationIds) {
    const l = await ctx.tx.locations.get(id);
    if (l !== null)
      places.push({
        country: l.country,
        region: l.region,
        city: l.city,
        remoteFrom: job.workMode === 'remote' ? [l.country] : [],
      });
  }
  const benefits = (await ctx.tx.benefits.list()).filter(
    (b) => (b.statutory && b.legalEntityId === job.entityId) || job.benefitIds.includes(b.id),
  );
  const eligibleFor = {
    employmentType: 'permanent' as const,
    weeklyMinutes: 2400,
    workMode: job.workMode,
    locationId: null,
  };
  const nyc = places.some((p) => p.country === 'US' && p.region === 'NYC') && settings.ai.matrix;
  for (const ad of ads) {
    const page: PublicJob = {
      jobId: job.id as PublicJob['jobId'],
      slug: job.slug,
      company: {
        slug: settings.companySlug,
        name: job.confidential ? 'Confidential' : settings.companyName,
        themeId: settings.themeId,
        logoUrl: job.confidential ? null : settings.logoUrl,
        about: job.confidential ? null : settings.about,
      },
      title: ad.title,
      language: ad.language,
      places,
      workMode: job.workMode,
      contractType: job.outline.contractType ?? 'Permanent',
      hours: job.outline.hours,
      department: job.department,
      seniority: job.outline.seniority,
      salary: job.salaryShown ? job.salary : null,
      postedAt: job.openedAt ?? ctx.at,
      validThrough: null,
      searchable,
      html: ad.html,
      otherLanguages: ads.filter((a) => a.language !== ad.language).map((a) => a.language),
      benefits: benefits
        .filter((b) => isEligible(b, eligibleFor) || b.statutory)
        .map((b) => ({
          category: b.category,
          name: b.names[ad.language] ?? b.names['en'] ?? b.key,
          description: null,
        })),
      process: stages.flatMap((s) => (s.candidateName === null ? [] : [s.candidateName])),
      form: (form?.fields ?? [])
        .filter((f) => f.shown)
        .map((f) => ({
          key: f.key,
          label: f.label,
          kind: f.kind,
          required: f.required,
          options: [...(f.options ?? [])],
        })),
      nycNotice: nyc,
      closed: false,
    };
    await ctx.tx.public.putListing(
      page,
      [ad.title, settings.companyName, job.department ?? '', ad.plain].join('\n'),
    );
  }
}

/** Every job the viewer is on the team of; all for an administrator. */
export async function myJobs(ctx: Ctx): Promise<readonly JobRecord[]> {
  const all = await ctx.tx.jobs.list();
  if (ctx.viewer.admin) return all;
  const mine = new Set(await ctx.tx.jobs.onTeam(ctx.viewer.personId ?? ''));
  return all.filter((j) => mine.has(j.id));
}

/** The internal board (R8): open jobs any member may see, refer to and apply to. */
export async function internalBoard(ctx: Ctx): Promise<readonly JobRecord[]> {
  const all = await ctx.tx.jobs.list();
  const results: JobRecord[] = [];
  for (const job of all) {
    if (job.state !== 'open' || job.confidential) continue;
    const targets = await ctx.tx.jobs.targets(job.id);
    if (targets.some((t) => t.target === 'internal_board' && t.state === 'live')) results.push(job);
  }
  return results;
}
