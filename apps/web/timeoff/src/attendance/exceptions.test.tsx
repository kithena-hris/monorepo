import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../test/axe';
import { adaExceptions } from './acme.fixture';
import { Exceptions } from './exceptions';

/** Exceptions for HR (T23) on Acme's September: what needs Ada, and the inspector's record. */

const ready = (over: Partial<ReturnType<typeof adaExceptions>> = {}) => ({
  status: 'ready' as const,
  data: { ...adaExceptions(), ...over },
});

describe('exceptions for HR', () => {
  it('lists the four kinds with their count and why each matters', async () => {
    const { container } = render(<Exceptions load={ready()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Attendance' })).toBeTruthy();
    expect(screen.getByText('Everyone · September 2026')).toBeTruthy();
    const kinds = within(screen.getByRole('list', { name: 'What needs action' }));
    const rows = kinds.getAllByRole('listitem').map((r) => r.textContent);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain('Missed clock-outs');
    expect(rows[0]).toContain('2');
    expect(rows[1]).toContain('Less than 12h rest between days');
    expect(rows[1]).toContain('The working-time rules require 12h');
    expect(rows[2]).toContain('Overtime waiting for approval');
    expect(rows[2]).toContain('2h 35m');
    expect(rows[3]).toContain('Worked on a holiday');
    expect(rows[3]).toContain('A day in lieu is owed');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('opens the first kind with anyone in it, and the one the address names', () => {
    const { unmount } = render(<Exceptions load={ready()} />);
    const missed = within(screen.getByRole('list', { name: 'Missed clock-outs, by person' }));
    expect(missed.getAllByRole('listitem').map((r) => r.textContent)).toEqual([
      expect.stringContaining('Leo Rossi'),
      expect.stringContaining('Adam Novak'),
    ]);
    expect(missed.getByText('Wed 30 Sept · no clock-out')).toBeTruthy();
    unmount();

    render(<Exceptions load={ready({ kind: 'short_rest' })} />);
    const rest = within(
      screen.getByRole('list', { name: 'Less than 12h rest between days, by person' }),
    );
    expect(rest.getByText('Wed 30 Sept · 10h 10m rest before it')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /^Less than 12h rest between days/ }).getAttribute('href'),
    ).toBe('/time-off/attendance/exceptions?month=2026-09&kind=short_rest');
  });

  it('downloads the inspector’s record for the month, as CSV and PDF, and moves a month', () => {
    render(<Exceptions load={ready()} />);
    expect(
      screen.getByRole('link', { name: 'Export for the labour inspector' }).getAttribute('href'),
    ).toBe('/time-off/downloads/inspector?from=2026-09-01&to=2026-09-30&format=csv');
    expect(
      screen
        .getByRole('link', { name: 'Export for the labour inspector as PDF' })
        .getAttribute('href'),
    ).toBe('/time-off/downloads/inspector?from=2026-09-01&to=2026-09-30&format=pdf');
    expect(screen.getByRole('link', { name: 'August 2026' }).getAttribute('href')).toBe(
      '/time-off/attendance/exceptions?month=2026-08',
    );
  });

  it('says when nothing needs HR', () => {
    render(<Exceptions load={ready({ items: [] })} />);
    expect(screen.getByText('Nothing needs you in September 2026.')).toBeTruthy();
  });

  it('loads in the page’s shape', async () => {
    const { container } = render(<Exceptions load={{ status: 'loading' }} />);
    expect(screen.getByRole('status').textContent).toBe('Loading the exceptions');
    expect(await axeViolations(container)).toEqual([]);
  });
});
