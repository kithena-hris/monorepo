import { Decimal } from 'decimal.js';
import type { CalendarDate, TermsIssue } from '@kithena/contracts';

import {
  issue,
  len,
  onDate,
  lengthDays,
  yearlyFromHourly,
  type Choice,
  type ContractTypeChoice,
  type Limits,
  type Rule,
  type TermsAnswers,
  type TermsPack,
  noLeave,
  withNotes,
} from './pack.js';

/**
 * The United States (Recruiting PRD §19.8). Signed off by the owner on 21 Oct 2026 (REC-150) from the statutes each rule cites, as they stand for 2026; a local employment lawyer's read is still worth having before launch, and the dated tables are what moves each year. State and city minimum
 * wages and exempt thresholds move every January (a few in July or
 * September), and the tables below are the part updated each year.
 */

const STATES: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NYC: 'New York City',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
};

const FEDERAL_CENTS = 725;

/** State (and NYC) minimum wage, cents an hour, from 1 January of the year. */
const STATE_MINIMUM: Record<string, readonly (readonly [string, number])[]> = {
  AK: [
    ['2025-07-01', 1300],
    ['2026-07-01', 1400],
  ],
  AZ: [
    ['2025-01-01', 1470],
    ['2026-01-01', 1515],
  ],
  DE: [['2025-01-01', 1500]],
  FL: [
    ['2025-09-30', 1400],
    ['2026-09-30', 1500],
  ],
  HI: [
    ['2024-01-01', 1400],
    ['2026-01-01', 1600],
  ],
  ME: [
    ['2025-01-01', 1465],
    ['2026-01-01', 1510],
  ],
  MI: [
    ['2025-02-21', 1248],
    ['2026-01-01', 1373],
  ],
  MO: [
    ['2025-01-01', 1375],
    ['2026-01-01', 1500],
  ],
  MT: [
    ['2025-01-01', 1055],
    ['2026-01-01', 1085],
  ],
  NE: [
    ['2025-01-01', 1350],
    ['2026-01-01', 1500],
  ],
  NM: [['2023-01-01', 1200]],
  NV: [['2024-07-01', 1200]],
  RI: [
    ['2025-01-01', 1500],
    ['2026-01-01', 1600],
  ],
  SD: [
    ['2025-01-01', 1150],
    ['2026-01-01', 1185],
  ],
  VA: [
    ['2025-01-01', 1241],
    ['2026-01-01', 1277],
  ],
  CA: [
    ['2025-01-01', 1650],
    ['2026-01-01', 1690],
  ],
  CO: [
    ['2025-01-01', 1481],
    ['2026-01-01', 1516],
  ],
  CT: [
    ['2025-01-01', 1615],
    ['2026-01-01', 1694],
  ],
  DC: [['2025-07-01', 1795]],
  IL: [['2025-01-01', 1500]],
  MA: [['2025-01-01', 1500]],
  MD: [['2025-01-01', 1500]],
  MN: [
    ['2025-01-01', 1128],
    ['2026-01-01', 1141],
  ],
  NJ: [
    ['2025-01-01', 1549],
    ['2026-01-01', 1592],
  ],
  NY: [
    ['2025-01-01', 1550],
    ['2026-01-01', 1600],
  ],
  NYC: [
    ['2025-01-01', 1650],
    ['2026-01-01', 1700],
  ],
  OR: [['2025-07-01', 1505]],
  VT: [
    ['2025-01-01', 1401],
    ['2026-01-01', 1442],
  ],
  WA: [
    ['2025-01-01', 1666],
    ['2026-01-01', 1713],
  ],
};

/** The FLSA's salary floor for exemption ($684 a week) and the stricter states', cents a year. */
const EXEMPT_YEARLY: Record<string, readonly (readonly [string, number])[]> = {
  FEDERAL: [['2019-01-01', 3_556_800]],
  CA: [
    ['2025-01-01', 6_864_000],
    ['2026-01-01', 7_030_400],
  ],
  CO: [
    ['2025-01-01', 5_667_850],
    ['2026-01-01', 5_766_450],
  ],
  // Outside New York City, Long Island and Westchester: $1,161.65 a week, then $1,199.10.
  NY: [
    ['2025-01-01', 6_040_580],
    ['2026-01-01', 6_235_320],
  ],
  // New York City, Long Island and Westchester: $1,237.50 a week, then $1,275.
  NYC: [
    ['2025-01-01', 6_435_000],
    ['2026-01-01', 6_630_000],
  ],
  // 2.25 times the state minimum wage for 40 hours, 52 weeks.
  WA: [
    ['2025-01-01', 7_796_880],
    ['2026-01-01', 8_016_840],
  ],
};

/** States that void a non-compete for employees. */
const NO_NON_COMPETE = new Set(['CA', 'MN', 'ND', 'OK']);
/** States that test contractors with the ABC test. */
const ABC_TEST = new Set(['CA', 'MA', 'NJ', 'IL', 'CT', 'VT']);

const minimumCents = (region: string | null | undefined, on: CalendarDate): number => {
  const table = region == null ? undefined : STATE_MINIMUM[region];
  return Math.max(FEDERAL_CENTS, table === undefined ? 0 : onDate(table, on));
};

export const exemptThresholdMinor = (
  region: string | null | undefined,
  on: CalendarDate,
): number => {
  const table = region == null ? undefined : EXEMPT_YEARLY[region];
  const federal = onDate(EXEMPT_YEARLY['FEDERAL'] as readonly (readonly [string, number])[], on);
  return Math.max(federal, table === undefined ? 0 : onDate(table, on));
};

const RELATIONSHIPS: readonly Choice[] = withNotes(
  [
    { key: 'employee', label: 'W-2 employee' },
    { key: 'contractor', label: '1099 contractor' },
  ],
  {
    employee:
      'On the payroll with tax withheld, minimum wage and overtime unless exempt, and unemployment and workers’ compensation cover.',
    contractor:
      'Self-employed, paid on invoice and reported on Form 1099-NEC. Control over how the work is done makes them an employee, and many states apply the stricter ABC test.',
  },
);

/** What each contract means in the United States, in a line beside the choice. */
export const NOTE: Readonly<Record<string, string>> = {
  at_will_full_time:
    'Either side may end it at any time for any lawful reason; Montana requires good cause after the probationary period.',
  at_will_part_time:
    'At-will, with fewer hours. Health cover eligibility follows the company’s plans and the Affordable Care Act’s 30-hour line.',
  temporary:
    'At-will employment expected to end after a season or a project, still owed the minimum wage and overtime.',
  intern:
    'Paid at least the minimum wage. An unpaid internship must pass the Department of Labor’s primary beneficiary test.',
  fixed_term_contract:
    'A contract for a set term, which ends at-will status for its length: ending it early can mean paying out the rest.',
  contractor_1099:
    'A service agreement, not employment: no minimum wage, overtime or withholding. The IRS and the states look at the facts, not the label.',
};

function types(answers: TermsAnswers): ContractTypeChoice[] {
  if (answers.relationship === 'contractor') {
    return [
      {
        key: 'contractor_1099',
        label: '1099 independent contractor',
        employmentType: 'contractor',
        relationship: 'contractor',
        fixedTerm: false,
      },
    ];
  }
  return [
    {
      key: 'at_will_full_time',
      label: 'At-will, full time',
      employmentType: 'permanent',
      relationship: 'employee',
      fixedTerm: false,
    },
    {
      key: 'at_will_part_time',
      label: 'At-will, part time',
      employmentType: 'permanent',
      relationship: 'employee',
      fixedTerm: false,
    },
    {
      key: 'temporary',
      label: 'Temporary or seasonal',
      employmentType: 'seasonal',
      relationship: 'employee',
      fixedTerm: true,
    },
    {
      key: 'intern',
      label: 'Intern',
      employmentType: 'intern',
      relationship: 'employee',
      fixedTerm: true,
    },
    {
      key: 'fixed_term_contract',
      label: 'Employment contract for a fixed term',
      employmentType: 'fixed_term',
      relationship: 'employee',
      fixedTerm: true,
    },
  ];
}

function limits(answers: TermsAnswers): Limits {
  const montana = answers.region === 'MT';
  const employed = answers.relationship !== 'contractor';
  return {
    durationMonths:
      types(answers).find((t) => t.key === answers.contractType)?.fixedTerm === true
        ? { min: 0, max: null }
        : null,
    maxWeeklyMinutes: 84 * 60,
    probation: employed
      ? {
          allowed: true,
          required: false,
          max: montana ? len(12, 'months') : null,
          default: montana ? len(6, 'months') : len(90, 'days'),
        }
      : { allowed: false, required: false, max: null, default: null },
    noticeEmployee: len(0, 'days'),
    noticeEmployer: len(0, 'days'),
  };
}

function check(answers: TermsAnswers, _entity: unknown, on: CalendarDate): TermsIssue[] {
  const out: TermsIssue[] = [];
  const region = answers.region ?? null;
  if (answers.relationship === 'contractor' && region !== null && ABC_TEST.has(region)) {
    out.push(
      issue(
        'relationship',
        'abc_test',
        `${region} ABC test`,
        'This state presumes employment unless all three parts of the ABC test are met',
        'warning',
      ),
    );
  }
  if (answers.contractType === 'fixed_term_contract') {
    out.push(
      issue(
        'contract_type',
        'ends_at_will',
        'common law',
        'A contract for a fixed term ends at-will status for its length',
        'warning',
      ),
    );
  }
  if (answers.probation != null && region !== 'MT') {
    out.push(
      issue(
        'probation',
        'introductory_period',
        'common law',
        'An introductory period does not change at-will status',
        'warning',
      ),
    );
  }
  if (answers.relationship === 'employee' && answers.exempt == null) {
    out.push(
      issue(
        'pay',
        'exempt_required',
        'FLSA 29 U.S.C. § 213(a)(1)',
        'Say whether the role is exempt from overtime',
      ),
    );
  }
  if (answers.exempt === true && answers.annualPayMinor !== undefined) {
    const threshold = exemptThresholdMinor(region, on);
    if (answers.annualPayMinor < threshold) {
      out.push(
        issue(
          'pay',
          'below_exempt_threshold',
          'FLSA 29 C.F.R. § 541.600 and state law',
          `Exempt status needs at least $${new Decimal(threshold).div(100).toFixed(0)} a year here`,
        ),
      );
    }
  }
  if (
    answers.probation != null &&
    region === 'MT' &&
    lengthDays(answers.probation) > lengthDays(len(12, 'months'))
  ) {
    out.push(
      issue(
        'probation',
        'montana_probation',
        'Mont. Code Ann. § 39-2-904',
        'Montana’s probationary period is at most 12 months',
      ),
    );
  }
  return out;
}

export const unitedStates: TermsPack = {
  country: 'US',
  version: 'us-2026.1',
  reviewed: true,
  regions: Object.entries(STATES).map(([key, label]) => ({ key, label })),
  regionRequired: true,
  relationships: () => RELATIONSHIPS,
  contractTypes: (answers) => withNotes(types(answers), NOTE),
  fixedTermReasons: () => [],
  asksPreviousEmployment: () => false,
  agreementRequired: () => false,
  limits,
  paymentsPerYear: () => [12],
  minimumAnnualPayMinor: (answers, _entity, on) =>
    answers.relationship === 'contractor'
      ? null
      : yearlyFromHourly(minimumCents(answers.region, on), answers.weeklyMinutes ?? 0),
  nonCompete: (answers) =>
    answers.region != null && NO_NON_COMPETE.has(answers.region)
      ? {
          allowed: false,
          reason: `${answers.region} voids non-competes for employees`,
          maxMonths: 0,
        }
      : { allowed: true, reason: '', maxMonths: 24 },
  rules: (answers): Rule[] => [
    {
      step: 'location',
      text: 'The state, and the city where a city law applies, decide minimum wage, leave and non-competes.',
      source: 'state law',
    },
    {
      step: 'contract_type',
      text: 'Employment is at-will everywhere except Montana after its probationary period.',
      source: 'Mont. Code Ann. § 39-2-904',
    },
    {
      step: 'pay',
      text: 'At least the federal, state and city minimum wage; exempt roles need the salary threshold and the duties test.',
      source: 'FLSA; state law',
    },
    ...(answers.region != null && NO_NON_COMPETE.has(answers.region)
      ? [
          {
            step: 'clauses' as const,
            text: 'Non-competes are void for employees in this state.',
            source: `${answers.region} law`,
          },
        ]
      : []),
    {
      step: 'summary',
      text: 'The accepted offer letter is often the only document; Form I-9 by day one and within three business days.',
      source: '8 U.S.C. § 1324a',
    },
  ],
  check: (answers, entity, on) => check(answers, entity, on),
  documents: () => ['offer_letter'],
  conditions: (answers) => (answers.relationship === 'contractor' ? [] : ['right_to_work']),
  minimumLeave: () =>
    noLeave(
      'Fair Labor Standards Act',
      'No federal minimum; state and city law and the company’s policy decide.',
    ),
  signature: () => 'electronic',
};
