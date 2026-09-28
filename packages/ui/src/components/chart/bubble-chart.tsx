import type { JSX } from 'react';

import { cn } from '../../lib/cn';
import { ChartGrid, ChartMark, seriesTone, toneVar, type ChartTone } from './chart';
import { ChartFrame } from './chart-window';

export interface BubblePoint {
  /** Printed on the bubble, or beside it when the bubble is too small. */
  label: string;
  x: number;
  y: number;
  /** The third measure, drawn as the bubble's area. */
  size: number;
  tone?: ChartTone;
}

export interface BubbleChartProps {
  data: readonly BubblePoint[];
  label: string;
  xLabel: string;
  yLabel: string;
  sizeLabel: string;
  /** Axis extents. Default to the data with a little room either side. */
  xRange?: readonly [number, number];
  yRange?: readonly [number, number];
  formatX?: (value: number) => string;
  formatY?: (value: number) => string;
  formatSize?: (value: number) => string;
  /** Diameter of the largest bubble, in pixels. */
  maxDiameter?: number;
  height?: number;
  /** What the chart shows, in a sentence, read before the data table. */
  summary?: string;
  className?: string;
}

function padded(values: readonly number[]): [number, number] {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const room = (high - low) * 0.15 || 1;
  return [low - room, high + room];
}

/**
 * A scatter plot whose bubbles carry a third value in their size: teams by
 * tenure and engagement, sized by headcount.
 *
 * Size is **area**, not diameter. A bubble twice as wide is four times the
 * ink, and people read the ink; scaling the diameter would make a team of 40
 * look four times the size of a team of 20. So the diameter follows the
 * square root of the value.
 *
 * Bubbles are labelled directly rather than keyed by colour: a legend of
 * twelve hues is a matching game. Keep it to about a dozen.
 */
export function BubbleChart({
  data,
  label,
  xLabel,
  yLabel,
  sizeLabel,
  xRange,
  yRange,
  formatX = (value) => String(value),
  formatY = (value) => String(value),
  formatSize = (value) => String(value),
  maxDiameter = 64,
  height = 260,
  summary,
  className,
}: BubbleChartProps): JSX.Element {
  const [xMin, xMax] = xRange ?? padded(data.map((point) => point.x));
  const [yMin, yMax] = yRange ?? padded(data.map((point) => point.y));
  const largest = Math.max(...data.map((point) => point.size), 1);
  const diameter = (size: number): number =>
    Math.max(Math.sqrt(Math.max(size, 0) / largest) * maxDiameter, 10);

  return (
    <ChartFrame
      label={label}
      rows={data.map((point) => ({ label: point.label, value: point.size }))}
      {...(summary === undefined ? {} : { summary })}
      className={cn('w-full', className)}
    >
      <div className="flex gap-2">
        <div
          aria-hidden
          className="flex shrink-0 items-center text-[11px] font-medium whitespace-nowrap text-fg-subtle"
        >
          <span className="rotate-180 [writing-mode:vertical-rl]">{yLabel}</span>
        </div>

        <div className="relative min-w-0 flex-1" style={{ height }}>
          <ChartGrid />
          {/* Largest first, so a small bubble is never hidden behind a big one. */}
          {data
            .map((point, index) => ({ point, index }))
            .toSorted((a, b) => b.point.size - a.point.size)
            .map(({ point, index }, order) => {
              const size = diameter(point.size);
              const tone = toneVar[point.tone ?? seriesTone(index)];
              const inside = size >= 44;
              const readout = `${point.label}: ${xLabel} ${formatX(point.x)}, ${yLabel} ${formatY(point.y)}, ${sizeLabel} ${formatSize(point.size)}`;
              return (
                <ChartMark key={point.label} content={readout}>
                  <div
                    role="img"
                    tabIndex={0}
                    aria-label={readout}
                    className={cn(
                      'absolute flex -translate-x-1/2 translate-y-1/2 items-center justify-center rounded-full',
                      'motion-safe:animate-pop-in',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
                    )}
                    style={{
                      left: `${String(((point.x - xMin) / (xMax - xMin || 1)) * 100)}%`,
                      bottom: `${String(((point.y - yMin) / (yMax - yMin || 1)) * 100)}%`,
                      width: size,
                      height: size,
                      background: `color-mix(in oklab, ${tone} 40%, var(--color-surface))`,
                      boxShadow: `inset 0 0 0 1.5px ${tone}`,
                      animationDelay: `min(calc(${String(order)} * 40ms), 240ms)`,
                    }}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'text-[11px] leading-none font-semibold whitespace-nowrap text-fg',
                        !inside && 'absolute start-full ms-1.5 font-medium text-fg-muted',
                      )}
                    >
                      {point.label}
                    </span>
                  </div>
                </ChartMark>
              );
            })}
        </div>
      </div>

      <div
        aria-hidden
        className="mt-2 flex justify-between ps-6 text-[11px] font-medium text-fg-subtle"
      >
        <span>{formatX(xMin)}</span>
        <span>{xLabel}</span>
        <span>{formatX(xMax)}</span>
      </div>
      <p aria-hidden className="mt-2.5 text-sm text-fg-muted">
        Size is {sizeLabel.toLowerCase()}.
      </p>

      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">{xLabel}</th>
              <th scope="col">{yLabel}</th>
              <th scope="col">{sizeLabel}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((point) => (
              <tr key={point.label}>
                <th scope="row">{point.label}</th>
                <td>{formatX(point.x)}</td>
                <td>{formatY(point.y)}</td>
                <td>{formatSize(point.size)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartFrame>
  );
}
