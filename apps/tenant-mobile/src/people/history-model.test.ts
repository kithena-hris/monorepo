import { describe, expect, it } from 'vitest';

import { previousOf, titleOf, type HistoryChange } from './history-model';

const c = (id: string, effectiveFrom: string, value: string, extra: Partial<HistoryChange> = {}) =>
  ({
    id,
    key: 'salary',
    effectiveFrom,
    recordedAt: `${effectiveFrom}T09:00:00Z`,
    by: 'Ada',
    supersedes: null,
    supersededBy: null,
    actor: null,
    value,
    ...extra,
  }) satisfies HistoryChange;

describe('previousOf', () => {
  it('is the value in force just before, not the one recorded last', () => {
    const all = [
      c('a', '2026-01-01', '58'),
      c('b', '2026-11-01', '64'),
      c('r', '2026-06-01', '60'),
    ];
    expect(previousOf(all[1] as HistoryChange, all)?.id).toBe('r');
  });

  it('is what a correction corrects, and skips a value since corrected', () => {
    const wrong = c('w', '2026-01-01', '85', { supersededBy: 'x' });
    const fix = c('x', '2026-01-01', '58', { supersedes: 'w' });
    const later = c('l', '2026-06-01', '60');
    expect(previousOf(fix, [wrong, fix, later])?.id).toBe('w');
    expect(previousOf(later, [wrong, fix, later])?.id).toBe('x');
  });
});

describe('titleOf', () => {
  it('names what happened', () => {
    expect(titleOf('Salary', c('a', '2026-01-01', '58'))).toBe('Salary added');
    expect(titleOf('Salary', c('b', '2026-02-01', '60'), c('a', '2026-01-01', '58'))).toBe(
      'Salary changed',
    );
    expect(titleOf('Salary', c('b', '2026-02-01', ''), c('a', '2026-01-01', '58'))).toBe(
      'Salary cleared',
    );
    expect(titleOf('Salary', c('x', '2026-01-01', '58', { supersedes: 'w' }))).toBe(
      'Salary corrected',
    );
  });
});
