import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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
