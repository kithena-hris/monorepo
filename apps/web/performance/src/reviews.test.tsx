import { TooltipProvider } from '@reach/ui';
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
                    advice: 'Describe what she did, not who she is.',
                    rewrite: 'She sets direction firmly in planning.',
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
    const use = await screen.findByRole('button', { name: 'Use the rewrite' }, { timeout: 3000 });
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
    expect(screen.queryByRole('button', { name: 'Use the rewrite' })).toBeNull();
  });

  // A rating chosen by mistake could not be taken back (§10.2).
  it('clears a rating when the chosen one is pressed again', async () => {
    const onAct = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: { revision: 4, savedAt: '2026-10-18T10:01:00.000Z', missing: ['q1'], score: null },
      }),
    );
    render(
      <Write
        load={{
          status: 'ready',
          data: { ...data, answers: { q1: { value: 4, comment: null } }, missing: [] },
        }}
        onAct={onAct}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: /Exceeds/u }));
    await waitFor(
      () => {
        expect(onAct).toHaveBeenCalledWith('SavePerformanceAnswers', {
          id: 'r1',
          input: { revision: 3, answers: { q1: { value: null, comment: null } } },
        });
      },
      { timeout: 3000 },
    );
    expect(screen.getByRole('radio', { name: /Exceeds/u })).not.toBeChecked();
  });

  // Said again in the tones chosen, seen before it is used, its link kept.
  it('rephrases an answer in the tones chosen and uses it on Use this', async () => {
    const rephrased =
      '<p>She leads planning firmly. <a href="https://x.test/pr/1">Ships</a> on time.</p>';
    const onAct = vi.fn((name: string) =>
      Promise.resolve(
        name === 'RephrasePerformanceAnswer'
          ? { ok: true as const, data: { html: rephrased } }
          : name === 'PerformanceHowItReads'
            ? { ok: true as const, data: { reads: null, flags: [], sentiment: null } }
            : {
                ok: true as const,
                data: {
                  revision: 4,
                  savedAt: '2026-10-18T10:01:00.000Z',
                  missing: [],
                  score: null,
                },
              },
      ),
    );
    // As the editor writes a link, so the answer is not rewritten on mount.
    const html =
      '<p>She is bossy. <a target="_blank" rel="noopener noreferrer nofollow" href="https://x.test/pr/1">Ships</a> on time.</p>';
    render(
      <Write
        load={{
          status: 'ready',
          data: {
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
            answers: { t1: { value: html, comment: null } },
            missing: [],
            ai: { writingChecks: true },
          },
        }}
        onAct={onAct}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Rephrase' }, { timeout: 3000 }));
    fireEvent.click(await screen.findByRole('button', { name: 'More concise' }));
    const go = screen
      .getAllByRole('button', { name: 'Rephrase' })
      .find((b) => b.closest('[role="dialog"]') !== null);
    expect(go).toBeDefined();
    if (go !== undefined) fireEvent.click(go);
    await waitFor(() => {
      expect(onAct).toHaveBeenCalledWith('RephrasePerformanceAnswer', {
        id: 'r1',
        input: { html, tones: ['clearer', 'concise'] },
      });
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Use this' }));
    await waitFor(
      () => {
        const saved = onAct.mock.calls
          .filter(([name]) => name === 'SavePerformanceAnswers')
          .map((call) => JSON.stringify(call));
        expect(saved.some((c) => c.includes('She leads planning firmly.'))).toBe(true);
      },
      { timeout: 3000 },
    );
  });

  // A manager replaced mid-cycle keeps their draft to read, never to submit (§8.8).
  it('turns Submit off for a former manager, says why, and lets them delete it', async () => {
    const onAct = vi.fn(() => Promise.resolve({ ok: true as const, data: { ok: true } }));
    const onNavigate = vi.fn();
    render(
      <Write
        load={{
          status: 'ready',
          data: {
            ...data,
            review: {
              ...data.review,
              kind: 'manager',
              formerManager: { at: '2026-11-20T09:00:00Z', to: 'Priya Shah' },
            },
          },
        }}
        onAct={onAct}
        onNavigate={onNavigate}
      />,
      { wrapper: TooltipProvider },
    );
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /Why Submit is off: .*Priya Shah writes theirs/u }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete this review' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(onAct).toHaveBeenCalledWith('DiscardPerformanceReview', { id: 'r1' });
    });
    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith('/performance/reviews');
    });
  });
});
