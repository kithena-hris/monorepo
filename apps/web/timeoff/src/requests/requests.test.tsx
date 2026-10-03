import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { approved, november, past, suggested, upcoming } from './acme.fixture';
import { MyRequests, type RequestsData } from './requests';

/**
 * My requests (T6, T7, MT10) on Acme's demo data: Adam's year on
 * 1 October 2026. Every state passes axe; the dialog is portalled, so axe
 * runs over the document while it is open.
 */

const ready = (data: RequestsData) => ({ status: 'ready' as const, data });
const ok = () => Promise.resolve({ ok: true as const });

describe('my requests', () => {
  it('lists the tab, and draws the first request beside it with its timeline', async () => {
    const { container } = render(<MyRequests load={ready(upcoming())} />);
    expect(screen.getByRole('heading', { level: 1, name: 'My requests' })).toBeTruthy();
    const rows = screen.getAllByRole('link');
    expect(rows.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      [
        'Vacation19–23 Oct · 5 daysWaiting for approval',
        '/time-off/requests/0199a000-0000-7000-8000-000000000020',
      ],
      [
        'Vacation10–12 Nov · 3 daysApproved',
        '/time-off/requests/0199a000-0000-7000-8000-000000000011',
      ],
    ]);
    expect(rows[0]).toHaveAttribute('aria-current', 'page');
    const detail = within(screen.getByRole('region', { name: 'Vacation · 19–23 Oct' }));
    expect(detail.getByText('Mon 26 Oct')).toBeTruthy();
    const timeline = within(detail.getByRole('list', { name: 'What happened' }));
    expect(
      timeline.getAllByRole('listitem').map((li) => li.querySelector('p')?.textContent),
    ).toEqual(['Sent', 'Waiting for your manager', 'No payroll change']);
    expect(detail.getByText('Back for the release on the 26th')).toBeTruthy();
    expect(detail.getByRole('button', { name: 'Withdraw request' })).toBeTruthy();
    expect(detail.queryByRole('button', { name: 'Change dates' })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('draws an approved request at its own address, with approval and the way to change it', async () => {
    const { container } = render(<MyRequests load={ready(approved())} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Vacation · 10–12 Nov' })).toBeTruthy();
    const timeline = within(screen.getByRole('list', { name: 'What happened' }));
    expect(timeline.getByText('Approved by your manager')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change dates' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel request' })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('takes a suggested date in one tap, or keeps the request’s own', async () => {
    const onAnswer = vi.fn(ok);
    render(<MyRequests load={ready(suggested())} onAnswer={onAnswer} />);
    expect(screen.getAllByText('Your manager suggested other dates')).toHaveLength(2);
    // What Marco wrote with them (TOF-099b).
    expect(screen.getByText(/could you take 26–30 Oct instead\? Omar and Yuki/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Take 26–30 Oct · 5 days' }));
    expect(onAnswer).toHaveBeenCalledWith('0199a000-0000-7000-8000-000000000020', 0);
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: 'Keep my dates' })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Keep my dates' }));
    expect(onAnswer).toHaveBeenLastCalledWith('0199a000-0000-7000-8000-000000000020', null);
  });

  it('says so when a tab is empty, and lists the past latest first', () => {
    const { rerender } = render(
      <MyRequests load={ready({ ...past(), tab: 'cancelled', items: [], selected: null })} />,
    );
    expect(screen.getByText('Nothing cancelled.')).toBeTruthy();
    rerender(<MyRequests load={ready(past())} />);
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual([
      'Personal day4 Sept · 1 dayTaken',
      'Vacation3–7 Aug · 5 daysTaken',
      'Vacation10 Jul · 0.5 daysTaken',
      'Vacation16–20 Feb · 5 daysTaken',
    ]);
  });

  it('loads in its own shape, and fails with a way to try again', async () => {
    const { container, rerender } = render(<MyRequests load={{ status: 'loading' }} />);
    expect(screen.getByRole('status').textContent).toContain('Loading your requests');
    expect(await axeViolations(container)).toEqual([]);
    const retry = vi.fn();
    rerender(<MyRequests load={{ status: 'error', message: 'Time Off did not answer', retry }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });
});

describe('changing or cancelling', () => {
  it('offers T7’s three choices for an approved request, and cancels at once', async () => {
    const onCancel = vi.fn(ok);
    render(<MyRequests load={ready(approved())} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Change 10–12 Nov' }));
    expect(dialog.getByRole('radio', { name: 'Move the dates' })).toBeTruthy();
    expect(dialog.getByRole('radio', { name: 'Shorten it' })).toHaveAccessibleDescription(
      /Up to 3 days back/,
    );
    expect(dialog.getByRole('radio', { name: 'Cancel it' })).toBeChecked();
    expect(await axeViolations(document.body)).toEqual([]);
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel it' }));
    expect(onCancel).toHaveBeenCalledWith(november.requestId);
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('moves the dates with a new range, the old ones shown as booked', () => {
    const onChange = vi.fn(ok);
    render(<MyRequests load={ready(approved())} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change dates' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: 'Continue' }));
    expect(dialog.getByRole('button', { name: /11 November 2026, Booked now/ })).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: /^Monday, 16 November 2026/ }));
    fireEvent.click(dialog.getByRole('button', { name: /^Wednesday, 18 November 2026/ }));
    fireEvent.click(dialog.getByRole('button', { name: 'Ask again' }));
    expect(onChange).toHaveBeenCalledWith(november.requestId, {
      from: '2026-11-16',
      to: '2026-11-18',
      startsHalfDay: false,
      endsHalfDay: false,
    });
  });

  it('shortens to a new last day, and says why when Time Off refuses', async () => {
    const onShorten = vi.fn(() =>
      Promise.resolve({ ok: false as const, message: 'Those days have passed' }),
    );
    render(<MyRequests load={ready(approved())} onShorten={onShorten} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change dates' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.click(dialog.getByRole('radio', { name: 'Shorten it' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Continue' }));
    fireEvent.click(dialog.getByRole('button', { name: /^Wednesday, 11 November 2026/ }));
    fireEvent.click(dialog.getByRole('button', { name: 'Give the days back' }));
    expect(onShorten).toHaveBeenCalledWith(november.requestId, '2026-11-11');
    expect(await dialog.findByText('Those days have passed')).toBeTruthy();
  });

  it('withdraws a request nobody has decided, with no other choice', () => {
    const onCancel = vi.fn(ok);
    render(<MyRequests load={ready(upcoming())} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw request' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Withdraw 19–23 Oct' }));
    expect(dialog.queryByRole('radio', { name: 'Move the dates' })).toBeNull();
    fireEvent.click(dialog.getByRole('button', { name: 'Withdraw it' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
