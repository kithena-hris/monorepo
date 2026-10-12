import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Answers } from './answers';
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
});
