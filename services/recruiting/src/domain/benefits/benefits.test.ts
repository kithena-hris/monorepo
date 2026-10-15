import { CalendarDate } from '@kithena/contracts';
import { describe, expect, it } from 'vitest';

import {
  eligibleFrom,
  isEligible,
  offerBenefits,
  statutoryBenefits,
  totalRewards,
  type Benefit,
} from './benefits.js';

const meal: Benefit = {
  id: 'b1',
  key: 'meal',
  legalEntityId: 'acme-es',
  category: 'meal',
  names: { en: 'Meal card', es: 'Tarjeta restaurante' },
  value: { kind: 'money', yearlyMinor: 242_000, currency: 'EUR' },
  eligibility: {
    employmentTypes: ['permanent'],
    minWeeklyMinutes: 1200,
    waiting: { kind: 'after_probation' },
    workModes: null,
    locationIds: null,
  },
  statutory: false,
  taxNote: 'Exempt up to €11 a working day (art. 42.3 LIRPF)',
};
const health: Benefit = {
  ...meal,
  id: 'b2',
  key: 'health',
  category: 'health',
  names: { en: 'Health insurance' },
  value: { kind: 'descriptive' },
  eligibility: { ...meal.eligibility, minWeeklyMinutes: null, waiting: { kind: 'none' } },
};
const pension: Benefit = {
  ...meal,
  id: 'b3',
  key: 'pension',
  category: 'pension',
  names: { en: 'Pension top-up' },
  value: { kind: 'percent', basisPoints: 300 },
};
const who = {
  employmentType: 'permanent' as const,
  weeklyMinutes: 2400,
  workMode: 'hybrid' as const,
  locationId: null,
};

describe('benefits (PRD §20)', () => {
  it('filters by eligibility', () => {
    expect(isEligible(meal, who)).toBe(true);
    expect(isEligible(meal, { ...who, weeklyMinutes: 600 })).toBe(false);
    expect(isEligible(meal, { ...who, employmentType: 'intern' })).toBe(false);
  });

  it('starts a waiting benefit after probation', () => {
    expect(
      eligibleFrom(meal, CalendarDate.parse('2026-12-01'), CalendarDate.parse('2027-05-31')),
    ).toBe('2027-05-31');
    expect(eligibleFrom(health, CalendarDate.parse('2026-12-01'), null)).toBe('start');
  });

  it('locks the pack’s statutory items into the offer', () => {
    const gb = statutoryBenefits('GB', 'ENG', 'acme-gb');
    expect(offerBenefits([], [meal], gb, who).map((b) => b.key)).toEqual([
      'pension_auto_enrolment',
    ]);
    expect(statutoryBenefits('US', 'TX', 'x')).toEqual([]);
    expect(statutoryBenefits('US', 'CA', 'x').map((b) => b.key)).toEqual(['paid_sick_leave']);
  });

  it('adds the money and lists the rest, never pricing equity', () => {
    expect(totalRewards(5_300_000, 500_000, [meal, health, pension], 'EUR', 'es', 400)).toEqual({
      baseMinor: 5_300_000,
      variableMinor: 500_000,
      benefitsMinor: 242_000 + 159_000,
      totalMinor: 5_300_000 + 500_000 + 401_000,
      descriptive: ['Health insurance'],
      equityUnits: 400,
    });
  });
});
