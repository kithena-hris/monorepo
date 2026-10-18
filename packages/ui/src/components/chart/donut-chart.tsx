'use client';

import type { JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { ChartDataTable, ChartMark, type ChartPoint } from './chart';
import { ChartFrame } from './chart-window';
import { bgTone, seriesTone, strokeTone, type ChartTone } from './tones';

export interface DonutSlice extends ChartPoint {
  tone?: ChartTone;
  /**
   * What the slice is made of, drawn as an outer ring inside the slice's own
   * arc: reviews by state on the inside, by kind around them. A part keeps
   * one tone wherever it appears, so "Self review" is one colour around the
   * whole ring and reads as one thing.
   */
  parts?: readonly DonutSlice[];
}

export interface DonutChartProps {
  data: readonly DonutSlice[];
  label: string;
  size?: number;
  /**
   * Rendered in the hole. Defaults to the total, which is what a reader looks
   * for first; pass `null` for an empty hole. A string or number is set as a
   * headline sized to the ring; anything else is laid out as given.
   */
  center?: ReactNode;
  /** A word under the centre figure: "people", "Permanent". */
  centerLabel?: string;
  /** Drop the legend where the donut is a thumbnail and the card says the rest. */
  showLegend?: boolean;
  /** A thinner ring, for a single share shown as a progress-like figure. */
  thin?: boolean;
  format?: (value: number) => string;
  /** Makes each slice and each legend row selectable. */
  onSelect?: (slice: DonutSlice, index: number) => void;
  selectedIndex?: number;
  /**
   * Extra right-click commands. There is no `zoomable` here on purpose: a
   * donut has no axis and no order, so "zoom" would have to mean "hide some
   * slices", which is what the legend already does, and a chart whose total
   * silently excludes what you zoomed past is a chart that lies.
   */
  menuItems?: ReactNode;
  className?: string;
}

/**
 * Composition of a whole, a headcount split, a leave-type mix.
 *
 * Capped at five slices on purpose. Human beings compare angles badly, and a
 * donut with eleven segments is a legend with a decoration attached; that is a
 * bar chart. The legend prints the value beside every label for the same
 * reason.
 */
export function DonutChart({
  data,
  label,
  size = 170,
  center: centerProp,
  centerLabel,
  showLegend = true,
  thin = false,
  format = (v) => String(v),
  onSelect,
  selectedIndex,
  menuItems,
  className,
}: DonutChartProps): JSX.Element {
  const total = data.reduce((sum, slice) => sum + slice.value, 0) || 1;
  const center = centerProp === undefined ? format(total) : centerProp;
  // Two rings when any slice says what it is made of: the parts outside, the
  // slices inside, a hairline between them.
  const ringed = data.some((slice) => (slice.parts?.length ?? 0) > 0);
  const outerStroke = ringed ? Math.round(size * 0.1) : 0;
  const stroke = Math.round(size * (thin ? 0.08 : ringed ? 0.11 : 0.13));
  const outerRadius = (size - outerStroke) / 2;
  const radius = ringed
    ? outerRadius - outerStroke / 2 - Math.max(2, size * 0.015) - stroke / 2
    : (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  // `pathLength="1"` renormalises the circle so every dash figure below is a
  // fraction of the whole ring rather than a length in pixels. That is what
  // lets one keyframe animate a slice of any size, and it makes the arithmetic
  // here read as percentages of a total, which is what a donut *is*.
  const gap = data.length > 1 ? Math.min(2 / circumference, 0.01) : 0;
  // One tone per part, wherever it appears, in the order parts first appear.
  const partLabels = [
    ...new Set(data.flatMap((slice) => (slice.parts ?? []).map((part) => part.label))),
  ];
  const partTone = (part: DonutSlice): ChartTone =>
    part.tone ?? seriesTone(partLabels.indexOf(part.label) + data.length);
  const partTotals = partLabels.map((name) => ({
    label: name,
    value: data.reduce(
      (sum, slice) =>
        sum + (slice.parts ?? []).filter((p) => p.label === name).reduce((n, p) => n + p.value, 0),
      0,
    ),
    tone: partTone(
      data.flatMap((slice) => slice.parts ?? []).find((p) => p.label === name) ?? {
        label: name,
        value: 0,
      },
    ),
  }));

  // Where each arc begins, as a fraction of the ring. Accumulated rather than
  // derived per slice so a rounding error cannot open a seam.
  let offset = 0;
  let outerOffset = 0;
  const half = size / 2;
  const arcClass =
    'transition-[opacity,stroke-width] duration-(--animate-duration-fast) motion-safe:animate-arc';

  return (
    <ChartFrame
      label={label}
      rows={data}
      {...(menuItems ? { menuItems } : {})}
      className={cn('flex flex-wrap items-center gap-6', className)}
    >
      <div
        className="@container relative aspect-square max-w-full shrink-0"
        // A width, never a height: the ring keeps its size where there is room
        // and shrinks with a container narrower than it, square either way.
        style={{ width: size }}
      >
        <svg aria-hidden viewBox={`0 0 ${String(size)} ${String(size)}`} className="size-full">
          <circle
            cx={half}
            cy={half}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            className="stroke-surface-sunken"
          />
          {ringed ? (
            <circle
              cx={half}
              cy={half}
              r={outerRadius}
              fill="none"
              strokeWidth={outerStroke}
              className="stroke-surface-sunken"
            />
          ) : null}
          {data.map((slice, index) => {
            const fraction = slice.value / total;
            const start = offset;
            const selected = selectedIndex === index;
            const readout = `${slice.label}: ${format(slice.value)} (${String(Math.round(fraction * 100))}%)`;
            const arc = (
              <circle
                cx={half}
                cy={half}
                r={radius}
                fill="none"
                pathLength={1}
                strokeWidth={stroke}
                // A hairline gap between slices, so two adjacent segments of
                // similar lightness do not merge into one. Never more than half
                // the slice: a 1% slice must not be gapped out of existence.
                strokeDasharray={`${String(Math.max(fraction - gap, fraction / 2))} 1`}
                strokeDashoffset={-start}
                transform={`rotate(-90 ${String(half)} ${String(half)})`}
                className={cn(
                  strokeTone[slice.tone ?? seriesTone(index)],
                  // Each arc grows from where the previous one ended, and starts
                  // exactly when that one finished, so the ring is drawn in a
                  // single continuous pass rather than five overlapping ones.
                  arcClass,
                  onSelect && 'cursor-pointer hover:opacity-80',
                  selectedIndex !== undefined && !selected && 'opacity-40',
                )}
                style={{
                  // Delay and duration are both proportional to the slice, which
                  // is what keeps the pen moving at one speed: a 40% slice takes
                  // 40% of the run, and the ring closes in exactly one duration
                  // however many slices there are.
                  animationDelay: `calc(${String(start)} * var(--animate-duration-slow))`,
                  animationDuration: `calc(${String(fraction)} * var(--animate-duration-slow))`,
                  strokeWidth: selected ? stroke + 3 : stroke,
                }}
                onClick={
                  onSelect
                    ? () => {
                        onSelect(slice, index);
                      }
                    : undefined
                }
              />
            );
            offset += fraction;
            // The parts, around their slice and inside its angle; whatever the
            // parts do not account for stays bare, so a short sum shows.
            outerOffset = start;
            const parts = (slice.parts ?? []).map((part) => {
              const share = part.value / total;
              const from = outerOffset;
              outerOffset += share;
              if (share <= 0) return null;
              const partReadout = `${slice.label} · ${part.label}: ${format(part.value)} (${String(
                Math.round(slice.value === 0 ? 0 : (part.value / slice.value) * 100),
              )}% of ${slice.label.toLowerCase()})`;
              return (
                <ChartMark key={`${slice.label}/${part.label}`} content={partReadout}>
                  <circle
                    cx={half}
                    cy={half}
                    r={outerRadius}
                    fill="none"
                    pathLength={1}
                    strokeWidth={outerStroke}
                    strokeDasharray={`${String(Math.max(share - gap, share / 2))} 1`}
                    strokeDashoffset={-from}
                    transform={`rotate(-90 ${String(half)} ${String(half)})`}
                    className={cn(
                      strokeTone[partTone(part)],
                      arcClass,
                      selectedIndex !== undefined && !selected && 'opacity-40',
                    )}
                    style={{
                      // After the inner ring has closed, the same pen speed.
                      animationDelay: `calc((1 + ${String(from)}) * var(--animate-duration-slow))`,
                      animationDuration: `calc(${String(share)} * var(--animate-duration-slow))`,
                    }}
                  />
                </ChartMark>
              );
            });
            // Focus and the tooltip live on the legend row rather than on the
            // arc: an arc is a hard 12px target and a legend row is a line of
            // text. The arc keeps the hover.
            return (
              <g key={slice.label}>
                <ChartMark content={readout}>{arc}</ChartMark>
                {parts}
              </g>
            );
          })}
        </svg>
        {center === null ? null : (
          <div className="absolute inset-0 grid place-items-center text-center">
            {typeof center === 'string' || typeof center === 'number' ? (
              // A bare figure is set as the headline it is, sized to the ring
              // rather than to the page; anything richer is the caller's.
              <span>
                <span
                  className={cn(
                    'block font-display leading-none font-bold tracking-[-0.03em] tabular-nums',
                    ringed ? 'text-[14cqi]' : 'text-[17cqi]',
                  )}
                >
                  {center}
                </span>
                {centerLabel === undefined ? null : (
                  <span className="mt-1 block text-xs font-medium text-fg-muted">
                    {centerLabel}
                  </span>
                )}
              </span>
            ) : (
              center
            )}
          </div>
        )}
      </div>

      <div
        className={cn('flex min-w-0 flex-[1_1_10.5rem] flex-col gap-3', !showLegend && 'hidden')}
      >
        <ul>
          {data.map((slice, index) => {
            const selected = selectedIndex === index;
            const row = (
              <>
                <span
                  className={cn(
                    'size-2.5 shrink-0 rounded-[3px]',
                    bgTone[slice.tone ?? seriesTone(index)],
                  )}
                />
                <span className="min-w-0 flex-1 truncate text-start font-medium text-fg">
                  {slice.label}
                </span>
                {/* The value beside the label, always. An angle is not a number,
                    and a percentage of an unstated total is not a fact. */}
                <span className="font-semibold tabular-nums text-fg">{format(slice.value)}</span>
                <span className="w-10 text-end text-xs tabular-nums text-fg-muted">
                  {Math.round((slice.value / total) * 100)}%
                </span>
              </>
            );

            return (
              <li key={slice.label} className="border-b border-border last:border-b-0">
                {onSelect ? (
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      onSelect(slice, index);
                    }}
                    className={cn(
                      'flex min-h-8 w-full touch:min-h-tap items-center gap-2.5 rounded-xs px-1 text-sm transition-colors',
                      'hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus',
                      selected && 'bg-accent-subtle',
                      selectedIndex !== undefined && !selected && 'opacity-60',
                    )}
                  >
                    {row}
                  </button>
                ) : (
                  <span className="flex min-h-8 items-center gap-2.5 text-sm">{row}</span>
                )}
              </li>
            );
          })}
        </ul>
        {ringed ? (
          // The outer ring's key: what the slices are made of, and how many of each.
          <ul aria-label="Made of" className="flex flex-wrap gap-x-3 gap-y-1">
            {partTotals.map((part) => (
              <li key={part.label} className="flex items-center gap-1.5 text-xs text-fg-muted">
                <span className={cn('size-2 shrink-0 rounded-full', bgTone[part.tone])} />
                <span className="font-medium text-fg">{part.label}</span>
                <span className="tabular-nums">{format(part.value)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <ChartDataTable caption={label} data={data} format={format} />
      {ringed
        ? data.map((slice) =>
            (slice.parts ?? []).length === 0 ? null : (
              <ChartDataTable
                key={slice.label}
                caption={`${label}, ${slice.label}, by part`}
                data={slice.parts ?? []}
                format={format}
              />
            ),
          )
        : null}
    </ChartFrame>
  );
}
