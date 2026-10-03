import { describe, expect, it } from 'vitest';
import { LeaveTypeKey, type LedgerEntry } from '@kithena/contracts';

import { ADAM, context, date } from '../fixtures.js';
import { append, balanceOn, entry, type NewEntry } from './ledger.js';

const vacation = LeaveTypeKey.parse('vacation');
const ctx = context();
const post = (fields: Omit<NewEntry, 'personId' | 'leaveTypeKey' | 'unit'>): LedgerEntry =>
  entry({ personId: ADAM, leaveTypeKey: vacation, unit: 'day', ...fields }, ctx);

const build = (entries: readonly LedgerEntry[]): readonly LedgerEntry[] =>
  entries.reduce<readonly LedgerEntry[]>((ledger, next) => {
    const result = append(ledger, next);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  }, []);

/*
 * MT20, "Where the days went": 11.5 left of 25, 10.5 used, 3 booked.
 *
 * The rows MT20 draws are a sample and do not add up to its card, so this
 * ledger is built to the card: the year's grant and a carry-over, the
 * carried days lost on 31 Mar, ten days in August and a half day in
 * September taken, and three days booked for December. An expiry first
 * posted at the wrong amount and corrected is in it too, because a fold that
 * counts both is the bug this file exists to prevent.
 */
function mt20(): { ledger: readonly LedgerEntry[]; wrongExpiry: LedgerEntry } {
  const august = post({ kind: 'booking', amount: '-10.000', effectiveOn: date('2026-07-20'), requestId: null });
  const september = post({ kind: 'booking', amount: '-0.500', effectiveOn: date('2026-09-01') });
  const wrongExpiry = post({ kind: 'expiry', amount: '-3.500', effectiveOn: date('2026-03-31') });
  const ledger = build([
    post({ kind: 'grant', amount: '25.000', effectiveOn: date('2026-01-01'), policyVersion: 1 }),
    post({ kind: 'carry_over', amount: '3.000', effectiveOn: date('2026-01-01'), policyVersion: 1 }),
    wrongExpiry,
    post({ kind: 'expiry', amount: '-3.000', effectiveOn: date('2026-03-31'), supersedes: wrongExpiry.entryId }),
    august,
    post({ kind: 'release', amount: '10.000', effectiveOn: date('2026-08-14') }),
    post({ kind: 'taken', amount: '-10.000', effectiveOn: date('2026-08-14') }),
    september,
    post({ kind: 'release', amount: '0.500', effectiveOn: date('2026-09-04') }),
    post({ kind: 'taken', amount: '-0.500', effectiveOn: date('2026-09-04') }),
    post({ kind: 'booking', amount: '-3.000', effectiveOn: date('2026-09-30') }),
  ]);
  return { ledger, wrongExpiry };
}

describe('balanceOn', () => {
  it('folds MT20 to 11.5 left, 10.5 used, 3 booked of 25', () => {
    expect(balanceOn(mt20().ledger, date('2026-10-01'))).toEqual({
      left: '11.500',
      used: '10.500',
      booked: '3.000',
      allowance: '25.000',
    });
  });

  it('counts a superseded entry exactly once: not at all, with its correction in its place', () => {
    const { ledger, wrongExpiry } = mt20();
    // Without the correction, the wrong amount counts.
    const before = ledger.filter((e) => e.supersedes !== wrongExpiry.entryId);
    expect(balanceOn(before, date('2026-10-01')).left).toBe('11.000');
    expect(balanceOn(ledger, date('2026-10-01')).left).toBe('11.500');
  });

  it('only counts what is effective on the date', () => {
    expect(balanceOn(mt20().ledger, date('2026-02-01'))).toEqual({
      left: '28.000',
      used: '0.000',
      booked: '0.000',
      allowance: '25.000',
    });
  });

  it('keeps a superseded entry while its correction is not yet effective', () => {
    const original = post({ kind: 'adjustment', amount: '1.000', effectiveOn: date('2026-01-10'), reason: 'Moved from the old system' });
    const correction = post({
      kind: 'adjustment',
      amount: '2.000',
      effectiveOn: date('2026-02-10'),
      supersedes: original.entryId,
      reason: 'It was two',
    });
    const ledger = build([original, correction]);
    expect(balanceOn(ledger, date('2026-01-31')).left).toBe('1.000');
    expect(balanceOn(ledger, date('2026-02-28')).left).toBe('2.000');
  });

  it('adds monthly accruals with no rounding drift', () => {
    const accruals = Array.from({ length: 12 }, (_, m) =>
      post({
        kind: 'accrual',
        amount: [2, 5, 8, 11].includes(m) ? '2.084' : '2.083',
        effectiveOn: date(`2026-${String(m + 1).padStart(2, '0')}-01`),
      }),
    );
    expect(balanceOn(build(accruals), date('2026-12-31')).left).toBe('25.000');
  });

  it('does not count a borrow marker as days', () => {
    const ledger = build([
      post({ kind: 'grant', amount: '6.500', effectiveOn: date('2026-01-01') }),
      post({ kind: 'booking', amount: '-8.000', effectiveOn: date('2026-10-01') }),
      post({ kind: 'borrow', amount: '1.500', effectiveOn: date('2026-10-01') }),
    ]);
    expect(balanceOn(ledger, date('2026-10-01')).left).toBe('-1.500');
  });
});

describe('append', () => {
  const grant = post({ kind: 'grant', amount: '25.000', effectiveOn: date('2026-01-01') });

  it('never edits an entry: the ledger it was given is unchanged', () => {
    const ledger = build([grant]);
    const result = append(ledger, post({ kind: 'accrual', amount: '2.083', effectiveOn: date('2026-02-01') }));
    expect(result.ok).toBe(true);
    expect(ledger).toHaveLength(1);
    expect(Object.isFrozen(ledger)).toBe(true);
  });

  it('refuses the same entry twice', () => {
    const result = append(build([grant]), grant);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.error.code).toBe('DUPLICATE_ENTRY');
  });

  it('refuses to supersede an entry it does not hold', () => {
    const result = append(
      build([grant]),
      post({ kind: 'grant', amount: '26.000', effectiveOn: date('2026-01-01'), supersedes: '01890000-0000-7000-8000-999999999999' }),
    );
    if (result.ok) throw new Error('expected a refusal');
    expect(result.error.code).toBe('UNKNOWN_ENTRY');
  });

  it('refuses to supersede an entry twice, so it is excluded exactly once', () => {
    const first = post({ kind: 'grant', amount: '26.000', effectiveOn: date('2026-01-01'), supersedes: grant.entryId });
    const second = post({ kind: 'grant', amount: '27.000', effectiveOn: date('2026-01-01'), supersedes: grant.entryId });
    const result = append(build([grant, first]), second);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.error.code).toBe('ALREADY_SUPERSEDED');
  });

  it('refuses an adjustment without a reason', () => {
    const result = append([], post({ kind: 'adjustment', amount: '1.000', effectiveOn: date('2026-01-01') }));
    if (result.ok) throw new Error('expected a refusal');
    expect(result.error.code).toBe('REASON_REQUIRED');
  });

  it.each([
    ['grant', '-1.000'],
    ['accrual', '-2.083'],
    ['booking', '5.000'],
    ['taken', '5.000'],
    ['release', '-5.000'],
    ['expiry', '1.500'],
  ] as const)('refuses a %s of %s, the wrong sign for its kind', (kind, amount) => {
    const result = append([], post({ kind, amount, effectiveOn: date('2026-01-01') }));
    if (result.ok) throw new Error('expected a refusal');
    expect(result.error.code).toBe('WRONG_SIGN');
  });
});
