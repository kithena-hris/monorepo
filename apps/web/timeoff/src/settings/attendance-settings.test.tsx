import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { attendance } from './acme.fixture';
import { AttendanceSettings } from './attendance-settings';

/**
 * Attendance rules (T33) on Acme's settings: a break after 6 hours, 12 hours'
 * rest, 42 hours a week with overtime, and overtime as the person chooses.
 * Every state passes axe.
 */

const ready = { status: 'ready' as const, data: attendance() };

describe('attendance rules', () => {
  it('shows how people clock in, the limits, the schedule and what is never recorded', async () => {
    const { container } = render(<AttendanceSettings load={ready} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Attendance' })).toBeTruthy();
    const ways = within(screen.getByRole('list', { name: 'Ways to clock in' }));
    expect(ways.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Web, from the top barEveryoneOn',
      'Mobile appEveryoneOn',
      'Only inside the office areaLocation is only checked at the moment of a punch, and never kept.Off',
    ]);
    expect(screen.getByRole('spinbutton', { name: 'Break after (hours)' })).toHaveProperty(
      'value',
      '6',
    );
    expect(screen.getByRole('spinbutton', { name: 'Rest between days (hours)' })).toHaveProperty(
      'value',
      '12',
    );
    expect(screen.getByRole('spinbutton', { name: 'Weekly maximum (hours)' })).toHaveProperty(
      'value',
      '42',
    );
    expect(screen.getByRole('radio', { name: 'Person chooses' })).toHaveProperty(
      'ariaChecked',
      'true',
    );
    expect(screen.getByText('Mon–Fri · 09:00–17:30 · 40h')).toBeTruthy();
    expect(screen.getByText('What Kithena never records')).toBeTruthy();
    expect(
      screen.getByText(
        'No location trail, no screenshots, no keyboard or app activity. Only the punches people make.',
      ),
    ).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('saves the rules in minutes, as Time Off keeps them', async () => {
    const onSave = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(<AttendanceSettings load={ready} onSave={onSave} />);
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Break after (hours)' }), {
      key: 'ArrowUp',
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Comp time' }));
    expect(screen.queryByRole('spinbutton', { name: 'Paid at (× the hourly rate)' })).toBeNull();
    expect(screen.getByText('Banked hour for hour as comp time.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(onSave).toHaveBeenCalledWith({
      breakAfterMinutes: 390,
      breakMinutes: 30,
      restMinutes: 720,
      weeklyMaxMinutes: 2520,
      overtime: { becomes: 'comp', multiplier: '1.25' },
    });
  });

  it('keeps the form and says why when Time Off refuses it', async () => {
    const onSave = vi.fn(() =>
      Promise.resolve({ ok: false as const, message: 'Only HR can do that' }),
    );
    render(<AttendanceSettings load={ready} onSave={onSave} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Paid' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(screen.getByText('Not saved')).toBeTruthy();
    expect(screen.getByText('Only HR can do that')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Paid' })).toHaveProperty('ariaChecked', 'true');
  });

  it('loads in the page’s shape', async () => {
    const { container } = render(<AttendanceSettings load={{ status: 'loading' }} />);
    expect(screen.getByRole('status').textContent).toBe('Loading attendance');
    expect(await axeViolations(container)).toEqual([]);
  });
});
