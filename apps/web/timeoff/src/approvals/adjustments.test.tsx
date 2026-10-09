import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { Adjustments, type AdjustmentsData } from './adjustments';

/** Balance adjustments: Ada (HR) with one of Marco's waiting, and one she made herself. */

const data = (over: Partial<AdjustmentsData> = {}): AdjustmentsData => ({
  hr: true,
  items: [
    {
      adjustmentId: '01890000-0000-7000-8000-000000000001',
      personId: '22222222-2222-7222-8222-222222222222',
      displayName: 'Adam Novak',
      leaveTypeName: 'Vacation',
      unit: 'day',
      amount: '-1.000',
      effectiveOn: '2026-10-01',
      reason: 'Half a day twice, not booked',
      status: 'pending',
      note: null,
      canDecide: true,
    },
    {
      adjustmentId: '01890000-0000-7000-8000-000000000002',
      personId: '44444444-4444-7444-8444-444444444444',
      displayName: 'Omar Haddad',
      leaveTypeName: 'Vacation',
      unit: 'day',
      amount: '2.000',
      effectiveOn: '2026-10-01',
      reason: 'Worked the offsite weekend',
      status: 'approved',
      note: null,
      canDecide: false,
    },
  ],
  people: [{ personId: '22222222-2222-7222-8222-222222222222', displayName: 'Adam Novak' }],
  leaveTypes: [{ key: 'vacation', name: 'Vacation', unit: 'day' }],
  ...over,
});

const ready = (d: AdjustmentsData) => ({ status: 'ready' as const, data: d });

describe('balance adjustments', () => {
  it('shows HR what waits, approves it, and what was counted', async () => {
    const onDecide = vi.fn(() => Promise.resolve({ ok: true as const }));
    const { container } = render(<Adjustments load={ready(data())} onDecide={onDecide} />);
    expect(screen.getByText('Adam Novak · −1 day')).toBeTruthy();
    expect(screen.getByText('Omar Haddad · +2 days')).toBeTruthy();
    expect(screen.getByText('Counted')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onDecide).toHaveBeenCalledWith('01890000-0000-7000-8000-000000000001', true, null);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('will not adjust without a reason', async () => {
    const onAdjust = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(<Adjustments load={ready(data({ items: [] }))} onAdjust={onAdjust} />);
    fireEvent.click(screen.getByRole('button', { name: 'Adjust a balance' }));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Adjust' })).toBeDisabled();
  });
});
