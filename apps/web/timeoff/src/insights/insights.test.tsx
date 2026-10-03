import { TooltipProvider } from '@reach/ui';
import { render as draw, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { axeViolations } from '../test/axe';
import { adaInsights } from './acme.fixture';
import { Insights } from './insights';

// The charts' tooltips need the provider `framed` gives every screen.
const render = (ui: ReactElement) => draw(<TooltipProvider>{ui}</TooltipProvider>);

/** Insights (T27) for Ada on Acme's 1 October: each tab, the people behind a point, and the cohort rule. */

const ready = (over: Parameters<typeof adaInsights>[0] = {}) => ({
  status: 'ready' as const,
  data: adaInsights(over),
});

describe('insights', () => {
  it('says the month in points, each with where it came from and its people', async () => {
    const { container } = render(<Insights load={ready()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Insights' })).toBeTruthy();
    expect(
      screen.getByText(/across the company · 6 people · as of Thursday 1 October/),
    ).toBeTruthy();
    const points = within(screen.getByRole('list', { name: 'What changed' }));
    expect(points.getAllByRole('listitem')).toHaveLength(3);
    expect(points.getByText(/1240 days of vacation are still unbooked/)).toBeTruthy();
    expect(
      points.getByRole('link', { name: 'See 4 people: who has had no break' }).getAttribute('href'),
    ).toBe('/time-off/insights/what-changed?point=no_break');
    // A point about a count has nobody behind it to list.
    expect(points.queryByRole('link', { name: /missed/ })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Days taken by month' })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('opens the people behind a point beside it, and offers to nudge them', () => {
    render(<Insights load={ready({ point: 'no_break' })} />);
    const behind = within(screen.getByRole('list', { name: 'The people behind it' }));
    expect(behind.getAllByRole('listitem').map((r) => r.textContent)).toEqual([
      expect.stringContaining('Omar Haddad'),
      expect.stringContaining('Ravi Patel'),
      expect.stringContaining('Leo Rossi'),
      expect.stringContaining('Yuki Sato'),
    ]);
    expect(behind.getByText('Last day off Thu 30 Apr')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Nudge the 4' }).getAttribute('href')).toBe(
      '/time-off/insights/what-changed?point=no_break&nudge=no_break',
    );
  });

  it('shows sick leave only for a group the cohort minimum allows, and says what it left out', () => {
    const { unmount } = render(<Insights load={ready({ tab: 'time-off' })} />);
    expect(screen.getAllByText('Sick').length).toBeGreaterThan(0);
    expect(screen.getByText(/3 smaller teams are left out of the per-team figures/)).toBeTruthy();
    const teams = within(screen.getByRole('table', { name: 'Days taken by team' }));
    expect(teams.getAllByRole('row')).toHaveLength(3);
    unmount();
    render(
      <Insights
        load={ready({
          tab: 'time-off',
          scope: 'team',
          teams: [],
          months: adaInsights().months.map((m) => ({ ...m, sick: null })),
        })}
      />,
    );
    expect(screen.queryByText('Sick')).toBeNull();
    expect(screen.getByText('No team is large enough to describe on its own.')).toBeTruthy();
  });

  it('draws attendance and balances', async () => {
    const { container, unmount } = render(<Insights load={ready({ tab: 'attendance' })} />);
    expect(screen.getByRole('heading', { name: 'Missed clock-outs by month' })).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Overtime by team' })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
    unmount();
    render(<Insights load={ready({ tab: 'balances' })} />);
    const losing = within(screen.getByRole('list', { name: 'Who would lose days' }));
    expect(losing.getAllByRole('listitem').map((r) => r.textContent)).toEqual([
      expect.stringContaining('Omar Haddad'),
      expect.stringContaining('Adam Novak'),
      expect.stringContaining('Hana Kim'),
    ]);
  });

  it('loads in the page’s shape', async () => {
    const { container } = render(<Insights load={{ status: 'loading' }} />);
    expect(screen.getByRole('status').textContent).toBe('Loading the insights');
    expect(await axeViolations(container)).toEqual([]);
  });
});
