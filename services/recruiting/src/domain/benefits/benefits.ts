import type {
  CalendarDate,
  LaunchCountry,
  PeopleEmploymentType,
  WorkMode,
} from '@kithena/contracts';
import { Decimal } from 'decimal.js';

import { addMonths } from '../dates.js';

/**
 * The benefits catalogue (Recruiting PRD §20, REC-030).
 *
 * Per legal entity: what the company offers, who is eligible, and the
 * statutory items each country's pack ships, which cannot be removed from an
 * offer. Recruiting enrols no one; an offer says what is offered.
 */

export const BENEFIT_CATEGORIES = [
  'health',
  'pension',
  'meal',
  'transport',
  'childcare',
  'learning',
  'equipment',
  'wellbeing',
  'mobility',
  'equity',
  'bonus',
  'extra_holiday',
  'insurance',
  'flexible_pay',
  'relocation',
  'other',
] as const;
export type BenefitCategory = (typeof BENEFIT_CATEGORIES)[number];

export type BenefitValue =
  | { readonly kind: 'money'; readonly yearlyMinor: number; readonly currency: string }
  | { readonly kind: 'percent'; readonly basisPoints: number }
  | { readonly kind: 'days'; readonly days: number }
  | { readonly kind: 'descriptive' };

export interface Eligibility {
  readonly employmentTypes: readonly PeopleEmploymentType[] | null;
  readonly minWeeklyMinutes: number | null;
  /** After probation, or after N months. */
  readonly waiting:
    | { readonly kind: 'none' }
    | { readonly kind: 'after_probation' }
    | { readonly kind: 'months'; readonly months: number };
  readonly workModes: readonly WorkMode[] | null;
  readonly locationIds: readonly string[] | null;
}

export interface Benefit {
  readonly id: string;
  readonly key: string;
  readonly legalEntityId: string;
  readonly category: BenefitCategory;
  readonly names: Readonly<Record<string, string>>;
  readonly value: BenefitValue;
  readonly eligibility: Eligibility;
  readonly statutory: boolean;
  /** Descriptive, never a calculation of anyone's tax. */
  readonly taxNote: string | null;
}

export interface Eligible {
  readonly employmentType: PeopleEmploymentType;
  readonly weeklyMinutes: number;
  readonly workMode: WorkMode;
  readonly locationId: string | null;
}

export function isEligible(benefit: Benefit, who: Eligible): boolean {
  const e = benefit.eligibility;
  if (e.employmentTypes !== null && !e.employmentTypes.includes(who.employmentType)) return false;
  if (e.minWeeklyMinutes !== null && who.weeklyMinutes < e.minWeeklyMinutes) return false;
  if (e.workModes !== null && !e.workModes.includes(who.workMode)) return false;
  if (
    e.locationIds !== null &&
    (who.locationId === null || !e.locationIds.includes(who.locationId))
  )
    return false;
  return true;
}

/** When a waiting period ends, from the start and the probation's end. */
export function eligibleFrom(
  benefit: Benefit,
  start: CalendarDate,
  probationEnd: CalendarDate | null,
): CalendarDate | 'start' {
  const w = benefit.eligibility.waiting;
  if (w.kind === 'none') return 'start';
  if (w.kind === 'after_probation') return probationEnd ?? 'start';
  return addMonths(start, w.months);
}

/**
 * The statutory items a pack ships (PRD §20.1). Locked into every eligible
 * offer. Values are descriptive: the rates belong to payroll.
 */
export function statutoryBenefits(
  country: LaunchCountry,
  region: string | null,
  legalEntityId: string,
): Benefit[] {
  const anyone: Eligibility = {
    employmentTypes: null,
    minWeeklyMinutes: null,
    waiting: { kind: 'none' },
    workModes: null,
    locationIds: null,
  };
  const employees: Eligibility = {
    ...anyone,
    employmentTypes: ['permanent', 'fixed_term', 'intern', 'apprentice', 'seasonal'],
  };
  const item = (
    key: string,
    category: BenefitCategory,
    en: string,
    eligibility = employees,
    taxNote: string | null = null,
  ): Benefit => ({
    id: `statutory:${country}:${key}`,
    key,
    legalEntityId,
    category,
    names: { en },
    value: { kind: 'descriptive' },
    eligibility,
    statutory: true,
    taxNote,
  });
  switch (country) {
    case 'GB':
      return [item('pension_auto_enrolment', 'pension', 'Workplace pension (automatic enrolment)')];
    case 'IN':
      return [
        item('provident_fund', 'pension', 'Employees’ Provident Fund'),
        item('gratuity', 'bonus', 'Gratuity'),
        item('esi', 'insurance', 'Employees’ State Insurance, below the wage ceiling'),
      ];
    case 'US':
      return region !== null &&
        [
          'CA',
          'NY',
          'NYC',
          'WA',
          'MA',
          'NJ',
          'CO',
          'IL',
          'OR',
          'CT',
          'MD',
          'AZ',
          'VT',
          'DC',
        ].includes(region)
        ? [item('paid_sick_leave', 'extra_holiday', 'Paid sick leave (state law)')]
        : [];
    default:
      return [];
  }
}

export interface TotalRewards {
  readonly baseMinor: number;
  readonly variableMinor: number;
  readonly benefitsMinor: number;
  readonly totalMinor: number;
  /** Benefits with no money value, listed by name. */
  readonly descriptive: readonly string[];
  readonly equityUnits: number | null;
}

/** Base, variable at target and the money value of benefits; equity as units, never priced (§20.3). */
export function totalRewards(
  baseMinor: number,
  variableMinor: number,
  benefits: readonly Benefit[],
  currency: string,
  language: string,
  equityUnits: number | null,
): TotalRewards {
  let benefitsMinor = new Decimal(0);
  const descriptive: string[] = [];
  for (const benefit of benefits) {
    const name = benefit.names[language] ?? benefit.names['en'] ?? benefit.key;
    if (benefit.value.kind === 'money' && benefit.value.currency === currency)
      benefitsMinor = benefitsMinor.plus(benefit.value.yearlyMinor);
    else if (benefit.value.kind === 'percent')
      benefitsMinor = benefitsMinor.plus(
        new Decimal(baseMinor).mul(benefit.value.basisPoints).div(10_000).floor(),
      );
    else descriptive.push(name);
  }
  const total = new Decimal(baseMinor).plus(variableMinor).plus(benefitsMinor);
  return {
    baseMinor,
    variableMinor,
    benefitsMinor: benefitsMinor.toNumber(),
    totalMinor: total.toNumber(),
    descriptive,
    equityUnits,
  };
}

/** The benefits on an offer: what was chosen and is eligible, plus every eligible statutory one, locked. */
export function offerBenefits(
  chosen: readonly string[],
  catalogue: readonly Benefit[],
  statutory: readonly Benefit[],
  who: Eligible,
): Benefit[] {
  const picked = catalogue.filter((b) => chosen.includes(b.id) && isEligible(b, who));
  return [...statutory.filter((b) => isEligible(b, who)), ...picked];
}
