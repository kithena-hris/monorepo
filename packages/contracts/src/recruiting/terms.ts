import * as z from 'zod';

import { asFinancial, asInternal, asPublic, policy } from '../classification.js';
import { keySchema } from '../people/primitives.js';
import { CalendarDate } from '../primitives.js';
import { ConditionKind, LaunchCountry, WorkMode } from './primitives.js';

/**
 * Employment terms, resolved (Recruiting PRD §19.2, REC-012).
 *
 * What the terms composer produces and `validateTerms` accepts: every term an
 * offer and a contract state, already checked against the country's pack.
 * It maps one to one onto People's employment terms fields (People PRD
 * Appendix A), which `toPeopleTerms` spells out so the mapping is code a test
 * reads rather than a sentence in two documents.
 */

/** The fifteen steps of the composer, in order (PRD §19.2). */
export const TERMS_STEPS = [
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
] as const;
export const TermsStep = z.enum(TERMS_STEPS).register(policy, asPublic());
export type TermsStep = z.infer<typeof TermsStep>;

/** People's fixed list (`employment_type`); a pack's own type names the one it maps to. */
export const PeopleEmploymentType = z
  .enum(['permanent', 'fixed_term', 'contractor', 'intern', 'apprentice', 'seasonal'])
  .register(policy, asPublic());
export type PeopleEmploymentType = z.infer<typeof PeopleEmploymentType>;

export const Relationship = z
  .enum(['employee', 'worker', 'contractor'])
  .register(policy, asPublic());
export type Relationship = z.infer<typeof Relationship>;

/** A length in the unit the statute uses: notice in weeks in GB, months in DE probation. */
export const TermLength = z
  .object({
    count: z.int().nonnegative().register(policy, asInternal()),
    unit: z.enum(['days', 'weeks', 'months']).register(policy, asInternal()),
  })
  .register(policy, asInternal());
export type TermLength = z.infer<typeof TermLength>;

/** A decimal with up to four places, as text: `0.8000`. Never a float (repo rule). */
export const Fte = z
  .string()
  .regex(/^(0(\.\d{1,4})?|1(\.0{1,4})?)$/u, 'FTE is between 0 and 1, up to four places')
  .register(policy, asInternal());

export const ResolvedTerms = z
  .object({
    country: LaunchCountry,
    /** US state, Indian state, German Land, Spanish autonomous community; null where it does not matter. */
    region: z.string().max(10).nullable().register(policy, asPublic()),
    /** The pack's version these terms were validated against. */
    packVersion: z.string().min(1).register(policy, asPublic()),
    relationship: Relationship,
    /** The country's own name for the type: `befristet_ohne_sachgrund`, `indefinido`. */
    contractType: keySchema('contract type').register(policy, asPublic()),
    employmentType: PeopleEmploymentType,
    fixedTermReason: keySchema('fixed-term reason').nullable().register(policy, asInternal()),
    contractStart: CalendarDate,
    contractEnd: CalendarDate.nullable(),
    workingPattern: z.enum(['full_time', 'part_time']).register(policy, asInternal()),
    /** Weekly hours in minutes, so 37.5 hours is 2250 and no float is stored. */
    weeklyMinutes: z.int().positive().register(policy, asInternal()),
    fte: Fte,
    probation: TermLength.nullable(),
    probationEnd: CalendarDate.nullable(),
    noticeEmployee: TermLength,
    noticeEmployer: TermLength,
    workMode: WorkMode,
    hybridDaysOnsite: z.int().min(1).max(5).nullable().register(policy, asInternal()),
    remoteCountry: z.string().length(2).nullable().register(policy, asInternal()),
    collectiveAgreement: z
      .object({
        key: keySchema('collective agreement').register(policy, asInternal()),
        group: z.string().max(60).nullable().register(policy, asInternal()),
      })
      .nullable()
      .register(policy, asInternal()),
    nonCompeteMonths: z.int().min(0).max(24).nullable().register(policy, asInternal()),
    mobilityClause: z.boolean().register(policy, asInternal()),
    /** ES: 12 or 14; elsewhere 12. */
    paymentsPerYear: z.int().min(12).max(14).register(policy, asFinancial()),
    /** DE fixed term: printed and signed by hand (§ 14(4) TzBfG, PRD §21.2). */
    signature: z.enum(['electronic', 'wet_ink']).register(policy, asPublic()),
    /** The documents the pack requires beside the contract (ES remote agreement, GB statement…). */
    documents: z.array(keySchema('contract document')).register(policy, asPublic()),
    conditions: z.array(ConditionKind).register(policy, asPublic()),
  })
  .register(policy, asInternal());
export type ResolvedTerms = z.infer<typeof ResolvedTerms>;

/** One rule a set of terms broke or should be read against (PRD §19.3). */
export const TermsIssue = z
  .object({
    code: keySchema('terms issue').register(policy, asPublic()),
    step: TermsStep,
    severity: z.enum(['error', 'warning']).register(policy, asPublic()),
    /** The statute and section, or `company` for a tenant's stricter default. */
    source: z.string().min(1).max(120).register(policy, asPublic()),
    message: z.string().min(1).max(500).register(policy, asPublic()),
  })
  .register(policy, asPublic());
export type TermsIssue = z.infer<typeof TermsIssue>;

/** People's employment terms fields, keyed by People's own attribute keys. */
export interface PeopleTermsFields {
  readonly employment_type: PeopleEmploymentType;
  readonly contract_start: string;
  readonly contract_end: string | null;
  readonly probation_end: string | null;
  readonly working_pattern: 'full_time' | 'part_time';
  readonly fte: string;
  /** Hours a week, to two places: 2250 minutes is `37.5`. */
  readonly weekly_hours: string;
  readonly hybrid_days_onsite: number | null;
  readonly notice_period_employee: string;
  readonly notice_period_employer: string;
  readonly collective_agreement: string | null;
  readonly work_model: WorkMode;
  readonly remote_country: string | null;
  readonly employment_jurisdiction: string;
  readonly non_compete_months: number | null;
  readonly mobility_clause: boolean;
}

const lengthText = (length: TermLength): string => `${String(length.count)} ${length.unit}`;

/** The one place the mapping onto People's fields is written down (PRD §19.2). */
export function toPeopleTerms(terms: ResolvedTerms): PeopleTermsFields {
  return {
    employment_type: terms.employmentType,
    contract_start: terms.contractStart,
    contract_end: terms.contractEnd,
    probation_end: terms.probationEnd,
    working_pattern: terms.workingPattern,
    fte: terms.fte,
    // In hundredths of an hour first, a whole number, so `37.5` prints as itself.
    weekly_hours: String(Math.round((terms.weeklyMinutes * 5) / 3) / 100),
    hybrid_days_onsite: terms.hybridDaysOnsite,
    notice_period_employee: lengthText(terms.noticeEmployee),
    notice_period_employer: lengthText(terms.noticeEmployer),
    collective_agreement:
      terms.collectiveAgreement === null
        ? null
        : [terms.collectiveAgreement.key, terms.collectiveAgreement.group]
            .filter((part) => part !== null)
            .join(':'),
    work_model: terms.workMode,
    remote_country: terms.remoteCountry,
    employment_jurisdiction:
      terms.region === null ? terms.country : `${terms.country}-${terms.region}`,
    non_compete_months: terms.nonCompeteMonths,
    mobility_clause: terms.mobilityClause,
  };
}
