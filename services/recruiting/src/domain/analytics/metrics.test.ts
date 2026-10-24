import { describe, expect, it } from 'vitest';

import {
  adverseImpact,
  breakdown,
  funnel,
  percentile,
  timeToFill,
  timeToHire,
  validatePlan,
  type AppFacts,
} from './metrics.js';

const app = (
  id: string,
  reached: AppFacts['reached'],
  extra: Partial<AppFacts> = {},
): AppFacts => ({
  id,
  jobId: 'j1',
  receivedAt: '2026-09-01T00:00:00Z',
  hiredAt: null,
  reached,
  outcome: 'active',
  rejectionReason: null,
  source: 'kithena_jobs',
  department: 'Engineering',
  ...extra,
});

describe('metric definitions (PRD §23.2)', () => {
  it('measures time to hire and to fill in days', () => {
    expect(timeToHire(app('a', 'hired', { hiredAt: '2026-10-01T00:00:00Z' }))).toBe(30);
    expect(timeToFill('2026-08-01T00:00:00Z', ['2026-09-01T00:00:00Z'], 2)).toBeNull();
    expect(
      timeToFill('2026-08-01T00:00:00Z', ['2026-09-01T00:00:00Z', '2026-09-11T00:00:00Z'], 2),
    ).toBe(41);
  });

  it('takes the median and 85th percentile by nearest rank', () => {
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(percentile([10, 20, 30, 40, 50, 60, 70], 85)).toBe(60);
    expect(percentile([], 50)).toBeNull();
  });

  it('counts the funnel from the furthest stage each application reached', () => {
    const apps = [
      app('1', 'applied'),
      app('2', 'screening'),
      app('3', 'interview'),
      app('4', 'interview'),
      app('5', 'hired'),
    ];
    expect(funnel(apps).map((f) => [f.category, f.count, f.ofPrevious])).toEqual([
      ['applied', 5, null],
      ['screening', 4, '80'],
      ['interview', 3, '75'],
      ['assessment', 1, '33'],
      ['offer', 1, '100'],
      ['contract', 1, '100'],
      ['hired', 1, '100'],
    ]);
  });

  it('withholds personal breakdowns below five', () => {
    const apps = [
      ...Array.from({ length: 5 }, (_, i) => app(`e${String(i)}`, 'applied')),
      app('s1', 'applied', { department: 'Sales' }),
    ];
    expect(
      breakdown(
        apps,
        (a) => a.department ?? '',
        (g) => g.length,
        true,
      ),
    ).toEqual([
      { key: 'Engineering', n: 5, suppressed: false, value: 5 },
      { key: 'Sales', n: 1, suppressed: true, value: null },
    ]);
  });

  it('flags a group passing at under four fifths of the best', () => {
    expect(
      adverseImpact([
        { key: 'a', passed: 50, total: 100 },
        { key: 'b', passed: 30, total: 100 },
        { key: 'c', passed: 1, total: 3 },
      ]),
    ).toEqual([
      { key: 'a', ratio: '1.00', flagged: false },
      { key: 'b', ratio: '0.60', flagged: true },
      { key: 'c', ratio: null, flagged: false },
    ]);
  });
});

describe('a chart plan (PRD §23.4)', () => {
  const plan = {
    metric: 'offer_acceptance',
    breakdown: 'department' as const,
    filters: {},
    period: 'this_year' as const,
    compare: null,
    chart: 'bar' as const,
  };

  it('accepts names from the catalogue and refuses anything else whole', () => {
    expect(validatePlan(plan).ok).toBe(true);
    expect(validatePlan({ ...plan, metric: 'salary' })).toEqual({
      ok: false,
      reason: 'There is no metric called “salary”',
    });
    expect(validatePlan({ ...plan, breakdown: 'source' })).toMatchObject({ ok: false });
    expect(validatePlan({ ...plan, chart: 'funnel' })).toMatchObject({ ok: false });
  });
});
