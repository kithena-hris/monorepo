import { Decimal } from 'decimal.js';
import {
  ResolvedTerms,
  type CalendarDate,
  type ConditionKind,
  type LaunchCountry,
  type PeopleEmploymentType,
  type Relationship,
  type TermLength,
  type TermsIssue,
  type TermsStep,
  type WorkMode,
} from '@kithena/contracts';
import { err, ok, type Result } from '@kithena/domain-kit';

import { addDays, addMonths, monthsCovered } from '../dates.js';

/**
 * The terms pack framework (Recruiting PRD §19.1–§19.3, REC-024).
 *
 * A pack is a country's employment law as data plus pure functions: which
 * choices are offered for the answers given so far (and why the others are
 * not), the limits on every number, the defaults, the documents and
 * conditions a contract needs, and the country's own checks. The framework
 * runs what every country shares: an answer must be one of the options, a
 * number within its limits, pay at least the minimum.
 *
 * Code, not configuration, because the rules are logic ("probation at most
 * half of a fixed term under 12 months"). A tenant cannot loosen a pack; it
 * may set stricter defaults, which arrive as `TenantTermsValues`.
 */

/** What the composer has been told so far. Every field is optional until its step. */
export interface TermsAnswers {
  readonly region?: string | null;
  readonly relationship?: Relationship;
  readonly contractType?: string;
  readonly fixedTermReason?: string | null;
  /** DE § 14(2) s. 2, ES art. 14: did this person work for this employer before? */
  readonly previouslyEmployed?: boolean;
  readonly contractStart?: CalendarDate;
  readonly contractEnd?: CalendarDate | null;
  readonly weeklyMinutes?: number;
  readonly probation?: TermLength | null;
  readonly noticeEmployee?: TermLength;
  readonly noticeEmployer?: TermLength;
  readonly workMode?: WorkMode;
  readonly hybridDaysOnsite?: number | null;
  readonly remoteCountry?: string | null;
  /** DE: mobile work or Telearbeit (Arbeitsstättenverordnung applies to the latter). */
  readonly remoteKind?: 'mobile' | 'telearbeit' | null;
  readonly agreement?: { readonly key: string; readonly group: string | null } | null;
  /** Gross yearly base at the hours given, in the entity's currency's minor units. */
  readonly annualPayMinor?: number;
  readonly paymentsPerYear?: number;
  /** US: exempt from overtime under the FLSA. */
  readonly exempt?: boolean | null;
  /** ES probation: a qualified technician or not (art. 14 ET). */
  readonly roleGroup?: 'qualified' | 'other' | null;
  readonly benefitIds?: readonly string[];
  readonly nonCompeteMonths?: number | null;
  /** DE §§ 74 ff. HGB: compensation during the restraint, as a share of last pay. */
  readonly nonCompeteCompensationPercent?: number | null;
  readonly mobilityClause?: boolean;
}

/** What the legal entity contributes (step 1). */
export interface EntityFacts {
  readonly legalEntityId: string;
  readonly country: LaunchCountry;
  readonly currency: string;
  /** The entity's full-time week, for FTE. */
  readonly fullTimeWeeklyMinutes: number;
  readonly headcount: number;
  /** DE § 14(2a): a company in its first four years may fix terms for longer. */
  readonly foundedOn: CalendarDate | null;
  readonly hasWorksCouncil: boolean;
}

export interface Choice {
  readonly key: string;
  readonly label: string;
  /** Why it is not offered for these answers; absent when it is. */
  readonly unavailable?: string;
  /** What it means there, in a line: shown beside the choice so it is made knowingly. */
  readonly note?: string;
}

/** Each choice with its line from the country's notes, where it has one. */
export const withNotes = <T extends Choice>(
  choices: readonly T[],
  notes: Readonly<Record<string, string>>,
): T[] =>
  choices.map((c) => {
    const note = notes[c.key];
    return note === undefined ? c : { ...c, note };
  });

export interface ContractTypeChoice extends Choice {
  readonly employmentType: PeopleEmploymentType;
  readonly relationship: Relationship;
  readonly fixedTerm: boolean;
}

export interface Limits {
  /** A fixed term's length, in months; null when the type has no end. */
  readonly durationMonths: { readonly min: number; readonly max: number | null } | null;
  readonly maxWeeklyMinutes: number;
  readonly probation: {
    readonly allowed: boolean;
    readonly required: boolean;
    readonly max: TermLength | null;
    readonly default: TermLength | null;
  };
  readonly noticeEmployee: TermLength;
  readonly noticeEmployer: TermLength;
}

/** One rule in words, for the composer's side panel (PRD §19.2). */
export interface Rule {
  readonly step: TermsStep;
  readonly text: string;
  readonly source: string;
}

export interface TermsPack {
  readonly country: LaunchCountry;
  readonly version: string;
  /** False until the pack is signed off (REC-150); the screens say so beside its choices. */
  readonly reviewed: boolean;
  readonly regions: readonly Choice[];
  readonly regionRequired: boolean;
  relationships(): readonly Choice[];
  contractTypes(answers: TermsAnswers, entity: EntityFacts): readonly ContractTypeChoice[];
  fixedTermReasons(answers: TermsAnswers): readonly Choice[];
  /** Whether the step asks "did they work here before?" */
  asksPreviousEmployment(answers: TermsAnswers): boolean;
  agreementRequired(entity: EntityFacts): boolean;
  limits(answers: TermsAnswers, entity: EntityFacts, on: CalendarDate): Limits;
  paymentsPerYear(answers: TermsAnswers): readonly number[];
  /**
   * The lowest lawful yearly pay at the hours in the answers, minor units;
   * null where none applies.
   */
  minimumAnnualPayMinor(
    answers: TermsAnswers,
    entity: EntityFacts,
    on: CalendarDate,
  ): number | null;
  nonCompete(answers: TermsAnswers): {
    readonly allowed: boolean;
    readonly reason: string;
    readonly maxMonths: number;
  };
  rules(answers: TermsAnswers, entity: EntityFacts): readonly Rule[];
  /** The country's own checks, beyond the framework's. */
  check(answers: TermsAnswers, entity: EntityFacts, on: CalendarDate): readonly TermsIssue[];
  documents(answers: TermsAnswers): readonly string[];
  conditions(answers: TermsAnswers): readonly ConditionKind[];
  signature(answers: TermsAnswers): 'electronic' | 'wet_ink';
  /**
   * The lowest lawful paid leave a year for someone working `daysPerWeek`
   * days, in the unit the law counts it: 0 where no law sets one, and always
   * 0 for the self-employed. A company may give more, never less.
   */
  minimumLeave(answers: Pick<TermsAnswers, 'relationship'>, daysPerWeek: number): MinimumLeave;
}

export interface MinimumLeave {
  readonly days: number;
  readonly unit: 'working_days' | 'calendar_days';
  /** The law it comes from, to show beside the number. */
  readonly source: string;
  readonly note: string;
}

/** A minimum written in weeks of the person's own week: weeks × days a week, rounded up, at most `cap`. */
export const weeksOfLeave = (
  weeks: number,
  daysPerWeek: number,
  cap: number | null = null,
): number => {
  const days = Math.ceil(Math.round(weeks * daysPerWeek * 10) / 10);
  return cap === null ? days : Math.min(days, cap);
};

/** No paid-leave minimum: the self-employed, or a country with none. */
export const noLeave = (source: string, note: string): MinimumLeave => ({
  days: 0,
  unit: 'working_days',
  source,
  note,
});

/* ------------------------------------------------------------ helpers -- */

export const issue = (
  step: TermsStep,
  code: string,
  source: string,
  message: string,
  severity: 'error' | 'warning' = 'error',
): TermsIssue => ({ step, code, source, message, severity });

/** A length in days, for comparing lengths written in different units. */
export function lengthDays(length: TermLength): number {
  return length.unit === 'days'
    ? length.count
    : length.unit === 'weeks'
      ? length.count * 7
      : length.count * 30;
}

export const len = (count: number, unit: TermLength['unit']): TermLength => ({ count, unit });

export const lengthText = (length: TermLength): string =>
  `${String(length.count)} ${length.count === 1 ? length.unit.replace(/s$/u, '') : length.unit}`;

/** The last day of a period that starts on `start` and runs `length`. */
export function endOf(start: CalendarDate, length: TermLength): CalendarDate {
  if (length.unit === 'months') return addDays(addMonths(start, length.count), -1);
  return addDays(start, (length.unit === 'weeks' ? 7 : 1) * length.count - 1);
}

/** FTE to four places, never above 1. */
export function fteOf(weeklyMinutes: number, fullTimeWeeklyMinutes: number): string {
  const fte = Decimal.min(new Decimal(weeklyMinutes).div(fullTimeWeeklyMinutes), 1);
  return fte.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

/** A yearly figure scaled to the hours worked: minimum pay for a part-time week. */
export function scaledMinor(fullTimeMinor: number, fte: string): number {
  return new Decimal(fullTimeMinor).mul(fte).toDecimalPlaces(0, Decimal.ROUND_CEIL).toNumber();
}

/** An hourly rate in minor units over a year at the given week. */
export const yearlyFromHourly = (hourlyMinor: number, weeklyMinutes: number): number =>
  new Decimal(hourlyMinor)
    .mul(weeklyMinutes)
    .div(60)
    .mul(52)
    .toDecimalPlaces(0, Decimal.ROUND_CEIL)
    .toNumber();

/** The value of a dated table on a date: the last row whose start is on or before it. */
export const onDate = (table: readonly (readonly [string, number])[], on: string): number =>
  table.filter(([from]) => from <= on).at(-1)?.[1] ?? (table[0] as readonly [string, number])[1];

/* ------------------------------------------------------------ the run -- */

export interface Validated {
  readonly terms: ResolvedTerms;
  /** Read and confirmed by a person; they do not block. */
  readonly warnings: readonly TermsIssue[];
}

const offered = (choices: readonly Choice[], key: string | undefined | null): Choice | undefined =>
  key == null ? undefined : choices.find((choice) => choice.key === key);

/**
 * Every issue a set of answers has against a pack on a date, errors and
 * warnings both. The composer shows them as they arise; `validateTerms` turns
 * them into a result.
 */
export function termsIssues(
  pack: TermsPack,
  answers: TermsAnswers,
  entity: EntityFacts,
  on: CalendarDate,
): TermsIssue[] {
  const out: TermsIssue[] = [];
  const law = (step: TermsStep, code: string, message: string, source = 'framework') =>
    out.push(issue(step, code, source, message));

  if (entity.country !== pack.country) {
    law(
      'entity',
      'wrong_pack',
      `This entity is in ${entity.country}; the ${pack.country} pack cannot decide its terms`,
    );
    return out;
  }
  if (
    pack.regionRequired &&
    (answers.region == null || offered(pack.regions, answers.region) === undefined)
  ) {
    law('location', 'region_required', 'Choose the region the person works in; its law applies');
  }
  const relationship = offered(pack.relationships(), answers.relationship);
  if (relationship === undefined)
    law('relationship', 'relationship_required', 'Choose the relationship');

  const type = pack.contractTypes(answers, entity).find((t) => t.key === answers.contractType);
  if (type === undefined) {
    law('contract_type', 'type_required', 'Choose a contract type this country offers');
  } else if (type.unavailable !== undefined) {
    law('contract_type', 'type_unavailable', type.unavailable);
  }

  const start = answers.contractStart;
  if (start === undefined) law('duration', 'start_required', 'Give the start date');

  const limits = pack.limits(answers, entity, on);
  if (type?.fixedTerm === true) {
    const reasons = pack.fixedTermReasons(answers);
    if (reasons.length > 0) {
      const reason = offered(reasons, answers.fixedTermReason);
      if (reason === undefined)
        law('fixed_term_reason', 'reason_required', 'A fixed term here needs its reason');
      else if (reason.unavailable !== undefined)
        law('fixed_term_reason', 'reason_unavailable', reason.unavailable);
    }
    if (answers.contractEnd == null) {
      law('duration', 'end_required', 'A fixed-term contract needs its end date');
    } else if (start !== undefined) {
      if (answers.contractEnd < start)
        law('duration', 'end_before_start', 'The end is before the start');
      const months = monthsCovered(start, answers.contractEnd);
      const range = limits.durationMonths;
      if (range !== null && months < range.min) {
        law('duration', 'too_short', `At least ${String(range.min)} months for this type`);
      }
      if (range?.max != null && months > range.max) {
        law('duration', 'too_long', `At most ${String(range.max)} months for this type`);
      }
    }
  } else if (type !== undefined && answers.contractEnd != null) {
    law('duration', 'end_on_open_ended', 'This type has no end date');
  }

  const minutes = answers.weeklyMinutes;
  if (minutes === undefined || minutes <= 0) {
    law('hours', 'hours_required', 'Give the weekly hours');
  } else if (minutes > limits.maxWeeklyMinutes) {
    law(
      'hours',
      'hours_above_maximum',
      `At most ${String(limits.maxWeeklyMinutes / 60)} hours a week`,
    );
  }

  const probation = answers.probation ?? null;
  if (probation !== null && !limits.probation.allowed) {
    law('probation', 'probation_not_allowed', 'This contract cannot have a probation period');
  } else if (probation === null && limits.probation.required) {
    law('probation', 'probation_required', 'This contract must have a probation period');
  } else if (
    probation !== null &&
    limits.probation.max !== null &&
    lengthDays(probation) > lengthDays(limits.probation.max)
  ) {
    law('probation', 'probation_too_long', `At most ${lengthText(limits.probation.max)}`);
  }

  for (const [side, given, min] of [
    ['employee', answers.noticeEmployee, limits.noticeEmployee],
    ['employer', answers.noticeEmployer, limits.noticeEmployer],
  ] as const) {
    if (given === undefined) law('notice', `notice_${side}_required`, `Give the ${side}'s notice`);
    else if (lengthDays(given) < lengthDays(min)) {
      law(
        'notice',
        `notice_${side}_too_short`,
        `The ${side}'s notice is at least ${lengthText(min)}`,
      );
    }
  }

  if (answers.workMode === undefined)
    law('work_mode', 'work_mode_required', 'Choose how the work is done');
  if (answers.workMode === 'hybrid' && answers.hybridDaysOnsite == null) {
    law('work_mode', 'hybrid_days_required', 'Say how many days a week are on site');
  }
  if (
    answers.workMode === 'remote' &&
    answers.remoteCountry != null &&
    answers.remoteCountry !== pack.country
  ) {
    out.push(
      issue(
        'work_mode',
        'remote_abroad',
        'OECD Model Tax Convention art. 5',
        'Working from another country can create tax, social security and permanent establishment duties there',
        'warning',
      ),
    );
  }

  if (pack.agreementRequired(entity) && answers.agreement == null) {
    law(
      'agreement',
      'agreement_required',
      'Name the collective agreement and the professional group',
    );
  }

  const payments = answers.paymentsPerYear ?? 12;
  if (!pack.paymentsPerYear(answers).includes(payments)) {
    law(
      'pay',
      'payments_not_offered',
      `Paid in ${pack.paymentsPerYear(answers).join(' or ')} payments here`,
    );
  }
  if (answers.annualPayMinor === undefined) {
    law('pay', 'pay_required', 'Give the base pay');
  } else if (minutes !== undefined && minutes > 0 && relationship?.key !== 'contractor') {
    const floor = pack.minimumAnnualPayMinor(answers, entity, on);
    if (floor !== null && answers.annualPayMinor < floor) {
      law('pay', 'below_minimum_wage', 'The pay is below the minimum wage for these hours');
    }
  }

  const months = answers.nonCompeteMonths ?? null;
  if (months !== null && months > 0) {
    const nonCompete = pack.nonCompete(answers);
    if (!nonCompete.allowed) law('clauses', 'non_compete_not_allowed', nonCompete.reason);
    else if (months > nonCompete.maxMonths) {
      law(
        'clauses',
        'non_compete_too_long',
        `A restraint lasts at most ${String(nonCompete.maxMonths)} months`,
      );
    }
  }

  out.push(...pack.check(answers, entity, on));
  return out;
}

/**
 * `validateTerms(pack, answers, entity, on)`: the terms, or every error
 * (PRD §19.3). Pure; runs in the composer, before an offer is approved and
 * sent, and before a contract is generated.
 */
export function validateTerms(
  pack: TermsPack,
  answers: TermsAnswers,
  entity: EntityFacts,
  on: CalendarDate,
): Result<Validated, readonly TermsIssue[]> {
  const issues = termsIssues(pack, answers, entity, on);
  const errors = issues.filter((found) => found.severity === 'error');
  if (errors.length > 0) return err(errors);
  const type = pack.contractTypes(answers, entity).find((t) => t.key === answers.contractType);
  // Every field below was checked by `termsIssues`; the parse re-proves it.
  const start = answers.contractStart as CalendarDate;
  const minutes = answers.weeklyMinutes as number;
  const probation = answers.probation ?? null;
  const fte = fteOf(minutes, entity.fullTimeWeeklyMinutes);
  const terms = ResolvedTerms.parse({
    country: pack.country,
    region: answers.region ?? null,
    packVersion: pack.version,
    relationship: answers.relationship,
    contractType: answers.contractType,
    employmentType: type?.employmentType,
    fixedTermReason: type?.fixedTerm === true ? (answers.fixedTermReason ?? null) : null,
    contractStart: start,
    contractEnd: type?.fixedTerm === true ? (answers.contractEnd ?? null) : null,
    workingPattern: fte === '1.0000' ? 'full_time' : 'part_time',
    weeklyMinutes: minutes,
    fte,
    probation,
    probationEnd: probation === null ? null : endOf(start, probation),
    noticeEmployee: answers.noticeEmployee,
    noticeEmployer: answers.noticeEmployer,
    workMode: answers.workMode,
    hybridDaysOnsite: answers.workMode === 'hybrid' ? (answers.hybridDaysOnsite ?? null) : null,
    remoteCountry: answers.workMode === 'remote' ? (answers.remoteCountry ?? null) : null,
    collectiveAgreement: answers.agreement ?? null,
    nonCompeteMonths: answers.nonCompeteMonths ?? null,
    mobilityClause: answers.mobilityClause ?? false,
    paymentsPerYear: answers.paymentsPerYear ?? 12,
    signature: pack.signature(answers),
    documents: [...pack.documents(answers)],
    conditions: [...pack.conditions(answers)],
  });
  return ok({ terms, warnings: issues.filter((found) => found.severity === 'warning') });
}

/* ----------------------------------------------------------- composer -- */

export type StepState = 'done' | 'open' | 'invalid' | 'skipped';

export interface ComposerStep {
  readonly step: TermsStep;
  readonly state: StepState;
  readonly issues: readonly TermsIssue[];
}

const answered: Record<TermsStep, (a: TermsAnswers) => boolean> = {
  entity: () => true,
  location: (a) => a.region !== undefined,
  relationship: (a) => a.relationship !== undefined,
  contract_type: (a) => a.contractType !== undefined,
  fixed_term_reason: (a) => a.fixedTermReason !== undefined,
  duration: (a) => a.contractStart !== undefined,
  hours: (a) => a.weeklyMinutes !== undefined,
  probation: (a) => a.probation !== undefined,
  notice: (a) => a.noticeEmployee !== undefined && a.noticeEmployer !== undefined,
  work_mode: (a) => a.workMode !== undefined,
  agreement: (a) => a.agreement !== undefined,
  pay: (a) => a.annualPayMinor !== undefined,
  benefits: (a) => a.benefitIds !== undefined,
  clauses: (a) => a.nonCompeteMonths !== undefined || a.mobilityClause !== undefined,
  summary: () => false,
};

/**
 * The composer's fifteen steps for the answers so far (PRD §19.2): which are
 * done, which an earlier change made invalid, which do not apply.
 */
export function composerSteps(
  pack: TermsPack,
  answers: TermsAnswers,
  entity: EntityFacts,
  on: CalendarDate,
): ComposerStep[] {
  const issues = termsIssues(pack, answers, entity, on);
  const type = pack.contractTypes(answers, entity).find((t) => t.key === answers.contractType);
  const skipped = (step: TermsStep): boolean =>
    (step === 'location' && pack.regions.length === 0) ||
    (step === 'fixed_term_reason' &&
      (type?.fixedTerm !== true || pack.fixedTermReasons(answers).length === 0)) ||
    (step === 'agreement' && !pack.agreementRequired(entity) && answers.agreement === undefined);
  const STEPS: readonly TermsStep[] = [
    'entity',
    'location',
    'relationship',
    'contract_type',
    'fixed_term_reason',
    'duration',
    'hours',
    'probation',
    'notice',
    'work_mode',
    'agreement',
    'pay',
    'benefits',
    'clauses',
    'summary',
  ];
  return STEPS.map((step) => {
    const mine = issues.filter((found) => found.step === step);
    const errors = mine.filter((found) => found.severity === 'error');
    const state: StepState = skipped(step)
      ? 'skipped'
      : step === 'summary'
        ? issues.some((found) => found.severity === 'error')
          ? 'open'
          : 'done'
        : !answered[step](answers)
          ? 'open'
          : errors.length > 0
            ? 'invalid'
            : 'done';
    return { step, state, issues: mine };
  });
}
