'use client';

import type { JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Tooltip } from '../tooltip/tooltip';
import { ChartFrame } from './chart-window';
import type { ChartTone } from './chart';

/**
 * Two measures, one point per person.
 *
 * The pay-equity chart: compa-ratio against performance rating, one dot per
 * employee, coloured by whatever you are testing for. It is the shape that
 * makes an outlier obvious, and an outlier in a pay chart is a person, not a
 * data point, which is why every dot here carries a name.
 *
 * ### Reference lines are the point
 *
 * A compa-ratio scatter is unreadable without a line at 1.0, and a tenure plot
 * without one at the median. `referenceX` and `referenceY` draw them, labelled,
 * because "is this dot above or below the line" is the entire question.
 *
 * ### Colour groups. It does not measure
 *
 * `tone` on a point marks which group it belongs to and nothing more. Encoding
 * a *third* measure in colour makes a chart that takes a legend and a paragraph
 * to read, at which point the answer is two charts.
 *
 * ### Overlap is expected
 *
 * Points are semi-transparent so a cluster reads as a cluster rather than as
 * one dot. Thirty people on the same rating and the same ratio is a fact worth
 * seeing, not a rendering artefact to hide.
 */

export interface ScatterPoint {
  /** Who this is. Used in the tooltip and the data table. */
  label: string;
  x: number;
  y: number;
  tone?: ChartTone;
  /** A second line in the readout, a team, a grade. */
  meta?: string;
}

export interface ScatterChartProps {
  data: readonly ScatterPoint[];
  label: string;
  /** Axis names. Always shown: an unlabelled axis is a number with no unit. */
  xLabel: string;
  yLabel: string;
  height?: number;
  /** Fixed bounds. Defaults to the data's own range with a little padding. */
  xRange?: readonly [min: number, max: number];
  yRange?: readonly [min: number, max: number];
  /** A vertical line, the target ratio, the band midpoint. */
  referenceX?: { value: number; label: string };
  /** A horizontal line, the median, the budget. */
  referenceY?: { value: number; label: string };
  formatX?: (value: number) => string;
  formatY?: (value: number) => string;
  onSelect?: (point: ScatterPoint) => void;
  selectedLabel?: string;
  menuItems?: ReactNode;
  className?: string;
}

const dotTone: Record<ChartTone, string> = {
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  neutral: 'bg-fg-subtle',
};

/** A little breathing room, so points never sit on the frame. */
function padded(values: readonly number[]): [number, number] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.08 || 1;
  return [min - pad, max + pad];
}

export function ScatterChart({
  data,
  label,
  xLabel,
  yLabel,
  height = 280,
  xRange,
  yRange,
  referenceX,
  referenceY,
  formatX = (value) => String(value),
  formatY = (value) => String(value),
  onSelect,
  selectedLabel,
  menuItems,
  className,
}: ScatterChartProps): JSX.Element {
  const [xMin, xMax] = xRange ?? padded(data.map((point) => point.x));
  const [yMin, yMax] = yRange ?? padded(data.map((point) => point.y));
  const xSpan = Math.max(xMax - xMin, Number.EPSILON);
  const ySpan = Math.max(yMax - yMin, Number.EPSILON);

  const left = (value: number): string => `${String(((value - xMin) / xSpan) * 100)}%`;
  const top = (value: number): string => `${String(((yMax - value) / ySpan) * 100)}%`;

  return (
    <ChartFrame
      label={label}
      rows={data.map((point) => ({ label: point.label, value: point.y }))}
      {...(menuItems ? { menuItems } : {})}
      className={cn('w-full', className)}
    >
      <div className="flex gap-2">
        {/* The y axis: its name rotated once, and the two numbers that say what
            the scale is. An axis with a title and no figures is a direction
            without a distance. */}
        <div aria-hidden className="flex shrink-0 items-stretch gap-1">
          <div className="flex items-center justify-center text-2xs whitespace-nowrap text-fg-subtle">
            <span className="[writing-mode:vertical-rl] rotate-180">{yLabel}</span>
          </div>
          <div
            className="flex flex-col justify-between py-0.5 text-end text-2xs tabular-nums text-fg-subtle"
            style={{ height }}
          >
            <span>{formatY(yMax)}</span>
            <span>{formatY(yMin)}</span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div
            className="relative rounded-sm border border-border bg-surface-sunken/30"
            style={{ height }}
          >
            {referenceY === undefined ? null : (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 border-t border-dashed border-fg-subtle/60"
                style={{ top: top(referenceY.value) }}
              >
                <span className="absolute top-0.5 end-1 bg-surface/80 px-1 text-2xs text-fg-subtle">
                  {referenceY.label}
                </span>
              </div>
            )}
            {referenceX === undefined ? null : (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 border-s border-dashed border-fg-subtle/60"
                style={{ insetInlineStart: left(referenceX.value) }}
              >
                <span className="absolute top-1 start-1 text-2xs whitespace-nowrap text-fg-subtle">
                  {referenceX.label}
                </span>
              </div>
            )}

            {data.map((point, index) => {
              const selected = selectedLabel === point.label;
              const readout = `${point.label}: ${xLabel} ${formatX(point.x)}, ${yLabel} ${formatY(
                point.y,
              )}${point.meta === undefined ? '' : `, ${point.meta}`}`;

              return (
                <Tooltip key={`${point.label}-${String(index)}`} content={readout} side="top">
                  <div
                    role={onSelect ? 'button' : 'img'}
                    aria-label={readout}
                    tabIndex={0}
                    onClick={
                      onSelect
                        ? () => {
                            onSelect(point);
                          }
                        : undefined
                    }
                    className={cn(
                      // A 10px dot is a fine mouse target and an impossible
                      // finger one, so the hit area grows on a coarse pointer
                      // while the dot itself stays the size the data needs.
                      'absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full',
                      "touch:after:absolute touch:after:-inset-3 touch:after:content-['']",
                      'transition-[transform,opacity] duration-(--animate-duration-fast)',
                      'motion-safe:animate-pop-in',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
                      // Semi-transparent so a cluster reads as a cluster.
                      'opacity-70',
                      dotTone[point.tone ?? 'accent'],
                      onSelect && 'cursor-pointer hover:scale-150 hover:opacity-100',
                      selected && 'scale-150 opacity-100 ring-2 ring-border-focus',
                    )}
                    style={{
                      insetInlineStart: left(point.x),
                      top: top(point.y),
                      animationDelay: `min(calc(${String(index)} * 12ms), 300ms)`,
                    }}
                  />
                </Tooltip>
              );
            })}
          </div>

          <div aria-hidden className="mt-1 flex justify-between text-2xs text-fg-subtle">
            <span>{formatX(xMin)}</span>
            <span className="font-medium">{xLabel}</span>
            <span>{formatX(xMax)}</span>
          </div>
        </div>
      </div>

      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">{xLabel}</th>
            <th scope="col">{yLabel}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((point, index) => (
            <tr key={`${point.label}-${String(index)}`}>
              <th scope="row">{point.label}</th>
              <td>{formatX(point.x)}</td>
              <td>{formatY(point.y)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ChartFrame>
  );
}
