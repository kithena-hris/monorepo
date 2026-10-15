import * as z from 'zod';
import { LaunchCountry } from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { validatePipeline, defaultPipeline, type Stage } from '../domain/pipeline/pipeline.js';
import {
  BENEFIT_CATEGORIES,
  statutoryBenefits,
  type Benefit,
} from '../domain/benefits/benefits.js';
import { validateQuestionnaire, type Questionnaire } from '../domain/screening/questionnaire.js';
import { adminOnly, type Ctx } from './context.js';
import type { ApprovalChain } from '../domain/requisition/requisition.js';
import type {
  Entity,
  Location,
  PayBand,
  PipelineTemplate,
  ScorecardTemplate,
  Template,
} from './ports.js';

/**
 * Recruiting's settings (S1–S8): the company's entities and locations, its
 * pipelines, questionnaires, approval chains, scorecards, benefits, pay
 * bands and email templates. Administrators only. Every input is checked by
 * Zod for shape and by the domain for its rules.
 */

export const GeneralSettings = z.object({
  requisitionsOn: z.boolean(),
  revealInternalAt: z.enum(['screening', 'interview', 'assessment', 'offer']),
  replyAddress: z.email().nullable(),
  federalContractor: z.boolean(),
  rejectionReasons: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,62}$/u)).max(40),
  referralBonus: z
    .object({
      amountMinor: z.int().nonnegative(),
      currency: z.string().length(3),
      after: z.enum(['probation', 'three_months', 'six_months']),
    })
    .nullable(),
  companyName: z.string().min(1).max(200),
  companySlug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/u),
  about: z.string().max(4000).nullable(),
  themeId: z.string().max(40),
  logoUrl: z.url().nullable(),
  searchable: z.boolean(),
  ai: z.object({
    parser: z.boolean(),
    matrix: z.boolean(),
    writer: z.boolean(),
    assistant: z.boolean(),
    charts: z.boolean(),
    nycAuditOn: z.iso.date().nullable(),
    /** Schools' names masked too, against prestige bias (§14.6); a default so older settings still read. */
    maskSchools: z.boolean().default(false),
  }),
  /**
   * Voluntary self-ID categories asked after applying (§24.4): US EEO-1 race
   * and ethnicity for a US employer; gender where it is lawful to ask. Off by
   * default; a default so older settings still read.
   */
  selfId: z
    .object({ gender: z.boolean(), ethnicity: z.boolean() })
    .default({ gender: false, ethnicity: false }),
});
export type GeneralSettings = z.infer<typeof GeneralSettings>;

export const DEFAULT_SETTINGS: GeneralSettings = {
  requisitionsOn: true,
  revealInternalAt: 'offer',
  replyAddress: null,
  federalContractor: false,
  rejectionReasons: [
    'not_qualified',
    'better_candidate',
    'withdrew_interest',
    'no_show',
    'salary',
    'location',
    'position_closed',
    'knockout',
  ],
  referralBonus: null,
  companyName: 'Your company',
  companySlug: 'company',
  about: null,
  themeId: 'indigo',
  logoUrl: null,
  searchable: false,
  ai: {
    parser: false,
    matrix: false,
    writer: false,
    assistant: false,
    charts: false,
    nycAuditOn: null,
    maskSchools: false,
  },
  selfId: { gender: false, ethnicity: false },
};

export async function generalSettings(ctx: Ctx): Promise<GeneralSettings> {
  const held = GeneralSettings.safeParse(await ctx.tx.settings.get('general'));
  return held.success ? held.data : DEFAULT_SETTINGS;
}

export async function saveGeneralSettings(
  ctx: Ctx,
  input: unknown,
): Promise<Result<GeneralSettings>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  const parsed = GeneralSettings.safeParse(input);
  if (!parsed.success)
    return err(failure('INVALID', parsed.error.issues[0]?.message ?? 'Check the settings'));
  await ctx.tx.settings.set('general', parsed.data);
  await ctx.tx.tenant.register(parsed.data.companySlug);
  await ctx.tx.public.putCompany({
    slug: parsed.data.companySlug,
    name: parsed.data.companyName,
    themeId: parsed.data.themeId,
    logoUrl: parsed.data.logoUrl,
    about: parsed.data.about,
    searchable: parsed.data.searchable,
  });
  return ok(parsed.data);
}

const EntityInput = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(200),
  country: LaunchCountry,
  currency: z.string().length(3),
  fullTimeWeeklyMinutes: z.int().min(600).max(3600),
  headcount: z.int().nonnegative(),
  foundedOn: z.iso.date().nullable(),
  worksCouncil: z.boolean(),
  worksCouncilIds: z.array(z.uuid()),
});

export async function saveEntity(ctx: Ctx, input: unknown): Promise<Result<Entity>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  const parsed = EntityInput.safeParse(input);
  if (!parsed.success)
    return err(failure('INVALID', parsed.error.issues[0]?.message ?? 'Check the entity'));
  const entity = parsed.data as Entity;
  await ctx.tx.entities.save(entity);
  // The pack's statutory benefits arrive with the entity (PRD §20.1).
  for (const benefit of statutoryBenefits(entity.country, null, entity.id)) {
    if ((await ctx.tx.benefits.get(benefit.id)) === null) await ctx.tx.benefits.save(benefit);
  }
  return ok(entity);
}

const LocationInput = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(200),
  entityId: z.uuid().nullable(),
  country: LaunchCountry,
  region: z.string().max(10).nullable(),
  city: z.string().max(120).nullable(),
  timeZone: z.string().min(1).max(60),
});

export async function saveLocation(ctx: Ctx, input: unknown): Promise<Result<Location>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  const parsed = LocationInput.safeParse(input);
  if (!parsed.success)
    return err(failure('INVALID', parsed.error.issues[0]?.message ?? 'Check the location'));
  await ctx.tx.locations.save(parsed.data);
  return ok(parsed.data as Location);
}

export async function savePipeline(
  ctx: Ctx,
  template: PipelineTemplate,
): Promise<Result<PipelineTemplate>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  const valid = validatePipeline(template.stages);
  if (!valid.ok) return valid;
  if (template.isDefault) {
    for (const other of await ctx.tx.pipelines.list()) {
      if (other.id !== template.id && other.isDefault)
        await ctx.tx.pipelines.save({ ...other, isDefault: false });
    }
  }
  await ctx.tx.pipelines.save(template);
  return ok(template);
}

/** The company's default pipeline; created on first use. */
export async function defaultTemplate(ctx: Ctx): Promise<readonly Stage[]> {
  const all = await ctx.tx.pipelines.list();
  const held = all.find((p) => p.isDefault) ?? all[0];
  if (held !== undefined) return held.stages;
  const stages = defaultPipeline(ctx.deps.newId);
  await ctx.tx.pipelines.save({ id: ctx.deps.newId(), name: 'Standard', isDefault: true, stages });
  return stages;
}

export async function saveChain(ctx: Ctx, chain: ApprovalChain): Promise<Result<ApprovalChain>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  if (chain.steps.length === 0) return err(failure('NO_STEPS', 'A chain has at least one step'));
  await ctx.tx.chains.save(chain);
  return ok(chain);
}

export async function saveQuestionnaire(
  ctx: Ctx,
  q: Questionnaire,
): Promise<Result<Questionnaire>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  const countries = (await ctx.tx.entities.list()).map((e) => e.country);
  const valid = validateQuestionnaire(q, countries);
  if (!valid.ok) return valid;
  const held = await ctx.tx.questionnaires.get(q.id);
  // A changed questionnaire is a new version; a works council's consent was to the old one.
  const next =
    held === null
      ? { ...q, version: 1 }
      : {
          ...q,
          version: held.version + 1,
          worksCouncilConsentVersion: held.worksCouncilConsentVersion,
        };
  await ctx.tx.questionnaires.save(next);
  return ok(next);
}

export async function recordWorksCouncilConsent(
  ctx: Ctx,
  questionnaireId: string,
): Promise<Result<Questionnaire>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  const q = await ctx.tx.questionnaires.get(questionnaireId);
  if (q === null) return err(failure('NOT_FOUND', 'No such questionnaire'));
  const next = { ...q, worksCouncilConsentVersion: q.version };
  await ctx.tx.questionnaires.save(next);
  return ok(next);
}

export async function saveScorecardTemplate(
  ctx: Ctx,
  t: ScorecardTemplate,
): Promise<Result<ScorecardTemplate>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  if (t.competencies.length === 0)
    return err(failure('NO_COMPETENCIES', 'A scorecard has at least one competency'));
  await ctx.tx.scorecardTemplates.save(t);
  return ok(t);
}

export async function saveTemplate(ctx: Ctx, t: Template): Promise<Result<Template>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  if (t.body.trim() === '') return err(failure('EMPTY', 'A template has a body'));
  await ctx.tx.templates.save(t);
  return ok(t);
}

export async function saveBenefit(ctx: Ctx, b: Benefit): Promise<Result<Benefit>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  const held = await ctx.tx.benefits.get(b.id);
  if (held?.statutory === true)
    return err(
      failure('STATUTORY', 'A statutory benefit comes from the country pack and cannot be changed'),
    );
  if (!(BENEFIT_CATEGORIES as readonly string[]).includes(b.category))
    return err(failure('CATEGORY', 'Choose a category'));
  await ctx.tx.benefits.save({ ...b, statutory: false });
  return ok(b);
}

export async function savePayBand(ctx: Ctx, band: PayBand): Promise<Result<PayBand>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  if (band.minMinor > band.maxMinor)
    return err(failure('BAND_ORDER', 'The band’s lower end is above its upper end'));
  await ctx.tx.payBands.save({ ...band, source: 'recruiting' });
  return ok(band);
}
