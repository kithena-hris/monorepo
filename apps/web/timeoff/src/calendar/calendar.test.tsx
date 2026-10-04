import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TeamCalendar as Framed } from '../index';
import { axeViolations } from '../test/axe';
import { adam, october, year } from '../approvals/acme.fixture';
import { TeamCalendar, type TeamCalendarData } from './calendar';

/**
 * The team calendar (T12–T15, MT13, MT14) on Acme's demo data: Platform's
 * October 2026 as Marco sees it once Adam has asked for 19–23 October.
 */

const ready = (data: TeamCalendarData) => ({ status: 'ready' as const, data });

describe('the month (T12, T14)', () => {
  it('draws everyone off, the holiday and the day below the minimum', async () => {
    const { container } = render(
      <Framed load={ready(october())} path="/time-off/calendar/month" query={{}} />,
    );
    const month = screen.getByRole('region', { name: 'October 2026' });
    expect(
      within(month).getByRole('button', { name: 'Monday 12 October, Fiesta Nacional' }),
    ).toBeTruthy();
    expect(
      within(month).getByRole('button', { name: 'Wednesday 21 October, 4 of 7 in' }),
    ).toBeTruthy();
    expect(within(month).getAllByText('Adam').length).toBe(5);
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('opens a day from the query, and puts the day picked there', async () => {
    const onFilter = vi.fn();
    render(
      <Framed
        load={ready(october())}
        path="/time-off/calendar/month"
        query={{ day: '2026-10-21' }}
        onFilter={onFilter}
      />,
    );
    const day = within(screen.getByRole('dialog', { name: 'Wednesday 21 October' }));
    expect(day.getByText('4 of 7 in')).toBeTruthy();
    expect(day.getByText('Omar Haddad')).toBeTruthy();
    expect(day.getByText('Personal day · 21 Oct')).toBeTruthy();
    expect(day.getAllByText('Waiting')).toHaveLength(1);
    expect(day.getByRole('link', { name: 'Review Adam’s request' }).getAttribute('href')).toBe(
      `/time-off/approvals/waiting/${adam.requestId}`,
    );
    expect(await axeViolations(document.body)).toEqual([]);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onFilter).toHaveBeenCalledWith({ day: null });
  });

  it('keeps the types and holidays asked for in the query, and moves by month', () => {
    const onFilter = vi.fn();
    const onNavigate = vi.fn();
    render(
      <Framed
        load={ready(october())}
        path="/time-off/calendar/month"
        query={{ types: 'vacation', holidays: 'none' }}
        onFilter={onFilter}
        onNavigate={onNavigate}
      />,
    );
    const month = screen.getByRole('region', { name: 'October 2026' });
    expect(within(month).queryByText('Yuki')).toBeNull();
    expect(within(month).queryByRole('button', { name: /Fiesta Nacional/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Personal day' }));
    expect(onFilter).toHaveBeenCalledWith({ types: 'vacation,personal' });
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(onNavigate).toHaveBeenCalledWith(
      '/time-off/calendar/month?types=vacation&holidays=none&month=2026-11',
    );
  });

  it('gives a feed address to subscribe to', async () => {
    const onSubscribe = vi.fn(() =>
      Promise.resolve({ ok: true as const, url: 'https://acme.test/feed.ics?token=t' }),
    );
    render(
      <Framed load={ready(october())} path="/time-off/calendar/month" onSubscribe={onSubscribe} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }));
    expect(onSubscribe).toHaveBeenCalledWith('team');
    expect(
      await screen.findByText('https://acme.test/feed.ics?token=t', {}, { timeout: 5000 }),
    ).toBeTruthy();
  });
});

describe('the timeline and a clash (T13, T15)', () => {
  it('counts who is in, and offers the fixes ranked by whom they inconvenience', async () => {
    const onSuggest = vi.fn(() => Promise.resolve({ ok: true as const }));
    const { container } = render(
      <Framed
        load={ready(october('timeline'))}
        path="/time-off/calendar/timeline"
        onSuggest={onSuggest}
      />,
    );
    // The desk's card; the phone's is the same under its week.
    const heading = screen.getAllByRole('heading', {
      name: 'Wed 21 Oct is below the team minimum',
    })[0];
    const card = within(heading?.closest('[data-material], .flex-col') as HTMLElement);
    expect(
      card.getByText(
        'Adam’s request would leave 4 of 7 in. Here are 3 ways to keep 5, with what each one costs.',
      ),
    ).toBeTruthy();
    expect(card.getAllByRole('radio')).toHaveLength(4);
    for (const title of [
      'Ask Adam to swap Wed 21 for Mon 26',
      'Ask Adam to take 26–30 Oct',
      'Approve as asked',
      'Ask Yuki to move 21 Oct',
    ]) {
      expect(card.getByText(title)).toBeTruthy();
    }
    fireEvent.click(card.getByRole('button', { name: 'Suggest the swap to Adam' }));
    expect(onSuggest).toHaveBeenCalledWith(adam.requestId, [
      {
        spans: [
          { from: '2026-10-19', to: '2026-10-20' },
          { from: '2026-10-22', to: '2026-10-26' },
        ],
      },
    ]);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('the year, and the states around it', () => {
  it('draws the year as a heatmap', async () => {
    const { container } = render(<Framed load={ready(year())} path="/time-off/calendar/year" />);
    expect(screen.getByRole('heading', { name: '2026' })).toBeTruthy();
    expect(screen.getByText('How many people are off each day in 2026.')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('loads in the view’s shape', async () => {
    const { container } = render(
      <TeamCalendar load={{ status: 'loading' }} path="/time-off/calendar/timeline" />,
    );
    expect(screen.getByRole('status').textContent).toContain('Loading the calendar');
    expect(await axeViolations(container)).toEqual([]);
  });
});
