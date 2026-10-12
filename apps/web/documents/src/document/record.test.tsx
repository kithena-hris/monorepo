import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { FillRecord } from './record';

describe('filling a record from a document (G5)', () => {
  it('ticks what differs, saves only what is ticked, and says what waits for approval', async () => {
    const onApplyRecord = vi.fn(() => Promise.resolve({ ok: true as const, held: 1 }));
    render(
      <FillRecord
        documentId="d-1"
        onReadRecord={() =>
          Promise.resolve({
            ok: true,
            data: {
              personId: 'p-adam',
              name: 'Adam Novak',
              rows: [
                {
                  key: 'job_title',
                  label: 'Job title',
                  current: 'Engineer',
                  found: { value: 'Senior engineer', page: 1 },
                },
                {
                  key: 'hire_date',
                  label: 'Start date',
                  current: '2024-09-02',
                  found: { value: '2024-09-02', page: 1 },
                },
                { key: 'nickname', label: 'Nickname', current: null, found: null },
              ],
            },
          })
        }
        onApplyRecord={onApplyRecord}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fill the record from it' }));
    expect(await screen.findByText('Senior engineer')).toBeTruthy();
    expect(screen.queryByText('Nickname')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save 1' }));
    expect(onApplyRecord).toHaveBeenCalledWith('p-adam', { job_title: 'Senior engineer' });
    expect(await screen.findByText('1 wait for approval before they show.')).toBeTruthy();
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
