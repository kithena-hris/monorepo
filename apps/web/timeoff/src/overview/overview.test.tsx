import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Overview as Framed } from '../index';
import { axeViolations } from '../test/axe';
import { adam } from './acme.fixture';
import { Overview, type OverviewData } from './overview';

/**
 * The overview (T1, MT1) in each state it can be handed, on Acme's demo data:
 * Adam at 12:33 on Thursday 1 October 2026, and the states around it. Every
 * state passes axe.
 */

const ready = (data: OverviewData) => ({ status: 'ready' as const, data });
/** The browser's clock at the fixture's minute, as a page loaded then would have it. */
const atSeedTime = (): void => {
  vi.useFakeTimers({ now: Date.parse(adam().now), toFake: ['Date'] });
};
const section = (name: string): HTMLElement => {
  const heading = screen.getByRole('heading', { name });
  const found = heading.closest('section') ?? heading.closest('[class*="flex-col"]');
  if (!(found instanceof HTMLElement)) throw new Error(`no part headed “${name}”`);
  return found;
};

afterEach(() => {
  vi.useRealTimers();
});

describe('the overview', () => {
  it('greets Adam with his day, the clock, his balances and the actions', async () => {
    atSeedTime();
    const { container } = render(<Overview load={ready(adam())} onPunch={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Good afternoon, Adam' })).toBeTruthy();
    expect(screen.getByText('Thursday 1 October · Platform')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Plan parental leave' }).getAttribute('href')).toBe(
      '/time-off/parental/plan',
    );
    expect(screen.getByText('Clocked in')).toBeTruthy();
    expect(screen.getByRole('timer').textContent).toBe('3:41:00');
    expect(screen.getByText('Since 08:52 · 4h 19m left of your 8h day')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start break' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clock out' })).toBeTruthy();
    const balances = within(screen.getByRole('region', { name: 'Your balances' }));
    expect(balances.getByText('11.5')).toBeTruthy();
    expect(
      balances.getByRole('img', { name: 'Vacation: 10.5 used, 3 booked, 25 a year' }),
    ).toBeTruthy();
    expect(balances.getByText('6h')).toBeTruthy();
    expect(balances.getByText('banked')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('lists what is coming up, holidays and his own request, soonest first', () => {
    render(<Overview load={ready(adam())} />);
    const items = within(section('Coming up')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'Fiesta NacionalMon 12 Oct · public holidayIn 11 days',
      'La AlmudenaMon 9 Nov · public holidayIn 39 days',
      'Vacation · 10–12 Nov3 daysApproved',
      'Inmaculada ConcepciónTue 8 Dec · public holidayIn 68 days',
    ]);
    expect(
      within(section('Coming up')).getByRole('link', { name: /^Vacation · 10–12 Nov/ }),
    ).toHaveProperty('pathname', '/time-off/requests/0199a000-0000-7000-8000-000000000011');
  });

  it('turns one day into four with the Tuesday holiday, and says who on the team is away', () => {
    render(<Overview load={ready(adam())} />);
    const card = section('Make the most of your 11.5 days');
    expect(within(card).getByText('Take Mon 7 Dec')).toBeTruthy();
    expect(within(card).getByText('4 days off, 5–8 Dec, with Inmaculada Concepción.')).toBeTruthy();
    // A template, so no AI tag.
    expect(within(card).queryByText('AI')).toBeNull();
    expect(within(card).getByRole('link', { name: 'Request Mon 7 Dec' }).getAttribute('href')).toBe(
      '/time-off/request?type=vacation&from=2026-12-07&to=2026-12-07',
    );
    const team = within(section('Your team today'));
    expect(team.getByText('Hana Kim')).toBeTruthy();
    expect(team.getByText('Back Mon 5 Oct')).toBeTruthy();
    expect(team.getByText('Away')).toBeTruthy();
  });

  it('ticks the timer each second without drawing anything else again', () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-01T10:33:00.000Z') });
    render(<Overview load={ready(adam())} />);
    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    expect(screen.getByRole('timer').textContent).toBe('3:42:05');
  });

  it('punches through the shell, and says so when Time Off refuses', async () => {
    const onPunch = vi.fn(() =>
      Promise.resolve({ ok: false as const, message: 'Already on a break' }),
    );
    render(<Overview load={ready(adam())} onPunch={onPunch} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start break' }));
    expect(onPunch).toHaveBeenCalledWith('break_start', 'office');
    expect(await screen.findByText('Already on a break')).toBeTruthy();
  });

  it('on a break, offers to end it; clocked out, to clock in', async () => {
    atSeedTime();
    const onBreak = adam();
    const { container, rerender } = render(
      <Overview
        load={ready({
          ...onBreak,
          clock: onBreak.clock && { ...onBreak.clock, state: 'on_break' },
        })}
        onPunch={vi.fn()}
      />,
    );
    expect(screen.getByText('On a break')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'End break' })).toBeTruthy();
    expect(screen.getByRole('timer').textContent).toBe('3:41:00');
    expect(await axeViolations(container)).toEqual([]);
    rerender(
      <Overview
        load={ready({ ...onBreak, clock: onBreak.clock && { ...onBreak.clock, state: 'out' } })}
        onPunch={vi.fn()}
      />,
    );
    expect(screen.getByText('Not clocked in')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clock in' })).toBeTruthy();
  });

  it('gives an HR account that is not a member the page without a clock or balances', async () => {
    const { container } = render(
      <Overview
        load={ready({
          ...adam(),
          member: null,
          clock: null,
          balances: [],
          comingUp: [],
          bridges: [],
        })}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Time off' })).toBeTruthy();
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Your balances' })).toBeNull();
    expect(screen.queryByText(/Make the most/)).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('loads in its own shape, and fails with a way to try again', async () => {
    const { container, rerender } = render(<Overview load={{ status: 'loading' }} />);
    expect(screen.getByRole('status').textContent).toContain('Loading your time off');
    expect(screen.getByRole('heading', { level: 1, name: 'Time off' })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
    const retry = vi.fn();
    rerender(
      <Overview load={{ status: 'error', message: 'Time Off did not answer in time', retry }} />,
    );
    expect(screen.getByText('Time Off did not answer in time')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('takes the host’s frame: the trail and Request time off beside its own action', () => {
    render(
      <Framed
        load={ready(adam())}
        frame={{
          section: 'Overview',
          actions: [{ href: '/time-off/request', label: 'Request time off', icon: 'add' }],
        }}
      />,
    );
    expect(screen.getAllByRole('link', { name: 'Request time off' })[0]?.getAttribute('href')).toBe(
      '/time-off/request',
    );
    expect(screen.getByRole('link', { name: 'Plan parental leave' })).toBeTruthy();
  });
});
