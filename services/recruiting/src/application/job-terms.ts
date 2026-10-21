import * as z from 'zod';
import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { WorkMode } from '@kithena/contracts';

import { packFor } from '../domain/terms/packs.js';
import type {
  Choice,
  ContractTypeChoice,
  EntityFacts,
  MinimumLeave,
  TermsAnswers,
} from '../domain/terms/pack.js';
import { write, type PromptSpec } from './ai.js';
import type { Ctx } from './context.js';
import { editable, refreshProjection } from './jobs.js';
import type { Entity, JobRecord, Location } from './ports.js';

/**
 * A job's terms, set in order (R4, PRD §19.2): where the work is, then what
 * kind of work, then the contracts the law of that country allows for it,
 * then the hours and days, the leave, and the benefits. Each step's choices
 * come from the ones before it, through the country's pack, so nothing can be
 * offered that the law there does not allow; change an earlier choice and
 * the later ones that no longer fit are cleared, never left wrong.
 */

export interface JobTerms {
  readonly entityId: string | null;
  readonly locationId: string | null;
  readonly workMode: WorkMode | null;
  /** Hybrid: days a week on site. */
  readonly hybridDaysOnsite: number | null;
  readonly relationship: string | null;
  readonly contractType: string | null;
  readonly fixedTermReason: string | null;
  /** ISO weekdays worked, Monday 1. */
  readonly workDays: readonly number[];
  /** Minutes after midnight, the place's own time. */
  readonly dayStart: number | null;
  readonly dayEnd: number | null;
  /** Unpaid, inside the day. */
  readonly breakMinutes: number;
  readonly vacationDays: number | null;
  /** One figure, or a range from and to; the figures are the job's salary. */
  readonly payKind: 'fixed' | 'range' | null;
  /** Chosen from the entity's catalogue; its statutory benefits are always in. */
  readonly benefitIds: readonly string[];
}

/** What a save may carry beyond the terms: the pay itself, yearly, in the entity's currency. */
export interface TermsPatch extends Partial<JobTerms> {
  readonly pay?: { readonly minMinor: number; readonly maxMinor: number } | null | undefined;
  readonly salaryShown?: boolean | undefined;
}

export interface TermsOptions {
  readonly country: string | null;
  readonly entities: readonly { id: string; name: string; country: string; currency: string }[];
  readonly locations: readonly { id: string; name: string; city: string | null; country: string }[];
  readonly relationships: readonly Choice[];
  readonly contractTypes: readonly (Pick<ContractTypeChoice, 'key' | 'label' | 'fixedTerm'> & {
    readonly unavailable: string | null;
    readonly note: string | null;
  })[];
  readonly currency: string | null;
  /** The lowest lawful yearly pay at these hours, minor units; null where the law sets none. */
  readonly minimumPayMinor: number | null;
  readonly fixedTermReasons: readonly Choice[];
  readonly maxWeeklyMinutes: number | null;
  readonly fullTimeWeeklyMinutes: number | null;
  readonly weeklyMinutes: number | null;
  readonly hours: 'full_time' | 'part_time' | null;
  readonly leave: MinimumLeave | null;
  readonly benefits: readonly { id: string; name: string; category: string; statutory: boolean }[];
  /** The pack is awaiting a country reviewer (REC-150): said beside the choices. */
  readonly reviewed: boolean;
}

const key = (jobId: string): string => `job-terms:${jobId}`;

const EMPTY: JobTerms = {
  entityId: null,
  locationId: null,
  workMode: null,
  hybridDaysOnsite: null,
  relationship: null,
  contractType: null,
  fixedTermReason: null,
  workDays: [],
  dayStart: null,
  dayEnd: null,
  breakMinutes: 60,
  vacationDays: null,
  payKind: null,
  benefitIds: [],
};

export async function termsOf(ctx: Ctx, job: JobRecord): Promise<JobTerms> {
  const held = (await ctx.tx.settings.get(key(job.id))) as Partial<JobTerms> | null;
  return {
    ...EMPTY,
    entityId: job.entityId,
    locationId: job.locationIds[0] ?? null,
    workMode: job.workMode,
    benefitIds: job.benefitIds,
    payKind:
      job.salary === null ? null : job.salary.minMinor === job.salary.maxMinor ? 'fixed' : 'range',
    ...held,
  };
}

const factsOf = (entity: Entity): EntityFacts => ({
  legalEntityId: entity.id,
  country: entity.country,
  currency: entity.currency,
  fullTimeWeeklyMinutes: entity.fullTimeWeeklyMinutes,
  headcount: entity.headcount,
  foundedOn: entity.foundedOn,
  hasWorksCouncil: entity.worksCouncil,
});

/** Paid minutes a week: the days worked, each from start to end less its break. */
export function weeklyMinutesOf(terms: JobTerms): number | null {
  if (terms.dayStart === null || terms.dayEnd === null || terms.workDays.length === 0) return null;
  return terms.workDays.length * Math.max(0, terms.dayEnd - terms.dayStart - terms.breakMinutes);
}

const benefitName = (names: Readonly<Record<string, string>>): string =>
  names['en'] ?? Object.values(names)[0] ?? '';

/** What each step may offer, from the choices before it. */
export async function termsOptions(ctx: Ctx, terms: JobTerms): Promise<TermsOptions> {
  const entities = await ctx.tx.entities.list();
  const entity = entities.find((e) => e.id === terms.entityId) ?? null;
  const locations: readonly Location[] =
    entity === null
      ? []
      : (await ctx.tx.locations.list()).filter(
          (l) => l.country === entity.country && (l.entityId === null || l.entityId === entity.id),
        );
  const location = locations.find((l) => l.id === terms.locationId) ?? null;
  const pack = entity === null ? null : packFor(entity.country);
  const facts = entity === null ? null : factsOf(entity);
  const weekly = weeklyMinutesOf(terms);
  const answers: TermsAnswers = {
    region: location?.region ?? null,
    ...(terms.relationship === null
      ? {}
      : { relationship: terms.relationship as NonNullable<TermsAnswers['relationship']> }),
    ...(terms.contractType === null ? {} : { contractType: terms.contractType }),
    ...(terms.workMode === null ? {} : { workMode: terms.workMode }),
    ...(weekly === null ? {} : { weeklyMinutes: weekly }),
  };
  const ready = pack !== null && facts !== null && location !== null && terms.workMode !== null;
  const types = ready && terms.relationship !== null ? pack.contractTypes(answers, facts) : [];
  const limits =
    ready && terms.contractType !== null ? pack.limits(answers, facts, ctx.today) : null;
  return {
    country: entity?.country ?? null,
    entities: entities.map((e) => ({
      id: e.id,
      name: e.name,
      country: e.country,
      currency: e.currency,
    })),
    locations: locations.map((l) => ({ id: l.id, name: l.name, city: l.city, country: l.country })),
    relationships: ready ? pack.relationships() : [],
    contractTypes: types.map((t) => ({
      key: t.key,
      label: t.label,
      fixedTerm: t.fixedTerm,
      unavailable: t.unavailable ?? null,
      note: t.note ?? null,
    })),
    currency: entity?.currency ?? null,
    minimumPayMinor:
      ready && terms.contractType !== null && weekly !== null
        ? pack.minimumAnnualPayMinor(answers, facts, ctx.today)
        : null,
    fixedTermReasons:
      ready && types.find((t) => t.key === terms.contractType)?.fixedTerm === true
        ? pack.fixedTermReasons(answers)
        : [],
    maxWeeklyMinutes: limits?.maxWeeklyMinutes ?? null,
    fullTimeWeeklyMinutes: entity?.fullTimeWeeklyMinutes ?? null,
    weeklyMinutes: weekly,
    hours:
      weekly === null || entity === null
        ? null
        : weekly >= entity.fullTimeWeeklyMinutes
          ? 'full_time'
          : 'part_time',
    leave:
      ready && terms.relationship !== null
        ? pack.minimumLeave(answers, Math.max(1, terms.workDays.length || 5))
        : null,
    benefits:
      entity === null
        ? []
        : (await ctx.tx.benefits.list())
            .filter((b) => b.legalEntityId === entity.id)
            .map((b) => ({
              id: b.id,
              name: benefitName(b.names),
              category: b.category,
              statutory: b.statutory,
            })),
    reviewed: pack?.reviewed ?? true,
  };
}

/** The job's terms and what each step may offer: the wizard's read. */
export async function jobTerms(
  ctx: Ctx,
  job: JobRecord,
): Promise<{ terms: JobTerms; options: TermsOptions }> {
  const terms = await termsOf(ctx, job);
  return { terms, options: await termsOptions(ctx, terms) };
}

const refused = (code: string, message: string): Result<never> => err(failure(code, message));

/**
 * Save a change to the terms. The changed choice must be one its step
 * offers; every later choice that the change makes impossible is cleared,
 * in order, so the steps after it ask again. The job's record follows: its
 * entity, place, work mode, contract and hours as the ad shows them.
 */
export async function saveJobTerms(
  ctx: Ctx,
  jobId: string,
  input: TermsPatch,
): Promise<Result<{ terms: JobTerms; options: TermsOptions }>> {
  const held = await editable(ctx, jobId);
  if (!held.ok) return held;
  const job = held.value;
  const before = await termsOf(ctx, job);
  const { pay, salaryShown, ...patch } = input;
  let terms: JobTerms = { ...before, ...patch };

  // Where: the entity, a place of it in its country, and how the work is done.
  if (patch.entityId !== undefined && patch.entityId !== before.entityId)
    terms = {
      ...terms,
      locationId: patch.locationId ?? null,
      relationship: null,
      contractType: null,
      fixedTermReason: null,
      vacationDays: null,
      benefitIds: [],
    };
  let options = await termsOptions(ctx, terms);
  if (terms.entityId !== null && !options.entities.some((e) => e.id === terms.entityId))
    return refused('ENTITY', 'Choose one of the company’s legal entities');
  if (terms.locationId !== null && !options.locations.some((l) => l.id === terms.locationId)) {
    if (patch.locationId !== undefined)
      return refused('LOCATION', 'Choose a workplace of that entity, in its country');
    terms = { ...terms, locationId: null };
  }
  if (terms.workMode !== 'hybrid') terms = { ...terms, hybridDaysOnsite: null };
  else if (
    terms.hybridDaysOnsite !== null &&
    (terms.hybridDaysOnsite < 1 || terms.hybridDaysOnsite > 4)
  )
    return refused('HYBRID_DAYS', 'A hybrid week has one to four days on site');

  // What kind of work, and the contracts that country allows for it.
  options = await termsOptions(ctx, terms);
  if (
    terms.relationship !== null &&
    !options.relationships.some((r) => r.key === terms.relationship)
  ) {
    if (patch.relationship !== undefined)
      return refused('RELATIONSHIP', 'Choose a kind of work this country recognises');
    terms = { ...terms, relationship: null };
  }
  options = await termsOptions(ctx, terms);
  const type = options.contractTypes.find((t) => t.key === terms.contractType);
  if (terms.contractType !== null && (type === undefined || type.unavailable !== null)) {
    if (patch.contractType !== undefined)
      return refused(
        'CONTRACT_TYPE',
        type?.unavailable ?? 'Choose a contract this country allows for this kind of work',
      );
    terms = { ...terms, contractType: null, fixedTermReason: null };
  }
  options = await termsOptions(ctx, terms);
  if (
    terms.fixedTermReason !== null &&
    !options.fixedTermReasons.some((r) => r.key === terms.fixedTermReason)
  )
    terms = { ...terms, fixedTermReason: null };

  // Hours and days, within the law's week.
  if (terms.workDays.some((d) => !Number.isInteger(d) || d < 1 || d > 7))
    return refused('WORK_DAYS', 'Work days are Monday to Sunday');
  terms = { ...terms, workDays: [...new Set(terms.workDays)].toSorted((a, b) => a - b) };
  if (terms.dayStart !== null && terms.dayEnd !== null && terms.dayEnd <= terms.dayStart)
    return refused('DAY_ORDER', 'The working day ends after it starts');
  if (terms.breakMinutes < 0 || terms.breakMinutes > 240)
    return refused('BREAK', 'A break is between none and four hours');
  options = await termsOptions(ctx, terms);
  if (
    options.weeklyMinutes !== null &&
    options.maxWeeklyMinutes !== null &&
    options.weeklyMinutes > options.maxWeeklyMinutes
  )
    return refused(
      'HOURS_MAX',
      `That is ${String(options.weeklyMinutes / 60)} hours a week; the law there allows ${String(options.maxWeeklyMinutes / 60)}`,
    );

  // Leave: never below the country's minimum for this kind of work.
  if (
    terms.vacationDays !== null &&
    options.leave !== null &&
    terms.vacationDays < options.leave.days
  ) {
    if (patch.vacationDays !== undefined)
      return refused(
        'LEAVE_MIN',
        `At least ${String(options.leave.days)} ${options.leave.unit === 'calendar_days' ? 'calendar' : 'working'} days (${options.leave.source})`,
      );
    terms = { ...terms, vacationDays: options.leave.days };
  }

  // Benefits: the entity's own, its statutory ones always in.
  const known = new Set(options.benefits.map((b) => b.id));
  if (terms.benefitIds.some((id) => !known.has(id)))
    return refused('BENEFIT', 'Choose benefits from this entity’s catalogue');
  terms = {
    ...terms,
    benefitIds: [
      ...new Set([
        ...options.benefits.filter((b) => b.statutory).map((b) => b.id),
        ...terms.benefitIds,
      ]),
    ],
  };

  // Pay: one figure or a range, yearly, never below the law's minimum at these hours.
  let salary = job.salary;
  if (pay === null) salary = null;
  else if (pay !== undefined) {
    if (options.currency === null)
      return refused('ENTITY', 'Choose the employing entity first: it sets the currency');
    if (!Number.isInteger(pay.minMinor) || pay.minMinor <= 0 || pay.maxMinor < pay.minMinor)
      return refused('PAY_ORDER', 'The pay is above zero, and a range ends above where it starts');
    if (terms.payKind === 'fixed' && pay.maxMinor !== pay.minMinor)
      return refused('PAY_FIXED', 'A fixed salary is one figure');
    if (options.minimumPayMinor !== null && pay.minMinor < options.minimumPayMinor)
      return refused(
        'PAY_MIN',
        `Below the legal minimum for these hours: ${String(Math.ceil(options.minimumPayMinor / 100))} ${options.currency} a year`,
      );
    salary = { ...pay, currency: options.currency, period: 'year' };
  }
  if (terms.payKind === 'fixed' && salary !== null && salary.maxMinor !== salary.minMinor)
    salary = { ...salary, maxMinor: salary.minMinor };
  if (salary !== null && options.currency !== null && salary.currency !== options.currency)
    salary = null;

  await ctx.tx.settings.set(key(jobId), terms);
  const location = terms.locationId === null ? null : await ctx.tx.locations.get(terms.locationId);
  const contract = options.contractTypes.find((t) => t.key === terms.contractType);
  const next: JobRecord = {
    ...job,
    entityId: terms.entityId,
    locationIds: terms.locationId === null ? [] : [terms.locationId],
    countries: location === null ? job.countries : [location.country],
    ...(terms.workMode === null ? {} : { workMode: terms.workMode }),
    outline: {
      ...job.outline,
      contractType: contract?.label ?? job.outline.contractType,
      hours: options.hours ?? job.outline.hours,
    },
    benefitIds: terms.benefitIds,
    salary,
    ...(salaryShown === undefined ? {} : { salaryShown }),
  };
  await ctx.tx.jobs.save(next);
  await refreshProjection(ctx, next);
  return ok({ terms, options });
}

const PayEstimate = z.object({
  low: z.number().nonnegative(),
  median: z.number().nonnegative(),
  high: z.number().nonnegative(),
  basis: z.string().max(400),
  confidence: z.enum(['low', 'medium', 'high']),
});

const PAY: PromptSpec<z.infer<typeof PayEstimate>> = {
  feature: 'writer',
  version: 'pay-estimate@1',
  instruction: `You estimate the market pay for a job from the salary surveys, collective agreements and job-board data you know for that place. Return a JSON object {"low":0,"median":0,"high":0,"basis":"","confidence":"low"|"medium"|"high"}: gross yearly base pay in the currency given, in whole units (not cents), for the weekly hours given, in that city and country, as the 25th percentile, the median and the 75th percentile. "basis" says in one or two sentences which kind of data it rests on and how sure it is; never invent a named source. Leave out bonus, equity and benefits.`,
  answer: PayEstimate,
};

/** To the nearest step a person would write in an ad: 500 below 100k, 1,000 above. */
const tidy = (minor: number): number => {
  const step = minor >= 10_000_000 ? 100_000 : 50_000;
  return Math.round(minor / step) * step;
};

/**
 * R4: the pay the market gives for this job, in this place, at these hours,
 * as a model estimates it, for a person to keep or change. A fixed salary is
 * the median; a range is the middle half. Never below the legal minimum,
 * which the domain sets, not the model.
 */
export async function suggestPay(
  ctx: Ctx,
  jobId: string,
  kind: 'fixed' | 'range',
): Promise<
  Result<{
    readonly kind: 'fixed' | 'range';
    readonly minMinor: number;
    readonly maxMinor: number;
    readonly currency: string;
    readonly basis: string;
    readonly confidence: 'low' | 'medium' | 'high';
  }>
> {
  const held = await editable(ctx, jobId);
  if (!held.ok) return held;
  const job = held.value;
  const terms = await termsOf(ctx, job);
  const options = await termsOptions(ctx, terms);
  const location = terms.locationId === null ? null : await ctx.tx.locations.get(terms.locationId);
  if (options.currency === null || location === null)
    return refused('WORKPLACE', 'Choose the workplace first: pay depends on where the work is');
  const contract = options.contractTypes.find((t) => t.key === terms.contractType);
  const estimated = await write(ctx, PAY, {
    title: job.title,
    seniority: job.outline.seniority,
    department: job.department,
    city: location.city,
    region: location.region,
    country: location.country,
    workMode: terms.workMode,
    contract: contract?.label ?? null,
    weeklyHours: options.weeklyMinutes === null ? 40 : options.weeklyMinutes / 60,
    currency: options.currency,
  });
  if (!estimated.ok) return estimated;
  const [low, median, high] = [estimated.value.low, estimated.value.median, estimated.value.high]
    .map((n) => tidy(Math.round(n * 100)))
    .map((n) => Math.max(n, options.minimumPayMinor ?? 0))
    .toSorted((a, b) => a - b) as [number, number, number];
  if (median <= 0) return refused('AI_UNAVAILABLE', 'The assistant could not estimate this pay');
  return ok({
    kind,
    minMinor: kind === 'fixed' ? median : low,
    maxMinor: kind === 'fixed' ? median : high,
    currency: options.currency,
    basis: estimated.value.basis,
    confidence: estimated.value.confidence,
  });
}
