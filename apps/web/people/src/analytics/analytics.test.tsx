import { TooltipProvider } from '@reach/ui';
import { render as mount, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { fast } from '../test/user';
import { axeViolations } from '../test/axe';
import { Analytics, expiryRows, type AnalyticsState } from './analytics';

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
    items: [
      { kind: 'work_permit', personId: 's', name: 'Sana Khan', day: '2026-10-10' },
      { kind: 'fixed_term', personId: 'r', name: 'Rui Dias', day: '2026-10-26' },
      { kind: 'certification', personId: 's', name: 'Sana Khan', day: '2026-11-02' },
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

  it('draws what expires as one lane per person, with the dates in its table (PEO-122)', async () => {
    const user = fast();
    const { container } = render(<Analytics load={{ status: 'ready', data: workforce }} />);
    const section = screen.getByRole('heading', { name: 'What expires next' }).closest('section');
    if (section === null) throw new Error('no expiry section');
    // Sana's permit and certification share her lane; Rui has his own.
    expect(within(section).getAllByText('Sana Khan').length).toBeGreaterThan(0);
    expect(within(section).getAllByText('Rui Dias').length).toBeGreaterThan(0);
    await user.click(within(section).getByRole('button', { name: 'Show the numbers' }));
    const table = within(section).getByRole('table', { name: 'What expires next: the numbers' });
    expect(table).toHaveTextContent('Sana Khan: Work permit2026-10-10');
    expect(table).toHaveTextContent('Sana Khan: Certification2026-11-02');
    expect(table).toHaveTextContent('Rui Dias: Contract ends2026-10-26');
    // Every bar is reachable from the keyboard.
    const bars = within(section).getAllByRole('img', { name: /Work permit|Contract ends|Certification/ });
    expect(bars.length).toBe(3);
    bars[0]?.focus();
    expect(bars[0]).toHaveFocus();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('keeps two people of one name in two lanes', () => {
    expect(
      expiryRows([
        { kind: 'probation', personId: 'a', name: 'Ana García', day: '2026-10-01' },
        { kind: 'probation', personId: 'b', name: 'Ana García', day: '2026-10-02' },
        { kind: 'fixed_term', personId: 'a', name: 'Ana García', day: '2026-10-03' },
      ]).map((r) => [r.label, r.items.length]),
    ).toEqual([
      ['Ana García', 2],
      ['Ana García (2)', 1],
    ]);
  });

  it('says when nothing expires, and draws nothing for a viewer who may see no expiry', () => {
    const { rerender } = render(
      <Analytics
        load={{ status: 'ready', data: { ...workforce, expiries: { today: '2026-09-22', items: [] } } }}
      />,
    );
    expect(screen.getByText('Nothing expires in the next 90 days.')).toBeInTheDocument();
    rerender(
      <Analytics
        load={{ status: 'ready', data: { ...workforce, expiries: null, expiringIn90Days: null } }}
      />,
    );
    expect(screen.queryByRole('heading', { name: 'What expires next' })).toBeNull();
    expect(screen.queryByText('Expiring in 90 days')).toBeNull();
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
