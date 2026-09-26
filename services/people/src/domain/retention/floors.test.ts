import { describe, expect, it } from 'vitest';

import { FLOOR_REVIEWS, mayErase, nextErasure, statutoryFloors, type FloorReview, type StatutoryFloor } from './floors.js';

const allUnreviewed = FLOOR_REVIEWS;
const esReviewed: Readonly<Record<StatutoryFloor, FloorReview>> = {
  ...FLOOR_REVIEWS,
  'es-labour': { status: 'reviewed', reviewer: 'A. Counsel', reviewedOn: '2026-10-01', reference: 'memo-17' },
};
const HR = new Set(['hr']);

describe('the statutory floors (PEO-126)', () => {
  it('are every one unreviewed, pending counsel', () => {
    expect(statutoryFloors().map((f) => [f.floor, f.months, f.review.status])).toEqual([
      ['es-labour', 48, 'unreviewed'],
      ['de-labour', 72, 'unreviewed'],
      ['eu-payroll', 120, 'unreviewed'],
    ]);
  });
});

describe('erasing against a statutory floor (PEO-126)', () => {
  it('refuses automated erasure while a floor it relies on is unreviewed', () => {
    const decided = mayErase(['es-labour'], { kind: 'automated' }, allUnreviewed);
    expect(decided.ok).toBe(false);
    expect(!decided.ok && decided.error.code).toBe('RETENTION_FLOOR_UNREVIEWED');
  });

  it('allows automated erasure once every floor it relies on is reviewed, and when it relies on none', () => {
    expect(mayErase(['es-labour'], { kind: 'automated' }, esReviewed).ok).toBe(true);
    expect(mayErase(['es-labour', 'de-labour'], { kind: 'automated' }, esReviewed).ok).toBe(false);
    expect(mayErase([], { kind: 'automated' }, allUnreviewed).ok).toBe(true);
  });

  it('lets HR act by hand on an unreviewed floor, with a stated reason', () => {
    expect(mayErase(['es-labour'], { kind: 'manual', roles: HR, reason: 'Court order 12/2026' }, allUnreviewed).ok).toBe(
      true,
    );
  });

  it('refuses a manual run by anybody but HR, or with no reason', () => {
    const notHr = mayErase(['es-labour'], { kind: 'manual', roles: new Set(['people_admin']), reason: 'x' }, allUnreviewed);
    expect(!notHr.ok && notHr.error.code).toBe('FORBIDDEN');
    const blank = mayErase(['es-labour'], { kind: 'manual', roles: HR, reason: '   ' }, allUnreviewed);
    expect(!blank.ok && blank.error.code).toBe('REASON_REQUIRED');
  });
});

const due = (dueOn: string, floor: StatutoryFloor | null = null) => ({ dueOn, floor });

describe('the next automated erasure of a leaver (PEO-075)', () => {
  it('is the earliest date anything held falls due, with every floor due by then', () => {
    expect(
      nextErasure([due('2027-01-01', 'de-labour'), due('2026-03-31', 'es-labour'), due('2026-03-31')], '2026-01-01', allUnreviewed),
    ).toEqual({ dueOn: '2026-03-31', floors: ['es-labour'], waitingForReview: ['es-labour'] });
  });

  it('counts everything already overdue, as the next run will: one unreviewed floor holds it all back', () => {
    // The phone number was due long ago, but today's run also finds the payslips due.
    expect(nextErasure([due('2022-09-30'), due('2026-03-31', 'es-labour')], '2026-09-27', allUnreviewed)).toEqual({
      dueOn: '2022-09-30',
      floors: ['es-labour'],
      waitingForReview: ['es-labour'],
    });
  });

  it('waits for nothing once the floors it relies on are reviewed', () => {
    expect(nextErasure([due('2026-03-31', 'es-labour')], '2026-01-01', esReviewed)).toEqual({
      dueOn: '2026-03-31',
      floors: ['es-labour'],
      waitingForReview: [],
    });
  });

  it('waits for nothing under tenant policy alone, and is null when nothing is held under retention', () => {
    expect(nextErasure([due('2026-09-30')], '2026-01-01', allUnreviewed)).toEqual({ dueOn: '2026-09-30', floors: [], waitingForReview: [] });
    expect(nextErasure([], '2026-01-01', allUnreviewed)).toBeNull();
  });
});
