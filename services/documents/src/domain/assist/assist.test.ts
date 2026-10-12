import { describe, expect, it } from 'vitest';

import { changedLines, datesIn, keepCited, passages } from './assist.js';

describe('citations are checked, not trusted (PRD §14.1)', () => {
  it('keeps a claim only with a page the document has', () => {
    const kept = keepCited(
      [
        { text: 'Three days a week from home', pages: [2] },
        { text: 'Invented clause', pages: [9] },
        { text: 'Mixed', pages: [3, 12] },
        { text: 'No page', pages: [] },
      ],
      3,
    );
    expect(kept).toEqual([
      { text: 'Three days a week from home', pages: [2] },
      { text: 'Mixed', pages: [3] },
    ]);
  });
});

describe('a medical document is read for dates only, here', () => {
  it('finds the dates written in the usual ways', () => {
    expect(datesIn('Baja desde el 04/10/2026 hasta el 15/10/2026. Firmado 2026-10-04, 9 October 2026')).toEqual([
      '2026-10-04',
      '2026-10-15',
      '2026-10-09',
    ]);
  });
});

describe('what changed between versions (D3)', () => {
  it('lists lines added and removed, ignoring blank space', () => {
    expect(changedLines(['Salary: 56,000', 'Probation: 6 months', ''], ['Salary: 58,000', 'Probation: 6 months'])).toEqual({
      removed: ['Salary: 56,000'],
      added: ['Salary: 58,000'],
    });
  });
});

describe('asking across documents (B4)', () => {
  it('ranks the pages that share the question’s words', () => {
    const top = passages('How much paternity leave do I get?', [
      { documentId: 'parental', title: 'Parental leave policy', pages: ['Intro', 'Paternity leave is 16 weeks paid', 'Other'] },
      { documentId: 'handbook', title: 'Handbook', pages: ['Expenses', 'Leave of any kind is requested in Time off'] },
    ], 2);
    expect(top.map((p) => [p.documentId, p.page])).toEqual([
      ['parental', 2],
      ['handbook', 2],
    ]);
  });
});
