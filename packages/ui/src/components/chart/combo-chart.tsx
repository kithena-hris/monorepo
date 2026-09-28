'use client';

import type { JSX } from 'react';

import { cn } from '../../lib/cn';
import {
  ChartDataTable,
  ChartGrid,
  ChartLegend,
  ChartMark,
  bgTone,
  thinLabels,
  strokeTone,
  type ChartTone,
} from './chart';
import { ChartFrame } from './chart-window';

export interface ComboPoint {
  /** The period: "Mar", "Q2". */
  label: string;
  /** The measure drawn as a bar, read off the left axis. */
  bar: number;
  /** The measure drawn as a line, read off the right axis. */
  line: number;
}

export interface ComboChartProps {
  data: readonly ComboPoint[];
  /** Names the chart for assistive technology and the copy menu. */
  label: string;
  /** What the bars measure, with its unit: "Hires". */
  barLabel: string;
  /** What the line measures, with its unit: "Attrition %". */
  lineLabel: string;
  formatBar?: (value: number) => string;
  formatLine?: (value: number) => string;
  barTone?: ChartTone;
  lineTone?: ChartTone;
  height?: number;
  /** What the chart shows, in a sentence, read before the data tables. */
  summary?: string;
  className?: string;
}

const TICKS = [1, 2 / 3, 1 / 3, 0];

/**
 * Bars and a line over one time axis, for two measures in different units:
 * hires (a count) against attrition (a rate), spend (money) against budget.
 *
 * ### Two axes, both labelled
 *
 * A second y axis is the one device in charting most often used to mislead,
 * because the two scales can be stretched until any two lines cross. So both
 * axes are printed, the legend says which series reads off which, and each
 * starts at zero. The line is drawn over the bars with a halo in the card
 * colour, so it stays one unbroken stroke where it crosses them, and its
 * points sit over the middle of each bar, where the period is.
 */
export function ComboChart({
  data,
  label,
  barLabel,
  lineLabel,
  formatBar = (value) => String(Math.round(value)),
  formatLine = (value) => String(Math.round(value * 10) / 10),
  barTone = 'chart-1',
  lineTone = 'chart-4',
  height = 200,
  summary,
  className,
}: ComboChartProps): JSX.Element {
  const count = data.length;
  const barMax = Math.max(...data.map((point) => point.bar), 0) * 1.1 || 1;
  const lineMax = Math.max(...data.map((point) => point.line), 0) * 1.2 || 1;
  // Each point sits over the middle of its bar, not at the column's edge.
  const x = (index: number): number => ((index + 0.5) / Math.max(count, 1)) * 100;
  const y = (value: number): number => 100 - (value / lineMax) * 100;
  const points = data.map((point, index) => `${String(x(index))},${String(y(point.line))}`);

  return (
    <ChartFrame
      label={label}
      rows={data.map((point) => ({ label: point.label, value: point.bar }))}
      {...(summary === undefined ? {} : { summary })}
      className={cn('w-full', className)}
    >
      <div className="flex gap-2">
        <Axis values={TICKS.map((tick) => formatBar(barMax * tick))} height={height} />

        <div className="relative min-w-0 flex-1" style={{ height }}>
          <ChartGrid />

          <div className="absolute inset-0 flex items-stretch gap-2 touch:gap-1.5">
            {data.map((point, index) => (
              <ChartMark
                key={point.label}
                content={`${point.label}: ${barLabel} ${formatBar(point.bar)}, ${lineLabel} ${formatLine(point.line)}`}
              >
                <span
                  role="img"
                  tabIndex={0}
                  aria-label={`${point.label}: ${barLabel} ${formatBar(point.bar)}, ${lineLabel} ${formatLine(point.line)}`}
                  className="flex h-full min-w-0 flex-1 items-end rounded-t-[7px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                >
                  <span
                    className={cn(
                      'mx-auto block w-full max-w-8 origin-bottom rounded-t-[7px] rounded-b-[3px] motion-safe:animate-grow-y',
                      bgTone[barTone],
                    )}
                    style={{
                      height: `max(${String((point.bar / barMax) * 100)}%, 2px)`,
                      animationDelay: `min(calc(${String(index)} * 40ms), 320ms)`,
                    }}
                  />
                </span>
              </ChartMark>
            ))}
          </div>

          <svg
            aria-hidden
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 size-full overflow-visible"
          >
            {/* A halo in the card's colour under the line, so it stays one
                unbroken stroke where it crosses a bar. */}
            <polyline
              points={points.join(' ')}
              fill="none"
              strokeWidth={6}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              className="stroke-surface motion-safe:animate-draw-line"
            />
            <polyline
              points={points.join(' ')}
              fill="none"
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              className={cn(strokeTone[lineTone], 'motion-safe:animate-draw-line')}
            />
          </svg>
        </div>

        <Axis values={TICKS.map((tick) => formatLine(lineMax * tick))} height={height} end />
      </div>

      <div
        aria-hidden
        className={cn('@container mt-2 flex gap-2 px-8 touch:gap-1.5', thinLabels(data.length))}
      >
        {data.map((point) => (
          <span
            key={point.label}
            className="min-w-0 flex-1 truncate text-center text-[11px] font-medium text-fg-subtle"
          >
            {point.label}
          </span>
        ))}
      </div>

      <ChartLegend
        className="mt-3.5"
        items={[
          { label: `${barLabel} (left)`, tone: barTone },
          { label: `${lineLabel} (right)`, tone: lineTone },
        ]}
      />

      <ChartDataTable
        caption={`${label}, ${barLabel}`}
        valueLabel={barLabel}
        data={data.map((point) => ({ label: point.label, value: point.bar }))}
        format={formatBar}
      />
      <ChartDataTable
        caption={`${label}, ${lineLabel}`}
        valueLabel={lineLabel}
        data={data.map((point) => ({ label: point.label, value: point.line }))}
        format={formatLine}
      />
    </ChartFrame>
  );
}

function Axis({
  values,
  height,
  end = false,
}: {
  values: readonly string[];
  height: number;
  end?: boolean;
}): JSX.Element {
  return (
    <div
      aria-hidden
      className={cn(
        'flex w-6 shrink-0 flex-col justify-between text-[11px] leading-none font-medium tabular-nums text-fg-subtle',
        end ? 'text-start' : 'text-end',
      )}
      style={{ height }}
    >
      {values.map((value, index) => (
        // Keyed by position: two ticks can format to the same text.
        <span key={index} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
          {value}
        </span>
      ))}
    </div>
  );
}
