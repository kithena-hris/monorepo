import { describe, expect, it } from 'vitest';
import { DEFAULT_SCALE, FormDefinition, type FormDefinitionInput } from '@kithena/contracts';

import {
  diff,
  fingerprint,
  grade,
  normalise,
  questionsFor,
  score,
  subjectView,
  validateAnswers,
  validateDefinition,
} from './index.js';

/** The element at an index, or the test fails here. */
const must = <T>(v: T | undefined): T => {
  if (v === undefined) throw new Error('missing');
  return v;
};

const five = DEFAULT_SCALE.map((o) => ({ ...o }));

const form = (patch: Partial<FormDefinitionInput> = {}): FormDefinition =>
  FormDefinition.parse({
    title: 'Manager review',
    sections: [
      {
        id: 'results',
        title: 'Results',
        questions: [
          { id: 'q1', type: 'text', prompt: 'What were the results?' },
          { id: 'q2', type: 'scale', prompt: 'Delivers', options: five },
        ],
      },
      {
        id: 'how',
        title: 'How they work',
        questions: [
          { id: 'q3', type: 'scale', prompt: 'Collaborates', options: five, allowComment: true },
          {
            id: 'q4',
            type: 'text',
            prompt: 'Retention risk',
            private: true,
            required: false,
            activities: ['manager'],
          },
        ],
      },
      {
        id: 'score',
        title: 'Performance score',
        questions: [{ id: 'ps', type: 'performance_score', prompt: 'Performance score' }],
      },
    ],
    ...patch,
  });

describe('validateDefinition', () => {
  it('accepts a sound form', () => {
    expect(validateDefinition(form()).ok).toBe(true);
  });

  it('refuses two questions with one id', () => {
    const f = form();
    const dup = {
      ...f,
      sections: [
        {
          ...must(f.sections[0]),
          questions: [
            must(must(f.sections[0]).questions[0]),
            must(must(f.sections[0]).questions[0]),
          ],
        },
      ],
    };
    const r = validateDefinition(dup);
    expect(r.ok ? null : r.error.code).toBe('DUPLICATE_QUESTION');
  });

  it('keeps the performance score alone in the last section', () => {
    const f = form();
    const moved = {
      ...f,
      sections: [must(f.sections[2]), must(f.sections[0]), must(f.sections[1])],
    };
    const r = validateDefinition(moved);
    expect(r.ok ? null : r.error.code).toBe('SCORE_NOT_LAST');
  });

  it('refuses a score on a feedback form', () => {
    const r = validateDefinition(form(), { purpose: 'feedback' });
    expect(r.ok ? null : r.error.code).toBe('SCORE_ON_FEEDBACK');
  });

  it('refuses a scale whose values do not rise', () => {
    const bad = form();
    const q = must(must(bad.sections[0]).questions[1]);
    if (q.type !== 'scale') throw new Error('scale');
    must(q.options[1]).value = 1;
    const r = validateDefinition(bad);
    expect(r.ok ? null : r.error.code).toBe('SCALE_ORDER');
  });
});

describe('normalise', () => {
  it('drops an empty section and says which', () => {
    const f = form();
    const withEmpty = {
      ...f,
      sections: [
        must(f.sections[0]),
        { id: 'e', title: 'Empty', description: null, questions: [] },
        must(f.sections[1]),
      ],
    };
    const { definition, removed } = normalise(withEmpty);
    expect(definition.sections.map((s) => s.id)).toEqual(['results', 'how']);
    expect(removed).toEqual(['Empty']);
  });
});

describe('questionsFor', () => {
  it('keeps a manager-only question out of a self review', () => {
    const self = questionsFor(form(), 'self');
    expect(self.sections.flatMap((s) => s.questions.map((q) => q.id))).toEqual([
      'q1',
      'q2',
      'q3',
      'ps',
    ]);
  });
});

describe('subjectView', () => {
  it('leaves no trace of a private question', () => {
    const view = subjectView(form(), {
      q1: { value: 'Shipped it', comment: null },
      q4: { value: 'Might leave', comment: null },
    });
    const text = JSON.stringify(view);
    expect(text).not.toContain('q4');
    expect(text).not.toContain('Retention');
    expect(text).not.toContain('Might leave');
    expect(view.answers['q1']?.value).toBe('Shipped it');
  });
});

describe('validateAnswers', () => {
  it('allows a draft with gaps and refuses a submit with them', () => {
    const answers = { q2: { value: 4, comment: null } };
    expect(validateAnswers(form(), answers, { submitting: false }).ok).toBe(true);
    const r = validateAnswers(form(), answers, { submitting: true, activity: 'manager' });
    expect(r.ok ? null : r.error.code).toBe('REQUIRED');
  });

  it('refuses a value the scale does not have', () => {
    const r = validateAnswers(form(), { q2: { value: 7, comment: null } }, { submitting: false });
    expect(r.ok ? null : r.error.code).toBe('BAD_ANSWER');
  });

  it('refuses an answer to the computed score', () => {
    const r = validateAnswers(form(), { ps: { value: 5, comment: null } }, { submitting: false });
    expect(r.ok ? null : r.error.code).toBe('COMPUTED');
  });
});

describe('score', () => {
  it('averages each section, then the sections, rounding half up', () => {
    const s = score(
      form(),
      { q2: { value: 4, comment: null }, q3: { value: 3, comment: null } },
      five,
    );
    // Results 4, How 3: 3.5.
    expect(s).toMatchObject({ hundredths: 350, display: '3.5', label: 'Exceeds', rated: 2 });
  });

  it('maps another scale onto the company scale', () => {
    const tens = Array.from({ length: 10 }, (_, i) => ({
      label: String(i + 1),
      description: null,
      value: i + 1,
    }));
    const f = FormDefinition.parse({
      title: 'x',
      sections: [
        {
          id: 's',
          title: 's',
          questions: [{ id: 'a', type: 'scale', prompt: 'a', options: tens }],
        },
      ],
    });
    // 10 on 1–10 is 5 on 1–5.
    expect(score(f, { a: { value: 10, comment: null } }, five)?.hundredths).toBe(500);
  });

  it('is null with nothing rated', () => {
    expect(score(form(), {}, five)).toBeNull();
  });
});

describe('fingerprint and diff', () => {
  it('says what changed between two versions', () => {
    const a = form();
    const b = form();
    must(must(b.sections[0]).questions[0]).prompt = 'What were the most important results?';
    must(b.sections[1]).questions.splice(1, 1);
    must(b.sections[1]).questions.push({
      id: 'q5',
      type: 'text',
      prompt: 'Raises problems early',
      help: null,
      required: false,
      allowComment: false,
      private: false,
      guidance: null,
    });
    expect(fingerprint(a)).not.toBe(fingerprint(b));
    expect(fingerprint(a)).toBe(fingerprint(form()));
    expect(diff(a, b).map((c) => `${c.kind} ${c.questionId}`)).toEqual([
      'changed q1',
      'removed q4',
      'added q5',
    ]);
  });
});

describe('grade', () => {
  it('counts a quiz’s right answers', () => {
    const quiz = FormDefinition.parse({
      title: 'Quiz',
      sections: [
        {
          id: 's',
          title: 's',
          questions: [
            {
              id: 'a',
              type: 'choice',
              prompt: 'a',
              options: [
                { id: 'x', label: 'x' },
                { id: 'y', label: 'y' },
              ],
              correct: ['y'],
            },
            {
              id: 'b',
              type: 'choice',
              prompt: 'b',
              options: [
                { id: 'x', label: 'x' },
                { id: 'y', label: 'y' },
              ],
              correct: ['x'],
            },
          ],
        },
      ],
    });
    expect(
      grade(quiz, { a: { value: ['y'], comment: null }, b: { value: ['y'], comment: null } }),
    ).toEqual({ correct: 1, of: 2 });
  });
});
