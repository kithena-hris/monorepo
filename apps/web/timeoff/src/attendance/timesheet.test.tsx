import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Timesheet as Framed } from '../index';
import { axeViolations } from '../test/axe';
import { adamWeek } from './acme.fixture';
import { instantAt } from './time';
import { Timesheet, type TimesheetData } from './timesheet';

/**
 * My timesheet (T20, MT17) and fixing a missed clock-out (T21, MT18) on
 * Acme's demo data: Adam's week of 28 September, seen on Thursday at 12:33.
 */

const ready = (data: TimesheetData = adamWeek()) => ({ status: 'ready' as const, data });

describe('my timesheet', () => {
  it('draws each day with its punches, what was worked and its bar, and what it needs', async () => {
    const { container } = render(<Timesheet load={ready()} onCorrect={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Attendance' })).toBeTruthy();
    expect(screen.getByText('Week of 28 Sept · 40h scheduled')).toBeTruthy();
    // The table's own rows and cells: each bar carries a table of its own for a screen reader.
    const rows = [
      ...screen.getByRole('table', { name: 'Your days' }).querySelectorAll(':scope > tbody > tr'),
    ];
    const cells = (i: number): string[] =>
      [...(rows[i - 1]?.querySelectorAll(':scope > td') ?? [])].map((c) => c.textContent);
    expect(cells(1).slice(0, 5)).toEqual(['Mon 28 Sept', '08:58', '17:41', '45m', '7h 58m']);
    expect(cells(2)[6]).toBe('+1h 05m overtime');
    expect(cells(3).slice(0, 5)).toEqual(['Wed 30 Sept', '08:47', '—', '50m', '—']);
    expect(cells(4).slice(0, 5)).toEqual(['Thu 1 Oct', '08:52', 'now', '—', '3h 41m']);
    expect(cells(4)[6]).toBe('Clocked in');
    expect(cells(5)[6]).toBe('Planned 8h');
    expect(screen.getByRole('figure', { name: 'Wed 30 Sept' })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('totals the week against the schedule, the overtime waiting, and who can see it', () => {
    render(<Timesheet load={ready()} />);
    expect(screen.getByText('20h 44m')).toBeTruthy();
    expect(screen.getByText('Of 40h, not counting Wednesday')).toBeTruthy();
    const overtime = within(
      screen.getByRole('heading', { name: 'Overtime' }).closest('section') as HTMLElement,
    );
    expect(overtime.getByText('Waiting for approval').nextSibling?.textContent).toBe('1h 05m');
    expect(
      screen.getByText(
        'Kept for 4 years as Spanish law requires. Only you, your manager and HR can see it.',
      ),
    ).toBeTruthy();
    expect(screen.getByText(/no location trail, no screenshots/)).toBeTruthy();
  });

  it('moves between weeks and months by address', () => {
    render(<Timesheet load={ready()} />);
    expect(screen.getByRole('link', { name: 'Previous week' }).getAttribute('href')).toBe(
      '/time-off/attendance/timesheet?week=2026-09-21',
    );
    expect(screen.getByRole('link', { name: 'Next week' }).getAttribute('href')).toBe(
      '/time-off/attendance/timesheet?week=2026-10-05',
    );
    expect(screen.getByRole('link', { name: 'Month' }).getAttribute('href')).toBe(
      '/time-off/attendance/timesheet?month=2026-09',
    );
  });

  it('draws its loading state in the page’s shape, and says why when it cannot load', async () => {
    const { container, rerender } = render(<Timesheet load={{ status: 'loading' }} />);
    expect(screen.getByRole('status').textContent).toBe('Loading your timesheet');
    expect(await axeViolations(container)).toEqual([]);
    const retry = vi.fn();
    rerender(<Timesheet load={{ status: 'error', message: 'Time Off is asleep', retry }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });

  it('opens under the host’s frame, with its tabs', () => {
    render(
      <Framed
        load={ready()}
        frame={{
          section: 'Attendance',
          tabs: [
            { href: '/time-off/attendance/timesheet', label: 'My timesheet', current: true },
            { href: '/time-off/attendance/requests', label: 'Requests', current: false },
          ],
        }}
      />,
    );
    expect(screen.getByRole('link', { name: 'My timesheet' })).toBeTruthy();
  });
});

describe('fixing a missed clock-out', () => {
  it('asks when Adam finished on Wednesday, and adds a clock-out beside the record', async () => {
    const onCorrect = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(<Timesheet load={ready()} onCorrect={onCorrect} />);
    expect(screen.getByText('You didn’t clock out on Wednesday')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fix Wednesday' }));
    const dialog = within(
      screen.getByRole('dialog', { name: 'When did you finish on Wednesday?' }),
    );
    expect(dialog.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
    expect(await axeViolations(document.body)).toEqual([]);
    fireEvent.change(dialog.getByLabelText('Finished at'), { target: { value: '18:05' } });
    fireEvent.blur(dialog.getByLabelText('Finished at'));
    // 4h 25m before the break and 4h 03m after it: 8h 28m, 28m over.
    expect(dialog.getByText('8h 28m worked, 28m overtime')).toBeTruthy();
    fireEvent.change(dialog.getByRole('textbox', { name: 'Note (optional)' }), {
      target: { value: 'Forgot after the release call' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Save 18:05' }));
    expect(onCorrect).toHaveBeenCalledWith({
      personId: '7ac0e000-0000-7000-8000-000000000002',
      supersedes: null,
      at: '2026-09-30T16:05:00.000Z',
      kind: 'out',
      reason: 'Forgot after the release call',
    });
    expect(await screen.findByRole('button', { name: 'Fix Wednesday' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('fills in Time Off’s suggestion with the evidence it used, tagged AI only when a model chose it', async () => {
    const onCorrect = vi.fn(() => Promise.resolve({ ok: true as const }));
    const suggestion = {
      at: '2026-09-30T16:05:00.000Z',
      time: '18:05',
      ai: true,
      evidence: [
        {
          source: 'kithena' as const,
          at: '2026-09-30T16:04:00.000Z',
          what: 'You sent a time-off request',
        },
        {
          source: 'calendar' as const,
          at: '2026-09-30T15:30:00.000Z',
          what: 'Billing v2 sync, Google Calendar',
        },
      ],
    };
    const week = adamWeek();
    render(
      <Timesheet
        load={ready({
          ...week,
          fix: '2026-09-30',
          open: week.open.map((o) => ({ ...o, suggestion })),
        })}
        onCorrect={onCorrect}
      />,
    );
    const dialog = within(
      screen.getByRole('dialog', { name: 'When did you finish on Wednesday?' }),
    );
    expect(dialog.getByRole('heading', { name: 'Around 18:05' })).toBeTruthy();
    expect(dialog.getByText('Your last action in Kithena was at 18:04')).toBeTruthy();
    expect(dialog.getByText('Your meeting ended at 17:30')).toBeTruthy();
    expect(dialog.getByText('Billing v2 sync, Google Calendar')).toBeTruthy();
    expect(dialog.getByText('AI')).toBeTruthy();
    expect(dialog.getByText('8h 28m worked, 28m overtime')).toBeTruthy();
    expect(await axeViolations(document.body)).toEqual([]);
    fireEvent.click(dialog.getByRole('button', { name: 'Save 18:05' }));
    expect(onCorrect).toHaveBeenCalledWith(
      expect.objectContaining({ at: '2026-09-30T16:05:00.000Z', kind: 'out' }),
    );
  });

  it('opens from the morning notification’s link, and says so when Time Off refuses', async () => {
    const onCorrect = vi.fn(() =>
      Promise.resolve({ ok: false as const, message: 'The time is before your last punch' }),
    );
    render(<Timesheet load={ready({ ...adamWeek(), fix: '2026-09-30' })} onCorrect={onCorrect} />);
    const dialog = within(
      screen.getByRole('dialog', { name: 'When did you finish on Wednesday?' }),
    );
    fireEvent.change(dialog.getByLabelText('Finished at'), { target: { value: '19:00' } });
    fireEvent.blur(dialog.getByLabelText('Finished at'));
    fireEvent.click(dialog.getByRole('button', { name: 'Save 19:00' }));
    expect(await dialog.findByText('The time is before your last punch')).toBeTruthy();
  });
});

describe('a wall-clock time in a zone', () => {
  it('is the instant it names there, either side of a change of offset', () => {
    expect(instantAt('2026-09-30', '18:05', 'Europe/Madrid')).toBe('2026-09-30T16:05:00.000Z');
    expect(instantAt('2026-11-02', '18:05', 'Europe/Madrid')).toBe('2026-11-02T17:05:00.000Z');
    expect(instantAt('2026-09-30', '18:05', 'America/New_York')).toBe('2026-09-30T22:05:00.000Z');
  });
});
