import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import {
  HANA,
  VACATION_POLICY,
  leaveTypeRows,
  vacationPublished,
  vacationWithDraft,
} from './acme.fixture';
import { LeaveType } from './leave-type';

/**
 * Editing a policy (T30) on Acme's vacation in Spain: a draft that lowers the
 * carry-over to 3 days and adds a 29-day band at 15 years, and the preview
 * Time Off folded for it. Every state passes axe.
 */

const ready = <T,>(data: T) => ({ status: 'ready' as const, data });
const section = (name: string): HTMLElement => {
  const found = screen.getByRole('heading', { name }).closest('section');
  if (found === null) throw new Error(`no section “${name}”`);
  return found;
};

describe('editing a policy', () => {
  it('shows the rules, what publishing would change and Adam’s view of it', async () => {
    const { container } = render(<LeaveType load={ready(vacationWithDraft())} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Vacation · Spain' })).toBeTruthy();
    expect(
      screen.getByText('Version 1 in effect from 1 January 2026 · version 2 is a draft'),
    ).toBeTruthy();
    const bands = within(screen.getByRole('list', { name: 'Allowance by years of service' }));
    expect(bands.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByRole('switch', { name: 'Carry days into next year' })).toHaveProperty(
      'ariaChecked',
      'true',
    );

    const preview = within(section('Change preview'));
    expect(
      preview.getByText('If you publish version 2, worked out on 3 people’s balances.'),
    ).toBeTruthy();
    expect(preview.getByText('1 person gets 1 more day')).toBeTruthy();
    expect(preview.getByText('From 1 January 2026, for this leave year.')).toBeTruthy();
    expect(preview.getByText('2 people would lose days on 31 December 2026')).toBeTruthy();
    expect(
      preview.getByText(
        'Above the carry-over limit, if they book nothing more: 2 to 3 more days each.',
      ),
    ).toBeTruthy();

    const adam = within(section('What Adam Novak would see'));
    expect(adam.getByText('Vacation this year')).toBeTruthy();
    expect(adam.getByText('14.5')).toBeTruthy();
    expect(
      adam.getByText('11.5 of them would be lost on 31 December 2026, above what carries over.'),
    ).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('shows the person the address names, and asks the shell to show another', () => {
    const onPreviewAs = vi.fn();
    render(
      <LeaveType load={ready({ ...vacationWithDraft(), as: HANA })} onPreviewAs={onPreviewAs} />,
    );
    const hana = within(section('What Hana Kim would see'));
    // 28 → 29: the draft's 15-year band.
    expect(hana.getByText('29')).toBeTruthy();
    expect(hana.getByText('28')).toBeTruthy();
  });

  it('publishes the draft from the leave year’s first day', async () => {
    const onPublish = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(<LeaveType load={ready(vacationWithDraft())} onPublish={onPublish} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Publish changes' }));
    });
    expect(onPublish).toHaveBeenCalledWith(VACATION_POLICY, '2026-01-01');
  });

  it('saves an edit as the draft, and holds the preview and publishing until it is saved', async () => {
    const onSaveDraft = vi.fn(() =>
      Promise.resolve({ ok: false as const, message: 'Tenure bands climb' }),
    );
    render(
      <LeaveType load={ready(vacationWithDraft())} onSaveDraft={onSaveDraft} onPublish={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Half days allowed' }));
    expect(screen.getByRole('status').textContent).toBe('Unsaved changes');
    expect(screen.getByRole('button', { name: 'Publish changes' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(
      within(section('Change preview')).getByText(
        'Save the draft to see who these changes would reach.',
      ),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    });
    expect(onSaveDraft).toHaveBeenCalledWith(
      VACATION_POLICY,
      expect.objectContaining({
        requests: { halfDays: false, showWhoIsOff: true, blockBelowMinimum: false },
        carryOver: { maxDays: '3.000', useBy: { month: 3, day: 31 } },
      }),
    );
    expect(screen.getByText('Tenure bands climb')).toBeTruthy();
  });

  it('adds a band a year after the last, at its allowance', () => {
    render(<LeaveType load={ready(vacationPublished())} onSaveDraft={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a band' }));
    const bands = within(screen.getByRole('list', { name: 'Allowance by years of service' }));
    const rows = bands.getAllByRole('listitem');
    expect(rows).toHaveLength(5);
    const last = within(rows[4] as HTMLElement);
    expect(last.getByRole('spinbutton', { name: 'From year' })).toHaveProperty('value', '11');
    expect(last.getByRole('spinbutton', { name: 'Days a year' })).toHaveProperty('value', '28.0');
  });

  it('says there is nothing drafted, and offers no publishing', async () => {
    const { container } = render(
      <LeaveType load={ready(vacationPublished())} onPublish={vi.fn()} />,
    );
    expect(screen.getByText('Version 1 in effect from 1 January 2026')).toBeTruthy();
    expect(within(section('Change preview')).getByText(/^Nothing is drafted/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Publish changes' })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('has no allowance to set for a type that draws no balance', () => {
    const sick = leaveTypeRows()[1];
    if (sick === undefined) throw new Error('no sick');
    render(
      <LeaveType
        load={ready({ leaveType: sick, policies: [], policyId: null, preview: null, as: null })}
      />,
    );
    expect(
      screen.getByText('Sick draws no balance, so there is no allowance to set.'),
    ).toBeTruthy();
  });

  it('loads in the editor’s shape', async () => {
    const { container } = render(<LeaveType load={{ status: 'loading' }} />);
    expect(screen.getByRole('status').textContent).toBe('Loading leave type');
    expect(await axeViolations(container)).toEqual([]);
  });
});
