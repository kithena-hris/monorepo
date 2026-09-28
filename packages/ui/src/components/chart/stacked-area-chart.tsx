'use client';

import type { JSX } from 'react';

import { cn } from '../../lib/cn';
import {
  ChartDataTable,
  ChartGrid,
  ChartLegend,
  ChartMark,
  fillTone,
  seriesTone,
  thinLabels,
  type StackedSeries,
} from './chart';
import { ChartFrame } from './chart-window';

export interface StackedAreaChartProps {
  /** The periods along the x axis, in order. */
  categories: readonly string[];
  /**
   * The layers, bottom first. Put the largest at the bottom: only the bottom
   * layer sits on a flat baseline, so it is the only one whose changes can be
   * read directly.
   */
  series: readonly StackedSeries[];
  label: string;
  height?: number;
  /** Every period fills the height, so the chart reads as shares of 100%. */
  normalise?: boolean;
  format?: (value: number) => string;
  /** What the chart shows, in a sentence, read before the data tables. */
  summary?: string;
  className?: string;
}

/**
 * How a total changes over time, and what it is made of.
 *
 * Five layers at most. Past that the upper layers are ribbons whose thickness
 * nobody can judge, and the chart has become a texture. With `normalise` it
 * answers "what share" and stops answering "how many", so the tooltip always
 * carries the count as well as the share.
 *
 * Drawn as one stretched SVG with the axis labels in HTML, the same trade the
 * trend chart makes: the plot fills any width without measuring anything, and
 * the text stays on the type scale.
 */
export function StackedAreaChart({
  categories,
  series,
  label,
  height = 200,
  normalise = false,
  format = (value) => String(Math.round(value)),
  summary,
  className,
}: StackedAreaChartProps): JSX.Element {
  const count = categories.length;
  const totals = categories.map((_, index) =>
    series.reduce((sum, entry) => sum + (entry.values[index] ?? 0), 0),
  );
  const share = (value: number, index: number): number =>
    normalise ? (value / (totals[index] || 1)) * 100 : value;

  // Running tops, layer by layer: layer k's top edge is layer k-1's top plus
  // its own value, which is also layer k+1's bottom edge.
  const tops: number[][] = [];
  series.forEach((entry, layer) => {
    tops.push(
      categories.map(
        (_, index) => share(entry.values[index] ?? 0, index) + (tops[layer - 1]?.[index] ?? 0),
      ),
    );
  });
  const max = normalise ? 100 : Math.max(...(tops.at(-1) ?? [0])) * 1.08 || 1;
  const x = (index: number): number => (count > 1 ? (index / (count - 1)) * 100 : 50);
  const y = (value: number): number => 100 - (value / max) * 100;

  const ticks = [max, (max * 2) / 3, max / 3, 0];

  return (
    <ChartFrame
      label={label}
      rows={categories.map((category, index) => ({ label: category, value: totals[index] ?? 0 }))}
      {...(summary === undefined ? {} : { summary })}
      className={cn('w-full', className)}
    >
      <div className="flex gap-2">
        <div
          aria-hidden
          className="flex w-8 shrink-0 flex-col justify-between text-end text-[11px] leading-none font-medium tabular-nums text-fg-subtle"
          style={{ height }}
        >
          {ticks.map((tick, index) => (
            <span key={index} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
              {normalise ? `${String(Math.round(tick))}%` : format(tick)}
            </span>
          ))}
        </div>

        <div className="relative min-w-0 flex-1" style={{ height }}>
          <ChartGrid />
          <svg
            aria-hidden
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            // The whole stack rises from the baseline together: layers growing
            // one at a time would briefly show a total that never existed.
            className="absolute inset-0 size-full origin-bottom motion-safe:animate-grow-y"
          >
            {series.map((entry, layer) => {
              const top = (tops[layer] ?? []).map(
                (value, index) => `${String(x(index))},${String(y(value))}`,
              );
              const bottom =
                layer === 0
                  ? [`100,100`, `0,100`]
                  : (tops[layer - 1] ?? [])
                      .map((value, index) => `${String(x(index))},${String(y(value))}`)
                      .toReversed();
              return (
                <polygon
                  key={entry.label}
                  points={[...top, ...bottom].join(' ')}
                  className={cn(fillTone[entry.tone ?? seriesTone(layer)], 'opacity-90')}
                />
              );
            })}
          </svg>

          {/* One hover column per period, the full plot height, so a reading
              does not depend on hitting a ribbon a few pixels thick. */}
          <div className="absolute inset-0 flex">
            {categories.map((category, index) => {
              const readout = `${category}: ${series
                .map((entry) => {
                  const value = entry.values[index] ?? 0;
                  return normalise
                    ? `${entry.label} ${format(value)} (${String(Math.round(share(value, index)))}%)`
                    : `${entry.label} ${format(value)}`;
                })
                .join(', ')}; total ${format(totals[index] ?? 0)}`;
              return (
                <ChartMark key={category} content={readout}>
                  <span
                    role="img"
                    tabIndex={0}
                    aria-label={readout}
                    className="h-full min-w-0 flex-1 hover:bg-fg/5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus"
                  />
                </ChartMark>
              );
            })}
          </div>
        </div>
      </div>

      <div
        aria-hidden
        className={cn(
          '@container mt-2 flex justify-between ps-10 text-[11px] font-medium text-fg-subtle',
          thinLabels(categories.length),
        )}
      >
        {categories.map((category) => (
          <span key={category}>{category}</span>
        ))}
      </div>

      <ChartLegend
        className="mt-3.5"
        items={series.map((entry, layer) => ({
          label: entry.label,
          tone: entry.tone ?? seriesTone(layer),
        }))}
      />

      {series.map((entry) => (
        <ChartDataTable
          key={entry.label}
          caption={`${label}, ${entry.label}`}
          valueLabel={entry.label}
          data={categories.map((category, index) => ({
            label: category,
            value: entry.values[index] ?? 0,
          }))}
          format={format}
        />
      ))}
    </ChartFrame>
  );
}
