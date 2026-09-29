import { describe, expect, it } from 'vitest';

import { analyticsExport, type AnalyticsView } from './analytics.js';

/**
 * Insights' Export (V7): a tab's numbers as rows, from the view and nothing
 * else — so a chart the viewer may not see is not in the file, a group
 * withheld below the cohort minimum is "insufficient data" with no count, and
 * no row names a person.
 */

const view: AnalyticsView = {
  asOf: '2026-09-22',
  source: 'snapshot',
  sourceNote: 'From the daily snapshot.',
  minimum: 10,
  segment: null,
  segments: [],
  headcount: {
    value: 412,
    change: 4,
    trend: [
      { label: '2026-08', value: 408 },
      { label: '2026-09', value: 412 },
    ],
  },
  startingSoon: 3,
  attrition: {
    percent: 6.4,
    leavers: 26,
    formula: 'leavers ÷ average headcount',
    trend: [{ label: '2026-09', value: 6.4 }],
  },
  complete: { percent: 81, incomplete: 78, change: null, trend: [] },
  expiringIn90Days: 2,
  movement: {
    period: '2026-08-22 to 2026-09-22',
    opening: 408,
    joiners: 7,
    moves: 1,
    leavers: 3,
    closing: 412,
  },
  completenessBySection: [{ label: 'Pay', value: 12 }],
  expiries: {
    today: '2026-09-22',
    items: [{ kind: 'visa', personId: 'p1', name: 'Ada Lovelace', day: '2026-10-01' }],
  },
  tenure: [{ label: 'Under 6 months', headcount: 40, leavers: 5 }],
  span: [{ label: '2 reports', value: 9 }],
  joiners: {
    months: ['2026-09'],
    departments: ['Engineering'],
    cells: [{ row: 'Engineering', column: '2026-09', value: 7 }],
  },
  composition: {
    categories: ['Engineering'],
    series: [{ label: 'Permanent', values: [120] }],
  },
  selfId: [
    {
      key: 'ethnicity',
      label: 'Ethnicity',
      status: 'insufficient_data',
      minimum: 10,
      publishedAsOf: '2026-09-01',
      total: null,
      note: '',
      cells: [],
    },
  ],
  pay: null,
  funnel: null,
};

const HEADER = ['chart', 'group', 'series', 'value'];

describe('exporting a tab of Insights', () => {
  it('writes the headcount tab’s figures and charts, and nothing from another tab', () => {
    const rows = analyticsExport(view, 'headcount');
    expect(rows[0]).toEqual(HEADER);
    expect(rows).toContainEqual(['Headcount', '2026-09-22', '', '412']);
    expect(rows).toContainEqual(['Starting soon', '2026-09-22', '', '3']);
    expect(rows).toContainEqual(['Headcount by month', '2026-08', '', '408']);
    expect(rows).toContainEqual([
      'Where the change came from',
      'Joined',
      '2026-08-22 to 2026-09-22',
      '7',
    ]);
    expect(rows).toContainEqual(['Headcount by department', 'Engineering', 'Permanent', '120']);
    expect(rows).toContainEqual(['Joiners by department', 'Engineering', '2026-09', '7']);
    expect(rows.some((r) => r[0]?.startsWith('Attrition'))).toBe(false);
  });

  it('writes turnover and data quality from their own charts', () => {
    expect(analyticsExport(view, 'turnover')).toEqual([
      HEADER,
      ['Attrition, rolling 12 months', '2026-09-22', 'percent', '6.4'],
      ['Left, 12 months', '2026-09-22', '', '26'],
      ['Attrition by month', '2026-09', 'percent', '6.4'],
      ['Tenure', 'Under 6 months', 'Here now', '40'],
      ['Tenure', 'Under 6 months', 'Left in 12 months', '5'],
      ['Span of control', '2 reports', 'managers', '9'],
    ]);
    expect(analyticsExport(view, 'data-quality')).toEqual([
      HEADER,
      ['Records complete', '2026-09-22', 'percent', '81'],
      ['Incomplete records', '2026-09-22', '', '78'],
      ['Expiring in 90 days', '2026-09-22', '', '2'],
      ['Missing details by section', 'Pay', '', '12'],
    ]);
  });

  it('never names a person: the expiry timeline stays on the screen', () => {
    const text = JSON.stringify(
      (['headcount', 'turnover', 'data-quality', 'pay'] as const).map((t) =>
        analyticsExport(view, t),
      ),
    );
    expect(text).not.toContain('Ada Lovelace');
  });

  it('says "insufficient data" for a withheld self-identification question, with no count', () => {
    const rows = analyticsExport(view, 'pay');
    expect(rows).toContainEqual(['Ethnicity', '', '', 'insufficient data', '', '', '']);
  });

  it('is its header alone when the tab has nothing for this viewer', () => {
    const none: AnalyticsView = {
      ...view,
      startingSoon: null,
      attrition: null,
      tenure: null,
      span: null,
    };
    expect(analyticsExport(none, 'turnover')).toEqual([HEADER]);
  });
});
