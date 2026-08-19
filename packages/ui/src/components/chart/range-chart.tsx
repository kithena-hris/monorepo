'use client';

import type { JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Tooltip } from '../tooltip/tooltip';
import { ChartFrame } from './chart-window';
import type { ChartTone } from './chart';

/**
 * A salary band, and where people actually sit in it.
 *
 * One row per grade: the band from minimum to maximum, a marker at the
 * midpoint, and a marker for the actual figure being compared against it. This
 * is the chart a pay review runs on, and the one a works council asks for.
 *
 * ### A band is a range, not a bar
 *
 * A bar from zero to the maximum says the bottom of the scale is zero, which
 * for a salary band is both false and alarming. The bar starts at the minimum,
 * because that is what a band *is*.
 *
 * ### The comparison is a line, not a second bar
 *
 * The actual figure is a marker inside the band, so "below midpoint" is a
 * position rather than an arithmetic exercise. Two bars side by side make the
 * reader do the subtraction, and they do it wrong.
 *
 * ### Out of band is stated, not implied
 *
 * A value below the minimum or above the maximum is pinned to the edge, drawn
 * in the danger tone, and *says so in words*. Silently clamping it is how a
 * chart hides the exact case somebody opened it to find.
 */

export interface RangeBand {
  label: string;
  min: number;
  max: number;
  /** The reference point in the band. Defaults to the midpoint. */
  mid?: number;
  /** The figure being compared: a salary, an average, an offer. */
  value?: number;
  /** A second line under the label, a headcount, a grade code. */
  meta?: string;
  tone?: ChartTone;
}

export interface RangeChartProps {
  data: readonly RangeBand[];
  label: string;
  /** What the numbers are: "Base salary, EUR". */
  valueLabel: string;
  format?: (value: number) => string;
  /** Row height in pixels. */
  rowHeight?: number;
  /** Upper bound for the label column. It shrinks with the chart. */
  labelWidth?: number;
  onSelect?: (band: RangeBand) => void;
  selectedLabel?: string;
  menuItems?: ReactNode;
  className?: string;
}

/** A position on the shared scale, as a CSS length. */
function percent(value: number): string {
  return `${String(value)}%`;
}

const bandTone: Record<ChartTone, string> = {
  accent: 'bg-accent/25',
  success: 'bg-success/25',
  warning: 'bg-warning/25',
  danger: 'bg-danger/25',
  info: 'bg-info/25',
  neutral: 'bg-fg-subtle/25',
};

const edgeTone: Record<ChartTone, string> = {
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  neutral: 'bg-fg-subtle',
};

export function RangeChart({
  data,
  label,
  valueLabel,
  format = (value) => String(value),
  rowHeight = 34,
  labelWidth = 140,
  onSelect,
  selectedLabel,
  menuItems,
  className,
}: RangeChartProps): JSX.Element {
  // One scale for every row, so two bands can be compared by eye. Per-row
  // scales would make a narrow band look as wide as a broad one.
  const floor = Math.min(...data.flatMap((band) => [band.min, band.value ?? band.min]));
  const ceiling = Math.max(...data.flatMap((band) => [band.max, band.value ?? band.max]));
  const span = Math.max(ceiling - floor, 1);
  const at = (value: number): number =>
    ((Math.min(Math.max(value, floor), ceiling) - floor) / span) * 100;

  return (
    <ChartFrame
      label={label}
      rows={data.map((band) => ({ label: band.label, value: band.value ?? band.mid ?? band.min }))}
      {...(menuItems ? { menuItems } : {})}
      className={cn('w-full', className)}
    >
      <div className="flex min-w-0">
        <div
          aria-hidden
          className="shrink-0" // `clamp` rather than a breakpoint: the label column gives up its width
          // gradually as the chart narrows, down to a floor that still fits a
          // name. A fixed 148px is 38% of a phone screen spent on labels.
          style={{ width: `clamp(5.5rem, 30%, ${String(labelWidth)}px)` }}
        >
          {data.map((band) => (
            <div
              key={band.label}
              className="flex flex-col justify-center pe-3"
              style={{ height: rowHeight }}
            >
              <span className="truncate text-sm text-fg">{band.label}</span>
              {band.meta === undefined ? null : (
                <span className="truncate text-2xs text-fg-subtle">{band.meta}</span>
              )}
            </div>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          {data.map((band, index) => {
            const mid = band.mid ?? (band.min + band.max) / 2;
            const tone = band.tone ?? 'accent';
            const selected = selectedLabel === band.label;
            const below = band.value !== undefined && band.value < band.min;
            const above = band.value !== undefined && band.value > band.max;
            const outside = below || above;

            const position =
              band.value === undefined
                ? ''
                : outside
                  ? below
                    ? ', below the minimum'
                    : ', above the maximum'
                  : `, ${String(Math.round(((band.value - band.min) / Math.max(band.max - band.min, 1)) * 100))}% through the band`;

            const readout = `${band.label}: ${format(band.min)} to ${format(band.max)}, midpoint ${format(mid)}${
              band.value === undefined ? '' : `. ${valueLabel} ${format(band.value)}${position}`
            }`;

            return (
              <div key={band.label} className="relative" style={{ height: rowHeight }}>
                <Tooltip content={readout} side="top">
                  <div
                    role={onSelect ? 'button' : 'img'}
                    aria-label={readout}
                    tabIndex={0}
                    onClick={
                      onSelect
                        ? () => {
                            onSelect(band);
                          }
                        : undefined
                    }
                    className={cn(
                      'absolute inset-y-2 rounded-sm',
                      'origin-left transition-[opacity,box-shadow] duration-(--animate-duration-fast)',
                      'motion-safe:animate-grow-x',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
                      bandTone[tone],
                      onSelect && 'cursor-pointer hover:brightness-105',
                      selected && 'ring-2 ring-border-focus',
                      selectedLabel !== undefined && !selected && 'opacity-50',
                    )}
                    style={{
                      insetInlineStart: percent(at(band.min)),
                      width: percent(at(band.max) - at(band.min)),
                      animationDelay: `min(calc(${String(index)} * 40ms), 240ms)`,
                    }}
                  >
                    {/* The midpoint. A band without one is a range; with one it
                        is a policy. */}
                    <span
                      aria-hidden
                      className="absolute inset-y-0 w-px bg-fg-subtle/60"
                      style={{
                        insetInlineStart: percent(
                          ((mid - band.min) / Math.max(band.max - band.min, 1)) * 100,
                        ),
                      }}
                    />
                  </div>
                </Tooltip>

                {band.value === undefined ? null : (
                  <span
                    aria-hidden
                    className={cn(
                      'absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-xs',
                      'motion-safe:animate-pop-in',
                      // Out of band is a different colour *and* a different
                      // sentence in the readout above.
                      outside ? 'bg-danger ring-2 ring-surface' : edgeTone[tone],
                    )}
                    style={{ insetInlineStart: percent(at(band.value)) }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div aria-hidden className="mt-1 flex justify-between text-2xs text-fg-subtle">
        <span>{format(floor)}</span>
        <span className="font-medium">{valueLabel}</span>
        <span>{format(ceiling)}</span>
      </div>

      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Band</th>
            <th scope="col">Minimum</th>
            <th scope="col">Midpoint</th>
            <th scope="col">Maximum</th>
            <th scope="col">{valueLabel}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((band) => (
            <tr key={band.label}>
              <th scope="row">{band.label}</th>
              <td>{format(band.min)}</td>
              <td>{format(band.mid ?? (band.min + band.max) / 2)}</td>
              <td>{format(band.max)}</td>
              <td>
                {band.value === undefined
                  ? 'Not compared'
                  : `${format(band.value)}${
                      band.value < band.min
                        ? ' (below minimum)'
                        : band.value > band.max
                          ? ' (above maximum)'
                          : ''
                    }`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ChartFrame>
  );
}
