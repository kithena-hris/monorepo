import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { marcoRequests } from './acme.fixture';
import { AttendanceRequests } from './requests';

/** The attendance Requests tab (TOF-099) on Marco's Thursday 1 October. */

const ready = (over: Partial<ReturnType<typeof marcoRequests>> = {}) => ({
  status: 'ready' as const,
  data: { ...marcoRequests(), ...over },
});

describe('the attendance Requests tab', () => {
  it('lists the overtime and the late correction that need Marco, and his own overtime', async () => {
    const { container } = render(<AttendanceRequests load={ready()} onDecide={vi.fn()} />);
    expect(screen.getByText('2 overtime to decide, 1 late correction')).toBeTruthy();
    const needs = within(screen.getByRole('list', { name: 'Needs you' }));
    expect(needs.getAllByRole('listitem').map((r) => r.textContent)).toEqual([
      expect.stringContaining('Omar Haddad · 1h 30m overtime'),
      expect.stringContaining('Adam Novak · 1h 05m overtime'),
      expect.stringContaining('Adam Novak · Wednesday clock-out'),
    ]);
    const mine = within(screen.getByRole('list', { name: 'Your overtime' }));
    expect(mine.getAllByRole('listitem').map((r) => r.textContent)).toEqual([
      expect.stringMatching(/Tue 29 Sept.*40m over the plan.*Waiting/),
      expect.stringMatching(/Mon 28 Sept.*30m over the plan.*Paid/),
    ]);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('decides a day as comp time, pay or decline, as the rules let the manager choose', () => {
    const onDecide = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(<AttendanceRequests load={ready()} onDecide={onDecide} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Decide Omar Haddad’s overtime on Tue 29 Sept' }),
    );
    const dialog = within(
      screen.getByRole('dialog', { name: 'Omar Haddad’s overtime on Tuesday' }),
    );
    expect(dialog.getAllByRole('radio')).toHaveLength(3);
    expect(dialog.getByRole('radio', { name: /Comp time/ })).toBeTruthy();
    expect(dialog.getByRole('radio', { name: /Decline/ })).toBeTruthy();
    expect(dialog.getByText('1h 30m at 1.25×, sent to Payroll with the month.')).toBeTruthy();
    fireEvent.click(dialog.getByRole('radio', { name: /Pay it/ }));
    fireEvent.click(dialog.getByRole('button', { name: 'Approve' }));
    expect(onDecide).toHaveBeenCalledWith({
      personId: 'p-omar',
      date: '2026-09-29',
      approve: true,
      choice: 'paid',
    });
  });

  it('offers only what the rules allow, and says Time Off’s refusal', async () => {
    const onDecide = vi.fn(() =>
      Promise.resolve({ ok: false as const, message: 'This overtime was already decided' }),
    );
    render(
      <AttendanceRequests
        load={ready({ overtime: { becomes: 'comp', multiplier: '1.25' } })}
        onDecide={onDecide}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Decide Adam Novak’s overtime on Tue 29 Sept' }),
    );
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getAllByRole('radio')).toHaveLength(2);
    fireEvent.click(dialog.getByRole('button', { name: 'Approve' }));
    expect(onDecide).toHaveBeenCalledWith(expect.objectContaining({ choice: 'comp' }));
    expect(await dialog.findByText('This overtime was already decided')).toBeTruthy();
  });

  it('shows somebody who manages nobody only their own overtime', () => {
    render(<AttendanceRequests load={ready({ needsYou: [], mine: [] })} />);
    expect(screen.queryByRole('list', { name: 'Needs you' })).toBeNull();
    expect(screen.getByText('No overtime in the last month.')).toBeTruthy();
  });

  it('loads in the tab’s shape', async () => {
    const { container } = render(<AttendanceRequests load={{ status: 'loading' }} />);
    expect(screen.getByRole('status').textContent).toBe('Loading your attendance requests');
    expect(await axeViolations(container)).toEqual([]);
  });
});
