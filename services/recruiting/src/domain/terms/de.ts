import type { CalendarDate, TermsIssue } from '@kithena/contracts';

import { addYears, monthsCovered } from '../dates.js';
import {
  issue,
  len,
  lengthDays,
  onDate,
  yearlyFromHourly,
  type Choice,
  type ContractTypeChoice,
  type EntityFacts,
  type Limits,
  type Rule,
  type TermsAnswers,
  type TermsPack,
  noLeave,
  weeksOfLeave,
} from './pack.js';

/**
 * Germany (Recruiting PRD §19.4). Signed off by the owner on 21 Oct 2026
 * (REC-150) from the statutes each rule cites, as they stand for 2026; a
 * German employment lawyer's read is still worth having before launch, and
 * every rule names its source so it can be checked line by line.
 */

const LAENDER: readonly Choice[] = [
  ['BW', 'Baden-Württemberg'],
  ['BY', 'Bayern'],
  ['BE', 'Berlin'],
  ['BB', 'Brandenburg'],
  ['HB', 'Bremen'],
  ['HH', 'Hamburg'],
  ['HE', 'Hessen'],
  ['MV', 'Mecklenburg-Vorpommern'],
  ['NI', 'Niedersachsen'],
  ['NW', 'Nordrhein-Westfalen'],
  ['RP', 'Rheinland-Pfalz'],
  ['SL', 'Saarland'],
  ['SN', 'Sachsen'],
  ['ST', 'Sachsen-Anhalt'],
  ['SH', 'Schleswig-Holstein'],
  ['TH', 'Thüringen'],
].map(([key, label]) => ({ key: key as string, label: label as string }));

/** Mindestlohn per hour, in cents, from the date it applies (MiLoG § 1, the commission's orders). */
const MINDESTLOHN: readonly (readonly [string, number])[] = [
  ['2025-01-01', 1282],
  ['2026-01-01', 1390],
  ['2027-01-01', 1460],
];

/** Mindestausbildungsvergütung, first year, cents a month (BBiG § 17). */
const AUSBILDUNG_MONTHLY: readonly (readonly [string, number])[] = [
  ['2025-01-01', 68_200],
  ['2026-01-01', 72_400],
];

/** The Minijob limit follows the Mindestlohn at 10 hours a week (SGB IV § 8(1a)). */
const MINIJOB_MONTHLY: readonly (readonly [string, number])[] = [
  ['2025-01-01', 55_600],
  ['2026-01-01', 60_300],
  ['2027-01-01', 63_300],
];

const SACHGRUENDE: readonly Choice[] = [
  { key: 'temporary_need', label: 'A temporary need for the work (§ 14(1) no. 1)' },
  { key: 'after_training', label: 'After training or study, to help into work (no. 2)' },
  { key: 'substitution', label: 'Covering for another employee (no. 3)' },
  { key: 'nature_of_work', label: 'The nature of the work (no. 4)' },
  { key: 'trial', label: 'To try the person out (no. 5)' },
  { key: 'personal_reasons', label: 'Reasons in the person (no. 6)' },
  { key: 'budget_funds', label: 'Funded by a budget for fixed-term work (no. 7)' },
  { key: 'court_settlement', label: 'A court settlement (no. 8)' },
];

const WRITTEN_FORM = new Set([
  'befristet_mit_sachgrund',
  'befristet_ohne_sachgrund',
  'kurzfristig',
  'werkstudent',
  'praktikum_freiwillig',
]);

/** What each contract means in Germany, in a line beside the choice. */
export const NOTE: Readonly<Record<string, string>> = {
  unbefristet:
    'Open-ended, full or part time by the hours you set. After six months in a company of more than ten, the Kündigungsschutzgesetz protects against dismissal.',
  befristet_mit_sachgrund:
    'Fixed term for one of the objective reasons in § 14(1) TzBfG, of any length. Signed in writing before work starts, or it becomes open-ended.',
  befristet_ohne_sachgrund:
    'Fixed term without a reason: at most 2 years with up to 3 extensions (4 years in a company’s first 4), and never for someone employed here before.',
  kurzfristig:
    'Short-term work: at most 3 months or 70 working days in a calendar year, not the person’s main occupation. No social insurance contributions (§ 8(1) no. 2 SGB IV).',
  minijob:
    'Pay up to €603 a month in 2026 (§ 8(1a) SGB IV), with flat-rate employer contributions. Every employee right applies, leave included.',
  werkstudent:
    'An enrolled student, up to 20 hours a week in term time. Only pension insurance is due (§ 5(3) SGB VI).',
  praktikum_pflicht:
    'Required by a study or training regulation. Not paid the Mindestlohn (§ 22(1) no. 1 MiLoG).',
  praktikum_freiwillig:
    'Voluntary internship. The Mindestlohn applies once it runs over 3 months (§ 22(1) no. 3 MiLoG); the terms are set out in writing (§ 2(1a) NachwG).',
  ausbildung:
    'Vocational training under the BBiG: 24 to 42 months, a probation of 1 to 4 months, at least €724 a month in the first year for a start in 2026.',
  freier_mitarbeiter:
    'A service contract, not employment: no leave, probation or Mindestlohn. Set hours, place and instructions would make it employment (§ 7 SGB IV).',
};

const RELATIONSHIPS: readonly Choice[] = [
  {
    key: 'employee',
    label: 'Arbeitnehmer (employee)',
    note: 'On the payroll with social insurance, paid the Mindestlohn at least, and at least 20 days’ paid leave on a five-day week.',
  },
  {
    key: 'contractor',
    label: 'Freier Mitarbeiter (freelance)',
    note: 'Self-employed and invoicing, free to decide when, where and how. Misclassified, the employer owes the social insurance back.',
  },
];

const youngCompany = (entity: EntityFacts, start: CalendarDate | undefined): boolean =>
  entity.foundedOn !== null && start !== undefined && start < addYears(entity.foundedOn, 4);

function types(answers: TermsAnswers): ContractTypeChoice[] {
  const employee = answers.relationship !== 'contractor';
  const off = (reason: string | false) => (reason === false ? {} : { unavailable: reason });
  return [
    {
      key: 'unbefristet',
      label: 'Unbefristet (permanent)',
      employmentType: 'permanent',
      relationship: 'employee',
      fixedTerm: false,
    },
    {
      key: 'befristet_mit_sachgrund',
      label: 'Befristet mit Sachgrund (§ 14(1) TzBfG)',
      employmentType: 'fixed_term',
      relationship: 'employee',
      fixedTerm: true,
    },
    {
      key: 'befristet_ohne_sachgrund',
      label: 'Befristet ohne Sachgrund (§ 14(2) TzBfG)',
      employmentType: 'fixed_term',
      relationship: 'employee',
      fixedTerm: true,
      ...off(
        answers.previouslyEmployed === true &&
          'Not allowed: this person worked for this employer before (§ 14(2) sentence 2 TzBfG)',
      ),
    },
    {
      key: 'kurzfristig',
      label: 'Kurzfristige Beschäftigung (short-term)',
      employmentType: 'seasonal',
      relationship: 'employee',
      fixedTerm: true,
    },
    {
      key: 'minijob',
      label: 'Minijob (geringfügige Beschäftigung)',
      employmentType: 'permanent',
      relationship: 'employee',
      fixedTerm: false,
    },
    {
      key: 'werkstudent',
      label: 'Werkstudent',
      employmentType: 'intern',
      relationship: 'employee',
      fixedTerm: true,
    },
    {
      key: 'praktikum_pflicht',
      label: 'Pflichtpraktikum',
      employmentType: 'intern',
      relationship: 'employee',
      fixedTerm: true,
    },
    {
      key: 'praktikum_freiwillig',
      label: 'Freiwilliges Praktikum',
      employmentType: 'intern',
      relationship: 'employee',
      fixedTerm: true,
    },
    {
      key: 'ausbildung',
      label: 'Ausbildung (BBiG)',
      employmentType: 'apprentice',
      relationship: 'employee',
      fixedTerm: true,
    },
    {
      key: 'freier_mitarbeiter',
      label: 'Freier Mitarbeiter (freelance)',
      employmentType: 'contractor',
      relationship: 'contractor',
      fixedTerm: false,
    },
  ]
    .filter((type) =>
      employee ? type.relationship === 'employee' : type.relationship === 'contractor',
    )
    .map((type) => ({ ...type, note: NOTE[type.key] ?? '' })) as ContractTypeChoice[];
}

function limits(answers: TermsAnswers, entity: EntityFacts): Limits {
  const type = answers.contractType;
  const ohne = type === 'befristet_ohne_sachgrund';
  return {
    durationMonths: ohne
      ? { min: 0, max: youngCompany(entity, answers.contractStart) ? 48 : 24 }
      : type === 'ausbildung'
        ? { min: 24, max: 42 }
        : type === 'kurzfristig'
          ? { min: 0, max: 3 }
          : type === 'praktikum_freiwillig' || type === 'praktikum_pflicht'
            ? { min: 0, max: 12 }
            : type?.startsWith('befristet') === true || type === 'werkstudent'
              ? { min: 0, max: null }
              : null,
    // § 3 ArbZG: 8 hours a day on six working days; Werkstudent 20 hours in term time.
    maxWeeklyMinutes: type === 'werkstudent' ? 20 * 60 : 48 * 60,
    probation:
      type === 'ausbildung'
        ? { allowed: true, required: true, max: len(4, 'months'), default: len(4, 'months') }
        : type === 'freier_mitarbeiter'
          ? { allowed: false, required: false, max: null, default: null }
          : { allowed: true, required: false, max: len(6, 'months'), default: len(6, 'months') },
    // § 622(1) BGB: four weeks to the 15th or the end of a month.
    noticeEmployee: type === 'freier_mitarbeiter' ? len(0, 'days') : len(4, 'weeks'),
    noticeEmployer: type === 'freier_mitarbeiter' ? len(0, 'days') : len(4, 'weeks'),
  };
}

function check(answers: TermsAnswers, entity: EntityFacts, on: CalendarDate): TermsIssue[] {
  const out: TermsIssue[] = [];
  const type = answers.contractType;
  const { contractStart: start, contractEnd: end, probation } = answers;
  if (
    probation != null &&
    start !== undefined &&
    end != null &&
    type?.startsWith('befristet') === true &&
    lengthDays(probation) * 2 > monthsCovered(start, end) * 30
  ) {
    out.push(
      issue(
        'probation',
        'probation_disproportionate',
        '§ 15(3) TzBfG',
        'A probation over half of a fixed term is likely disproportionate',
        'warning',
      ),
    );
  }
  if (
    answers.noticeEmployee !== undefined &&
    answers.noticeEmployer !== undefined &&
    lengthDays(answers.noticeEmployee) > lengthDays(answers.noticeEmployer)
  ) {
    out.push(
      issue(
        'notice',
        'employee_notice_longer',
        '§ 622(6) BGB',
        "The employee's notice may not be longer than the employer's",
      ),
    );
  }
  if (type === 'minijob' && answers.annualPayMinor !== undefined) {
    const limit = onDate(MINIJOB_MONTHLY, on) * 12;
    if (answers.annualPayMinor > limit) {
      out.push(
        issue(
          'pay',
          'minijob_above_limit',
          '§ 8(1a) SGB IV',
          `A Minijob earns at most €${String(limit / 1200)} a month`,
        ),
      );
    }
  }
  if (type === 'freier_mitarbeiter') {
    out.push(
      issue(
        'relationship',
        'scheinselbststaendigkeit',
        '§ 7 SGB IV',
        'Check the freelancer is not in fact an employee (Scheinselbstständigkeit): set hours, place and instructions point to employment',
        'warning',
      ),
    );
  }
  if ((answers.nonCompeteMonths ?? 0) > 0 && (answers.nonCompeteCompensationPercent ?? 0) < 50) {
    out.push(
      issue(
        'clauses',
        'non_compete_uncompensated',
        '§ 74(2) HGB',
        'A non-compete binds only with compensation of at least half the last pay',
      ),
    );
  }
  if (answers.workMode === 'remote' && answers.remoteKind == null) {
    out.push(
      issue(
        'work_mode',
        'remote_kind_required',
        '§ 2(7) ArbStättV',
        'Say whether this is mobile work or Telearbeit',
      ),
    );
  }
  if (entity.hasWorksCouncil) {
    out.push(
      issue(
        'summary',
        'works_council_consent',
        '§ 99 BetrVG',
        'The works council must consent to this hire before the offer is sent',
        'warning',
      ),
    );
  }
  return out;
}

export const germany: TermsPack = {
  country: 'DE',
  version: 'de-2026.1',
  reviewed: true,
  regions: LAENDER,
  regionRequired: true,
  relationships: () => RELATIONSHIPS,
  contractTypes: types,
  fixedTermReasons: (answers) =>
    answers.contractType === 'befristet_mit_sachgrund' ? SACHGRUENDE : [],
  asksPreviousEmployment: (answers) => answers.contractType === 'befristet_ohne_sachgrund',
  agreementRequired: () => false,
  limits,
  paymentsPerYear: () => [12, 13],
  minimumAnnualPayMinor(answers, _entity, on) {
    const minutes = answers.weeklyMinutes ?? 0;
    switch (answers.contractType) {
      case 'praktikum_pflicht':
      case 'freier_mitarbeiter':
        return null;
      case 'ausbildung':
        return onDate(AUSBILDUNG_MONTHLY, on) * 12;
      case 'praktikum_freiwillig': {
        // MiLoG § 22(1) no. 3: a voluntary internship of up to three months is exempt.
        const { contractStart: start, contractEnd: end } = answers;
        if (start !== undefined && end != null && monthsCovered(start, end) <= 3) return null;
        return yearlyFromHourly(onDate(MINDESTLOHN, on), minutes);
      }
      default:
        return yearlyFromHourly(onDate(MINDESTLOHN, on), minutes);
    }
  },
  nonCompete: (answers) =>
    answers.relationship === 'contractor'
      ? {
          allowed: false,
          reason: 'A post-contractual restraint under §§ 74 ff. HGB binds employees',
          maxMonths: 0,
        }
      : { allowed: true, reason: '', maxMonths: 24 },
  rules(answers, entity): Rule[] {
    return [
      {
        step: 'location',
        text: 'The Land decides the public holidays.',
        source: 'Feiertagsgesetze der Länder',
      },
      {
        step: 'contract_type',
        text: 'Without an objective reason, a fixed term lasts at most 2 years with up to 3 extensions, and never for someone employed here before.',
        source: '§ 14(2) TzBfG',
      },
      ...(youngCompany(entity, answers.contractStart)
        ? [
            {
              step: 'duration' as const,
              text: 'In the first 4 years of a new company, a fixed term without reason may last up to 4 years.',
              source: '§ 14(2a) TzBfG',
            },
          ]
        : []),
      {
        step: 'contract_type',
        text: 'A fixed-term clause needs written form: printed and signed by hand, or a qualified electronic signature.',
        source: '§ 14(4) TzBfG',
      },
      {
        step: 'hours',
        text: '8 hours a day, up to 10 if averaged to 8 over 6 months.',
        source: '§ 3 ArbZG',
      },
      {
        step: 'probation',
        text: 'At most 6 months, with 2 weeks’ notice during it.',
        source: '§ 622(3) BGB',
      },
      {
        step: 'notice',
        text: '4 weeks to the 15th or the end of a month; the employer’s period grows with tenure.',
        source: '§ 622(1), (2) BGB',
      },
      { step: 'pay', text: 'At least the Mindestlohn for every hour.', source: '§ 1 MiLoG' },
      { step: 'benefits', text: 'At least 20 days’ holiday on a 5-day week.', source: '§ 3 BUrlG' },
      {
        step: 'clauses',
        text: 'A non-compete binds only with compensation of half the last pay, for at most 2 years.',
        source: '§§ 74, 74a HGB',
      },
      {
        step: 'summary',
        text: 'The essential terms are given in writing (text form allowed since 2025 with a receipt).',
        source: '§ 2 NachwG',
      },
    ];
  },
  check,
  documents: (answers) =>
    answers.workMode === 'remote' && answers.remoteKind === 'telearbeit'
      ? ['nachweis', 'telearbeit_agreement']
      : ['nachweis'],
  conditions: () => [],
  // § 14(4) TzBfG: every fixed-term employment, not the Ausbildung (ended by
  // BBiG § 21) nor a Pflichtpraktikum (not employment).
  minimumLeave: (answers, daysPerWeek) =>
    answers.relationship !== 'employee'
      ? noLeave('BUrlG § 2', 'A freelancer has no statutory leave.')
      : {
          days: weeksOfLeave(4, daysPerWeek),
          unit: 'working_days',
          source: 'BUrlG § 3',
          note: '24 working days on a six-day week, so four weeks of the days worked.',
        },
  signature: (answers) =>
    answers.contractType !== undefined && WRITTEN_FORM.has(answers.contractType)
      ? 'wet_ink'
      : 'electronic',
};
