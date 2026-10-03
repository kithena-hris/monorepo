import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { leaveTypes } from './acme.fixture';
import { LeaveTypes } from './leave-types';

/** Leave types (T29) on Acme's settings, for Ada. Every state passes axe. */

describe('leave types', () => {
  it('lists each type with how it is paid, who it reaches and who approves it', async () => {
    const { container } = render(<LeaveTypes load={{ status: 'ready', data: leaveTypes() }} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Leave types' })).toBeTruthy();
    const list = within(screen.getByRole('list', { name: 'Leave types' }));
    const vacation = list.getByRole('link', { name: /^Vacation/ });
    expect(vacation.getAttribute('href')).toBe('/settings/time-off/leave-types/vacation');
    expect(within(vacation).getByText('Paid · tracked in days')).toBeTruthy();
    expect(within(vacation).getByText('Everyone · Manager approves')).toBeTruthy();
    const sick = list.getByRole('link', { name: /^Sick/ });
    expect(
      within(sick).getByText(
        'Paid by Social Security · no balance · note after 3 days · teammates see “Off”',
      ),
    ).toBeTruthy();
    expect(
      within(list.getByRole('link', { name: /^Moving home/ })).getByText('Hidden'),
    ).toBeTruthy();
    expect(
      within(list.getByRole('link', { name: /^Comp time/ })).getByText(/tracked in hours/),
    ).toBeTruthy();
    expect(list.getAllByRole('link')).toHaveLength(8);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('adds a leave type from its name and opens its page (TOF-099a)', async () => {
    const onAdd = vi.fn(() => Promise.resolve({ ok: true as const, key: 'moving_day' }));
    const onNavigate = vi.fn();
    render(
      <LeaveTypes
        load={{ status: 'ready', data: { ...leaveTypes(), adding: true } }}
        onAdd={onAdd}
        onNavigate={onNavigate}
        onAsk={vi.fn()}
      />,
    );
    expect(
      // Behind the open dialog, so hidden from the accessibility tree.
      screen.getByRole('link', { name: 'Add leave type', hidden: true }).getAttribute('href'),
    ).toBe('/settings/time-off/leave-types?add=1');
    const dialog = within(screen.getByRole('dialog', { name: 'Add a leave type' }));
    fireEvent.change(dialog.getByRole('textbox', { name: /^Name/ }), {
      target: { value: 'Moving day' },
    });
    expect(dialog.getByText('Kept as “moving_day” for exports and integrations.')).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Add leave type' }));
    expect(onAdd).toHaveBeenCalledWith({
      key: 'moving_day',
      name: { default: 'Moving day' },
      category: 'other',
      colorToken: 'chart-4',
      icon: 'flag',
      unit: 'day',
      tracked: true,
      paid: 'paid',
      visibility: 'type',
    });
    await vi.waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith('/settings/time-off/leave-types/moving_day');
    });
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('keeps the company’s own parental weeks (TOF-099a)', () => {
    const onSave = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(
      <LeaveTypes load={{ status: 'ready', data: leaveTypes() }} onSaveParentalCompany={onSave} />,
    );
    const weeks = within(
      screen
        .getByRole('heading', { name: 'Your own parental weeks' })
        .closest('section') as HTMLElement,
    );
    expect(weeks.getByRole('spinbutton', { name: 'Extra weeks' })).toHaveProperty('value', '2');
    expect(weeks.getByRole('combobox', { name: 'Booked as' }).textContent).toBe('Parental leave');
    fireEvent.keyDown(weeks.getByRole('spinbutton', { name: 'Extra weeks' }), { key: 'ArrowUp' });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({
      extraWeeks: 3,
      afterServiceYears: 1,
      leaveTypeKey: 'parental',
    });
  });

  it('says Spain’s pack is not reviewed yet, and says nothing once it is', () => {
    const { rerender } = render(<LeaveTypes load={{ status: 'ready', data: leaveTypes() }} />);
    expect(screen.getByText('Spain’s rules are not reviewed yet')).toBeTruthy();
    const reviewed = { ...leaveTypes(), packs: [{ country: 'ES', version: 1, reviewed: true }] };
    rerender(<LeaveTypes load={{ status: 'ready', data: reviewed }} />);
    expect(screen.queryByText('Spain’s rules are not reviewed yet')).toBeNull();
  });

  it('loads in the list’s shape, and shows Time Off’s refusal to anyone but HR', async () => {
    const { container, rerender } = render(<LeaveTypes load={{ status: 'loading' }} />);
    expect(screen.getByRole('status').textContent).toBe('Loading the leave types');
    expect(await axeViolations(container)).toEqual([]);
    rerender(<LeaveTypes load={{ status: 'error', message: 'Only HR can do that' }} />);
    expect(screen.getByText('Could not load the leave types')).toBeTruthy();
    expect(screen.getByText('Only HR can do that')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });
});
