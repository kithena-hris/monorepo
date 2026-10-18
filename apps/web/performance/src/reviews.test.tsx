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
});
