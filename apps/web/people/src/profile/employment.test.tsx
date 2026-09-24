import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { fast } from '../test/user';
import { dayAfter, Employment, type EmploymentPeriod, type EmploymentState } from './employment';

const calendar = { today: '2026-09-24', timeZone: 'Europe/Madrid' };
const first: EmploymentPeriod = {
  period: 1,
  startedOn: '2026-01-01',
  lastWorkingDay: null,
  leavingReason: null,
  eligibleForRehire: null,
  noticeFrom: null,
  rehireOverrideReason: null,
};

const state = (status: string, periods: readonly EmploymentPeriod[] = [first]): EmploymentState => ({
  calendar,
  employment: { status, periods },
});

const done = () => Promise.resolve({ ok: true as const });

describe('lifecycle moves on a profile (PEO-120)', () => {
  it('counts days on the calendar alone', () => {
    expect(dayAfter('2026-12-31')).toBe('2027-01-01');
    expect(dayAfter('2028-02-28')).toBe('2028-02-29');
  });

  it('offers what the status allows, and nothing on one’s own profile', async () => {
    const { container, rerender } = render(<Employment state={state('active')} onMove={vi.fn(done)} />);
    for (const name of ['Give notice', 'Start leave', 'Terminate']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Rehire' })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
    rerender(<Employment state={state('notice')} onMove={vi.fn(done)} />);
    expect(screen.getByRole('button', { name: 'Withdraw notice' })).toBeInTheDocument();
    rerender(<Employment state={state('active')} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('2026-09-24 (Europe/Madrid)')).toBeInTheDocument();
  });

  it('terminates with a reason, and ends access now when asked', async () => {
    const onMove = vi.fn(done);
    render(<Employment state={state('active')} onMove={onMove} />);
    const user = fast();
    await user.click(screen.getByRole('button', { name: 'Terminate' }));
    const dialog = screen.getByRole('dialog', { name: 'Terminate' });
    await user.click(within(dialog).getByRole('button', { name: 'Terminate' }));
    expect(onMove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('combobox', { name: /Reason/ }));
    await user.click(screen.getByRole('option', { name: 'Dismissed' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Eligible for rehire' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'End their access now' }));
    await user.click(within(dialog).getByRole('button', { name: 'Terminate' }));
    expect(onMove).toHaveBeenCalledWith({
      kind: 'terminate',
      lastWorkingDay: '2026-09-24',
      reason: 'dismissed',
      eligibleForRehire: false,
      endAccessNow: true,
    });
  });

  it('asks why before rehiring somebody not eligible, and shows a refusal', async () => {
    const onMove = vi.fn(() => Promise.resolve({ ok: false as const, message: 'Not yet' }));
    const left: EmploymentPeriod = {
      ...first,
      lastWorkingDay: '2026-09-01',
      leavingReason: 'dismissed',
      eligibleForRehire: false,
    };
    render(<Employment state={state('terminated', [left])} onMove={onMove} />);
    expect(screen.getByText('Not eligible for rehire')).toBeInTheDocument();
    const user = fast();
    await user.click(screen.getByRole('button', { name: 'Rehire' }));
    const dialog = screen.getByRole('dialog', { name: 'Rehire' });
    await user.click(within(dialog).getByRole('button', { name: 'Rehire' }));
    expect(onMove).not.toHaveBeenCalled();
    await user.type(
      within(dialog).getByRole('textbox', { name: /Why rehire them anyway/ }),
      'Cleared on appeal',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Rehire' }));
    expect(onMove).toHaveBeenCalledWith({
      kind: 'rehire',
      startDate: '2026-09-24',
      overrideReason: 'Cleared on appeal',
    });
    expect(await within(dialog).findByText('Not yet')).toBeInTheDocument();
  });

  it('moves without a form where there is nothing to ask', async () => {
    const onMove = vi.fn(done);
    render(<Employment state={state('on_leave')} onMove={onMove} />);
    const user = fast();
    await user.click(screen.getByRole('button', { name: 'End leave' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End leave' }));
    expect(onMove).toHaveBeenCalledWith({ kind: 'endLeave' });
  });
});
