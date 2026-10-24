import { CalendarDate, ResolvedTerms } from '@kithena/contracts';
import { describe, expect, it } from 'vitest';

import { contractFigures, particularsFor, toConfirm, type ContractFacts } from './particulars.js';

const base = {
  region: null,
  packVersion: 'x-2026.1',
  relationship: 'employee',
  employmentType: 'permanent',
  fixedTermReason: null,
  contractStart: '2026-12-01',
  contractEnd: null,
  workingPattern: 'full_time',
  weeklyMinutes: 2250,
  fte: '1.0000',
  probation: { count: 6, unit: 'months' },
  probationEnd: '2027-05-31',
  noticeEmployee: { count: 1, unit: 'months' },
  noticeEmployer: { count: 1, unit: 'months' },
  workMode: 'onsite',
  hybridDaysOnsite: null,
  remoteCountry: null,
  collectiveAgreement: null,
  nonCompeteMonths: null,
  mobilityClause: false,
  paymentsPerYear: 12,
  signature: 'electronic',
  documents: ['contract'],
  conditions: ['right_to_work'],
} as const;

const facts = (country: 'GB' | 'DE' | 'ES' | 'US' | 'IN', more: object = {}): ContractFacts => ({
  employer: { name: 'Acme Ltd', address: null },
  employee: { name: 'Yuki Sato', address: null },
  role: 'Platform engineer',
  placeOfWork: 'London, GB',
  terms: ResolvedTerms.parse({ ...base, country, contractType: 'permanent', ...more }),
  pay: {
    baseMinor: 6_500_000,
    currency: 'GBP',
    frequency: 'year',
    variableTargetMinor: 0,
    signOnMinor: 0,
    relocationMinor: 0,
  },
  benefits: ['Pension', 'Private health'],
  startDate: CalendarDate.parse('2026-12-01'),
  overtimeExempt: null,
});

const of = (f: ContractFacts) => new Map(particularsFor(f).map((p) => [p.key, p]));

describe('what the law says a contract states (statutory particulars)', () => {
  it('gives a British contract the day-one written statement, statutory holiday included', () => {
    const p = of(facts('GB'));
    expect(p.get('pay')).toMatchObject({ value: '65000.00 GBP a year, paid in 12 payments' });
    expect(p.get('holiday')?.value).toMatch(/5\.6 weeks/u);
    expect(p.get('holiday')?.law).toMatch(/Working Time Regulations/u);
    expect(p.get('sick_pay')).toMatchObject({ value: null });
    expect(p.get('continuous_employment')).toMatchObject({ value: '2026-12-01' });
    expect(p.has('end')).toBe(false);
    expect(p.has('dismissal_procedure')).toBe(false);
  });

  it('gives a German one the Nachweisgesetz list, the dismissal procedure and the end of a fixed term', () => {
    const p = of(facts('DE', { contractEnd: '2027-11-30', employmentType: 'fixed_term' }));
    expect(p.get('dismissal_procedure')?.value).toMatch(/§ 4 KSchG/u);
    expect(p.get('end')).toMatchObject({ value: '2027-11-30' });
    expect(p.get('employer_address')).toMatchObject({ value: null });
    expect(p.get('hours')).toMatchObject({ value: '37.5 hours a week (FTE 1.0000), on site' });
  });

  it('says a Spanish contract’s payments a year and its collective agreement', () => {
    const p = of(
      facts('ES', {
        paymentsPerYear: 14,
        collectiveAgreement: { key: 'consultoria', group: 'grupo_1' },
      }),
    );
    expect(p.get('pay')?.value).toMatch(/14 payments/u);
    expect(p.get('collective_agreement')).toMatchObject({ value: 'consultoria, group grupo_1' });
  });

  it('says an American one is at will, and whether overtime is paid', () => {
    const p = of({ ...facts('US', { contractType: 'at_will_full_time' }), overtimeExempt: true });
    expect(p.get('at_will')?.value).toMatch(/at will/u);
    expect(p.get('overtime_status')).toMatchObject({ value: 'exempt (FLSA)' });
    expect(p.has('holiday')).toBe(true);
  });

  it('finds what a draft still asks a person to confirm, and figures nobody gave', () => {
    const draft =
      'The employee is paid 65000.00 GBP a year. Holiday: [[TO CONFIRM: holiday year]]. A bonus of 5000 applies. [[TO CONFIRM: sick pay]]';
    expect(toConfirm(draft)).toEqual(['holiday year', 'sick pay']);
    expect(contractFigures(draft, particularsFor(facts('GB')))).toEqual(['5000']);
  });
});
