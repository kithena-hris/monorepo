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
import { write, type PromptSpec } from './ai.js';
import type {
  Entity,
  Location,
  OrgUnit,
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
  const held = await ctx.tx.entities.get(parsed.data.id);
  // One of People's keeps People's name and country; Recruiting adds what only
  // it knows: the currency, the working week, the works council.
  const entity: Entity =
    held?.source === 'people'
      ? { ...(parsed.data as Entity), name: held.name, country: held.country, source: 'people' }
      : (parsed.data as Entity);
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
  const held = await ctx.tx.locations.get(parsed.data.id);
  if (held?.source === 'people') return err(FROM_PEOPLE);
  if (parsed.data.entityId !== null && (await ctx.tx.entities.get(parsed.data.entityId)) === null)
    return err(failure('NOT_FOUND', 'No such legal entity'));
  await ctx.tx.locations.save(parsed.data);
  return ok(parsed.data as Location);
}

/** A row People owns is changed in People; Recruiting shows it and ties to it. */
const FROM_PEOPLE = failure('FROM_PEOPLE', 'This comes from People; change it there');

const OrgUnitInput = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(200),
  parentId: z.uuid().nullable(),
});

/** A department, where People is absent or beside People's (PRD §5.2). */
export async function saveOrgUnit(ctx: Ctx, input: unknown): Promise<Result<OrgUnit>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  const parsed = OrgUnitInput.safeParse(input);
  if (!parsed.success)
    return err(failure('INVALID', parsed.error.issues[0]?.message ?? 'Check the department'));
  const held = await ctx.tx.orgUnits.get(parsed.data.id);
  if (held?.source === 'people') return err(FROM_PEOPLE);
  if (parsed.data.parentId === parsed.data.id)
    return err(failure('INVALID', 'A department cannot sit under itself'));
  if (parsed.data.parentId !== null && (await ctx.tx.orgUnits.get(parsed.data.parentId)) === null)
    return err(failure('NOT_FOUND', 'No such parent department'));
  await ctx.tx.orgUnits.save(parsed.data);
  return ok(parsed.data);
}

/* ------------------------------------------------------------- removing -- */

export async function removeEntity(ctx: Ctx, id: string): Promise<Result<void>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  const held = await ctx.tx.entities.get(id);
  if (held === null) return err(failure('NOT_FOUND', 'No such legal entity'));
  if (held.source === 'people') return err(FROM_PEOPLE);
  if ((await ctx.tx.locations.list()).some((l) => l.entityId === id))
    return err(failure('IN_USE', 'Move or remove its locations first'));
  // Its statutory benefits came with it (PRD §20.1) and go with it.
  for (const b of await ctx.tx.benefits.list())
    if (b.legalEntityId === id) await ctx.tx.benefits.remove(b.id);
  await ctx.tx.entities.remove(id);
  return ok(undefined);
}

export async function removeLocation(ctx: Ctx, id: string): Promise<Result<void>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  const held = await ctx.tx.locations.get(id);
  if (held === null) return err(failure('NOT_FOUND', 'No such location'));
  if (held.source === 'people') return err(FROM_PEOPLE);
  await ctx.tx.locations.remove(id);
  return ok(undefined);
}

export async function removeOrgUnit(ctx: Ctx, id: string): Promise<Result<void>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  const held = await ctx.tx.orgUnits.get(id);
  if (held === null) return err(failure('NOT_FOUND', 'No such department'));
  if (held.source === 'people') return err(FROM_PEOPLE);
  if ((await ctx.tx.orgUnits.list()).some((u) => u.parentId === id))
    return err(failure('IN_USE', 'Move or remove the departments under it first'));
  await ctx.tx.orgUnits.remove(id);
  return ok(undefined);
}

/** A job copied its stages, so a template can go; the default stays until another is the default. */
export async function removePipeline(ctx: Ctx, id: string): Promise<Result<void>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  const held = await ctx.tx.pipelines.get(id);
  if (held === null) return err(failure('NOT_FOUND', 'No such pipeline'));
  if (held.isDefault && (await ctx.tx.pipelines.list()).length > 1)
    return err(failure('DEFAULT', 'Make another pipeline the default first'));
  await ctx.tx.pipelines.remove(id);
  return ok(undefined);
}

export async function removeChain(ctx: Ctx, id: string): Promise<Result<void>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  if ((await ctx.tx.chains.get(id)) === null) return err(failure('NOT_FOUND', 'No such chain'));
  await ctx.tx.chains.remove(id);
  return ok(undefined);
}

export async function removeQuestionnaire(ctx: Ctx, id: string): Promise<Result<void>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  if ((await ctx.tx.questionnaires.get(id)) === null)
    return err(failure('NOT_FOUND', 'No such questionnaire'));
  await ctx.tx.questionnaires.remove(id);
  return ok(undefined);
}

export async function removeScorecardTemplate(ctx: Ctx, id: string): Promise<Result<void>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  if ((await ctx.tx.scorecardTemplates.get(id)) === null)
    return err(failure('NOT_FOUND', 'No such scorecard'));
  await ctx.tx.scorecardTemplates.remove(id);
  return ok(undefined);
}

export async function removeTemplate(ctx: Ctx, id: string): Promise<Result<void>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  if ((await ctx.tx.templates.get(id)) === null)
    return err(failure('NOT_FOUND', 'No such template'));
  const used = (await ctx.tx.pipelines.list()).find((p) =>
    p.stages.some((s) => s.automations.some((a) => a.kind === 'email' && a.templateId === id)),
  );
  if (used !== undefined)
    return err(failure('IN_USE', `The pipeline “${used.name}” sends it; change that stage first`));
  await ctx.tx.templates.remove(id);
  return ok(undefined);
}

export async function removeBenefit(ctx: Ctx, id: string): Promise<Result<void>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  const held = await ctx.tx.benefits.get(id);
  if (held === null) return err(failure('NOT_FOUND', 'No such benefit'));
  if (held.statutory)
    return err(failure('STATUTORY', 'A statutory benefit comes from the country pack and stays'));
  await ctx.tx.benefits.remove(id);
  return ok(undefined);
}

export async function removePayBand(ctx: Ctx, id: string): Promise<Result<void>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  const held = await ctx.tx.payBands.get(id);
  if (held === null) return err(failure('NOT_FOUND', 'No such pay band'));
  if (held.source === 'people') return err(FROM_PEOPLE);
  await ctx.tx.payBands.remove(id);
  return ok(undefined);
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

/* ------------------------------------------------------- in words (AI) -- */

/**
 * Settings asked for in words (PRD §22.3, the AI decisions): "add a Berlin
 * office under Acme GmbH", "a pipeline for interns without an assessment".
 * The model only plans: it reads the names and ids the settings hold, never a
 * person, and proposes changes as the same inputs the commands take. Nothing
 * is written here; the administrator reads the proposal and applies it, and
 * every change then goes through its own command and its own checks.
 */

const Stage = z.object({
  id: z.uuid().nullable(),
  name: z.string().min(1).max(60),
  candidateName: z.string().max(60).nullable(),
  category: z.enum([
    'applied',
    'screening',
    'interview',
    'assessment',
    'works_council',
    'offer',
    'hired',
  ]),
});
const Approver = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('person'), personId: z.uuid() }),
  z.object({ kind: z.literal('role'), role: z.enum(['hr', 'finance', 'recruiting_admin']) }),
  z.object({ kind: z.literal('managers_manager') }),
]);
const Proposed = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('saveEntity'),
    id: z.uuid().nullable(),
    name: z.string().min(1).max(200),
    country: LaunchCountry,
    currency: z.string().length(3),
    worksCouncil: z.boolean(),
  }),
  z.object({
    op: z.literal('saveLocation'),
    id: z.uuid().nullable(),
    name: z.string().min(1).max(200),
    entityId: z.uuid().nullable(),
    country: LaunchCountry,
    city: z.string().max(120).nullable(),
    timeZone: z.string().min(1).max(60),
  }),
  z.object({
    op: z.literal('saveOrgUnit'),
    id: z.uuid().nullable(),
    name: z.string().min(1).max(200),
    parentId: z.uuid().nullable(),
  }),
  z.object({
    op: z.literal('savePipeline'),
    id: z.uuid().nullable(),
    name: z.string().min(1).max(120),
    isDefault: z.boolean(),
    stages: z.array(Stage).min(2).max(20),
  }),
  z.object({
    op: z.literal('saveChain'),
    id: z.uuid().nullable(),
    name: z.string().min(1).max(120),
    appliesTo: z.enum(['requisition', 'offer']),
    priority: z.int().min(0).max(100),
    budgetAboveMinor: z.int().nonnegative().nullable(),
    legalEntityIds: z.array(z.uuid()).max(20),
    steps: z.array(Approver).min(1).max(10),
  }),
  z.object({
    op: z.literal('saveBenefit'),
    id: z.string().max(80).nullable(),
    legalEntityId: z.uuid(),
    category: z.enum(BENEFIT_CATEGORIES),
    name: z.string().min(1).max(200),
    description: z.string().max(1000).nullable(),
    value: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('money'),
        yearlyMinor: z.int().nonnegative(),
        currency: z.string().length(3),
      }),
      z.object({ kind: z.literal('percent'), basisPoints: z.int().min(0).max(10_000) }),
      z.object({ kind: z.literal('days'), days: z.int().min(0).max(365) }),
      z.object({ kind: z.literal('descriptive') }),
    ]),
    waiting: z.enum(['none', 'after_probation']),
    taxNote: z.string().max(500).nullable(),
  }),
  z.object({
    op: z.literal('saveTemplate'),
    id: z.uuid().nullable(),
    kind: z.enum(['email', 'offer_letter', 'contract']),
    purpose: z.string().min(1).max(60),
    language: z.enum(['en', 'es', 'de', 'hi']),
    name: z.string().min(1).max(120),
    subject: z.string().max(200).nullable(),
    body: z.string().min(1).max(8000),
  }),
  z.object({
    op: z.literal('remove'),
    kind: z.enum([
      'entity',
      'location',
      'orgUnit',
      'pipeline',
      'chain',
      'questionnaire',
      'template',
      'benefit',
      'payBand',
    ]),
    id: z.string().max(80),
  }),
]);
const Plan = z.object({
  say: z.string().max(400),
  changes: z.array(Proposed).max(10),
});
export type ProposedChange = z.infer<typeof Proposed>;

const IN_WORDS: PromptSpec<z.infer<typeof Plan>> = {
  feature: 'assistant',
  version: 'settings-in-words@1',
  instruction: `You plan changes to a company's recruiting settings from a request in words. You never write anything yourself: return a JSON object {"say":"","changes":[...]} and an administrator will read and apply it.
"say" is one or two plain sentences on what you propose, or what you could not do and why. "changes" is a list of at most ten, each one of:
- {"op":"saveEntity","id":<existing id or null for a new one>,"name":"","country":"DE|ES|GB|IN|US","currency":"EUR|GBP|INR|USD","worksCouncil":false}
- {"op":"saveLocation","id":null|existing,"name":"","entityId":<entity id or null>,"country":"DE|ES|GB|IN|US","city":""|null,"timeZone":"<IANA zone>"}
- {"op":"saveOrgUnit","id":null|existing,"name":"","parentId":<department id or null>}
- {"op":"savePipeline","id":null|existing,"name":"","isDefault":false,"stages":[{"id":null|existing,"name":"","candidateName":""|null,"category":"applied|screening|interview|assessment|works_council|offer|hired"}]} — a pipeline starts at applied, ends at hired, has an offer, and never goes back a category.
- {"op":"saveChain","id":null|existing,"name":"","appliesTo":"requisition|offer","priority":10,"budgetAboveMinor":null|integer,"legalEntityIds":[],"steps":[{"kind":"role","role":"hr|finance|recruiting_admin"}|{"kind":"managers_manager"}|{"kind":"person","personId":"<id from members>"}]}
- {"op":"saveBenefit","id":null|existing,"legalEntityId":"<entity id>","category":"<one of the benefit categories>","name":"","description":""|null,"value":{"kind":"money","yearlyMinor":0,"currency":"EUR"}|{"kind":"percent","basisPoints":0}|{"kind":"days","days":0}|{"kind":"descriptive"},"waiting":"none|after_probation","taxNote":""|null}
- {"op":"saveTemplate","id":null|existing,"kind":"email|offer_letter|contract","purpose":"","language":"en|es|de|hi","name":"","subject":""|null,"body":""}
- {"op":"remove","kind":"entity|location|orgUnit|pipeline|chain|questionnaire|template|benefit|payBand","id":"<existing id>"}
Use the ids in "current" to change or remove what exists, and null for something new. Never invent an id. Rows marked "people" come from the People module and cannot be renamed or removed here: say so instead. A statutory benefit cannot be removed. Keep names as the person wrote them. When the request is unclear or outside these settings, return no changes and say why.`,
  answer: Plan,
};

export interface SettingsPlan {
  readonly say: string;
  readonly changes: readonly { readonly change: ProposedChange; readonly summary: string }[];
}

export async function settingsInWords(
  ctx: Ctx,
  input: { readonly text: string },
): Promise<Result<SettingsPlan>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  const text = input.text.trim();
  if (text.length < 3) return err(failure('INVALID', 'Say what to change'));
  const entities = await ctx.tx.entities.list();
  const current = {
    entities: entities.map((e) => ({
      id: e.id,
      name: e.name,
      country: e.country,
      currency: e.currency,
      source: e.source ?? 'recruiting',
    })),
    locations: (await ctx.tx.locations.list()).map((l) => ({
      id: l.id,
      name: l.name,
      entityId: l.entityId,
      country: l.country,
      source: l.source ?? 'recruiting',
    })),
    departments: (await ctx.tx.orgUnits.list()).map((u) => ({
      id: u.id,
      name: u.name,
      parentId: u.parentId,
      source: u.source ?? 'recruiting',
    })),
    pipelines: (await ctx.tx.pipelines.list()).map((p) => ({
      id: p.id,
      name: p.name,
      isDefault: p.isDefault,
      stages: p.stages.map((s) => ({ id: s.id, name: s.name, category: s.category })),
    })),
    chains: (await ctx.tx.chains.list()).map((c) => ({
      id: c.id,
      name: c.name,
      appliesTo: c.appliesTo,
    })),
    questionnaires: (await ctx.tx.questionnaires.list()).map((q) => ({ id: q.id, name: q.name })),
    templates: (await ctx.tx.templates.list()).map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      purpose: t.purpose,
      language: t.language,
    })),
    benefits: (await ctx.tx.benefits.list()).map((b) => ({
      id: b.id,
      name: b.names['en'] ?? Object.values(b.names)[0] ?? b.key,
      legalEntityId: b.legalEntityId,
      category: b.category,
      statutory: b.statutory,
    })),
    payBands: (await ctx.tx.payBands.list()).map((b) => ({
      id: b.id,
      grade: b.grade,
      source: b.source,
    })),
    // Names only, for a chain's "person" step: who they are stays in People.
    members: (await ctx.tx.members.list()).map((m) => ({ id: m.personId, name: m.displayName })),
    benefitCategories: BENEFIT_CATEGORIES,
  };
  const planned = await write(ctx, IN_WORDS, { request: text, current });
  if (!planned.ok) return planned;
  const named = (id: string | null, list: readonly { id: string; name: string }[]): string =>
    list.find((x) => x.id === id)?.name ?? id ?? '';
  const changes = planned.value.changes.map((raw) => {
    // A new row gets its id here, so what is applied is exactly what was shown.
    const change: ProposedChange =
      'id' in raw && raw.id === null && raw.op !== 'remove'
        ? { ...raw, id: ctx.deps.newId() }
        : raw;
    const verb = 'id' in raw && raw.id === null ? 'Add' : 'Change';
    const summary = ((): string => {
      switch (change.op) {
        case 'saveEntity':
          return `${verb} legal entity ${change.name} (${change.country}, ${change.currency})`;
        case 'saveLocation':
          return `${verb} location ${change.name}${change.entityId === null ? '' : ` under ${named(change.entityId, current.entities)}`}`;
        case 'saveOrgUnit':
          return `${verb} department ${change.name}${change.parentId === null ? '' : ` under ${named(change.parentId, current.departments)}`}`;
        case 'savePipeline':
          return `${verb} pipeline ${change.name}: ${change.stages.map((s) => s.name).join(' → ')}${change.isDefault ? ' (default)' : ''}`;
        case 'saveChain':
          return `${verb} ${change.appliesTo} approval chain ${change.name}, ${String(change.steps.length)} step${change.steps.length === 1 ? '' : 's'}`;
        case 'saveBenefit':
          return `${verb} benefit ${change.name} for ${named(change.legalEntityId, current.entities)}`;
        case 'saveTemplate':
          return `${verb} ${change.kind.replaceAll('_', ' ')} template ${change.name} (${change.language.toUpperCase()})`;
        case 'remove': {
          const lists: Record<typeof change.kind, readonly { id: string; name: string }[]> = {
            entity: current.entities,
            location: current.locations,
            orgUnit: current.departments,
            pipeline: current.pipelines,
            chain: current.chains,
            questionnaire: current.questionnaires,
            template: current.templates,
            benefit: current.benefits,
            payBand: current.payBands.map((b) => ({ id: b.id, name: b.grade })),
          };
          return `Remove ${change.kind === 'orgUnit' ? 'department' : change.kind === 'payBand' ? 'pay band' : change.kind} ${named(change.id, lists[change.kind])}`;
        }
      }
    })();
    return { change, summary };
  });
  return ok({ say: planned.value.say, changes });
}
