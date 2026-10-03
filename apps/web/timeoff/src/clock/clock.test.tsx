import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { runScreenCommand } from '@reach/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TopBarClock } from '../index';
import { NOW, adamClock } from '../attendance/acme.fixture';
import { axeViolations } from '../test/axe';
import { checkOnce, metresBetween, officeAt } from './location';

/**
 * The clock in the top bar (T2) on Acme's demo data: Adam at 12:33 on
 * Thursday 1 October, clocked in at the Madrid reader since 08:52.
 */

const ready = (data = adamClock()) => ({ status: 'ready' as const, data });
const ok = () => vi.fn(() => Promise.resolve({ ok: true as const }));

afterEach(() => {
  vi.useRealTimers();
});

describe('the clock in the top bar', () => {
  it('shows the time worked today and ticks every second without being drawn again', () => {
    vi.useFakeTimers({ now: Date.parse(NOW), toFake: ['Date', 'setInterval', 'clearInterval'] });
    render(<TopBarClock load={ready()} onPunch={ok()} />);
    const pill = screen.getByRole('button', { name: 'The clock: clocked in' });
    expect(pill.textContent).toContain('3:41:00');
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(pill.textContent).toContain('3:41:02');
  });

  it('opens on the day: the bar, the punches, working on, Start break and Clock out', async () => {
    vi.useFakeTimers({ now: Date.parse(NOW), toFake: ['Date'] });
    const onPunch = ok();
    render(<TopBarClock load={ready()} onPunch={onPunch} />);
    fireEvent.click(screen.getByRole('button', { name: 'The clock: clocked in' }));
    const panel = within(screen.getByRole('dialog', { name: 'The clock' }));
    expect(panel.getByText('Clocked in · Office')).toBeTruthy();
    expect(panel.getByRole('timer').textContent).toBe('3:41:00');
    expect(panel.getByRole('figure', { name: 'Today' })).toBeTruthy();
    const punches = within(panel.getByRole('list', { name: 'Today’s punches' }));
    expect(punches.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '08:52 Clocked inBadge reader · Office',
    ]);
    expect(panel.getByText('What are you working on?')).toBeTruthy();
    expect(panel.getByRole('button', { name: 'Start break' })).toBeTruthy();
    expect(await axeViolations(document.body)).toEqual([]);
    fireEvent.click(panel.getByRole('button', { name: 'Clock out' }));
    expect(onPunch).toHaveBeenCalledWith('out', 'office', 'web');
  });

  it('keeps what you are working on, in your own words, on this device', () => {
    render(<TopBarClock load={ready()} onPunch={ok()} />);
    fireEvent.click(screen.getByRole('button', { name: 'The clock: clocked in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'What you are working on' }), {
      target: { value: 'Billing v2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Working on Billing v2')).toBeTruthy();
    expect(localStorage.getItem('kithena.timeoff.working-on')).toBe('Billing v2');
    localStorage.clear();
  });

  it('opens and closes on ⌥T, which the shell runs as the clock’s command', () => {
    render(<TopBarClock load={ready()} onPunch={ok()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => {
      expect(runScreenCommand('clock')).toBe(true);
    });
    expect(screen.getByRole('dialog', { name: 'The clock' })).toBeTruthy();
    act(() => {
      runScreenCommand('clock');
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is a Clock in button when out, and clocks in where you say you are', async () => {
    const data = adamClock();
    const out = {
      ...data,
      punches: data.punches.filter((p) => p.at < '2026-09-29T00:00:00Z'),
      days: data.days.map((d) =>
        d.date === '2026-10-01'
          ? {
              ...d,
              status: 'planned' as const,
              workedMinutes: null,
              segments: [{ kind: 'planned', from: 540, to: 1050 }],
            }
          : d,
      ),
    };
    const onPunch = ok();
    render(<TopBarClock load={ready(out)} onPunch={onPunch} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clock in' }));
    const panel = within(screen.getByRole('dialog', { name: 'The clock' }));
    expect(panel.getByText('Your day is 8h. Nothing punched yet today.')).toBeTruthy();
    fireEvent.click(panel.getByRole('radio', { name: 'Remote' }));
    expect(await axeViolations(document.body)).toEqual([]);
    fireEvent.click(panel.getByRole('button', { name: 'Clock in' }));
    expect(onPunch).toHaveBeenCalledWith('in', 'remote', 'web');
  });

  it('says so when the clock does not change', async () => {
    const onPunch = vi.fn(() =>
      Promise.resolve({ ok: false as const, message: 'Already on a break' }),
    );
    render(<TopBarClock load={ready()} onPunch={onPunch} />);
    fireEvent.click(screen.getByRole('button', { name: 'The clock: clocked in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start break' }));
    expect(await screen.findByText('Already on a break')).toBeTruthy();
    expect(screen.getByText('The clock did not change')).toBeTruthy();
  });

  it('draws nothing until it has the clock, or when it cannot have one', () => {
    const { container, rerender } = render(<TopBarClock load={{ status: 'loading' }} />);
    expect(container.innerHTML).toBe('');
    rerender(<TopBarClock load={{ status: 'error', message: 'Not a member' }} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('the one location check', () => {
  const madrid = {
    name: 'Madrid office',
    latitude: 40.4168,
    longitude: -3.7038,
    radiusMetres: 150,
  };

  it('finds the office a point is inside, and none outside every one', () => {
    expect(Math.round(metresBetween(madrid, { latitude: 40.4178, longitude: -3.7038 }))).toBe(111);
    expect(officeAt({ latitude: 40.4175, longitude: -3.7035 }, [madrid])).toBe(madrid);
    expect(officeAt({ latitude: 40.43, longitude: -3.7038 }, [madrid])).toBeNull();
  });

  it('asks once and answers with the office, never with where the device is', async () => {
    const getCurrentPosition = vi.fn((done: PositionCallback) => {
      done({ coords: { latitude: 40.4169, longitude: -3.7039 } } as GeolocationPosition);
    });
    const geolocation = { getCurrentPosition } as unknown as Geolocation;
    expect(await checkOnce([madrid], geolocation)).toEqual(madrid);
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    // Nothing to compare with: it does not ask at all.
    expect(await checkOnce([], geolocation)).toBeNull();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });
});
