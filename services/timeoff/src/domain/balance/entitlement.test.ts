import { describe, expect, it } from 'vitest';
import { DayAmount, PolicyDefinition, type LedgerEntry } from '@kithena/contracts';

import { ADAM, context, date } from '../fixtures.js';
import { days, sum } from '../days.js';
import { carryOverExpiry, entitlement } from './entitlement.js';
import { entry } from './ledger.js';

const flat = (overrides: Record<string, unknown> = {}) =>
  PolicyDefinition.parse({
    leaveTypeKey: 'vacation',
    allowance: [{ fromYears: 0, days: '25.000' }],
    ...overrides,
  });

/** T30: 0–2 years 25, 3–5 26, 6–9 27, 10+ 28. */
const tenure = (overrides: Record<string, unknown> = {}) =>
  flat({
    allowance: [
      { fromYears: 0, days: '25.000' },
      { fromYears: 3, days: '26.000' },
      { fromYears: 6, days: '27.000' },
      { fromYears: 10, days: '28.000' },
    ],
    ...overrides,
  });

const total = (entries: readonly LedgerEntry[]): string => sum(entries.map((e) => days(e.amount))).toFixed(3);

const run = (args: Partial<Parameters<typeof entitlement>[0]> & { policy: PolicyDefinition }) =>
  entitlement(
    {
      policyVersion: 1,
      member: { personId: ADAM, hireDate: date('2020-01-01'), terminationDate: null },
      year: 2026,
      ...args,
    },
    context(),
  );

describe('entitlement', () => {
  it('grants a full year upfront on the first day of the leave year', () => {
    const entries = run({ policy: flat() });
    expect(entries.map((e) => [e.kind, e.amount, e.effectiveOn, e.policyVersion])).toEqual([
      ['grant', '25.000', '2026-01-01', 1],
    ]);
  });

  it('gives a joiner on 1 Jul 12.5 of 25', () => {
    const entries = run({
      policy: flat(),
      member: { personId: ADAM, hireDate: date('2026-07-01'), terminationDate: null },
    });
    expect(entries.map((e) => [e.kind, e.amount, e.effectiveOn])).toEqual([['grant', '12.500', '2026-07-01']]);
  });

  it('rounds a pro-rata grant up to the half day', () => {
    // 25 × (17/31 + 5) / 12 = 11.56…, rounded up to 12.
    const entries = run({
      policy: flat(),
      member: { personId: ADAM, hireDate: date('2026-07-15'), terminationDate: null },
    });
    expect(total(entries)).toBe('12.000');
  });

  it('pro-rates a leaver too', () => {
    const entries = run({
      policy: flat(),
      member: { personId: ADAM, hireDate: date('2020-01-01'), terminationDate: date('2026-03-31') },
    });
    expect(total(entries)).toBe('6.500'); // 25 × 3/12 = 6.25, up to 6.5
  });

  it('gives a joiner the whole year when pro-rata is off', () => {
    const entries = run({
      policy: flat({ proRata: false }),
      member: { personId: ADAM, hireDate: date('2026-07-01'), terminationDate: null },
    });
    expect(total(entries)).toBe('25.000');
  });

  it('credits monthly earning on the 1st, 2.08 a month, summing to exactly 25', () => {
    const entries = run({ policy: flat({ earning: 'monthly' }) });
    expect(entries).toHaveLength(12);
    expect(entries.every((e) => e.kind === 'accrual' && e.effectiveOn.endsWith('-01'))).toBe(true);
    expect(entries.every((e) => days(e.amount).toFixed(2) === '2.08')).toBe(true);
    expect(total(entries)).toBe('25.000');
  });

  it('moves to 26 from the 3-year band boundary, monthly', () => {
    const entries = run({
      policy: tenure({ earning: 'monthly' }),
      member: { personId: ADAM, hireDate: date('2023-07-01'), terminationDate: null },
    });
    const june = entries.find((e) => e.effectiveOn === '2026-06-01');
    const july = entries.find((e) => e.effectiveOn === '2026-07-01');
    expect(days(june?.amount ?? '0').toFixed(2)).toBe('2.08'); // 25/12
    expect(days(july?.amount ?? '0').toFixed(2)).toBe('2.17'); // 26/12
    expect(total(entries)).toBe('25.500');
  });

  it('moves to 26 from the 3-year band boundary, upfront, as a top-up on the anniversary', () => {
    const entries = run({
      policy: tenure(),
      member: { personId: ADAM, hireDate: date('2023-07-01'), terminationDate: null },
    });
    expect(entries.map((e) => [e.kind, e.amount, e.effectiveOn])).toEqual([
      ['grant', '25.000', '2026-01-01'],
      ['grant', '0.500', '2026-07-01'],
    ]);
  });

  it('starts the year on the policy year start, not 1 January', () => {
    const entries = run({ policy: flat({ year: { month: 4, day: 1 } }) });
    expect(entries[0]?.effectiveOn).toBe('2026-04-01');
  });

  it('carries over up to the cap on the first day of the year', () => {
    const policy = flat({ carryOver: { maxDays: '5.000', useBy: { month: 3, day: 31 } } });
    const capped = run({ policy, carriedIn: DayAmount.parse('7.500') }).find((e) => e.kind === 'carry_over');
    expect([capped?.amount, capped?.effectiveOn]).toEqual(['5.000', '2026-01-01']);
    const under = run({ policy, carriedIn: DayAmount.parse('3.000') }).find((e) => e.kind === 'carry_over');
    expect(under?.amount).toBe('3.000');
  });

  it('carries nothing without a carry-over rule, or from a negative close', () => {
    expect(run({ policy: flat(), carriedIn: DayAmount.parse('4.000') }).some((e) => e.kind === 'carry_over')).toBe(false);
    const policy = flat({ carryOver: { maxDays: '5.000', useBy: { month: 3, day: 31 } } });
    expect(run({ policy, carriedIn: DayAmount.parse('-1.500') }).some((e) => e.kind === 'carry_over')).toBe(false);
  });

  it('produces nothing for a year the member was not employed in', () => {
    expect(
      run({ policy: flat(), member: { personId: ADAM, hireDate: date('2027-02-01'), terminationDate: null } }),
    ).toEqual([]);
  });
});

describe('carryOverExpiry', () => {
  const ctx = context();
  const policy = flat({ carryOver: { maxDays: '5.000', useBy: { month: 3, day: 31 } } });
  const row = (kind: LedgerEntry['kind'], amount: string, on: string) =>
    entry({ personId: ADAM, leaveTypeKey: policy.leaveTypeKey, unit: 'day', kind, amount, effectiveOn: date(on) }, ctx);

  it('expires carried days not taken by the use-by date, carried days going first', () => {
    const ledger = [row('carry_over', '3.000', '2026-01-01'), row('taken', '-1.500', '2026-02-13'), row('taken', '-2.000', '2026-04-10')];
    const expiry = carryOverExpiry({ ledger, policy, year: 2026 }, ctx);
    expect([expiry?.kind, expiry?.amount, expiry?.effectiveOn]).toEqual(['expiry', '-1.500', '2026-03-31']);
  });

  it('expires nothing when the carried days were used', () => {
    const ledger = [row('carry_over', '3.000', '2026-01-01'), row('taken', '-4.000', '2026-02-13')];
    expect(carryOverExpiry({ ledger, policy, year: 2026 }, ctx)).toBeNull();
  });
});
