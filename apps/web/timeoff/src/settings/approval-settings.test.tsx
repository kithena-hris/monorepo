import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { approvals } from './acme.fixture';
import { ApprovalSettings } from './approval-settings';

/**
 * Approval rules and team minimums (T34) on Acme's settings: managers
 * approve, HR too below zero, HR plans parental leave; Platform keeps 5 in.
 * Every state passes axe.
 */

const ready = { status: 'ready' as const, data: approvals() };

describe('approval rules and team minimums', () => {
  it('reads each rule as a sentence, and shows what is automatic and each team’s minimum', async () => {
    const { container } = render(<ApprovalSettings load={ready} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Approvals' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Any request' }).textContent).toBe('Manager');
    expect(screen.getByText('Request → Manager')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Any request below zero' }).textContent).toBe(
      'Manager, then HR',
    );
    expect(screen.getByRole('combobox', { name: 'Parental leave plans' }).textContent).toBe('HR');
    expect(screen.getByText('Plan → HR')).toBeTruthy();
    expect(
      screen.getByRole('checkbox', { name: 'Shortening or cancelling time off' }),
    ).toHaveProperty('ariaChecked', 'true');
    expect(screen.getByText('Under 3 days; the manager is told')).toBeTruthy();
    expect(
      screen.getByRole('checkbox', { name: 'One day of vacation with the team above its minimum' }),
    ).toHaveProperty('ariaChecked', 'false');
    const teams = within(screen.getByRole('list', { name: 'Team minimums' }));
    expect(teams.getByRole('combobox', { name: 'Platform' }).textContent).toBe(
      'A number of people',
    );
    expect(
      teams.getByRole('spinbutton', { name: 'Platform: at least (people in)' }),
    ).toHaveProperty('value', '5');
    expect(teams.getByRole('spinbutton', { name: 'Support: at least (% in)' })).toHaveProperty(
      'value',
      '60',
    );
    expect(teams.getByRole('combobox', { name: 'Sales' }).textContent).toBe('No minimum');
    expect(screen.getByText('Minimums warn, they don’t block')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('saves the rules and only the minimums that changed', () => {
    const onSave = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(<ApprovalSettings load={ready} onSave={onSave} />);
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'One day of vacation with the team above its minimum' }),
    );
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Platform: at least (people in)' }), {
      key: 'ArrowUp',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(
      approvals().rules,
      { shortenOrCancel: true, sickUnderDays: 3, oneDayAboveMinimum: true },
      [{ teamKey: 'platform', minimum: { atLeast: 6, unit: 'people' } }],
    );
  });

  it('turns automatic sick approval off', () => {
    const onSave = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(<ApprovalSettings load={ready} onSave={onSave} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Short sick leave' }));
    expect(screen.getByText('Off: every sick day goes to the manager')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(
      approvals().rules,
      expect.objectContaining({ sickUnderDays: null }),
      [],
    );
  });

  it('loads in the page’s shape', async () => {
    const { container } = render(<ApprovalSettings load={{ status: 'loading' }} />);
    expect(screen.getByRole('status').textContent).toBe('Loading approvals');
    expect(await axeViolations(container)).toEqual([]);
  });
});
