import { describe, expect, it } from 'vitest';

import {
  asksPayHistory,
  score,
  usableIn,
  validateQuestionnaire,
  type Question,
  type Questionnaire,
} from './questionnaire.js';

const rightToWork: Question = {
  id: 'q1',
  text: 'Do you have the right to work in Spain?',
  kind: 'yes_no',
  required: true,
  options: [],
  points: null,
  knockout: { answers: ['no'], autoReject: false, legalRequirement: true },
};
const years: Question = {
  id: 'q2',
  text: 'Years building backend services',
  kind: 'number',
  required: true,
  options: [],
  points: null,
  knockout: { answers: [], below: 3, autoReject: false, legalRequirement: false },
};
const stack: Question = {
  id: 'q3',
  text: 'Which do you use daily?',
  kind: 'multiple',
  required: false,
  options: ['Go', 'Kotlin', 'PHP'],
  points: { Go: 2, Kotlin: 2, PHP: 0 },
  knockout: null,
};
const questionnaire: Questionnaire = {
  id: 'qq',
  version: 2,
  name: 'Backend',
  questions: [rightToWork, years, stack],
  worksCouncilConsentVersion: 1,
};

describe('screening (PRD §15)', () => {
  it('scores points and flags knockouts without rejecting', () => {
    expect(score(questionnaire, { q1: false, q2: 5, q3: ['Go', 'PHP'] })).toEqual({
      score: 2,
      maxScore: 4,
      knockedOut: ['q1'],
      autoReject: false,
      missing: [],
    });
    expect(score(questionnaire, { q1: true, q2: 2 })).toMatchObject({
      knockedOut: ['q2'],
      missing: [],
    });
  });

  it('rejects on its own only when every knockout that fired may', () => {
    const auto = {
      ...questionnaire,
      questions: [
        { ...rightToWork, knockout: { answers: ['no'], autoReject: true, legalRequirement: true } },
        years,
      ],
    };
    expect(score(auto, { q1: false, q2: 5 }).autoReject).toBe(true);
    expect(score(auto, { q1: false, q2: 1 }).autoReject).toBe(false);
  });

  it('refuses automatic rejection in a Spanish job for a question that is not a legal requirement', () => {
    const auto = {
      ...questionnaire,
      questions: [
        {
          ...years,
          knockout: { answers: [], below: 3, autoReject: true, legalRequirement: false },
        },
      ],
    };
    expect(validateQuestionnaire(auto, ['ES'])).toMatchObject({
      ok: false,
      error: { code: 'AUTO_REJECT_NOT_ALLOWED' },
    });
    expect(validateQuestionnaire(auto, ['GB']).ok).toBe(true);
  });

  it('needs the works council’s consent to this version in a German entity that has one', () => {
    expect(usableIn(questionnaire, 'DE', true)).toBe(false);
    expect(usableIn({ ...questionnaire, worksCouncilConsentVersion: 2 }, 'DE', true)).toBe(true);
    expect(usableIn(questionnaire, 'ES', true)).toBe(true);
  });

  it('notices a question about pay history', () => {
    expect(
      asksPayHistory({
        ...questionnaire,
        questions: [{ ...years, text: 'What is your current salary?' }],
      }),
    ).toBe(true);
    expect(asksPayHistory(questionnaire)).toBe(false);
  });
});
