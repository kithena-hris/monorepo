import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Write, type WriteData } from './reviews';

const data: WriteData = {
  review: {
    id: 'r1',
    kind: 'self',
    title: 'Self review',
    status: 'in_progress',
    revision: 3,
    savedAt: '2026-10-18T10:00:00.000Z',
    due: '2026-11-01',
    confidential: false,
    subject: { personId: 'p1', name: 'Ada Lovelace', title: 'Engineer' },
    author: 'Ada Lovelace',
    cycle: { id: 'c1', name: 'H2 2026', names: 'shown', minimum: 3 },
    handover: null,
    detached: null,
    unlock: null,
  },
  form: {
    title: 'Self review',
    description: null,
    sections: [
      {
        id: 's1',
        title: 'Results',
        description: null,
        questions: [
          {
            id: 'q1',
            type: 'scale',
            prompt: 'How did it go?',
            help: null,
            required: true,
            allowComment: false,
            private: false,
            options: [
              { label: 'Meets', description: null, value: 3 },
              { label: 'Exceeds', description: null, value: 4 },
            ],
          },
        ],
      },
    ],
  },
  answers: {},
  suggestions: {},
  drafted: [],
  missing: ['q1'],
  score: null,
  panel: { goals: [], reviews: [], feedback: [], notes: [], earlier: [] },
  may: { write: true, unlock: false, withdraw: false, decline: false },
  ai: {},
};

describe('<Write>', () => {
  // Every render had cleared the save timer each change set, so an answer
  // was saved only when something else flushed it (§10.2).
  it('saves an answer on its own, shortly after it changes', async () => {
    const onAct = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: { revision: 4, savedAt: '2026-10-18T10:01:00.000Z', missing: [], score: null },
      }),
    );
    render(<Write load={{ status: 'ready', data }} onAct={onAct} />);
    fireEvent.click(screen.getByRole('radio', { name: /Exceeds/u }));
    await waitFor(
      () => {
        expect(onAct).toHaveBeenCalledWith('SavePerformanceAnswers', {
          id: 'r1',
          input: { revision: 3, answers: { q1: { value: 4, comment: null } } },
        });
      },
      { timeout: 3000 },
    );
    expect(await screen.findByText(/Saved .* revision 4/u)).toBeInTheDocument();
  });

  // How it will read sits with the draft: a flag under the answer it is about,
  // and the change it suggests, taken in one press and saved.
  it('reads the draft and puts a suggestion in the sentence’s place', async () => {
    const withText: WriteData = {
      ...data,
      form: {
        ...data.form,
        sections: [
          {
            id: 's1',
            title: 'Results',
            description: null,
            questions: [
              {
                id: 't1',
                type: 'text',
                prompt: 'What went well?',
                help: null,
                required: false,
                allowComment: false,
                private: false,
              },
            ],
          },
        ],
      },
      answers: { t1: { value: '<p>She is bossy. Ships on time.</p>', comment: null } },
      missing: [],
      ai: { writingChecks: true },
    };
    const onAct = vi.fn((name: string) =>
      Promise.resolve(
        name === 'PerformanceHowItReads'
          ? {
              ok: true as const,
              data: {
                reads: 'Mostly warm, one word about the person.',
                flags: [
                  {
                    sentence: 'She is bossy.',
                    level: 'warning',
                    title: 'About the person, not the work',
                    suggestion: 'She sets direction firmly in planning.',
                  },
                ],
                sentiment: { position: 62, counts: { positive: 1, negative: 1, neutral: 0 } },
              },
            }
          : {
              ok: true as const,
              data: { revision: 4, savedAt: '2026-10-18T10:01:00.000Z', missing: [], score: null },
            },
      ),
    );
    render(<Write load={{ status: 'ready', data: withText }} onAct={onAct} />);
    const use = await screen.findByRole('button', { name: 'Use suggestion' }, { timeout: 3000 });
    fireEvent.click(use);
    await waitFor(
      () => {
        const saved = onAct.mock.calls
          .filter(([name]) => name === 'SavePerformanceAnswers')
          .map((call) => JSON.stringify(call));
        expect(saved.some((c) => c.includes('She sets direction firmly in planning.'))).toBe(true);
      },
      { timeout: 3000 },
    );
    expect(screen.queryByRole('button', { name: 'Use suggestion' })).toBeNull();
  });
});
