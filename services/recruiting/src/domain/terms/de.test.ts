import { CalendarDate } from '@kithena/contracts';
import { describe, expect, it } from 'vitest';

import { germany } from './de.js';
import {
  composerSteps,
  len,
  termsIssues,
  validateTerms,
  type EntityFacts,
  type TermsAnswers,
} from './pack.js';

const d = (s: string) => CalendarDate.parse(s);

const berlin: EntityFacts = {
  legalEntityId: '00000000-0000-4000-8000-0000000000de',
  country: 'DE',
  currency: 'EUR',
  fullTimeWeeklyMinutes: 40 * 60,
  headcount: 140,
  foundedOn: d('2015-03-01'),
  hasWorksCouncil: false,
};

const permanent: TermsAnswers = {
  region: 'BE',
  relationship: 'employee',
  contractType: 'unbefristet',
  contractStart: d('2026-11-01'),
  contractEnd: null,
  weeklyMinutes: 40 * 60,
  probation: len(6, 'months'),
  noticeEmployee: len(4, 'weeks'),
  noticeEmployer: len(4, 'weeks'),
  workMode: 'hybrid',
  hybridDaysOnsite: 2,
  agreement: null,
  annualPayMinor: 7_800_000,
  paymentsPerYear: 12,
  benefitIds: [],
  nonCompeteMonths: null,
  mobilityClause: false,
};

const on = d('2026-10-15');
const codes = (answers: TermsAnswers, entity = berlin) =>
  termsIssues(germany, answers, entity, on).map((found) => found.code);

describe('Germany: lawful and unlawful terms (PRD §19.4)', () => {
  it.each<[string, TermsAnswers, readonly string[]]>([
    ['a permanent hybrid contract', permanent, []],
    [
      'a fixed term without reason, two years',
      {
        ...permanent,
        contractType: 'befristet_ohne_sachgrund',
        contractEnd: d('2028-10-31'),
        probation: len(6, 'months'),
      },
      [],
    ],
    [
      'a fixed term without reason, longer than two years',
      { ...permanent, contractType: 'befristet_ohne_sachgrund', contractEnd: d('2029-04-30') },
      ['too_long'],
    ],
    [
      'a fixed term without reason for someone employed here before',
      {
        ...permanent,
        contractType: 'befristet_ohne_sachgrund',
        contractEnd: d('2027-10-31'),
        previouslyEmployed: true,
      },
      ['type_unavailable'],
    ],
    [
      'a fixed term with reason, but none given',
      {
        ...permanent,
        contractType: 'befristet_mit_sachgrund',
        contractEnd: d('2027-10-31'),
        fixedTermReason: null,
      },
      ['reason_required'],
    ],
    [
      'a probation of seven months',
      { ...permanent, probation: len(7, 'months') },
      ['probation_too_long'],
    ],
    [
      'three weeks’ notice from the employer',
      { ...permanent, noticeEmployee: len(3, 'weeks'), noticeEmployer: len(3, 'weeks') },
      ['notice_employee_too_short', 'notice_employer_too_short'],
    ],
    [
      'a longer notice for the employee than the employer',
      { ...permanent, noticeEmployee: len(3, 'months'), noticeEmployer: len(1, 'months') },
      ['employee_notice_longer'],
    ],
    ['50 hours a week', { ...permanent, weeklyMinutes: 50 * 60 }, ['hours_above_maximum']],
    [
      'pay under the Mindestlohn',
      { ...permanent, annualPayMinor: 2_500_000 },
      ['below_minimum_wage'],
    ],
    [
      'a Minijob above the monthly limit',
      { ...permanent, contractType: 'minijob', weeklyMinutes: 10 * 60, annualPayMinor: 900_000 },
      ['minijob_above_limit'],
    ],
    [
      'a Werkstudent at 25 hours',
      {
        ...permanent,
        contractType: 'werkstudent',
        contractEnd: d('2027-10-31'),
        weeklyMinutes: 25 * 60,
        annualPayMinor: 2_000_000,
      },
      ['hours_above_maximum'],
    ],
    [
      'an Ausbildung without probation',
      {
        ...permanent,
        contractType: 'ausbildung',
        contractEnd: d('2029-08-31'),
        probation: null,
        annualPayMinor: 1_000_000,
      },
      ['probation_required'],
    ],
    [
      'an uncompensated non-compete',
      { ...permanent, nonCompeteMonths: 12, nonCompeteCompensationPercent: 0 },
      ['non_compete_uncompensated'],
    ],
    [
      'a non-compete of three years',
      { ...permanent, nonCompeteMonths: 36, nonCompeteCompensationPercent: 50 },
      ['non_compete_too_long'],
    ],
    [
      'remote without saying which kind',
      { ...permanent, workMode: 'remote', remoteCountry: 'DE' },
      ['remote_kind_required'],
    ],
    ['no Land', { ...permanent, region: null }, ['region_required']],
  ])('%s', (_case, answers, expected) => {
    expect(
      termsIssues(germany, answers, berlin, on)
        .filter((found) => found.severity === 'error')
        .map((found) => found.code),
    ).toEqual(expected);
  });

  it('lets a company in its first four years fix a term for up to four years', () => {
    const young = { ...berlin, foundedOn: d('2024-01-01') };
    const answers = {
      ...permanent,
      contractType: 'befristet_ohne_sachgrund',
      contractEnd: d('2030-10-31'),
    };
    expect(codes(answers, young)).not.toContain('too_long');
    expect(codes(answers)).toContain('too_long');
  });

  it('warns about a probation over half a short fixed term', () => {
    const answers = {
      ...permanent,
      contractType: 'befristet_ohne_sachgrund',
      contractEnd: d('2027-04-30'),
      probation: len(4, 'months'),
    };
    expect(codes(answers)).toContain('probation_disproportionate');
  });

  it('warns about a freelancer who may be an employee', () => {
    const answers: TermsAnswers = {
      ...permanent,
      relationship: 'contractor',
      contractType: 'freier_mitarbeiter',
      probation: null,
      noticeEmployee: len(0, 'days'),
      noticeEmployer: len(0, 'days'),
    };
    expect(termsIssues(germany, answers, berlin, on).map((f) => [f.code, f.severity])).toEqual([
      ['scheinselbststaendigkeit', 'warning'],
    ]);
  });
});

describe('the resolved terms', () => {
  it('marks a fixed term for wet ink and computes the probation end', () => {
    const result = validateTerms(
      germany,
      { ...permanent, contractType: 'befristet_ohne_sachgrund', contractEnd: d('2028-10-31') },
      berlin,
      on,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.terms).toMatchObject({
      signature: 'wet_ink',
      employmentType: 'fixed_term',
      probationEnd: '2027-04-30',
      fte: '1.0000',
      workingPattern: 'full_time',
      documents: ['nachweis'],
      packVersion: 'de-2026.1',
    });
  });

  it('signs a permanent contract electronically and computes part-time FTE', () => {
    const result = validateTerms(
      germany,
      { ...permanent, weeklyMinutes: 30 * 60, annualPayMinor: 5_000_000 },
      berlin,
      on,
    );
    expect(result.ok && result.value.terms).toMatchObject({
      signature: 'electronic',
      fte: '0.7500',
      workingPattern: 'part_time',
    });
  });

  it('returns every error, not the first', () => {
    const result = validateTerms(
      germany,
      { ...permanent, probation: len(9, 'months'), weeklyMinutes: 60 * 60 },
      berlin,
      on,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.map((found) => found.code)).toEqual([
      'hours_above_maximum',
      'probation_too_long',
    ]);
  });
});

describe('the composer', () => {
  it('skips the fixed-term reason for a permanent contract and marks a step an earlier change broke', () => {
    const steps = composerSteps(germany, { ...permanent, probation: len(8, 'months') }, berlin, on);
    const state = Object.fromEntries(steps.map((step) => [step.step, step.state]));
    expect(state).toMatchObject({
      fixed_term_reason: 'skipped',
      probation: 'invalid',
      duration: 'done',
      summary: 'open',
    });
  });

  it('asks about earlier employment only for a fixed term without reason', () => {
    expect(germany.asksPreviousEmployment({ contractType: 'befristet_ohne_sachgrund' })).toBe(true);
    expect(germany.asksPreviousEmployment({ contractType: 'unbefristet' })).toBe(false);
  });
});
