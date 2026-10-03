import { fireEvent, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { expect, it, vi } from 'vitest';

import { Overview, TeamNow, Timesheet, TopBarClock } from '../index';
import { adam } from '../overview/acme.fixture';
import { underFloor } from '../test/floor';
import { adamClock, adamWeek, marcoBoard } from './acme.fixture';

/**
 * The clock and attendance at 390×844 with a coarse pointer and the real
 * stylesheet (MT3, MT4, MT17, MT18, MT19): axe over the page, contrast
 * included, and every tap target against the 44px floor.
 */

const shown = (el: Element | null): boolean =>
  el !== null && (el as HTMLElement).offsetParent !== null;

async function clean(): Promise<void> {
  const result = await axe.run(document.body, { rules: { region: { enabled: false } } });
  expect(
    result.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(',')}`),
  ).toEqual([]);
  expect(underFloor(document.body)).toEqual([]);
}

const ok = () => vi.fn(() => Promise.resolve({ ok: true as const }));

it('is a phone: a finger for a pointer', () => {
  expect(matchMedia('(pointer: coarse)').matches).toBe(true);
});

it('draws my week as MT17: the total first, then each day with what was worked and its bar', async () => {
  render(<Timesheet load={{ status: 'ready', data: adamWeek() }} onCorrect={ok()} />);
  const table = screen.getByRole('table', { name: 'Your days' });
  // Each row is the day, what was worked and its status, with the bar under them.
  const row = table.querySelectorAll(':scope > tbody > tr')[1];
  const cells = [...(row?.querySelectorAll(':scope > td') ?? [])].filter(shown);
  expect(cells.map((c) => c.textContent.replace(/(overtime).*$/s, '$1'))).toEqual([
    'Tue 29 Sept',
    '9h 05m',
    expect.stringMatching(/^Tue 29 Sept/),
    '+1h 05m overtime',
  ]);
  const [day, , bar] = cells;
  expect(bar?.getBoundingClientRect().top).toBeGreaterThan(
    (day?.getBoundingClientRect().bottom ?? Infinity) - 1,
  );
  // The week's total leads, above the days.
  const total = screen.getByText('20h 44m');
  expect(total.getBoundingClientRect().top).toBeLessThan(table.getBoundingClientRect().top);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  await clean();
});

it('fixes Wednesday in a sheet, as MT18, with the phone’s own time wheel', async () => {
  const onCorrect = ok();
  render(<Timesheet load={{ status: 'ready', data: adamWeek() }} onCorrect={onCorrect} />);
  fireEvent.click(screen.getByRole('button', { name: 'Fix Wednesday' }));
  const dialog = within(screen.getByRole('dialog', { name: 'When did you finish on Wednesday?' }));
  const time = dialog.getByLabelText('Finished at');
  expect(time.getAttribute('type')).toBe('time');
  fireEvent.change(time, { target: { value: '18:05' } });
  await clean();
  fireEvent.click(dialog.getByRole('button', { name: 'Save 18:05' }));
  expect(onCorrect).toHaveBeenCalledWith(
    expect.objectContaining({ at: '2026-09-30T16:05:00.000Z' }),
  );
});

it('draws the team as MT19: the counts, and one row each without the bar', async () => {
  render(<TeamNow load={{ status: 'ready', data: marcoBoard() }} />);
  expect(screen.queryByRole('figure', { name: 'Omar Haddad today' })).toBeNull();
  expect(shown(screen.getByText('Not in yet'))).toBe(false);
  expect(shown(screen.getByText('Back Mon 5 Oct'))).toBe(true);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  await clean();
});

it('clocks in on the overview with a slide, as MT3, from where you say you are', async () => {
  const onPunch = ok();
  const data = adam();
  if (data.clock === null) throw new Error('Adam has a clock');
  render(
    <Overview
      load={{
        status: 'ready',
        data: {
          ...data,
          clock: {
            state: 'out',
            workModel: null,
            today: { ...data.clock.today, workedMinutes: 0, segments: [] },
          },
        },
      }}
      onPunch={onPunch}
    />,
  );
  // The desk's button is not there under a finger; the slide is.
  expect(screen.queryByRole('button', { name: 'Clock in' })).toBeNull();
  const slide = screen.getByRole('slider', { name: 'Slide to clock in' });
  expect(shown(slide)).toBe(true);
  expect(shown(screen.getByText(/Kithena never tracks where you go/))).toBe(true);
  await clean();
  fireEvent.click(screen.getByRole('radio', { name: 'Remote' }));
  fireEvent.keyDown(slide, { key: 'Enter' });
  expect(onPunch).toHaveBeenCalledWith('in', 'remote', 'mobile');
});

it('shows the day before clocking out, as MT4, and keeps working on request', async () => {
  const onPunch = ok();
  render(<Overview load={{ status: 'ready', data: adam() }} onPunch={onPunch} />);
  fireEvent.click(screen.getByRole('button', { name: 'Clock out' }));
  const sheet = within(screen.getByRole('dialog', { name: 'Clock out at 12:33?' }));
  expect(sheet.getByText('3h 41m')).toBeTruthy();
  await clean();
  fireEvent.click(sheet.getByRole('button', { name: 'Keep working' }));
  expect(onPunch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Clock out' }));
  fireEvent.click(
    within(screen.getByRole('dialog', { name: 'Clock out at 12:33?' })).getByRole('button', {
      name: 'Clock out',
    }),
  );
  expect(onPunch).toHaveBeenCalledWith('out', 'office', 'mobile');
});

it('opens the top bar’s clock as a sheet under a finger, every target reachable', async () => {
  render(<TopBarClock load={{ status: 'ready', data: adamClock() }} onPunch={ok()} />);
  fireEvent.click(screen.getByRole('button', { name: 'The clock: clocked in' }));
  const sheet = within(screen.getByRole('dialog', { name: 'The clock' }));
  expect(shown(sheet.getByRole('button', { name: 'Keep working' }))).toBe(true);
  expect(shown(sheet.getByText('Worked'))).toBe(true);
  await clean();
});
