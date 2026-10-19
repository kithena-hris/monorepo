import { describe, expect, it } from 'vitest';

import { contractText, contractTitle } from './contract-text';

const offer = {
  offer: {
    versions: [
      {
        version: 2,
        terms: {
          probation: { count: 6, unit: 'months' },
          noticeEmployee: { count: 1, unit: 'months' },
          noticeEmployer: { count: 2, unit: 'months' },
          workMode: 'hybrid',
          hybridDaysOnsite: 3,
          paymentsPerYear: 14,
        },
        pay: {
          baseMinor: 4_200_000,
          currency: 'EUR',
          frequency: 'year' as const,
          variableTargetMinor: 0,
          signOnMinor: 100_000,
          relocationMinor: 0,
        },
        benefitIds: ['b1', 'statutory:social_security'],
        startDate: '2026-11-02',
      },
    ],
    acceptance: { version: 2, versionHash: 'abcdef0123456789' },
  },
  candidate: { name: 'Yuki Tanaka' },
  job: { title: 'Account manager' },
  checked: {
    terms: {
      contractType: 'indefinido',
      employmentType: 'permanent',
      weeklyMinutes: 2400,
      fte: '1.0000',
      documents: ['contract', 'remote_work_agreement'],
    },
  },
  benefits: [{ id: 'b1', names: { es: 'Seguro médico' } }],
};

describe('the contract from an accepted offer', () => {
  it('names the parties, the role and every term the offer carries', () => {
    const text = contractText(offer, 'Acme SL');
    expect(contractTitle(offer)).toBe('Employment contract – Yuki Tanaka');
    expect(text).toContain('between Acme SL (the employer) and Yuki Tanaka (the employee)');
    expect(text).toContain('Role: Account manager.');
    expect(text).toContain('Contract: indefinido, permanent.');
    expect(text).toContain('Start date: 2026-11-02.');
    expect(text).toContain('€42,000.00 a year, paid in 14 payments a year.');
    expect(text).toContain('Signing bonus: €1,000.00.');
    expect(text).toContain(
      'Working time: 40 hours a week (1.0000 FTE), hybrid with 3 days on site.',
    );
    expect(text).toContain('Probation: 6 months.');
    expect(text).toContain('Notice: 1 months by the employee, 2 months by the employer.');
    expect(text).toContain('Benefits: Seguro médico, social security.');
    expect(text).toContain('Signed with this contract: remote work agreement.');
    expect(text).toContain('offer version 2 (abcdef012345)');
    expect(text).not.toContain('Variable pay');
  });

  it('still reads as a contract when the screen holds less', () => {
    const text = contractText(
      { ...offer, checked: null, offer: { versions: [], acceptance: null } },
      'Acme',
    );
    expect(text).toBe('Acme engages Yuki Tanaka as Account manager.');
  });
});
