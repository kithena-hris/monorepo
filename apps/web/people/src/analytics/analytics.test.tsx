import { TooltipProvider } from '@reach/ui';
import { render as mount, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

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
  it('draws the tab its route names, titled Insights, and no other tab’s questions', () => {
    const { rerender } = render(<Analytics load={{ status: 'ready', data: workforce }} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Insights' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Headcount by month' })).toBeInTheDocument();
    expect(screen.getByText('11.4% attrition')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Where our data is thin' })).toBeNull();

    rerender(<Analytics tab="data-quality" load={{ status: 'ready', data: workforce }} />);
    expect(screen.getByRole('heading', { name: 'Where our data is thin' })).toBeInTheDocument();
    expect(screen.getByText('Records complete')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Headcount by month' })).toBeNull();

    // A tab with nothing this viewer may see says so, rather than an empty page.
    rerender(<Analytics tab="pay" load={{ status: 'ready', data: workforce }} />);
    expect(screen.getByText('Nothing to show on this tab')).toBeInTheDocument();
  });

  it('counts who starts soon beside the headcount, only where People sent the figure', () => {
    const { rerender } = render(
      <Analytics load={{ status: 'ready', data: { ...workforce, startingSoon: 4 } }} />,
    );
    expect(screen.getByText('Starting soon').parentElement?.parentElement).toHaveTextContent(
      'Starting soon4',
    );
    expect(screen.getByText('Hired, not started yet')).toBeInTheDocument();
    // Never "Open roles": People does not count them, recruiting would.
    expect(screen.queryByText('Open roles')).toBeNull();

    rerender(<Analytics load={{ status: 'ready', data: { ...workforce, startingSoon: null } }} />);
    expect(screen.queryByText('Starting soon')).toBeNull();
  });

  it('exports the tab on screen, for the segment on screen, as a file', () => {
    const { rerender } = render(
      <Analytics tab="turnover" load={{ status: 'ready', data: workforce }} />,
    );
    const link = screen.getByRole('link', { name: 'Export' });
    expect(link).toHaveAttribute('href', '/people/downloads/insights?tab=turnover');
    expect(link).toHaveAttribute('download');

    rerender(
      <Analytics
        tab="headcount"
        segmentId="seg-1"
        load={{
          status: 'ready',
          data: { ...workforce, segment: { id: 'seg-1', name: 'Engineering' } },
        }}
      />,
    );
    expect(screen.getByRole('link', { name: 'Export' })).toHaveAttribute(
      'href',
      '/people/downloads/insights?tab=headcount&segment=seg-1',
    );
  });

  it('answers each question with a chart and its numbers one tap away', async () => {
    const user = fast();
    const { container, rerender } = render(
      <Analytics load={{ status: 'ready', data: workforce }} />,
    );
    expect(screen.getAllByText('912').length).toBeGreaterThan(0);
    expect(await axeViolations(container)).toEqual([]);

    const section = screen
      .getByRole('heading', { name: 'Where the change came from' })
      .closest('section');
    if (section === null) throw new Error('no movement section');
    await user.click(within(section).getByRole('button', { name: 'Show the numbers' }));
    expect(
      screen.getByRole('table', { name: 'Where the change came from: the numbers' }),
    ).toHaveTextContent('Closing912');

    rerender(<Analytics tab="data-quality" load={{ status: 'ready', data: workforce }} />);
    for (const title of [
      'Where our data is thin',
      'What expires next',
      'Where new joiners stall',
    ]) {
      const section = screen.getByRole('heading', { name: title }).closest('section');
      if (section === null) throw new Error(`no section for ${title}`);
      await user.click(within(section).getByRole('button', { name: 'Show the numbers' }));
      expect(within(section).getByRole('table', { name: `${title}: the numbers` })).toBeVisible();
    }
    expect(await axeViolations(container)).toEqual([]);
  });

  it('draws nothing for a chart the viewer may not see: absent, not empty', () => {
    const { container } = render(
      <Analytics
        load={{
          status: 'ready',
          data: { ...workforce, attrition: null, completenessBySection: null, funnel: null },
        }}
        tab="data-quality"
      />,
    );
    for (const gone of ['Attrition', 'Where our data is thin', 'Where new joiners stall']) {
      expect(container.textContent).not.toContain(gone);
    }
  });

  it('draws what expires as one lane per person, with the dates in its table (PEO-122)', async () => {
    const user = fast();
    const { container } = render(
      <Analytics tab="data-quality" load={{ status: 'ready', data: workforce }} />,
    );
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
    const bars = within(section).getAllByRole('img', {
      name: /Work permit|Contract ends|Certification/,
    });
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
        tab="data-quality"
        load={{
          status: 'ready',
          data: { ...workforce, expiries: { today: '2026-09-22', items: [] } },
        }}
      />,
    );
    expect(screen.getByText('Nothing expires in the next 90 days.')).toBeInTheDocument();
    rerender(
      <Analytics
        tab="data-quality"
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

  const remaining: AnalyticsState = {
    ...workforce,
    attrition: {
      ...(workforce.attrition as NonNullable<AnalyticsState['attrition']>),
      trend: [
        { label: '2026-07', value: 10.2 },
        { label: '2026-08', value: 11.4 },
      ],
    },
    tenure: [
      { label: 'Under 6 months', headcount: 120, leavers: 4 },
      { label: '6 to 12 months', headcount: 90, leavers: 19 },
    ],
    span: [
      { label: '1 report', value: 12 },
      { label: '6 reports', value: 30 },
    ],
    joiners: {
      months: ['2026-07', '2026-08'],
      departments: ['Engineering', 'Sales'],
      cells: [
        { row: 'Engineering', column: '2026-07', value: 4 },
        { row: 'Sales', column: '2026-08', value: 2 },
      ],
    },
    composition: {
      categories: ['Engineering', 'Sales'],
      series: [
        { label: 'Permanent', values: [300, 120] },
        { label: 'Contractor', values: [40, 5] },
      ],
    },
    selfId: [
      {
        key: 'ethnicity',
        label: 'Ethnicity',
        status: 'ok',
        minimum: null,
        publishedAsOf: '2026-09-01',
        total: 910,
        note: 'Counts are rounded to the nearest 5.',
        cells: [
          { label: 'A', value: 455 },
          { label: 'Prefer not to say', value: 455 },
        ],
      },
      {
        key: 'disability',
        label: 'Disability',
        status: 'insufficient_data',
        minimum: 10,
        publishedAsOf: '2026-09-01',
        total: null,
        note: 'Counts are rounded to the nearest 5.',
        cells: [],
      },
    ],
  };

  it('draws attrition, composition, tenure, span and joiners, each with its numbers (PEO-067)', async () => {
    const user = fast();
    const { container, rerender } = render(
      <Analytics tab="turnover" load={{ status: 'ready', data: remaining }} />,
    );
    const open = async (title: string) => {
      const section = screen.getByRole('heading', { name: title }).closest('section');
      if (section === null) throw new Error(`no section for ${title}`);
      await user.click(within(section).getByRole('button', { name: 'Show the numbers' }));
      expect(within(section).getByRole('table', { name: `${title}: the numbers` })).toBeVisible();
    };
    for (const title of [
      'Are people leaving faster',
      'Who is at risk of leaving',
      'Is the org shaped sensibly',
    ]) {
      await open(title);
    }
    expect(
      screen.getByRole('table', { name: 'Who is at risk of leaving: the numbers' }),
    ).toHaveTextContent('6 to 12 months: left19');
    expect(await axeViolations(container)).toEqual([]);

    rerender(<Analytics tab="headcount" load={{ status: 'ready', data: remaining }} />);
    for (const title of ['What we are made of', 'When people join']) await open(title);
    // Joined in 12 months: the joiners' heatmap, summed.
    expect(screen.getByText('Joined, 12M').parentElement?.parentElement).toHaveTextContent(
      'Joined, 12M6',
    );
  });

  it('shows a withheld self-ID question as insufficient data, with no number to read (PEO-070)', async () => {
    const { container } = render(
      <Analytics tab="pay" load={{ status: 'ready', data: remaining }} />,
    );
    const withheld = screen.getByRole('heading', { name: 'Disability' }).closest('section');
    if (withheld === null) throw new Error('no section for Disability');
    expect(within(withheld).getByText('Insufficient data')).toBeInTheDocument();
    expect(within(withheld).queryByRole('button', { name: 'Show the numbers' })).toBeNull();
    // The minimum and the publication date are the only numbers in it.
    expect(withheld.textContent.replace('2026-09-01', '').replace('Fewer than 10', '')).not.toMatch(
      /\d/,
    );
    // A served one says its total was rounded on its own.
    const served = screen.getByRole('heading', { name: 'Ethnicity' }).closest('section');
    expect(served?.textContent).toContain('rounded to the nearest 5');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('applies a segment through the shell and says what it leaves out (PEO-068)', async () => {
    const user = fast();
    const onSegmentChange = vi.fn();
    const { rerender } = render(
      <Analytics
        load={{
          status: 'ready',
          data: { ...remaining, segments: [{ id: 'seg-1', name: 'Engineering' }] },
        }}
        onSegmentChange={onSegmentChange}
        tab="turnover"
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Segment' }));
    await user.click(await screen.findByRole('option', { name: 'Segment: Engineering' }));
    expect(onSegmentChange).toHaveBeenCalledWith('seg-1');

    rerender(
      <Analytics
        load={{
          status: 'ready',
          data: {
            ...remaining,
            span: null,
            selfId: null,
            expiries: null,
            segment: { id: 'seg-1', name: 'Engineering' },
            segments: [{ id: 'seg-1', name: 'Engineering' }],
          },
        }}
        segmentId="seg-1"
        onSegmentChange={onSegmentChange}
        tab="turnover"
      />,
    );
    expect(screen.getByText(/Showing the people you may see in Engineering/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Is the org shaped sensibly' })).toBeNull();
  });

  const band = { minimumMinor: '4000000', midpointMinor: '5000000', maximumMinor: '6000000' };
  const withheld = {
    status: 'insufficient_data' as const,
    people: null,
    p25: null,
    median: null,
    p75: null,
    band: null,
  };
  const pay: NonNullable<AnalyticsState['pay']> = {
    asOf: '2026-09-01',
    minimum: 10,
    grade: [
      {
        label: 'Level 3',
        currency: 'EUR',
        status: 'ok',
        people: 12,
        p25: '4775000',
        median: '5050000',
        p75: '5325000',
        band,
      },
      { label: 'Level 4', currency: 'EUR', ...withheld },
      {
        label: 'Level 3',
        currency: 'GBP',
        status: 'ok',
        people: 10,
        p25: '3112500',
        median: '3225000',
        p75: '3337500',
        band: null,
      },
    ],
    tenure: [
      { ...workforceTenure('Under 6 months', '3000000'), currency: 'EUR' },
      { ...workforceTenure('2 to 5 years', '5000000'), currency: 'EUR' },
      { label: '5 years or more', currency: 'EUR', ...withheld },
    ],
    compa: [
      {
        label: 'Level 3',
        currency: 'EUR',
        status: 'ok',
        people: 12,
        p25: '0.9550',
        median: '1.0100',
        p75: '1.0650',
        band,
      },
    ],
  };
  function workforceTenure(label: string, median: string) {
    return {
      label,
      status: 'ok' as const,
      people: 20,
      p25: String(Number(median) - 100000),
      median,
      p75: String(Number(median) + 100000),
      band: null,
    };
  }

  it('draws pay per currency, median inside the band, and a small group as words only (PEO-078)', async () => {
    const user = fast();
    const { container } = render(
      <Analytics tab="pay" load={{ status: 'ready', data: { ...remaining, pay } }} />,
    );
    for (const title of [
      'How pay sits in each band, EUR',
      'How pay sits in each band, GBP',
      'Pay against tenure, EUR',
      'Compa-ratio by grade, EUR',
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    const eur = screen
      .getByRole('heading', { name: 'How pay sits in each band, EUR' })
      .closest('section');
    if (eur === null) throw new Error('no EUR section');
    await user.click(within(eur).getByRole('button', { name: 'Show the numbers' }));
    const table = within(eur).getByRole('table', {
      name: 'How pay sits in each band, EUR: the numbers',
    });
    expect(table).toHaveTextContent('Level 4: 25th / median / 75thInsufficient data');
    expect(eur.textContent).toContain('Insufficient data, fewer than 10 people: Level 4');
    // GBP has no band: said in words, not drawn against a made-up range.
    const gbp = screen
      .getByRole('heading', { name: 'How pay sits in each band, GBP' })
      .closest('section');
    expect(gbp?.textContent).toContain('No band set: Level 3');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('draws no pay section for anybody People sent none (PEO-078)', () => {
    render(<Analytics tab="pay" load={{ status: 'ready', data: { ...remaining, pay: null } }} />);
    expect(screen.queryByRole('heading', { name: /How pay sits/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: /Compa-ratio/ })).toBeNull();
  });

  it('opens the Scheduled reports page from its Schedules button', async () => {
    const schedule = {
      id: 's1',
      name: 'Monthly headcount',
      ownerName: 'Ada Lovelace',
      paused: false,
      segmentId: null,
      segmentName: null,
      filter: [],
      kind: 'summary' as const,
      format: null,
      fields: null,
      reason: null,
      every: 'month' as const,
      weekday: null,
      day: 1,
      hour: 8,
      legalEntityId: null,
      recipients: [
        { accountId: 'a', name: 'Nora Becker' },
        { accountId: 'b', name: 'Sofia Lindqvist' },
        { accountId: 'c', name: 'Tom Fischer' },
      ],
      lastRun: null,
    };
    const schedules = {
      canManage: true,
      schedules: [schedule, { ...schedule, id: 's2', name: 'Expiring permits', paused: true }],
      segments: [],
      people: [],
      legalEntities: [],
      fields: [],
    };
    const { container, rerender } = render(
      <Analytics load={{ status: 'ready', data: { ...workforce, schedules } }} />,
    );
    // One list of schedules, on its own page: no popover repeats it here.
    expect(screen.getByRole('link', { name: 'Schedules' })).toHaveAttribute(
      'href',
      '/people/reports',
    );
    expect(screen.queryByRole('list', { name: 'Scheduled reports' })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);

    // For a viewer People refuses them, there is no button.
    rerender(<Analytics load={{ status: 'ready', data: { ...workforce, schedules: null } }} />);
    expect(screen.queryByRole('link', { name: 'Schedules' })).toBeNull();
  });

  it('has loading and error states', async () => {
    const { container, rerender } = render(<Analytics load={{ status: 'loading' }} />);
    expect(screen.getByText('Loading the analytics')).toBeInTheDocument();
    rerender(<Analytics load={{ status: 'error', message: 'Down' }} />);
    expect(screen.getByText('Down')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('Analytics, the cohort minimum (V7)', () => {
  it('says which groups are hidden, from the minimum People applied', () => {
    const { rerender } = render(
      <Analytics load={{ status: 'ready', data: { ...workforce, minimum: 25 } }} />,
    );
    expect(screen.getByText(/Groups under 25 people are hidden\.$/)).toBeInTheDocument();
    // Not said, not guessed.
    rerender(<Analytics load={{ status: 'ready', data: workforce }} />);
    expect(screen.queryByText(/Groups under/)).toBeNull();
  });
});
