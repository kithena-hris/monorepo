import { describe, expect, it } from 'vitest';

import { factsFor, filled, phrasedFrom, whatChangedContext, type Figures } from './what-changed.js';

const figures = (over: Partial<Figures> = {}): Figures => ({
  asOf: '2026-09-22',
  minimum: 5,
  headcount: { value: 128, change: 8 },
  startingSoon: 4,
  movement: { joiners: 10, moves: 3, leavers: 2 },
  joiners: {
    cells: [
      { row: 'Engineering', column: '2026-08', value: 9 },
      { row: 'Engineering', column: '2026-09', value: 7 },
      { row: 'Sales', column: '2026-09', value: 3 },
    ],
  },
  attrition: {
    percent: 4.3,
    leavers: 12,
    trend: [
      { label: '2026-08', value: 3.1 },
      { label: '2026-09', value: 4.3 },
    ],
  },
  tenure: [
    { label: 'Under 6 months', leavers: 7 },
    { label: '2 to 5 years', leavers: 5 },
  ],
  complete: { percent: 87, incomplete: 14, change: 3 },
  completenessBySection: [
    { label: 'Emergency contact', value: 30 },
    { label: 'Bank', value: 4 },
  ],
  expiries: {
    today: '2026-09-22',
    items: [
      { kind: 'fixed_term', day: '2026-10-03' },
      { kind: 'fixed_term', day: '2026-10-15' },
      { kind: 'fixed_term', day: '2026-10-30' },
      { kind: 'fixed_term', day: '2026-10-31' },
      { kind: 'probation', day: '2026-09-28' },
      { kind: 'work_permit', day: '2026-12-01' },
    ],
  },
  pay: {
    grade: [
      {
        status: 'ok',
        median: '9000000',
        band: { minimumMinor: '5000000', maximumMinor: '8000000' },
      },
      {
        status: 'ok',
        median: '6000000',
        band: { minimumMinor: '5000000', maximumMinor: '8000000' },
      },
      { status: 'insufficient_data', median: null, band: null },
      { status: 'insufficient_data', median: null, band: null },
    ],
  },
  ...over,
});

describe('the facts of each tab, from the numbers and nothing else', () => {
  it('headcount: the change, the movement, where joiners went, who is coming', () => {
    expect(filled(factsFor(figures(), 'headcount'))).toEqual([
      'Headcount up 8 since last month, to 128.',
      '10 joined, 2 left and 3 moved within the company in the last month.',
      'Most joiners this month are in Engineering.',
      '4 people are starting soon.',
    ]);
  });

  it('names no group smaller than the cohort minimum', () => {
    const facts = filled(factsFor(figures({ minimum: 10 }), 'headcount'));
    expect(facts.join(' ')).not.toContain('Engineering');
  });

  it('says a flat headcount as flat, and leaves out what is not there', () => {
    expect(
      filled(
        factsFor(
          figures({
            headcount: { value: 40, change: 0 },
            movement: null,
            joiners: null,
            startingSoon: null,
          }),
          'headcount',
        ),
      ),
    ).toEqual(['Headcount unchanged since last month, at 40.']);
  });

  it('turnover: the trend in points, the leavers, the tenure most of them had', () => {
    expect(filled(factsFor(figures(), 'turnover'))).toEqual([
      'Attrition up 1.2 points to 4.3% over the last year.',
      '12 people left in the last year.',
      'Most leavers had been here under 6 months.',
    ]);
    const flat = figures({
      attrition: {
        percent: 4.3,
        leavers: 1,
        trend: [
          { label: '2026-08', value: 4.1 },
          { label: '2026-09', value: 4.3 },
        ],
      },
      tenure: null,
    });
    expect(filled(factsFor(flat, 'turnover'))).toEqual([
      'Attrition flat at 4.3% over the last year.',
      '1 person left in the last year.',
    ]);
  });

  it('data quality: completeness and its change, the worst section, what lapses soon', () => {
    expect(filled(factsFor(figures(), 'data-quality'))).toEqual([
      'Records 87% complete, up 3 points since last month; 14 incomplete.',
      'Most missing details are in Emergency contact.',
      '1 probation ends this month.',
      '4 contracts end in October.',
    ]);
  });

  it('pay: medians outside their bands, and grades too small to show', () => {
    expect(filled(factsFor(figures(), 'pay'))).toEqual([
      '1 grade has a median above its band.',
      '2 grades are too small to show.',
    ]);
  });

  it('has nothing to say about nothing', () => {
    const none = figures({
      attrition: null,
      tenure: null,
      complete: null,
      completenessBySection: null,
      expiries: null,
      pay: null,
    });
    expect(factsFor(none, 'turnover').sentences).toEqual([]);
    expect(factsFor(none, 'pay').sentences).toEqual([]);
  });
});

describe('what a model is shown', () => {
  it('is the sentences with every figure and group held back', () => {
    const facts = factsFor(figures(), 'headcount');
    const context = JSON.stringify(whatChangedContext('headcount', facts));
    const bare = context.replace(/\{[ng]\d+\}/gu, '');
    expect(bare).not.toMatch(/\d/u);
    for (const value of Object.values(facts.fill)) expect(bare).not.toContain(value);
    expect(context).toContain('Headcount up {n1} since last month, to {n2}.');
  });
});

describe('a model’s answer', () => {
  const facts = factsFor(figures(), 'turnover');
  const all = '{n1} {n2} {n3} {g1}';

  it('is filled from the facts when it keeps every placeholder and writes no number', () => {
    expect(
      phrasedFrom(facts, {
        sentences: [
          'Attrition rose {n1} points to {n2} over the last year, with {n3} people leaving.',
          'Most of them had been here {g1}.',
        ],
      }),
    ).toEqual([
      'Attrition rose 1.2 points to 4.3% over the last year, with 12 people leaving.',
      'Most of them had been here under 6 months.',
    ]);
  });

  it('is refused when it writes a number of its own, in digits or words', () => {
    expect(phrasedFrom(facts, { sentences: [`${all} and 3 more`] })).toBeNull();
    expect(phrasedFrom(facts, { sentences: [`${all}, about twelve`] })).toBeNull();
  });

  it('is refused when it invents a placeholder or drops one', () => {
    expect(phrasedFrom(facts, { sentences: [`${all} {n9}`] })).toBeNull();
    expect(phrasedFrom(facts, { sentences: ['{n1} {n2} {n3}'] })).toBeNull();
  });

  it('is refused when it is not the shape asked for', () => {
    expect(phrasedFrom(facts, { sentences: [all], note: 'x' })).toBeNull();
    expect(phrasedFrom(facts, { sentences: [] })).toBeNull();
    expect(phrasedFrom(facts, 'text')).toBeNull();
  });
});
