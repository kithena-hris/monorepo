import { describe, expect, it } from 'vitest';

import { matchScore, verifyFindings, type Finding } from './matrix.js';

const criteria = [
  { id: 'c1', text: 'Five years of product design', must: true, weight: 3 },
  { id: 'c2', text: 'Spanish at C1', must: false, weight: 1 },
];
const text = 'Product designer since 2018 at Acme and Globex. Spanish (C1).';

describe('the evidence matrix (PRD §14.3)', () => {
  it('keeps a verdict only when its quotes are in the text', () => {
    const findings: Finding[] = [
      {
        criterionId: 'c1',
        verdict: 'met',
        passages: ['Product designer since 2018'],
        why: 'Since 2018.',
      },
      { criterionId: 'c2', verdict: 'met', passages: ['fluent Spanish'], why: 'Says so.' },
    ];
    expect(verifyFindings(findings, criteria, text).map((f) => [f.criterionId, f.verdict])).toEqual(
      [
        ['c1', 'met'],
        ['c2', 'not_evidenced'],
      ],
    );
  });

  it('answers every criterion, and nothing the job did not ask', () => {
    const findings: Finding[] = [
      { criterionId: 'zz', verdict: 'met', passages: ['Acme'], why: '' },
    ];
    expect(verifyFindings(findings, criteria, text).map((f) => f.verdict)).toEqual([
      'not_evidenced',
      'not_evidenced',
    ]);
  });

  it('scores by weight, and bands with every must-have met for strong', () => {
    const all = (v1: Finding['verdict'], v2: Finding['verdict']): Finding[] => [
      { criterionId: 'c1', verdict: v1, passages: [], why: '' },
      { criterionId: 'c2', verdict: v2, passages: [], why: '' },
    ];
    expect(matchScore(criteria, all('met', 'met'))).toEqual({ scoreBp: 10_000, band: 'strong' });
    expect(matchScore(criteria, all('met', 'not_met'))).toEqual({ scoreBp: 7_500, band: 'strong' });
    expect(matchScore(criteria, all('partly_met', 'met'))).toEqual({
      scoreBp: 6_250,
      band: 'good',
    });
    expect(matchScore(criteria, all('not_met', 'met'))).toEqual({ scoreBp: 2_500, band: 'weak' });
    expect(matchScore([], [])).toEqual({ scoreBp: 0, band: 'weak' });
  });
});
