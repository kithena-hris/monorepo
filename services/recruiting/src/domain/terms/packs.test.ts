import { CalendarDate, type LaunchCountry } from '@kithena/contracts';
import { describe, expect, it } from 'vitest';

import { len, termsIssues, validateTerms, type EntityFacts, type TermsAnswers } from './pack.js';
import { PACKS, packFor } from './packs.js';

const d = (s: string) => CalendarDate.parse(s);
const on = d('2026-10-15');

const entity = (country: LaunchCountry, extra: Partial<EntityFacts> = {}): EntityFacts => ({
  legalEntityId: '00000000-0000-4000-8000-000000000001',
  country,
  currency: 'EUR',
  fullTimeWeeklyMinutes: 40 * 60,
  headcount: 120,
  foundedOn: null,
  hasWorksCouncil: false,
  ...extra,
});

const base: TermsAnswers = {
  relationship: 'employee',
  contractStart: d('2026-12-01'),
  contractEnd: null,
  weeklyMinutes: 40 * 60,
  workMode: 'onsite',
  agreement: null,
  paymentsPerYear: 12,
  benefitIds: [],
  nonCompeteMonths: null,
  mobilityClause: false,
};

const errors = (country: LaunchCountry, answers: TermsAnswers, facts = entity(country)) =>
  termsIssues(packFor(country), answers, facts, on)
    .filter((found) => found.severity === 'error')
    .map((found) => found.code);
const warnings = (country: LaunchCountry, answers: TermsAnswers, facts = entity(country)) =>
  termsIssues(packFor(country), answers, facts, on)
    .filter((found) => found.severity === 'warning')
    .map((found) => found.code);

const spain: TermsAnswers = {
  ...base,
  region: 'MD',
  contractType: 'indefinido',
  roleGroup: 'qualified',
  probation: len(6, 'months'),
  noticeEmployee: len(15, 'days'),
  noticeEmployer: len(15, 'days'),
  agreement: { key: 'consultoria', group: 'grupo_1' },
  annualPayMinor: 5_300_000,
  paymentsPerYear: 14,
};

describe('the questions an offer asks for a country’s checks', () => {
  it('asks Spain’s qualified technician and the US exemption, where their checks need them', () => {
    expect(packFor('ES').asks?.(spain)).toEqual(['roleGroup']);
    expect(packFor('ES').asks?.({ ...spain, contractType: 'autonomo' })).toEqual([]);
    expect(packFor('US').asks?.({ relationship: 'employee' })).toEqual(['exempt']);
    expect(packFor('US').asks?.({ relationship: 'contractor' })).toEqual([]);
    expect(packFor('GB').asks?.({ relationship: 'employee' }) ?? []).toEqual([]);
  });
});

describe('Spain (PRD §19.5)', () => {
  it.each<[string, TermsAnswers, readonly string[]]>([
    ['a permanent contract under an agreement', spain, []],
    ['no collective agreement', { ...spain, agreement: null }, ['agreement_required']],
    // Written as words, it cannot be a key: said as a finding, never thrown (an offer read failed on it).
    [
      'an agreement written as words',
      { ...spain, agreement: { key: 'Convenio de consultoría', group: null } },
      ['agreement_key'],
    ],
    [
      'probation of 6 months for a role that is not qualified',
      { ...spain, roleGroup: 'other' },
      ['probation_too_long'],
    ],
    [
      'probation for someone who did the job before',
      { ...spain, previouslyEmployed: true },
      ['probation_not_allowed'],
    ],
    [
      'a production contract of 8 months with no agreement',
      {
        ...spain,
        contractType: 'temporal_produccion',
        fixedTermReason: 'unforeseeable_increase',
        contractEnd: d('2027-07-31'),
        probation: len(1, 'months'),
        agreement: { key: 'x', group: null },
      },
      [],
    ],
    [
      'a foreseeable peak of 4 months',
      {
        ...spain,
        contractType: 'temporal_produccion',
        fixedTermReason: 'foreseeable_peak',
        contractEnd: d('2027-03-31'),
        probation: len(1, 'months'),
      },
      ['too_long'],
    ],
    [
      'a temporary contract of 6 months with 2 months’ probation',
      {
        ...spain,
        contractType: 'temporal_produccion',
        fixedTermReason: 'unforeseeable_increase',
        contractEnd: d('2027-05-31'),
        probation: len(2, 'months'),
      },
      ['probation_too_long'],
    ],
    ['41 hours a week', { ...spain, weeklyMinutes: 41 * 60 }, ['hours_above_maximum']],
    ['pay under the SMI', { ...spain, annualPayMinor: 1_500_000 }, ['below_minimum_wage']],
    ['paid in 13 payments', { ...spain, paymentsPerYear: 13 }, ['payments_not_offered']],
  ])('%s', (_case, answers, expected) => {
    expect(errors('ES', answers)).toEqual(expected);
  });

  it('adds the remote work agreement at 30% remote or more', () => {
    const hybrid = validateTerms(
      PACKS.ES,
      { ...spain, workMode: 'hybrid', hybridDaysOnsite: 3 },
      entity('ES'),
      on,
    );
    const mostly = validateTerms(
      PACKS.ES,
      { ...spain, workMode: 'hybrid', hybridDaysOnsite: 4 },
      entity('ES'),
      on,
    );
    expect(hybrid.ok && hybrid.value.terms.documents).toEqual([
      'contrato',
      'acuerdo_trabajo_a_distancia',
    ]);
    expect(mostly.ok && mostly.value.terms.documents).toEqual(['contrato']);
  });

  it('allows 3 months’ probation in a company under 25', () => {
    expect(
      errors(
        'ES',
        { ...spain, roleGroup: 'other', probation: len(3, 'months') },
        entity('ES', { headcount: 20 }),
      ),
    ).toEqual([]);
  });
});

const uk: TermsAnswers = {
  ...base,
  region: 'ENG',
  contractType: 'permanent',
  probation: len(3, 'months'),
  noticeEmployee: len(1, 'months'),
  noticeEmployer: len(1, 'months'),
  annualPayMinor: 6_000_000,
};

describe('the United Kingdom (PRD §19.6)', () => {
  it('needs a right-to-work check and a written statement', () => {
    const result = validateTerms(PACKS.GB, uk, entity('GB', { currency: 'GBP' }), on);
    expect(result.ok && result.value.terms).toMatchObject({
      conditions: ['right_to_work'],
      documents: ['contract', 'written_statement'],
    });
  });

  it.each<[string, TermsAnswers, readonly string[]]>([
    [
      'pay under the National Living Wage',
      { ...uk, annualPayMinor: 2_000_000 },
      ['below_minimum_wage'],
    ],
    [
      'no notice from the employer',
      { ...uk, noticeEmployer: len(0, 'days') },
      ['notice_employer_too_short'],
    ],
  ])('%s', (_case, answers, expected) => {
    expect(errors('GB', answers)).toEqual(expected);
  });

  it('warns, not blocks, above 48 hours and on a long probation', () => {
    expect(errors('GB', { ...uk, weeklyMinutes: 50 * 60, probation: len(9, 'months') })).toEqual(
      [],
    );
    expect(warnings('GB', { ...uk, weeklyMinutes: 50 * 60, probation: len(9, 'months') })).toEqual([
      'above_48_hours',
      'long_probation',
    ]);
  });
});

const india: TermsAnswers = {
  ...base,
  region: 'KA',
  contractType: 'permanent',
  weeklyMinutes: 48 * 60,
  probation: len(6, 'months'),
  noticeEmployee: len(30, 'days'),
  noticeEmployer: len(30, 'days'),
  annualPayMinor: 180_000_000,
};

describe('India (PRD §19.7)', () => {
  it('needs the state, and never offers a non-compete', () => {
    expect(errors('IN', { ...india, region: null })).toEqual(['region_required']);
    expect(errors('IN', { ...india, nonCompeteMonths: 6 })).toEqual(['non_compete_not_allowed']);
  });

  it('allows one extension of probation with a warning', () => {
    expect(errors('IN', { ...india, probation: len(12, 'months') })).toEqual([]);
    expect(warnings('IN', { ...india, probation: len(12, 'months') })).toEqual([
      'probation_extended',
    ]);
    expect(errors('IN', { ...india, probation: len(13, 'months') })).toEqual([
      'probation_too_long',
    ]);
  });
});

const california: TermsAnswers = {
  ...base,
  region: 'CA',
  contractType: 'at_will_full_time',
  probation: null,
  noticeEmployee: len(0, 'days'),
  noticeEmployer: len(0, 'days'),
  annualPayMinor: 12_000_000,
  exempt: true,
};

describe('the United States (PRD §19.8)', () => {
  it.each<[string, TermsAnswers, readonly string[]]>([
    ['an exempt Californian at $120k', california, []],
    [
      'a non-compete in California',
      { ...california, nonCompeteMonths: 12 },
      ['non_compete_not_allowed'],
    ],
    [
      'exempt below California’s threshold',
      { ...california, annualPayMinor: 6_000_000 },
      ['below_exempt_threshold'],
    ],
    ['exempt status not given', { ...california, exempt: null }, ['exempt_required']],
    [
      'pay under California’s minimum',
      { ...california, exempt: false, annualPayMinor: 3_000_000 },
      ['below_minimum_wage'],
    ],
    ['no state', { ...california, region: null }, ['region_required']],
  ])('%s', (_case, answers, expected) => {
    expect(errors('US', answers, entity('US', { currency: 'USD' }))).toEqual(expected);
  });

  it('allows a non-compete in Texas and warns about the ABC test for a contractor in New Jersey', () => {
    expect(errors('US', { ...california, region: 'TX', nonCompeteMonths: 12 })).toEqual([]);
    expect(
      warnings('US', {
        ...california,
        region: 'NJ',
        relationship: 'contractor',
        contractType: 'contractor_1099',
        exempt: null,
      }),
    ).toContain('abc_test');
  });

  it('marks an I-9 condition on every employee', () => {
    const result = validateTerms(PACKS.US, california, entity('US', { currency: 'USD' }), on);
    expect(result.ok && result.value.terms.conditions).toEqual(['right_to_work']);
  });
});

describe('every pack', () => {
  it.each(Object.values(PACKS).map((pack) => [pack.country, pack] as const))(
    '%s cites a source for every rule, notes every choice and is signed off',
    (_country, pack) => {
      expect(pack.reviewed).toBe(true);
      for (const r of pack.relationships()) expect(r.note?.length ?? 0).toBeGreaterThan(0);
      for (const relationship of ['employee', 'contractor'] as const)
        for (const t of pack.contractTypes({ relationship }, entity(pack.country)))
          expect(t.note?.length ?? 0).toBeGreaterThan(0);
      for (const rule of pack.rules({}, entity(pack.country)))
        expect(rule.source.length).toBeGreaterThan(0);
    },
  );
});

describe('the statutory minimum of paid leave, by country', () => {
  const employee = { relationship: 'employee' as const };
  it('scales a working-week minimum to the days worked a week', () => {
    // DE BUrlG § 3: 24 working days on a six-day week, so 20 on five and 16 on four.
    expect(packFor('DE').minimumLeave(employee, 5)).toMatchObject({ days: 20 });
    expect(packFor('DE').minimumLeave(employee, 4)).toMatchObject({ days: 16 });
    // GB WTR reg. 13 and 13A: 5.6 weeks, capped at 28 days.
    expect(packFor('GB').minimumLeave(employee, 5)).toMatchObject({ days: 28 });
    expect(packFor('GB').minimumLeave(employee, 6)).toMatchObject({ days: 28 });
    expect(packFor('GB').minimumLeave(employee, 3)).toMatchObject({ days: 17 });
  });

  it('counts Spain in calendar days, and says where each rule comes from', () => {
    const es = packFor('ES').minimumLeave(employee, 5);
    expect(es).toMatchObject({ days: 30, unit: 'calendar_days' });
    expect(es.source).toContain('38');
    for (const country of Object.keys(PACKS) as LaunchCountry[])
      expect(packFor(country).minimumLeave(employee, 5).source).not.toBe('');
  });

  it('asks none where no law sets one, and none of the self-employed', () => {
    expect(packFor('US').minimumLeave(employee, 5)).toMatchObject({ days: 0 });
    for (const country of Object.keys(PACKS) as LaunchCountry[])
      expect(packFor(country).minimumLeave({ relationship: 'contractor' }, 5).days).toBe(0);
  });
});
