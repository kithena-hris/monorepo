/**
 * The charts, one page each.
 *
 * They earn their own section rather than a shared page. There are eight of
 * them plus a legend and a data table, they are the part of the system a reader
 * is most likely to arrive looking for by name, and each answers a different
 * question about the same data, which is a decision the documentation should
 * help with rather than bury under one heading called "Charts".
 *
 * Every one is hand-drawn SVG in `packages/ui`. A charting library brings its
 * own colour system, tooltip and focus behaviour, and the design system would
 * then have two sources of truth for a colour and none for a focus ring.
 */

import {
  BarChart,
  ChartDataTable,
  ChartLegend,
  DonutChart,
  RangeChart,
  ScatterChart,
  Sparkline,
  TimelineChart,
  TrendChart,
  WaterfallChart,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import type { DocPage } from './doc-types';

/* --------------------------------------------------------------- fixtures -- */

const HEADCOUNT = [
  { label: 'Platform', value: 42 },
  { label: 'Payroll', value: 28 },
  { label: 'People Ops', value: 17 },
  { label: 'Finance', value: 11 },
];

const MONTHS = [
  { label: 'Apr', value: 18 },
  { label: 'May', value: 21 },
  { label: 'Jun', value: 34 },
  { label: 'Jul', value: 28 },
  { label: 'Aug', value: 37 },
  { label: 'Sep', value: 31 },
];

/* ------------------------------------------------------------------ pages -- */

const bar: DocPage = {
  slug: 'bar-chart',
  title: 'Bar chart',
  description: 'Comparing a value across categories.',
  when: 'Categories, not time. A bar chart of months invites the reader to compare adjacent bars when what they want is the shape of the trend.',
  importLine: "import { BarChart } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      blurb:
        'Bars grow from their baseline rather than fading in, which reads as being plotted rather than as appearing.',
      render: () => <BarChart label="Headcount by team" data={HEADCOUNT} className="w-full" />,
      code: `<BarChart
  label="Headcount by team"
  data={[
    { label: 'Platform', value: 42 },
    { label: 'Payroll', value: 28 },
  ]}
/>`,
    },
    {
      id: 'values',
      title: 'With values',
      blurb:
        'Print the figures when the reader needs the number rather than the comparison. A chart nobody can read a value off is a picture.',
      render: () => (
        <BarChart label="Headcount by team" data={HEADCOUNT} showValues className="w-full" />
      ),
      code: `<BarChart label="Headcount by team" data={teams} showValues />`,
    },
  ],
};

const donut: DocPage = {
  slug: 'donut-chart',
  title: 'Donut chart',
  description: 'Parts of one whole.',
  when: 'Only when the parts genuinely sum to something meaningful, and only for a handful of slices. Past about five, a bar chart is easier to read and honest about it.',
  importLine: "import { DonutChart } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      blurb:
        'The legend prints the value and the share as text beside each slice, because colour is never the only signal.',
      render: () => (
        <DonutChart
          label="Absence by kind"
          data={[
            { label: 'Annual', value: 62, tone: 'accent' },
            { label: 'Sick', value: 24, tone: 'warning' },
            { label: 'Parental', value: 14, tone: 'success' },
          ]}
        />
      ),
      code: `<DonutChart
  label="Absence by kind"
  data={[
    { label: 'Annual', value: 62, tone: 'accent' },
    { label: 'Sick', value: 24, tone: 'warning' },
    { label: 'Parental', value: 14, tone: 'success' },
  ]}
/>`,
    },
    {
      id: 'center',
      title: 'With a centre figure',
      blurb: 'The hole is the obvious place for the total, so the reader is not adding up slices.',
      render: () => (
        <DonutChart
          label="Absence by kind"
          data={[
            { label: 'Annual', value: 62, tone: 'accent' },
            { label: 'Sick', value: 24, tone: 'warning' },
            { label: 'Parental', value: 14, tone: 'success' },
          ]}
          center={
            <div className="text-center">
              <p className="text-xl font-semibold tabular-nums text-fg">100</p>
              <p className="text-xs text-fg-muted">days</p>
            </div>
          }
        />
      ),
      code: `<DonutChart label="Absence by kind" data={kinds} center={<Total value={100} />} />`,
    },
  ],
};

const trend: DocPage = {
  slug: 'trend-chart',
  title: 'Trend chart',
  description: 'A value over time, one line per series.',
  when: 'Time on the x-axis. The line draws itself from the left, which says "this is being plotted" rather than "this appeared".',
  importLine: "import { TrendChart } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Single series',
      render: () => (
        <TrendChart
          label="Open requests"
          series={[{ label: 'Open requests', data: MONTHS }]}
          className="w-full"
        />
      ),
      code: `<TrendChart label="Open requests" series={[{ label: 'Open requests', data: months }]} />`,
    },
    {
      id: 'multiple',
      title: 'Several series',
      blurb:
        'Each series takes a tone from the closed chart palette, and the legend can hide one so a reader can isolate a line without losing the scale.',
      render: () => (
        <TrendChart
          label="Requests by kind"
          area
          className="w-full"
          series={[
            { label: 'Annual', tone: 'accent', data: MONTHS },
            {
              label: 'Sick',
              tone: 'warning',
              data: MONTHS.map((point) => ({
                label: point.label,
                value: Math.round(point.value * 0.4),
              })),
            },
          ]}
        />
      ),
      code: `<TrendChart
  label="Requests by kind"
  area
  series={[
    { label: 'Annual', tone: 'accent', data: months },
    { label: 'Sick', tone: 'warning', data: sickMonths },
  ]}
/>`,
    },
  ],
};

const sparkline: DocPage = {
  slug: 'sparkline',
  title: 'Sparkline',
  description: 'A shape, at the size of a word.',
  when: 'Inside a table cell or beside a figure, where there is no room for axes and the reader wants direction rather than values.',
  importLine: "import { Sparkline } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      render: () => (
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <span className="text-lg font-semibold tabular-nums text-fg">37</span>
            <Sparkline label="Open requests, last six months" data={MONTHS} />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-lg font-semibold tabular-nums text-fg">12</span>
            <Sparkline
              label="Sick days, last six months"
              tone="warning"
              area
              data={MONTHS.map((point) => ({
                label: point.label,
                value: Math.round(point.value * 0.4),
              }))}
            />
          </div>
        </div>
      ),
      code: `<Sparkline label="Open requests, last six months" data={months} />
<Sparkline label="Sick days" tone="warning" area data={sickMonths} />`,
    },
  ],
};

const range: DocPage = {
  slug: 'range-chart',
  title: 'Range chart',
  description: 'Where a figure sits inside a band.',
  when: 'Pay bands, review distributions, anything where the question is not "how big" but "where in the range". A bar chart cannot answer that.',
  importLine: "import { RangeChart } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      blurb:
        'The marker is the individual and the band is the policy, so an offer below the minimum is visible as a position rather than as a number the reader has to compare by hand.',
      render: () => (
        <RangeChart
          label="Pay bands, Platform"
          valueLabel="Current salary"
          className="w-full"
          format={(value) => `€${value.toLocaleString('en-IE')}`}
          data={[
            { label: 'P3', min: 52000, max: 68000, value: 61000 },
            { label: 'P4', min: 64000, max: 84000, value: 71500 },
            { label: 'P5', min: 80000, max: 105000, value: 79000 },
          ]}
        />
      ),
      code: `<RangeChart
  label="Pay bands, Platform"
  valueLabel="Current salary"
  data={[
    { label: 'P3', min: 52000, max: 68000, value: 61000 },
    { label: 'P4', min: 64000, max: 84000, value: 71500 },
  ]}
/>`,
    },
  ],
};

const scatter: DocPage = {
  slug: 'scatter-chart',
  title: 'Scatter chart',
  description: 'Two measures against each other, one point per person.',
  when: 'When the question is whether two things move together. A reference line makes the comparison a judgement rather than an eyeball.',
  importLine: "import { ScatterChart } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      render: () => (
        <ScatterChart
          label="Tenure against salary"
          xLabel="Years of tenure"
          yLabel="Salary (€000)"
          className="w-full"
          data={[
            { label: 'Grace Hopper', x: 5.4, y: 92, meta: 'Platform' },
            { label: 'Ada Lovelace', x: 3.1, y: 74, meta: 'Platform' },
            { label: 'Radia Perlman', x: 7.8, y: 98, meta: 'Platform' },
            { label: 'Joan Clarke', x: 1.2, y: 58, meta: 'Payroll', tone: 'warning' },
            { label: 'Katherine Johnson', x: 9.6, y: 118, meta: 'Leadership', tone: 'success' },
          ]}
        />
      ),
      code: `<ScatterChart
  label="Tenure against salary"
  xLabel="Years of tenure"
  yLabel="Salary (€000)"
  data={people}
/>`,
    },
  ],
};

const waterfall: DocPage = {
  slug: 'waterfall-chart',
  title: 'Waterfall chart',
  description: 'How an opening balance became a closing one.',
  when: 'Headcount movement, a payroll reconciliation, a leave balance. The reader wants the steps, not the endpoints.',
  importLine: "import { WaterfallChart } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      blurb:
        'A step marked `total` is anchored to the baseline; the rest float from wherever the previous one left off, and take their tone from the sign.',
      render: () => (
        <WaterfallChart
          label="Headcount movement, H1"
          className="w-full"
          data={[
            { label: 'Opening', value: 1240, total: true },
            { label: 'Hires', value: 96 },
            { label: 'Transfers in', value: 14 },
            { label: 'Leavers', value: -58 },
            { label: 'Transfers out', value: -8 },
            { label: 'Closing', value: 1284, total: true },
          ]}
        />
      ),
      code: `<WaterfallChart
  label="Headcount movement, H1"
  data={[
    { label: 'Opening', value: 1240, total: true },
    { label: 'Hires', value: 96 },
    { label: 'Leavers', value: -58 },
    { label: 'Closing', value: 1284, total: true },
  ]}
/>`,
    },
  ],
};

const timelineChart: DocPage = {
  slug: 'timeline-chart',
  title: 'Timeline chart',
  description: 'Who is away, and when.',
  when: 'Absence planning, contract periods, anything where overlap is the thing the reader is looking for.',
  importLine: "import { TimelineChart } from '@reach/ui';",
  sections: [
    {
      id: 'default',
      title: 'Default',
      tall: true,
      render: () => (
        <TimelineChart
          label="Platform, August"
          unit="day"
          today="2026-08-12"
          className="w-full"
          rows={[
            {
              label: 'Grace Hopper',
              meta: 'Principal Engineer',
              items: [{ id: 'a', label: 'Annual leave', start: '2026-08-17', end: '2026-08-21' }],
            },
            {
              label: 'Ada Lovelace',
              meta: 'Staff Engineer',
              items: [
                {
                  id: 'b',
                  label: 'Sick',
                  start: '2026-08-10',
                  end: '2026-08-11',
                  tone: 'warning',
                },
              ],
            },
            {
              label: 'Radia Perlman',
              meta: 'Network Engineer',
              items: [
                {
                  id: 'c',
                  label: 'Parental leave',
                  start: '2026-08-03',
                  end: '2026-08-28',
                  tone: 'success',
                },
              ],
            },
          ]}
        />
      ),
      code: `<TimelineChart
  label="Platform, August"
  unit="day"
  today={today}
  rows={[
    {
      label: 'Grace Hopper',
      items: [{ id: 'a', label: 'Annual leave', start: '2026-08-17', end: '2026-08-21' }],
    },
  ]}
/>`,
    },
  ],
};

const legend: DocPage = {
  slug: 'chart-legend',
  title: 'Chart legend and data table',
  description: 'The two pieces every chart needs and nobody remembers.',
  when: 'A legend that can hide a series lets a reader isolate one line without losing the scale. The data table is visually hidden and is how a screen-reader user reads a chart at all.',
  importLine: "import { ChartDataTable, ChartLegend } from '@reach/ui';",
  sections: [
    {
      id: 'legend',
      title: 'Legend',
      blurb: 'Clicking an entry hides that series. The control is a real toggle, not a swatch.',
      render: function LegendDemo(): JSX.Element {
        const [hidden, setHidden] = useState<readonly string[]>([]);
        return (
          <div className="space-y-3">
            <ChartLegend
              items={[
                { label: 'Annual', tone: 'accent' },
                { label: 'Sick', tone: 'warning' },
                { label: 'Parental', tone: 'success' },
              ]}
              hidden={hidden}
              onHiddenChange={setHidden}
            />
            <p className="text-sm text-fg-muted">
              {hidden.length === 0 ? 'Nothing hidden.' : `Hidden: ${hidden.join(', ')}.`}
            </p>
          </div>
        );
      },
      code: `const [hidden, setHidden] = useState<readonly string[]>([]);

<ChartLegend items={series} hidden={hidden} onHiddenChange={setHidden} />`,
    },
    {
      id: 'data-table',
      title: 'Data table',
      blurb:
        'Rendered `sr-only`, so it costs a sighted reader nothing and is the only way the chart is readable to a screen reader. Every chart in this system ships one.',
      render: () => (
        <div className="w-full">
          <BarChart label="Headcount by team" data={HEADCOUNT} className="w-full" />
          <ChartDataTable caption="Headcount by team" data={HEADCOUNT} valueLabel="People" />
          <p className="mt-3 text-sm text-fg-muted">
            The table above this line is visually hidden. Read the page with a screen reader, or
            inspect the DOM, and it is there.
          </p>
        </div>
      ),
      code: `<BarChart label="Headcount by team" data={teams} />
<ChartDataTable caption="Headcount by team" data={teams} valueLabel="People" />`,
    },
  ],
};

export const CHART_PAGES: readonly DocPage[] = [
  bar,
  donut,
  trend,
  sparkline,
  range,
  scatter,
  waterfall,
  timelineChart,
  legend,
];

/** The sidebar group, so the section is defined next to its pages. */
export const CHART_SLUGS: readonly string[] = CHART_PAGES.map((page) => page.slug);
