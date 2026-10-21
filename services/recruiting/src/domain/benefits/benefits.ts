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

/** A category as people see it: its name and the icon beside it, by the icon's name in Reach. */
export interface CategoryInfo {
  readonly key: string;
  readonly name: string;
  readonly icon: string;
  /** Added by the company, so it can be renamed or removed. */
  readonly custom: boolean;
}

/** The icons a category may wear: Reach's names, so a screen can draw them without knowing benefits. */
export const CATEGORY_ICONS = [
  'health',
  'payroll',
  'break',
  'travel',
  'parental',
  'goal',
  'system',
  'favourite',
  'location',
  'analytics',
  'payment',
  'vacation',
  'locked',
  'transfer',
  'home',
  'more',
  'team',
  'company',
  'calendar',
  'document',
  'starred',
  'work',
  'meeting',
  'approve',
] as const;

export const BUILT_IN_CATEGORIES: readonly CategoryInfo[] = (
  [
    ['health', 'Health', 'health'],
    ['pension', 'Pension and savings', 'payroll'],
    ['meal', 'Food', 'break'],
    ['transport', 'Getting to work', 'travel'],
    ['childcare', 'Family', 'parental'],
    ['learning', 'Learning and growth', 'goal'],
    ['equipment', 'Equipment', 'system'],
    ['wellbeing', 'Wellbeing', 'favourite'],
    ['mobility', 'Flexibility', 'location'],
    ['equity', 'Equity', 'analytics'],
    ['bonus', 'Bonus', 'payment'],
    ['extra_holiday', 'Time off', 'vacation'],
    ['insurance', 'Insurance', 'locked'],
    ['flexible_pay', 'Flexible pay', 'transfer'],
    ['relocation', 'Relocation', 'home'],
    ['other', 'Other perks', 'more'],
  ] as const
).map(([key, name, icon]) => ({ key, name, icon, custom: false }));

/** One benefit of the standard library: what most companies offer, for each to pick from. */
export interface LibraryItem {
  readonly key: string;
  readonly category: BenefitCategory;
  readonly name: string;
  readonly description: string;
}

const lib = (category: BenefitCategory, items: readonly (readonly [string, string, string])[]) =>
  items.map(([key, name, description]) => ({ key, category, name, description }));

/**
 * The standard library (PRD §20): every benefit a company commonly offers, by
 * category, each with a line a candidate can read. Every entity has it to
 * pick from; a company removes what it never offers and adds its own.
 * Described, never valued: the amounts are the company's to set.
 */
export const BENEFIT_LIBRARY: readonly LibraryItem[] = [
  ...lib('health', [
    [
      'private_health',
      'Private health insurance',
      'Cover for you, with faster access to specialists.',
    ],
    [
      'family_health',
      'Health cover for your family',
      'Your partner and children on the health plan too.',
    ],
    ['dental', 'Dental cover', 'Check-ups and treatment paid or reimbursed.'],
    ['vision', 'Vision cover', 'Eye tests, glasses and lenses.'],
    ['health_check', 'Yearly health check', 'A full check-up every year, on the company.'],
    ['mental_health', 'Mental health support', 'Confidential counselling and therapy sessions.'],
  ]),
  ...lib('pension', [
    [
      'employer_pension',
      'Employer pension contributions',
      'The company adds to your pension every month.',
    ],
    ['pension_matching', 'Pension matching', 'Your own contributions matched, up to a limit.'],
    ['financial_advice', 'Financial planning', 'Independent advice on saving and retirement.'],
  ]),
  ...lib('meal', [
    ['meal_allowance', 'Meal allowance', 'A monthly budget for lunch.'],
    ['office_lunch', 'Lunch at the office', 'Lunch provided on office days.'],
    ['snacks', 'Snacks and drinks', 'Fruit, snacks and good coffee at the office.'],
  ]),
  ...lib('transport', [
    ['public_transport', 'Public transport ticket', 'A monthly pass, paid or subsidised.'],
    ['bike_leasing', 'Bike leasing', 'A bike or e-bike through a leasing scheme.'],
    ['parking', 'Parking', 'A space at the workplace.'],
    ['commuting_allowance', 'Commuting allowance', 'Money towards the cost of getting to work.'],
    ['company_car', 'Company car', 'A car for work and private use.'],
  ]),
  ...lib('childcare', [
    ['childcare_allowance', 'Childcare allowance', 'Help with nursery and childcare costs.'],
    [
      'parental_leave_plus',
      'Enhanced parental leave',
      'Paid parental leave above the legal minimum.',
    ],
    ['phased_return', 'Phased return to work', 'Shorter hours on full pay after parental leave.'],
    ['family_days', 'Family care days', 'Paid days off to care for a child or relative.'],
  ]),
  ...lib('learning', [
    ['learning_budget', 'Learning budget', 'A yearly budget for courses, books and conferences.'],
    [
      'certifications',
      'Paid certifications',
      'Course and exam fees for professional certificates.',
    ],
    ['language_classes', 'Language classes', 'Lessons in the local language, or another.'],
    ['mentoring', 'Mentoring', 'A mentor from outside your team.'],
    ['study_leave', 'Study leave', 'Paid time off to study.'],
    ['conference_days', 'Conference days', 'Paid days and travel to attend conferences.'],
  ]),
  ...lib('equipment', [
    ['laptop_choice', 'Laptop of your choice', 'The machine you work best on.'],
    ['home_office', 'Home office budget', 'A desk, a chair and a screen for working from home.'],
    ['phone', 'Mobile phone', 'A phone and plan for work.'],
    ['internet_allowance', 'Internet allowance', 'Towards your home connection.'],
  ]),
  ...lib('wellbeing', [
    ['gym', 'Gym or sports membership', 'A membership, paid or subsidised.'],
    ['wellbeing_budget', 'Wellbeing budget', 'A yearly budget for whatever keeps you well.'],
    ['team_events', 'Team events', 'Regular time together, on the company.'],
    ['volunteering_days', 'Volunteering days', 'Paid days to volunteer for a cause.'],
  ]),
  ...lib('mobility', [
    [
      'flexible_hours',
      'Flexible working hours',
      'Start and finish when it suits you, around core hours.',
    ],
    ['work_from_home', 'Work from home', 'Days at home when the work allows.'],
    ['work_abroad', 'Work from abroad', 'Weeks a year working from another country.'],
    ['four_day_week', 'Four-day week', 'Full-time work over four days.'],
    ['sabbatical', 'Sabbatical', 'Extended leave after some years with the company.'],
  ]),
  ...lib('equity', [
    ['stock_options', 'Stock options', 'A share in the growth of the company.'],
    ['share_purchase', 'Employee share purchase plan', 'Buy company shares at a discount.'],
    ['restricted_stock', 'Restricted stock units', 'Shares granted to you over time.'],
  ]),
  ...lib('bonus', [
    ['performance_bonus', 'Performance bonus', 'A yearly bonus on company and personal results.'],
    ['thirteenth_salary', 'Thirteenth month', 'An extra month’s salary each year.'],
    ['signing_bonus', 'Signing bonus', 'A one-off payment when you join.'],
    ['referral_bonus', 'Referral bonus', 'Paid when someone you refer is hired.'],
    ['profit_sharing', 'Profit sharing', 'A share of the profit in a good year.'],
  ]),
  ...lib('extra_holiday', [
    ['extra_holiday_days', 'Extra holiday days', 'More paid holiday than the law requires.'],
    ['birthday_off', 'Your birthday off', 'A paid day off on or around your birthday.'],
    [
      'year_end_closure',
      'Days off between the holidays',
      'The company closes at the turn of the year, on full pay.',
    ],
    ['moving_day', 'Moving day', 'A paid day off when you move home.'],
  ]),
  ...lib('insurance', [
    ['life_insurance', 'Life insurance', 'A payment to your family if you die while employed.'],
    [
      'income_protection',
      'Income protection',
      'Income if illness or injury keeps you from working.',
    ],
    ['accident_insurance', 'Accident insurance', 'Cover for accidents, at work and away from it.'],
    ['travel_insurance', 'Travel insurance', 'Cover on work and personal trips.'],
  ]),
  ...lib('flexible_pay', [
    ['salary_sacrifice', 'Salary sacrifice', 'Trade part of your salary for benefits before tax.'],
    ['pay_on_demand', 'Pay on demand', 'Draw pay already earned before payday.'],
    [
      'benefits_budget',
      'Flexible benefits budget',
      'A budget to spend on the benefits you choose.',
    ],
  ]),
  ...lib('relocation', [
    ['relocation_package', 'Relocation package', 'Moving costs and help settling in.'],
    ['visa_sponsorship', 'Visa sponsorship', 'Visa and work permit costs covered.'],
    ['temporary_housing', 'Temporary housing', 'A place to stay for your first weeks.'],
  ]),
  ...lib('other', [
    ['employee_discounts', 'Employee discounts', 'Lower prices with partner brands.'],
    ['pet_friendly', 'Pet-friendly office', 'Bring your dog to work.'],
  ]),
];

/** The library's benefit for an entity: its id is stable, so a pick keeps pointing at it. */
export function libraryBenefit(legalEntityId: string, item: LibraryItem): Benefit {
  return {
    id: `lib:${legalEntityId}:${item.key}`,
    key: item.key,
    legalEntityId,
    category: item.category,
    names: { en: item.name },
    description: item.description,
    value: { kind: 'descriptive' },
    eligibility: {
      employmentTypes: null,
      minWeeklyMinutes: null,
      waiting: { kind: 'none' },
      workModes: null,
      locationIds: null,
    },
    statutory: false,
    taxNote: null,
  };
}

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
  /** A built-in category's key, or one the company added. */
  readonly category: string;
  readonly names: Readonly<Record<string, string>>;
  /** A line a candidate reads under the name; absent on benefits saved before it existed. */
  readonly description?: string | null;
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
    description: string,
    eligibility = employees,
    taxNote: string | null = null,
  ): Benefit => ({
    id: `statutory:${country}:${key}`,
    key,
    legalEntityId,
    category,
    names: { en },
    description,
    value: { kind: 'descriptive' },
    eligibility,
    statutory: true,
    taxNote,
  });
  switch (country) {
    case 'GB':
      return [
        item(
          'pension_auto_enrolment',
          'pension',
          'Workplace pension (automatic enrolment)',
          'You are enrolled in a workplace pension, and the company pays into it.',
        ),
      ];
    case 'IN':
      return [
        item(
          'provident_fund',
          'pension',
          'Employees’ Provident Fund',
          'You and the company each pay into your provident fund every month.',
        ),
        item(
          'gratuity',
          'bonus',
          'Gratuity',
          'A lump sum when you leave after five years, or after one on a fixed term.',
        ),
        item(
          'esi',
          'insurance',
          'Employees’ State Insurance, below the wage ceiling',
          'Medical care and cash benefits when sick, for pay below the ceiling.',
        ),
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
        ? [
            item(
              'paid_sick_leave',
              'extra_holiday',
              'Paid sick leave (state law)',
              'Paid time off when you or your family are ill, as the state requires.',
            ),
          ]
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
