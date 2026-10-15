import type { TermsIssue } from '@kithena/contracts';

import { monthsCovered } from '../dates.js';
import {
  issue,
  len,
  onDate,
  lengthDays,
  yearlyFromHourly,
  type ContractTypeChoice,
  type Limits,
  type Rule,
  type TermsAnswers,
  type TermsPack,
} from './pack.js';

/**
 * The United Kingdom (Recruiting PRD §19.6). **Awaiting a country reviewer**
 * (REC-150).
 */

/** National Living Wage, pence an hour, from 1 April each year (21 and over). */
const NLW: readonly (readonly [string, number])[] = [
  ['2025-04-01', 1221],
  ['2026-04-01', 1271],
];
/** The apprentice rate, pence an hour. */
const APPRENTICE: readonly (readonly [string, number])[] = [
  ['2025-04-01', 755],
  ['2026-04-01', 800],
];

function types(answers: TermsAnswers): ContractTypeChoice[] {
  switch (answers.relationship) {
    case 'contractor':
      return [
        {
          key: 'self_employed',
          label: 'Self-employed contractor',
          employmentType: 'contractor',
          relationship: 'contractor',
          fixedTerm: false,
        },
      ];
    case 'worker':
      return [
        {
          key: 'zero_hours',
          label: 'Zero-hours or casual (worker)',
          employmentType: 'seasonal',
          relationship: 'worker',
          fixedTerm: false,
        },
      ];
    default:
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
          label: 'Fixed term',
          employmentType: 'fixed_term',
          relationship: 'employee',
          fixedTerm: true,
        },
        {
          key: 'apprenticeship',
          label: 'Apprenticeship',
          employmentType: 'apprentice',
          relationship: 'employee',
          fixedTerm: true,
        },
      ];
  }
}

function limits(answers: TermsAnswers): Limits {
  const type = answers.contractType;
  const employed = answers.relationship !== 'contractor';
  return {
    durationMonths:
      type === 'apprenticeship'
        ? { min: 8, max: null }
        : type === 'fixed_term'
          ? { min: 0, max: null }
          : null,
    // The 48-hour limit can be opted out of in writing (WTR 1998 reg. 5): a warning, not a cap.
    maxWeeklyMinutes: 84 * 60,
    probation: employed
      ? { allowed: true, required: false, max: null, default: len(3, 'months') }
      : { allowed: false, required: false, max: null, default: null },
    noticeEmployee: answers.relationship === 'employee' ? len(1, 'weeks') : len(0, 'days'),
    noticeEmployer: answers.relationship === 'employee' ? len(1, 'weeks') : len(0, 'days'),
  };
}

function check(answers: TermsAnswers): TermsIssue[] {
  const out: TermsIssue[] = [];
  if ((answers.weeklyMinutes ?? 0) > 48 * 60) {
    out.push(
      issue(
        'hours',
        'above_48_hours',
        'Working Time Regulations 1998 reg. 4',
        'Above 48 hours a week needs the worker’s written opt-out',
        'warning',
      ),
    );
  }
  if (answers.probation != null && lengthDays(answers.probation) > lengthDays(len(6, 'months'))) {
    out.push(
      issue(
        'probation',
        'long_probation',
        'company practice',
        'A probation over 6 months is unusual and hard to justify',
        'warning',
      ),
    );
  }
  const { contractStart: start, contractEnd: end } = answers;
  if (
    answers.contractType === 'fixed_term' &&
    start !== undefined &&
    end != null &&
    monthsCovered(start, end) >= 48
  ) {
    out.push(
      issue(
        'duration',
        'four_years_successive',
        'Fixed-term Employees Regulations 2002 reg. 8',
        'Four years of successive fixed terms make the contract permanent unless objectively justified',
        'warning',
      ),
    );
  }
  if (answers.relationship !== 'employee') {
    out.push(
      issue(
        'relationship',
        'status_by_facts',
        'ERA 1996 s. 230',
        'The label does not decide status: control, personal service and mutual obligation do',
        'warning',
      ),
    );
  }
  return out;
}

export const unitedKingdom: TermsPack = {
  country: 'GB',
  version: 'gb-2026.1',
  reviewed: false,
  regions: [
    { key: 'ENG', label: 'England' },
    { key: 'SCT', label: 'Scotland' },
    { key: 'WLS', label: 'Wales' },
    { key: 'NIR', label: 'Northern Ireland' },
  ],
  regionRequired: true,
  relationships: () => [
    { key: 'employee', label: 'Employee' },
    { key: 'worker', label: 'Worker' },
    { key: 'contractor', label: 'Self-employed' },
  ],
  contractTypes: types,
  fixedTermReasons: () => [],
  asksPreviousEmployment: () => false,
  agreementRequired: () => false,
  limits,
  paymentsPerYear: () => [12],
  minimumAnnualPayMinor(answers, _entity, on) {
    if (answers.relationship === 'contractor') return null;
    const rate =
      answers.contractType === 'apprenticeship' ? onDate(APPRENTICE, on) : onDate(NLW, on);
    return yearlyFromHourly(rate, answers.weeklyMinutes ?? 0);
  },
  nonCompete: (answers) =>
    answers.relationship === 'contractor'
      ? {
          allowed: false,
          reason:
            'Restraints on a self-employed contractor are a commercial matter, not an employment term',
          maxMonths: 0,
        }
      : { allowed: true, reason: '', maxMonths: 12 },
  rules: (): Rule[] => [
    {
      step: 'relationship',
      text: 'Employee, worker or self-employed: the facts decide status, not the label.',
      source: 'ERA 1996 s. 230',
    },
    {
      step: 'duration',
      text: 'No maximum fixed term; four years of successive terms make it permanent unless justified.',
      source: 'FTE Regulations 2002 reg. 8',
    },
    {
      step: 'probation',
      text: 'Not statutory; 3 months is usual and over 6 is unusual.',
      source: 'company practice',
    },
    {
      step: 'notice',
      text: 'The employer gives at least 1 week after a month’s service, then 1 week per year up to 12; the employee at least 1 week.',
      source: 'ERA 1996 s. 86',
    },
    {
      step: 'hours',
      text: '48 hours a week averaged over 17 weeks unless the worker opts out in writing.',
      source: 'WTR 1998 regs. 4, 5',
    },
    {
      step: 'pay',
      text: 'At least the National Minimum or Living Wage for the person’s age band.',
      source: 'National Minimum Wage Act 1998',
    },
    {
      step: 'benefits',
      text: '5.6 weeks of holiday; pension auto-enrolment.',
      source: 'WTR 1998 reg. 13; Pensions Act 2008',
    },
    {
      step: 'summary',
      text: 'A written statement of particulars on or before day one, and a right-to-work check before the start.',
      source: 'ERA 1996 s. 1; IANA 2006',
    },
  ],
  check,
  documents: (answers) =>
    answers.relationship === 'contractor'
      ? ['services_agreement']
      : ['contract', 'written_statement'],
  conditions: (answers) => (answers.relationship === 'contractor' ? [] : ['right_to_work']),
  signature: () => 'electronic',
};
