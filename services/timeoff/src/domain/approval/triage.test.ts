import { describe, expect, it } from 'vitest';

import { date } from '../fixtures.js';
import { splitQueue, triage, type TriageItem } from './triage.js';

const vacation = { category: 'annual_leave', unit: 'day' } as const;

/** T16, "Waiting for me": five requests on Marco's queue. */
const T16: readonly (TriageItem & { who: string })[] = [
  { who: 'Leo Rossi', ...vacation, cost: '5.000', left: '14.000', daysBelowMinimum: [] },
  {
    who: 'Ravi Patel',
    category: 'other',
    unit: 'hour',
    cost: '8.000',
    left: '11.000',
    daysBelowMinimum: [],
  },
  {
    who: 'Hana Kim',
    category: 'sick_leave',
    unit: 'day',
    cost: '2.000',
    left: null,
    daysBelowMinimum: [],
  },
  {
    who: 'Adam Novak',
    ...vacation,
    cost: '5.000',
    left: '11.500',
    daysBelowMinimum: [date('2026-10-21')],
    protectedDays: [date('2026-10-22')],
  },
  { who: 'Omar Haddad', ...vacation, cost: '8.000', left: '6.500', daysBelowMinimum: [] },
];

describe('triage', () => {
  it('splits T16 three clear and two to look closer, with the reasons drawn', () => {
    const { clear, lookCloser } = splitQueue(T16, (item) => triage(item));
    expect(clear.map((i) => i.who)).toEqual(['Leo Rossi', 'Ravi Patel', 'Hana Kim']);
    expect(lookCloser.map(({ item, reason }) => [item.who, reason])).toEqual([
      ['Adam Novak', { rule: 'below_minimum', days: ['2026-10-21'] }],
      ['Omar Haddad', { rule: 'below_zero', by: '1.500' }],
    ]);
  });

  it('gives the first failing rule: the balance before coverage', () => {
    expect(
      triage({ ...vacation, cost: '8.000', left: '6.500', daysBelowMinimum: [date('2026-12-15')] }),
    ).toEqual({
      group: 'look_closer',
      reason: { rule: 'below_zero', by: '1.500' },
    });
  });

  it('looks closer at comp time beyond the hours banked', () => {
    expect(
      triage({
        category: 'other',
        unit: 'hour',
        cost: '8.000',
        left: '6.000',
        daysBelowMinimum: [],
      }),
    ).toEqual({
      group: 'look_closer',
      reason: { rule: 'over_banked', short: '2.000' },
    });
  });

  it('looks closer at a request overlapping a protected period', () => {
    expect(
      triage({
        ...vacation,
        cost: '1.000',
        left: '10.000',
        daysBelowMinimum: [],
        protectedDays: [date('2026-12-31')],
      }),
    ).toEqual({
      group: 'look_closer',
      reason: { rule: 'protected_period', days: ['2026-12-31'] },
    });
  });

  it('looks closer at sick leave from the threshold up', () => {
    const sick = { category: 'sick_leave', unit: 'day', left: null, daysBelowMinimum: [] } as const;
    expect(triage({ ...sick, cost: '3.000' })).toEqual({
      group: 'look_closer',
      reason: { rule: 'sick_over_threshold', days: '3.000' },
    });
    expect(triage({ ...sick, cost: '3.000' }, { sickUnderDays: 5 })).toEqual({ group: 'clear' });
  });
});
