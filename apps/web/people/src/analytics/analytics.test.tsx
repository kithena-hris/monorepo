import { TooltipProvider } from '@reach/ui';
import { render as mount, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { fast } from '../test/user';
import { axeViolations } from '../test/axe';
import { Analytics, type AnalyticsState } from './analytics';

const render = (ui: ReactElement) => mount(ui, { wrapper: TooltipProvider });

const workforce: AnalyticsState = {
  asOf: 'As of 22 Sep 2026',
  source: 'snapshot',
  sourceNote: 'snapshot taken 04:00 today',
  headcount: {
    value: 912,
    change: 10,
    trend: [
      { label: 'Feb', value: 842 },
      { label: 'May', value: 880 },
      { label: 'Aug', value: 912 },
    ],
  },
  attrition: {
    percent: 11.4,
    leavers: 104,
    formula: 'leavers in the 12 months ÷ the average month-end headcount',
  },
  complete: { percent: 78.6, incomplete: 88 },
  expiringIn90Days: 7,
  movement: {
    period: 'Feb – Aug 2026',
    opening: 842,
    joiners: 128,
    moves: 0,
    leavers: 58,
    closing: 912,
  },
  completenessBySection: [
    { label: 'HR information', value: 99 },
    { label: 'Emergency contacts', value: 71 },
    { label: 'Compensation', value: 62 },
  ],
  expiries: {
    today: '2026-09-22',
    rows: [
      {
        label: 'Sana Khan',
        meta: 'Work permit · India',
        items: [{ id: 's', label: 'Work permit', start: '2026-10-10' }],
      },
      {
        label: 'Rui Dias',
        meta: 'Fixed-term contract',
        items: [{ id: 'r', label: 'Contract ends', start: '2026-10-26' }],
      },
    ],
  },
  funnel: [
    { label: 'Invited', value: 128 },
    { label: 'Enrolled', value: 121 },
    { label: 'Completed', value: 94 },
    { label: 'Record complete', value: 61 },
  ],
};

describe('Analytics', () => {
  it('answers each question with a chart and its numbers one tap away', async () => {
    const user = fast();
    const { container } = render(<Analytics load={{ status: 'ready', data: workforce }} />);
    expect(screen.getAllByText('912').length).toBeGreaterThan(0);
    expect(screen.getByText('11.4%')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);

    for (const title of [
      'Where the change came from',
      'Where our data is thin',
      'What expires next',
      'Where new joiners stall',
    ]) {
      const section = screen.getByRole('heading', { name: title }).closest('section');
      if (section === null) throw new Error(`no section for ${title}`);
      await user.click(within(section).getByRole('button', { name: 'Show the numbers' }));
      expect(within(section).getByRole('table', { name: `${title}: the numbers` })).toBeVisible();
    }
    expect(
      screen.getByRole('table', { name: 'Where the change came from: the numbers' }),
    ).toHaveTextContent('Closing912');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('draws nothing for a chart the viewer may not see: absent, not empty', () => {
    const { container } = render(
      <Analytics
        load={{
          status: 'ready',
          data: { ...workforce, attrition: null, completenessBySection: null, funnel: null },
        }}
      />,
    );
    for (const gone of ['Attrition', 'Where our data is thin', 'Where new joiners stall']) {
      expect(container.textContent).not.toContain(gone);
    }
  });

  it('says when a date was replayed from history rather than a snapshot', () => {
    render(<Analytics load={{ status: 'ready', data: { ...workforce, source: 'history' } }} />);
    expect(screen.getByText(/replayed from history/)).toBeInTheDocument();
  });

  it('has loading and error states', async () => {
    const { container, rerender } = render(<Analytics load={{ status: 'loading' }} />);
    expect(screen.getByText('Loading the analytics')).toBeInTheDocument();
    rerender(<Analytics load={{ status: 'error', message: 'Down' }} />);
    expect(screen.getByText('Down')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});
