import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Answers, forgetReads } from './answers';
import { axeViolations } from './test/axe';

describe('documents that answer HR (J1, J2, J6)', () => {
  it('looks in your documents for what HR asked, and saves only what you tick', async () => {
    const onAnswer = vi.fn(() => Promise.resolve({ ok: true as const }));
    const { container } = render(
      <Answers
        documentIds={['d-passport']}
        titles={{ 'd-passport': 'Passport' }}
        onWaitingFor={() =>
          Promise.resolve([
            { key: 'national_id', label: 'National ID', asked: true },
            { key: 'birth_date', label: 'Date of birth', asked: false },
          ])
        }
        onLookFor={() =>
          Promise.resolve({
            ok: true,
            data: [
              {
                key: 'national_id',
                label: 'National ID',
                asked: true,
                value: 'X1234567',
                page: 1,
                documentId: 'd-passport',
              },
            ],
          })
        }
        onAnswer={onAnswer}
      />,
    );
    expect(await screen.findByText('HR is waiting for 1 detail from you')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Look in this document' }));
    expect(await screen.findByText('X1234567 · Passport, p. 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 to your record' }));
    expect(onAnswer).toHaveBeenCalledWith({ national_id: 'X1234567' });
    expect(await screen.findByText('Saved to your record.')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('says nothing when the record waits for nothing', async () => {
    render(
      <Answers
        documentIds={['d-1']}
        onWaitingFor={() => Promise.resolve([])}
        onLookFor={vi.fn()}
        onAnswer={vi.fn()}
      />,
    );
    await Promise.resolve();
    expect(screen.queryByRole('button')).toBeNull();
  });

  describe('by itself, on the library', () => {
    beforeEach(() => {
      forgetReads();
    });
    const waiting = () =>
      Promise.resolve([
        { key: 'national_id', label: 'National ID', asked: false },
        { key: 'birth_date', label: 'Date of birth', asked: false },
        { key: 'iban', label: 'Bank account', asked: false },
      ]);
    const found = [
      {
        key: 'national_id',
        label: 'National ID',
        asked: false,
        value: 'X1234567',
        page: 1,
        documentId: 'd-passport',
      },
    ];

    it('reads without a press, lists what it found and names what it did not', async () => {
      const onLookFor = vi.fn(() => Promise.resolve({ ok: true as const, data: found }));
      const { container, unmount } = render(
        <Answers
          auto
          documentIds={['d-passport', 'd-contract']}
          stamp="2026-10-25,2026-10-14"
          titles={{ 'd-passport': 'Passport' }}
          onWaitingFor={waiting}
          onLookFor={onLookFor}
          onAnswer={vi.fn()}
        />,
      );
      expect(await screen.findByText('X1234567 · Passport, p. 1')).toBeTruthy();
      expect(screen.getByText('Your record is missing 3 details')).toBeTruthy();
      expect(screen.getByText('Kithena found 1 of them in your documents.')).toBeTruthy();
      expect(
        screen.getByText('Not in your documents: Date of birth and Bank account.'),
      ).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Look in/ })).toBeNull();
      expect(onLookFor).toHaveBeenCalledExactlyOnceWith(['d-passport', 'd-contract']);
      expect(await axeViolations(container)).toEqual([]);

      // Left and come back to: the same documents are not read again.
      unmount();
      render(
        <Answers
          auto
          documentIds={['d-passport', 'd-contract']}
          stamp="2026-10-25,2026-10-14"
          titles={{ 'd-passport': 'Passport' }}
          onWaitingFor={waiting}
          onLookFor={onLookFor}
          onAnswer={vi.fn()}
        />,
      );
      expect(await screen.findByText('X1234567 · Passport, p. 1')).toBeTruthy();
      expect(onLookFor).toHaveBeenCalledTimes(1);
    });

    it('stays off the page when the documents say none of it', async () => {
      const onLookFor = vi.fn(() => Promise.resolve({ ok: true as const, data: [] }));
      const { container } = render(
        <Answers
          auto
          documentIds={['d-contract']}
          onWaitingFor={waiting}
          onLookFor={onLookFor}
          onAnswer={vi.fn()}
        />,
      );
      await waitFor(() => {
        expect(onLookFor).toHaveBeenCalledTimes(1);
      });
      await waitFor(() => {
        expect(container.textContent).toBe('');
      });
    });
  });
});
