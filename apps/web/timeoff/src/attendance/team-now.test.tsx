import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../test/axe';
import { marcoBoard } from './acme.fixture';
import { TeamNow } from './team-now';

/**
 * Team, right now (T22, MT19) on Acme's demo data: Marco's reports on
 * Platform at 12:33 on Thursday 1 October.
 */

const ready = () => ({ status: 'ready' as const, data: marcoBoard() });

describe('team, right now', () => {
  it('counts who is in, on a break, not in yet and away', async () => {
    const { container } = render(<TeamNow load={ready()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Attendance' })).toBeTruthy();
    expect(screen.getByText('6 people report to you')).toBeTruthy();
    const count = (label: string): string | undefined =>
      screen.getAllByText(label).find((el) => el.closest('[class*="flex-col"]') !== null)
        ?.parentElement?.parentElement?.textContent ?? undefined;
    expect(count('In')).toContain('4');
    expect(count('On a break')).toContain('1');
    expect(count('Not in yet')).toContain('0');
    expect(count('Away')).toContain('1');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('shows each person’s status, office or remote, and today’s bar, and no trail', () => {
    render(<TeamNow load={ready()} />);
    const team = within(screen.getByRole('list', { name: 'Your team' }));
    const rows = team.getAllByRole('listitem');
    const text = (name: string): string =>
      rows.find((r) => r.textContent.includes(name))?.textContent ?? '';
    expect(text('Omar Haddad')).toContain('Office');
    expect(text('Omar Haddad')).toContain('In · 4h 02m');
    expect(text('Yuki Sato')).toContain('Break · 12m');
    expect(text('Ravi Patel')).toContain('Remote');
    expect(text('Ravi Patel')).toContain('In · 2h 21m');
    expect(text('Hana Kim')).toContain('Back Mon 5 Oct');
    expect(text('Hana Kim')).toContain('Away');
    expect(team.getByRole('figure', { name: 'Leo Rossi today' })).toBeTruthy();
    expect(team.queryByRole('figure', { name: 'Hana Kim today' })).toBeNull();
    expect(screen.getByText(/No location trail and no screen tracking/)).toBeTruthy();
  });

  it('lists what needs Marco: a late correction and overtime to decide', () => {
    render(<TeamNow load={ready()} />);
    const needs = within(
      screen.getByRole('heading', { name: 'Needs you' }).closest('section') as HTMLElement,
    );
    expect(needs.getByText('Adam Novak · Wednesday clock-out')).toBeTruthy();
    expect(needs.getByText('Omar Haddad · 1h 30m overtime')).toBeTruthy();
    expect(
      needs.getByRole('link', { name: 'Review Omar Haddad’s overtime' }).getAttribute('href'),
    ).toBe('/time-off/attendance/timesheets?person=p-omar&week=2026-09-29');
  });

  it('says what is normal in a sentence, tagged AI only when a model wrote it', () => {
    const { rerender } = render(<TeamNow load={ready()} />);
    const card = () =>
      within(
        screen
          .getByRole('heading', { name: 'Today, in a sentence' })
          .closest('.flex-col') as HTMLElement,
      );
    expect(card().getByText(/Ravi started at 10:12, inside the team’s hours/)).toBeTruthy();
    expect(card().queryByText('AI')).toBeNull();
    rerender(
      <TeamNow
        load={{
          status: 'ready',
          data: { ...marcoBoard(), sentence: { text: 'All in, as usual.', ai: true } },
        }}
      />,
    );
    expect(card().getByText('All in, as usual.')).toBeTruthy();
    expect(card().getByText('AI')).toBeTruthy();
  });

  it('draws its loading state in the page’s shape', async () => {
    const { container } = render(<TeamNow load={{ status: 'loading' }} />);
    expect(screen.getByRole('status').textContent).toBe('Loading your team right now');
    expect(await axeViolations(container)).toEqual([]);
  });
});
