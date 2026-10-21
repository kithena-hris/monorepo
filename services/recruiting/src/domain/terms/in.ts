import { Decimal } from 'decimal.js';
import type { TermsIssue } from '@kithena/contracts';

import {
  issue,
  len,
  lengthDays,
  type Choice,
  type ContractTypeChoice,
  type Limits,
  type Rule,
  type TermsAnswers,
  type TermsPack,
  noLeave,
} from './pack.js';

/**
 * India (Recruiting PRD §19.7). **Awaiting a country reviewer** (REC-150):
 * state minimum wages and the labour codes' start dates especially.
 */

const STATES: readonly Choice[] = [
  ['AP', 'Andhra Pradesh'],
  ['AS', 'Assam'],
  ['BR', 'Bihar'],
  ['CH', 'Chandigarh'],
  ['DL', 'Delhi'],
  ['GA', 'Goa'],
  ['GJ', 'Gujarat'],
  ['HR', 'Haryana'],
  ['KA', 'Karnataka'],
  ['KL', 'Kerala'],
  ['MP', 'Madhya Pradesh'],
  ['MH', 'Maharashtra'],
  ['OD', 'Odisha'],
  ['PB', 'Punjab'],
  ['RJ', 'Rajasthan'],
  ['TN', 'Tamil Nadu'],
  ['TG', 'Telangana'],
  ['UP', 'Uttar Pradesh'],
  ['UK', 'Uttarakhand'],
  ['WB', 'West Bengal'],
].map(([key, label]) => ({ key: key as string, label: label as string }));

/** The national floor wage, paise a day (Code on Wages s. 9); states set higher ones. */
const FLOOR_PER_DAY_PAISE = 17_800;

function types(answers: TermsAnswers): ContractTypeChoice[] {
  if (answers.relationship === 'contractor') {
    return [
      {
        key: 'consultant',
        label: 'Consultant or retainer',
        employmentType: 'contractor',
        relationship: 'contractor',
        fixedTerm: false,
      },
    ];
  }
  return [
    {
      key: 'permanent',
      label: 'Permanent',
      employmentType: 'permanent',
      relationship: 'employee',
      fixedTerm: false,
    },
    {
      key: 'fixed_term',
      label: 'Fixed-term employment',
      employmentType: 'fixed_term',
      relationship: 'employee',
      fixedTerm: true,
    },
    {
      key: 'apprentice',
      label: 'Trainee or apprentice (Apprentices Act 1961)',
      employmentType: 'apprentice',
      relationship: 'employee',
      fixedTerm: true,
    },
  ];
}

function limits(answers: TermsAnswers): Limits {
  const employed = answers.relationship !== 'contractor';
  return {
    durationMonths:
      answers.contractType === 'apprentice'
        ? { min: 6, max: 36 }
        : answers.contractType === 'fixed_term'
          ? { min: 0, max: null }
          : null,
    maxWeeklyMinutes: 48 * 60,
    // Not statutory: 6 months by default, one extension of up to 6 more.
    probation: employed
      ? { allowed: true, required: false, max: len(12, 'months'), default: len(6, 'months') }
      : { allowed: false, required: false, max: null, default: null },
    noticeEmployee: len(0, 'days'),
    noticeEmployer: len(0, 'days'),
  };
}

function check(answers: TermsAnswers): TermsIssue[] {
  const out: TermsIssue[] = [];
  if (answers.probation != null && lengthDays(answers.probation) > lengthDays(len(6, 'months'))) {
    out.push(
      issue(
        'probation',
        'probation_extended',
        'standing orders',
        'Over 6 months is an extension; record why',
        'warning',
      ),
    );
  }
  if (answers.relationship === 'contractor') {
    out.push(
      issue(
        'relationship',
        'misclassification',
        'Code on Social Security 2020',
        'Check the consultant is not in fact an employee: control and integration make them one',
        'warning',
      ),
    );
  }
  return out;
}

export const india: TermsPack = {
  country: 'IN',
  version: 'in-2026.1',
  reviewed: false,
  regions: STATES,
  regionRequired: true,
  relationships: () => [
    { key: 'employee', label: 'Employee' },
    { key: 'contractor', label: 'Consultant' },
  ],
  contractTypes: types,
  fixedTermReasons: () => [],
  asksPreviousEmployment: () => false,
  agreementRequired: () => false,
  limits,
  paymentsPerYear: () => [12],
  minimumAnnualPayMinor(answers) {
    if (answers.relationship === 'contractor') return null;
    // 26 paid days a month at the floor, scaled to the hours against a 48-hour week.
    return new Decimal(FLOOR_PER_DAY_PAISE)
      .mul(26 * 12)
      .mul(answers.weeklyMinutes ?? 0)
      .div(48 * 60)
      .toDecimalPlaces(0, Decimal.ROUND_CEIL)
      .toNumber();
  },
  nonCompete: () => ({
    allowed: false,
    reason: 'A restraint after employment ends is void in India (Indian Contract Act 1872, s. 27)',
    maxMonths: 0,
  }),
  rules: (): Rule[] => [
    {
      step: 'location',
      text: 'The state’s Shops and Establishments Act sets hours, holidays and leave.',
      source: 'state Shops and Establishments Acts',
    },
    {
      step: 'contract_type',
      text: 'A fixed-term employee has the same hours, wages and benefits as permanent staff, and gratuity pro rata after a year.',
      source: 'Code on Social Security 2020 s. 53',
    },
    {
      step: 'hours',
      text: '8 hours a day and 48 a week; overtime at twice the ordinary rate.',
      source: 'OSH Code 2020 s. 25',
    },
    {
      step: 'pay',
      text: 'Offered as CTC; wages must be at least half of total remuneration, and at least the state minimum.',
      source: 'Code on Wages 2019 s. 2(y)',
    },
    {
      step: 'benefits',
      text: 'Provident fund, state insurance below the wage ceiling, gratuity and maternity benefit are statutory.',
      source: 'Code on Social Security 2020',
    },
    {
      step: 'clauses',
      text: 'A non-compete after employment ends is void.',
      source: 'Indian Contract Act 1872 s. 27',
    },
    {
      step: 'summary',
      text: 'Every employee gets an appointment letter.',
      source: 'OSH Code 2020 s. 6(1)(f)',
    },
  ],
  check,
  documents: (answers) =>
    answers.relationship === 'contractor' ? ['consultancy_agreement'] : ['appointment_letter'],
  conditions: () => [],
  minimumLeave: (answers) =>
    answers.relationship !== 'employee'
      ? noLeave('Indian Contract Act 1872', 'A consultant has no statutory leave.')
      : {
          days: 12,
          unit: 'working_days',
          source: 'State Shops and Establishments Acts; Factories Act 1948 s. 79',
          note: 'Most states set 12 to 18 days of earned leave; check the state of the workplace.',
        },
  signature: () => 'electronic',
};
