import { describe, expect, it } from 'vitest';

import { checkSignupAnswers, SignupQuestion, SignupQuestionSet } from './signup-questions.js';

const question = (over: Partial<Record<string, unknown>> = {}): SignupQuestion =>
  SignupQuestion.parse({
    key: 't_shirt',
    label: 'T-shirt size',
    description: null,
    dataType: 'select',
    required: true,
    options: [
      { value: 's', label: 'Small' },
      { value: 'm', label: 'Medium' },
    ],
    maxLength: null,
    min: null,
    max: null,
    decimals: null,
    classification: 'internal',
    ...over,
  });

describe('the question set', () => {
  it('cannot carry a confidential field', () => {
    const set = {
      asOf: '2026-09-27T09:00:00.000Z',
      schemaVersion: 2,
      questions: [{ ...question(), classification: 'confidential' }],
    };
    expect(SignupQuestionSet.safeParse(set).success).toBe(false);
  });

  it('cannot ask for a type the page does not render', () => {
    expect(SignupQuestion.safeParse({ ...question(), dataType: 'bank_account' }).success).toBe(
      false,
    );
  });
});

describe('checkSignupAnswers', () => {
  const questions = [
    question(),
    question({
      key: 'years',
      label: 'Years',
      dataType: 'number',
      required: false,
      options: [],
      min: 0,
      max: 60,
    }),
    question({
      key: 'bio',
      label: 'Bio',
      dataType: 'text',
      required: false,
      options: [],
      maxLength: 5,
    }),
    question({ key: 'ok', label: 'Photo ok', dataType: 'boolean', required: false, options: [] }),
  ];

  it('takes good answers and drops blank optional ones', () => {
    expect(
      checkSignupAnswers(questions, { t_shirt: 'm', years: '4', bio: '  ', ok: false }),
    ).toEqual({
      ok: true,
      value: { t_shirt: 'm', years: 4, ok: false },
    });
  });

  it('names a missing required answer', () => {
    expect(checkSignupAnswers(questions, {})).toEqual({
      ok: false,
      problem: { field: 't_shirt', message: 'This is required' },
    });
  });

  it('refuses an option that is not offered, a number out of range and text too long', () => {
    expect(checkSignupAnswers(questions, { t_shirt: 'xl' })).toMatchObject({
      ok: false,
      problem: { field: 't_shirt' },
    });
    expect(checkSignupAnswers(questions, { t_shirt: 's', years: 61 })).toMatchObject({
      ok: false,
      problem: { field: 'years' },
    });
    expect(checkSignupAnswers(questions, { t_shirt: 's', years: 1.5 })).toMatchObject({
      ok: false,
      problem: { field: 'years' },
    });
    expect(checkSignupAnswers(questions, { t_shirt: 's', bio: 'toolong' })).toMatchObject({
      ok: false,
      problem: { field: 'bio' },
    });
  });

  it('never forwards a key that was not asked', () => {
    expect(checkSignupAnswers(questions, { t_shirt: 's', salary: 1 })).toEqual({
      ok: true,
      value: { t_shirt: 's' },
    });
  });
});
