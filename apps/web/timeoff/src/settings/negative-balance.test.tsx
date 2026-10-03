import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { VACATION_POLICY, negativeBalance } from './acme.fixture';
import { NegativeBalance } from './negative-balance';

/**
 * Negative balance rules (T31) on Acme's vacation in Spain: up to 3 days,
 * manager then HR, taken from next year, deducted from final pay. Every
 * state passes axe.
 */

const ready = { status: 'ready' as const, data: negativeBalance() };
const section = (name: string): HTMLElement => {
  const found = screen.getByRole('heading', { name }).closest('section');
  if (found === null) throw new Error(`no section “${name}”`);
  return found;
};

describe('negative balance rules', () => {
  it('shows the three decisions and the sentence employees will read', async () => {
    const { container } = render(<NegativeBalance load={ready} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Negative balance' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Let people go below zero' })).toHaveProperty(
      'ariaChecked',
      'true',
    );
    expect(screen.getByRole('spinbutton', { name: 'Up to (days)' })).toHaveProperty('value', '3.0');
    expect(screen.getByRole('radio', { name: 'Manager, then HR' })).toHaveProperty(
      'ariaChecked',
      'true',
    );
    expect(
      screen.getByRole('radio', { name: 'Take it from next year’s allowance' }),
    ).toHaveProperty('ariaChecked', 'true');
    expect(screen.getByRole('radio', { name: 'Deduct it from final pay' })).toHaveProperty(
      'ariaChecked',
      'true',
    );
    const preview = within(section('What people see'));
    expect(preview.getByText('−3')).toBeTruthy();
    expect(
      preview.getByText(
        'This can take you up to 3 days below zero. They come from next year’s allowance. If you leave before earning them back, they’re deducted from your final pay. Your manager approves it, then HR.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Check your contracts')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('saves a change and publishes it, the preview following the form', () => {
    const onSave = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(<NegativeBalance load={ready} onSave={onSave} />);
    fireEvent.click(
      within(screen.getByRole('group', { name: 'At the end of the year' })).getByRole('radio', {
        name: 'Write it off',
      }),
    );
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect(
      within(section('What people see')).getByText(
        /Any still below zero at the end of the year are written off\./,
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(
      VACATION_POLICY,
      {
        limit: '3.000',
        approvers: 'manager_then_hr',
        atYearEnd: 'write_off',
        onLeaving: 'final_pay',
      },
      true,
    );
  });

  it('turns borrowing off for the personal days, and says what people see then', async () => {
    const onSave = vi.fn(() => Promise.resolve({ ok: true as const }));
    const { container } = render(<NegativeBalance load={ready} onSave={onSave} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Let people go below zero' }));
    expect(screen.queryByRole('spinbutton', { name: 'Up to (days)' })).toBeNull();
    expect(
      within(section('What people see')).getByText(
        'A request for more vacation than someone has is refused, with what they have left.',
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(VACATION_POLICY, null, true);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('keeps a rule in the draft of a policy that has one', () => {
    const onSave = vi.fn(() => Promise.resolve({ ok: true as const }));
    const data = negativeBalance();
    const drafted = {
      policies: data.policies.map((p, i) => (i === 0 ? { ...p, status: 'draft' as const } : p)),
    };
    render(<NegativeBalance load={{ status: 'ready', data: drafted }} onSave={onSave} />);
    expect(screen.getByText('Vacation has a draft')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'HR only' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(
      VACATION_POLICY,
      expect.objectContaining({ approvers: 'hr' }),
      false,
    );
  });

  it('loads in the page’s shape', async () => {
    const { container } = render(<NegativeBalance load={{ status: 'loading' }} />);
    expect(screen.getByRole('status').textContent).toBe('Loading negative balance');
    expect(await axeViolations(container)).toEqual([]);
  });
});
