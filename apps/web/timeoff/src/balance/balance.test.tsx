import { fireEvent, render, screen, within } from '@testing-library/react';
import { TooltipProvider } from '@reach/ui';
import { describe, expect, it, vi } from 'vitest';

import { Holidays } from '../holidays/holidays';
import { axeViolations } from '../test/axe';
import { madrid, vacation } from './acme.fixture';
import { Balance } from './balance';

/**
 * Where the days went (MT20) and the holidays where you work (MT21), on
 * Acme's demo data: Adam in Madrid on 1 October 2026. Every state passes axe.
 */

describe('where the days went', () => {
  it('draws the balance beside every line it folds from, newest first, the corrected one left out', async () => {
    const { container } = render(<Balance load={{ status: 'ready', data: vacation() }} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Vacation' })).toBeTruthy();
    expect(
      screen.getByRole('img', { name: 'Vacation: 10.5 used, 3 booked, 25 a year' }),
    ).toBeTruthy();
    const lines = within(screen.getByRole('region', { name: 'Every change' })).getAllByRole(
      'listitem',
    );
    expect(lines.map((li) => li.textContent)).toEqual([
      'Earned in OctoberThu 1 Oct+2.083',
      'BookedMon 21 Sept−3',
      'TakenFri 7 Aug−5',
      'Corrected by HRFri 10 Jul · recorded Tue 14 Jul · A half day, not a whole one−0.5',
      'TakenFri 20 Feb−5',
      'Carried over from 2025Thu 1 Jan+3',
    ]);
    expect(screen.getByRole('link', { name: /^Booked/ })).toHaveAttribute(
      'href',
      '/time-off/requests/0199a000-0000-7000-8000-000000000011',
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it('loads in its shape, and fails with a way to try again', async () => {
    const { container, rerender } = render(<Balance load={{ status: 'loading' }} />);
    expect(screen.getByRole('status').textContent).toContain('Loading this balance');
    expect(await axeViolations(container)).toEqual([]);
    const retry = vi.fn();
    rerender(<Balance load={{ status: 'error', message: 'No such leave type', retry }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });
});

describe('holidays where you work', () => {
  it('lists Madrid’s year with the bridge day, a moved holiday and how far off each is', async () => {
    const { container } = render(<Holidays load={{ status: 'ready', data: madrid() }} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Holidays in 2026' })).toBeTruthy();
    expect(screen.getByText('Madrid · national, regional, city holidays')).toBeTruthy();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Fiesta del TrabajoFri 1 May · Passed',
      'Fiesta NacionalMon 12 Oct · In 11 days',
      'Todos los SantosMon 2 Nov · Moved from Sun 1 Nov',
      'La AlmudenaMon 9 Nov · In 39 days',
      'Inmaculada ConcepciónTue 8 Dec · Take Mon 7 Dec → 4 days off',
      'NavidadFri 25 Dec · In 85 days',
    ]);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('goes to the next year’s address', () => {
    const onNavigate = vi.fn();
    render(<Holidays load={{ status: 'ready', data: madrid() }} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('radio', { name: '2027' }));
    expect(onNavigate).toHaveBeenCalledWith('/time-off/holidays/2027');
  });

  it('adds them to a calendar through the feed, or says why not', async () => {
    const onSubscribe = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, message: 'Time Off did not answer' })
      .mockResolvedValueOnce({
        ok: true,
        url: 'https://api.kithena.test/v1/timeoff/calendar/feed.ics?token=t',
      });
    // The copy button's tooltip needs the provider `framed` gives every screen.
    const { container } = render(
      <TooltipProvider>
        <Holidays load={{ status: 'ready', data: madrid() }} onSubscribe={onSubscribe} />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add to my calendar' }));
    expect(await screen.findByText('Time Off did not answer')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Add to my calendar' }));
    expect(await screen.findByRole('link', { name: 'Open in my calendar' })).toHaveAttribute(
      'href',
      'webcal://api.kithena.test/v1/timeoff/calendar/feed.ics?token=t',
    );
    expect(screen.getByRole('button', { name: 'Copy the feed address' })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('loads in its shape', async () => {
    const { container } = render(<Holidays load={{ status: 'loading' }} />);
    expect(screen.getByRole('status').textContent).toContain('Loading the holidays');
    expect(await axeViolations(container)).toEqual([]);
  });
});
