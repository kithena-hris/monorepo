import { describe, expect, it } from 'vitest';

import { FLOOR_REVIEWS, mayErase, statutoryFloors, type FloorReview, type StatutoryFloor } from './floors.js';

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
