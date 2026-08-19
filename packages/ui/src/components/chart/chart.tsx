'use client';

import { useCallback, useId, useMemo, useState, type JSX, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Tooltip } from '../tooltip/tooltip';
import {
  ChartFrame,
  ChartMarquee,
  ChartZoomControls,
  useChartWindow,
  useDragZoom,
  type ChartWindow,
} from './chart-window';

/**
 * Small charts, drawn by hand.
 *
 * Why no charting library: the four shapes below are the ones an HRIS
 * dashboard actually uses. They are a few hundred lines of SVG, and every
 * library that draws them arrives with its own colour system, its own tooltip,
 * its own focus behaviour and 60–150kB. The design system would then have two
 * sources of truth for a colour and none for a focus ring. When a module needs
 * a real analytical chart, a distribution, a cohort matrix. That is a module
 * dependency, not a system one.
 *
 * **Accessibility.** Every chart here renders the same numbers twice: once as
 * SVG for people who can see it, and once as a real `<table>` for people using
 * a screen reader. An `aria-label` saying "line chart of headcount" tells a
 * blind user only that they are missing something; the table tells them what.
 * That is why `data` carries labels rather than bare numbers.
 */

export interface ChartPoint {
  /** The category or period. Used as the row header in the data table. */
  label: string;
  value: number;
}

export type ChartTone = 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export type { ChartWindow };

/**
 * The interaction surface every axis-based chart in this file shares.
 *
 * One shape rather than six, so `zoomable` means the same thing on a bar chart
 * as on a heatmap, and so a screen that swaps one chart for another does not
 * have to relearn the props.
 */
export interface ChartInteractionProps {
  /**
   * Renders the zoom and pan controls, and enables drag-to-zoom on the plot.
   * Both, always: a drag is unreachable by a keyboard, and the buttons are
   * unreachable by nobody.
   */
  zoomable?: boolean;
  /** The visible slice, as inclusive indices. Uncontrolled when omitted. */
  window?: ChartWindow;
  onWindowChange?: (window: ChartWindow) => void;
  /** Extra commands appended to the right-click menu. */
  menuItems?: ReactNode;
}

// The `-fg` end of each ramp, not the base.
//
// A base tone is mixed to sit on its own tinted wash, which is right for a
// badge and wrong for a mark drawn straight onto the card: amber-600 on white
// measures 2.76:1, and a donut slice is a graphical object that WCAG 1.4.11
// asks 3:1 of. `neutral` already points at a foreground token and stays put.
//
// `tools/a11y/contrast-sweep.mjs` checks these six against every surface a
// chart can sit on. It can, because `ChartTone` is closed: no chart in this
// package can reach a colour that is not on this list.
const fillTone: Record<ChartTone, string> = {
  accent: 'fill-accent-fg',
  success: 'fill-success-fg',
  warning: 'fill-warning-fg',
  danger: 'fill-danger-fg',
  info: 'fill-info-fg',
  neutral: 'fill-fg-subtle',
};

const strokeTone: Record<ChartTone, string> = {
  accent: 'stroke-accent-fg',
  success: 'stroke-success-fg',
  warning: 'stroke-warning-fg',
  danger: 'stroke-danger-fg',
  info: 'stroke-info-fg',
  neutral: 'stroke-fg-subtle',
};

const bgTone: Record<ChartTone, string> = {
  accent: 'bg-accent-fg',
  success: 'bg-success-fg',
  warning: 'bg-warning-fg',
  danger: 'bg-danger-fg',
  info: 'bg-info-fg',
  neutral: 'bg-fg-subtle',
};

/**
 * The hover and focus readout every mark in this file gets.
 *
 * A tooltip rather than a floating label drawn into the chart: it is the one
 * that survives a keyboard, because Radix opens it on focus as well as on
 * hover. A value only reachable with a pointer is a value half the readers
 * cannot get to.
 *
 * It is never the *only* copy of the number, the accessibility table below
 * every chart still carries all of them, since a tooltip is announced once and
 * then gone.
 */
function ChartMark({
  content,
  children,
  disabled = false,
}: {
  content: ReactNode;
  children: JSX.Element;
  disabled?: boolean;
}): JSX.Element {
  if (disabled) return children;
  return (
    <Tooltip content={content} side="top">
      {children}
    </Tooltip>
  );
}

export interface ChartLegendItem {
  label: string;
  tone: ChartTone;
}

/**
 * A legend whose rows switch their series on and off.
 *
 * Clicking a legend to isolate a line is the oldest interaction in charting and
 * the one people reach for without being taught. Making it a real `<button>`
 * with `aria-pressed` is what makes it reachable at all from a keyboard,
 * a `<li>` with an `onClick` is a control only a mouse can find.
 *
 * A hidden series is *hidden*, not deleted: it stays in the legend, keeps its
 * colour, and stays in the accessibility table. Removing it from the legend
 * would leave no way to bring it back.
 */
export function ChartLegend({
  items,
  hidden = [],
  onHiddenChange,
  className,
}: {
  items: readonly ChartLegendItem[];
  hidden?: readonly string[];
  onHiddenChange?: (hidden: readonly string[]) => void;
  className?: string;
}): JSX.Element {
  const toggle = (label: string): void => {
    onHiddenChange?.(
      hidden.includes(label) ? hidden.filter((entry) => entry !== label) : [...hidden, label],
    );
  };

  return (
    <ul className={cn('flex flex-wrap gap-x-3 gap-y-1.5', className)}>
      {items.map((item) => {
        const off = hidden.includes(item.label);
        const swatch = (
          <>
            <span
              className={cn(
                'size-2.5 shrink-0 rounded-xs transition-opacity duration-(--animate-duration-fast)',
                bgTone[item.tone],
                off && 'opacity-30',
              )}
            />
            <span className={cn('truncate', off && 'line-through opacity-60')}>{item.label}</span>
          </>
        );

        return (
          <li key={item.label}>
            {onHiddenChange ? (
              <button
                type="button"
                // `aria-pressed` reads as "shown" or "not shown". Strike-through
                // as well as opacity, because a legend that says which series
                // are off only in grey says it to nobody in bright sunlight.
                aria-pressed={!off}
                onClick={() => {
                  toggle(item.label);
                }}
                className={cn(
                  'flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-sm text-fg-muted',
                  'transition-colors duration-(--animate-duration-fast)',
                  'hover:bg-surface-hover hover:text-fg',
                  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus',
                )}
              >
                {swatch}
              </button>
            ) : (
              <span className="flex items-center gap-1.5 px-1.5 py-0.5 text-sm text-fg-muted">
                {swatch}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The screen-reader alternative every chart in this file renders. Exported
 * because a module writing its own chart owes its users the same thing.
 */
export function ChartDataTable({
  caption,
  data,
  valueLabel = 'Value',
  format,
}: {
  caption: string;
  data: readonly ChartPoint[];
  valueLabel?: string;
  format?: (value: number) => string;
}): JSX.Element {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Period</th>
          <th scope="col">{valueLabel}</th>
        </tr>
      </thead>
      <tbody>
        {data.map((point) => (
          <tr key={point.label}>
            <th scope="row">{point.label}</th>
            <td>{format ? format(point.value) : point.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export interface SparklineProps {
  data: readonly ChartPoint[];
  /** Named for the screen-reader table's caption. Required. */
  label: string;
  tone?: ChartTone;
  /** Fills under the line. Reads as volume rather than as a rate. */
  area?: boolean;
  /** Marks the final point, so "where it ended" survives being 80px wide. */
  showLastPoint?: boolean;
  className?: string;
  format?: (value: number) => string;
}

/**
 * A trend with no axes, sized to sit inside a stat tile.
 *
 * The SVG stretches with `preserveAspectRatio="none"`, which is what makes it
 * fill any width without measuring the container in JS. That distorts strokes,
 * so the line carries `vector-effect="non-scaling-stroke"`, without it a
 * sparkline in a wide tile has a hairline for a line and a 4px one when narrow.
 */
export function Sparkline({
  data,
  label,
  tone = 'accent',
  area = true,
  showLastPoint = true,
  className,
  format = (value) => String(value),
}: SparklineProps): JSX.Element {
  const gradientId = useId();
  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series would divide by zero and, worse, would draw a line along the
  // bottom edge implying a collapse. Flat draws through the middle.
  const span = max - min || 1;
  const step = data.length > 1 ? 100 / (data.length - 1) : 0;

  const points = data.map((d, i) => {
    const x = i * step;
    const y = max === min ? 16 : 30 - ((d.value - min) / span) * 28;
    return `${String(x)},${String(y)}`;
  });

  const line = `M ${points.join(' L ')}`;
  const last = data.at(-1);
  const lastX = (data.length - 1) * step;
  const lastY = max === min || !last ? 16 : 30 - ((last.value - min) / span) * 28;

  return (
    <div className={cn('relative w-full', className)}>
      <svg
        aria-hidden
        viewBox="0 0 100 32"
        preserveAspectRatio="none"
        className="h-10 w-full overflow-visible"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {area ? (
          <path
            d={`${line} L ${String(lastX)},32 L 0,32 Z`}
            fill={`url(#${gradientId})`}
            className={cn(strokeTone[tone], 'text-accent')}
            stroke="none"
          />
        ) : null}
        <path
          d={line}
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          className={strokeTone[tone]}
        />
        {showLastPoint ? (
          <circle
            cx={lastX}
            cy={lastY}
            r={2}
            vectorEffect="non-scaling-stroke"
            className={fillTone[tone]}
          />
        ) : null}
      </svg>
      <ChartDataTable caption={label} data={data} format={format} />
    </div>
  );
}

export interface BarChartProps extends ChartInteractionProps {
  data: readonly ChartPoint[];
  label: string;
  tone?: ChartTone;
  /** Height of the plot area. The bars fill it. */
  height?: number;
  /** Prints the value above each bar. Drop it when the bars get thin. */
  showValues?: boolean;
  /** Draws a dashed line at this value, a target, a budget, an average. */
  reference?: { value: number; label: string };
  format?: (value: number) => string;
  className?: string;
  /** Called when a bar is clicked or activated from the keyboard. */
  onSelect?: (point: ChartPoint, index: number) => void;
  /** Index of the currently selected bar. */
  selectedIndex?: number;
}

/**
 * Categorical comparison.
 *
 * Laid out with CSS grid and percentage heights rather than SVG, deliberately:
 * the bars then reflow with the container at any width, the labels are real
 * text that wraps and truncates like text, and each bar can be a real
 * `<button>` when the chart is interactive, none of which is true of a `<rect>`.
 */
export function BarChart({
  data,
  label,
  tone = 'accent',
  height = 160,
  showValues = false,
  reference,
  format = (v) => String(v),
  className,
  onSelect,
  selectedIndex,
  zoomable = false,
  window: controlledWindow,
  onWindowChange,
  menuItems,
}: BarChartProps): JSX.Element {
  const windowState = useChartWindow(data.length, controlledWindow, onWindowChange);
  const shown = zoomable ? windowState.slice(data) : [...data];
  const max = Math.max(...shown.map((d) => d.value), reference?.value ?? 0) || 1;

  const drag = useDragZoom({
    total: Math.max(2, shown.length),
    enabled: zoomable,
    onZoom: (range) => {
      // Rebased onto the full series: the drag reports indices within the
      // visible slice, so a second zoom would otherwise jump back to the start.
      windowState.setWindow({
        start: windowState.window.start + range.start,
        end: windowState.window.start + range.end,
      });
    },
  });

  return (
    <ChartFrame
      label={label}
      rows={data}
      {...(zoomable ? { window: windowState } : {})}
      {...(menuItems ? { menuItems } : {})}
      className={cn('w-full', className)}
    >
      {zoomable ? (
        <ChartZoomControls
          className="mb-2"
          state={windowState}
          total={data.length}
          visibleLabels={shown.map((point) => point.label)}
        />
      ) : null}

      {/*
       * `items-stretch`, and every column is `h-full`. With `items-end` the
       * columns were content-height, so the bars' percentage heights had
       * nothing to resolve against and every bar collapsed to its 2px floor.
       * A percentage height needs a parent with a definite height, every time.
       */}
      <div
        className={cn(
          'relative flex items-stretch gap-1.5 border-b border-border',
          zoomable && 'cursor-crosshair touch-none select-none',
        )}
        style={{ height }}
        {...(zoomable ? drag.handlers : {})}
      >
        <ChartMarquee marquee={drag.marquee} />

        {reference ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-fg-subtle"
            style={{ bottom: `${String((reference.value / max) * 100)}%` }}
          >
            <span className="absolute -top-4 right-0 text-2xs text-fg-subtle">
              {reference.label}
            </span>
          </div>
        ) : null}

        {shown.map((point, index) => {
          const percent = (point.value / max) * 100;
          const selected = selectedIndex === index;
          const readout = `${point.label}: ${format(point.value)}`;

          const bar = (
            <span
              className={cn(
                'block w-full origin-bottom rounded-t-sm',
                'transition-[height,background-color,opacity] duration-(--animate-duration-slow) ease-standard',
                'motion-safe:animate-grow-y',
                bgTone[tone],
                selected ? 'opacity-100' : 'opacity-80',
                onSelect && 'group-hover:opacity-100 group-focus-visible:opacity-100',
              )}
              // A percentage so the bar rescales with the container rather than
              // being recomputed, and `max(…, 2px)` so a zero stays visible,
              // an absent bar and a bar of zero look identical otherwise, and
              // they mean very different things.
              style={{
                height: `max(${String(percent)}%, 2px)`,
                // Staggered, so a chart plots left to right rather than
                // arriving in one frame.
                animationDelay: `min(calc(${String(index)} * 40ms), 320ms)`,
              }}
            />
          );

          return (
            <div
              key={point.label}
              className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1"
            >
              {showValues ? (
                <span
                  aria-hidden
                  className="shrink-0 text-center text-2xs tabular-nums text-fg-muted"
                >
                  {format(point.value)}
                </span>
              ) : null}

              {/* The plot area is what the percentage resolves against, so it
                  is a flex child with a definite height of its own. */}
              <div className="flex min-h-0 flex-1 items-end">
                <ChartMark content={readout}>
                  {onSelect ? (
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(point, index);
                      }}
                      aria-pressed={selected}
                      className="group flex h-full w-full items-end rounded-t-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                    >
                      <span className="sr-only">{readout}</span>
                      {bar}
                    </button>
                  ) : (
                    // Focusable even when it does nothing, so the tooltip is
                    // reachable without a pointer. `role="img"` with a name
                    // rather than a button, because it is not one.
                    <span
                      tabIndex={0}
                      role="img"
                      aria-label={readout}
                      className="flex h-full w-full items-end rounded-t-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                    >
                      {bar}
                    </span>
                  )}
                </ChartMark>
              </div>
            </div>
          );
        })}
      </div>

      <div aria-hidden className="mt-1.5 flex gap-1.5">
        {shown.map((point) => (
          <span
            key={point.label}
            className="min-w-0 flex-1 truncate text-center text-2xs text-fg-subtle"
          >
            {point.label}
          </span>
        ))}
      </div>

      {/* The whole series, not the window: zooming changes what is drawn, never
          what a screen reader can reach. */}
      <ChartDataTable caption={label} data={data} format={format} />
    </ChartFrame>
  );
}

export interface DonutSlice extends ChartPoint {
  tone?: ChartTone;
}

export interface DonutChartProps {
  data: readonly DonutSlice[];
  label: string;
  size?: number;
  /** Rendered in the hole. Use it for the total, not for a fifth slice. */
  center?: ReactNode;
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

const donutOrder: readonly ChartTone[] = ['accent', 'success', 'warning', 'danger', 'info'];

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
  size = 160,
  center,
  format = (v) => String(v),
  onSelect,
  selectedIndex,
  menuItems,
  className,
}: DonutChartProps): JSX.Element {
  const total = data.reduce((sum, slice) => sum + slice.value, 0) || 1;
  const stroke = Math.round(size / 7);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  // `pathLength="1"` renormalises the circle so every dash figure below is a
  // fraction of the whole ring rather than a length in pixels. That is what
  // lets one keyframe animate a slice of any size, and it makes the arithmetic
  // here read as percentages of a total, which is what a donut *is*.
  const gap = Math.min(1.5 / circumference, 0.01);

  // Where each arc begins, as a fraction of the ring. Accumulated rather than
  // derived per slice so a rounding error cannot open a seam.
  let offset = 0;

  return (
    <ChartFrame
      label={label}
      rows={data}
      {...(menuItems ? { menuItems } : {})}
      className={cn('flex flex-wrap items-center gap-5', className)}
    >
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg aria-hidden width={size} height={size} viewBox={`0 0 ${String(size)} ${String(size)}`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            className="stroke-surface-sunken"
          />
          {data.map((slice, index) => {
            const fraction = slice.value / total;
            const start = offset;
            const selected = selectedIndex === index;
            const readout = `${slice.label}: ${format(slice.value)} (${String(Math.round(fraction * 100))}%)`;
            const arc = (
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                pathLength={1}
                strokeWidth={stroke}
                // A hairline gap between slices, so two adjacent segments of
                // similar lightness do not merge into one. Never more than half
                // the slice: a 1% slice must not be gapped out of existence.
                strokeDasharray={`${String(Math.max(fraction - gap, fraction / 2))} 1`}
                strokeDashoffset={-start}
                transform={`rotate(-90 ${String(size / 2)} ${String(size / 2)})`}
                className={cn(
                  strokeTone[slice.tone ?? donutOrder[index % donutOrder.length] ?? 'accent'],
                  'transition-[opacity,stroke-width] duration-(--animate-duration-fast)',
                  // Each arc grows from where the previous one ended, and starts
                  // exactly when that one finished, so the ring is drawn in a
                  // single continuous pass rather than five overlapping ones.
                  'motion-safe:animate-arc',
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
            // Focus and the tooltip live on the legend row rather than on the
            // arc: an arc is a hard 12px target and a legend row is a line of
            // text. The arc keeps the hover.
            return (
              <ChartMark key={slice.label} content={readout}>
                {arc}
              </ChartMark>
            );
          })}
        </svg>
        {center ? (
          <div className="absolute inset-0 grid place-items-center text-center">{center}</div>
        ) : null}
      </div>

      <ul className="min-w-0 flex-1 space-y-1.5">
        {data.map((slice, index) => {
          const selected = selectedIndex === index;
          const row = (
            <>
              <span
                className={cn(
                  'size-2.5 shrink-0 rounded-xs',
                  bgTone[slice.tone ?? donutOrder[index % donutOrder.length] ?? 'accent'],
                )}
              />
              <span className="min-w-0 flex-1 truncate text-fg-muted">{slice.label}</span>
              {/* The value beside the label, always. An angle is not a number,
                  and a percentage of an unstated total is not a fact. */}
              <span className="font-medium tabular-nums text-fg">{format(slice.value)}</span>
              <span className="w-10 text-right tabular-nums text-fg-subtle">
                {Math.round((slice.value / total) * 100)}%
              </span>
            </>
          );

          return (
            <li key={slice.label}>
              {onSelect ? (
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    onSelect(slice, index);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-1 text-sm transition-colors',
                    'hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus',
                    selected && 'bg-accent-subtle',
                  )}
                >
                  {row}
                </button>
              ) : (
                <span className="flex items-center gap-2 px-1 text-sm">{row}</span>
              )}
            </li>
          );
        })}
      </ul>

      <ChartDataTable caption={label} data={data} format={format} />
    </ChartFrame>
  );
}

export interface TrendChartProps extends ChartInteractionProps {
  series: readonly { label: string; tone?: ChartTone; data: readonly ChartPoint[] }[];
  label: string;
  height?: number;
  format?: (value: number) => string;
  /**
   * Fills under the line. Reads as *volume*, so it is right for a headcount
   * and wrong for a rate, an area under a percentage implies an accumulation
   * that does not exist. Only sensible with one or two series; three
   * overlapping fills is a chart nobody can read.
   */
  area?: boolean;
  /**
   * Series switched off from the legend. Uncontrolled when omitted, the chart
   * keeps its own set, which is what a dashboard usually wants.
   */
  hiddenSeries?: readonly string[];
  onHiddenSeriesChange?: (hidden: readonly string[]) => void;
  /** Fires with the period and every series' value at it. */
  onSelect?: (selection: { index: number; label: string; values: Record<string, number> }) => void;
  className?: string;
}

/**
 * One or more lines over a shared period, with a y axis.
 *
 * The plot stretches (`preserveAspectRatio="none"`) while the strokes do not,
 * and the axis labels are HTML positioned in percentages rather than SVG
 * `<text>`, so they stay at the type scale, respect the root font size on a
 * television, and never end up 4px tall in a wide container.
 *
 * ### Zoom and pan are buttons first
 *
 * Drag-to-select is the obvious gesture and it is unreachable by a keyboard, a
 * switch, or anyone whose hand is not steady. So the primitive here is a pair
 * of buttons and a window prop: zoom in, zoom out, step left, step right,
 * reset, every one of them a real control with a name. A module that wants
 * drag-to-select can add it on top and feed the same `onWindowChange`.
 *
 * Zooming a *time series* narrows the period rather than scaling the drawing:
 * the axis re-labels, the y range re-fits to what is visible, and the numbers
 * stay readable. A chart that scales its own pixels is a chart with a blurry
 * axis.
 */
export function TrendChart({
  series,
  label,
  height = 200,
  format = (v) => String(v),
  area = false,
  hiddenSeries,
  onHiddenSeriesChange,
  onSelect,
  window: controlledWindow,
  onWindowChange,
  zoomable = false,
  menuItems,
  className,
}: TrendChartProps): JSX.Element {
  const periods = series[0]?.data.map((point) => point.label) ?? [];
  const total = periods.length;

  const [internalHidden, setInternalHidden] = useState<readonly string[]>([]);
  const hidden = hiddenSeries ?? internalHidden;
  const setHidden = useCallback(
    (next: readonly string[]): void => {
      if (hiddenSeries === undefined) setInternalHidden(next);
      onHiddenSeriesChange?.(next);
    },
    [hiddenSeries, onHiddenSeriesChange],
  );

  const windowState = useChartWindow(total, controlledWindow, onWindowChange);
  const visibleWindow = windowState.window;

  const drag = useDragZoom({
    total: Math.max(2, windowState.window.end - windowState.window.start + 1),
    enabled: zoomable,
    onZoom: (range) => {
      // Rebased onto the full series: the drag reports indices within the
      // visible slice, and a second zoom would otherwise jump back to the
      // start of the data.
      windowState.setWindow({
        start: visibleWindow.start + range.start,
        end: visibleWindow.start + range.end,
      });
    },
  });

  const [hovered, setHovered] = useState<number | null>(null);

  const visible = series.filter((entry) => !hidden.includes(entry.label));
  const slice = windowState.slice;

  const shownPeriods = slice(periods);
  const values = useMemo(
    () => visible.flatMap((entry) => slice(entry.data).map((point) => point.value)),
    [visible, slice],
  );

  // With every series hidden there is nothing to scale to. A 0–1 axis is a
  // truthful empty chart; a NaN one is a blank rectangle.
  const max = values.length > 0 ? Math.max(...values) : 1;
  const min = values.length > 0 ? Math.min(...values) : 0;
  const span = max - min || 1;
  const ticks = [max, min + span * 0.5, min];

  const step = shownPeriods.length > 1 ? 100 / (shownPeriods.length - 1) : 0;

  const readoutFor = (index: number): Record<string, number> =>
    Object.fromEntries(visible.map((entry) => [entry.label, slice(entry.data)[index]?.value ?? 0]));

  return (
    <ChartFrame
      label={label}
      rows={(series[0]?.data ?? []).map((point, index) => ({
        label: point.label,
        value: visible.reduce((sum, entry) => sum + (entry.data[index]?.value ?? 0), 0),
      }))}
      {...(zoomable ? { window: windowState } : {})}
      {...(menuItems ? { menuItems } : {})}
      className={cn('w-full', className)}
    >
      {zoomable ? (
        <ChartZoomControls
          className="mb-2"
          state={windowState}
          total={total}
          visibleLabels={shownPeriods}
        />
      ) : null}

      <div className="flex gap-2">
        <div
          aria-hidden
          className="flex shrink-0 flex-col justify-between text-2xs tabular-nums text-fg-subtle"
          style={{ height }}
        >
          {ticks.map((tick) => (
            <span key={tick}>{format(Math.round(tick))}</span>
          ))}
        </div>

        <div
          className={cn(
            'relative min-w-0 flex-1',
            zoomable && 'cursor-crosshair touch-none select-none',
          )}
          style={{ height }}
          {...(zoomable ? drag.handlers : {})}
        >
          <ChartMarquee marquee={drag.marquee} />

          {/* Gridlines behind the plot, so a value can be read off the chart
              without counting pixels against the axis. */}
          <div aria-hidden className="absolute inset-0 flex flex-col justify-between">
            {ticks.map((tick) => (
              <span key={tick} className="border-t border-border" />
            ))}
          </div>

          <svg
            aria-hidden
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 size-full"
          >
            {visible.map((entry) => {
              const points = slice(entry.data);
              const path = points
                .map((point, index) => {
                  const x = index * step;
                  const y = 100 - ((point.value - min) / span) * 100;
                  return `${index === 0 ? 'M' : 'L'} ${String(x)},${String(y)}`;
                })
                .join(' ');
              return (
                <g key={entry.label}>
                  {area ? (
                    <path
                      d={`${path} L 100,100 L 0,100 Z`}
                      className={cn(fillTone[entry.tone ?? 'accent'], 'opacity-15')}
                      stroke="none"
                    />
                  ) : null}
                  <path
                    d={path}
                    fill="none"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    // `pathLength="1"` normalises the dash length, so one
                    // keyframe draws a path of any actual length.
                    pathLength={1}
                    strokeDasharray={1}
                    className={cn(
                      strokeTone[entry.tone ?? 'accent'],
                      'motion-safe:animate-draw-line',
                    )}
                  />
                </g>
              );
            })}
          </svg>

          {/*
           * One hit column per period, over the whole plot height. Hovering a
           * 2px line is a coordination test; hovering the column above it is
           * not, and the column is also focusable, which the line could never
           * be.
           */}
          <div className="absolute inset-0 flex">
            {shownPeriods.map((period, index) => {
              const active = hovered === index;
              const readout = readoutFor(index);
              return (
                <ChartMark
                  key={period}
                  content={
                    <span className="flex flex-col gap-0.5">
                      <span className="font-medium">{period}</span>
                      {Object.entries(readout).map(([name, value]) => (
                        <span key={name} className="tabular-nums">
                          {name}: {format(value)}
                        </span>
                      ))}
                    </span>
                  }
                >
                  <button
                    type="button"
                    aria-label={`${period}: ${Object.entries(readout)
                      .map(([name, value]) => `${name} ${format(value)}`)
                      .join(', ')}`}
                    onFocus={() => {
                      setHovered(index);
                    }}
                    onBlur={() => {
                      setHovered(null);
                    }}
                    onMouseEnter={() => {
                      setHovered(index);
                    }}
                    onMouseLeave={() => {
                      setHovered(null);
                    }}
                    onClick={
                      onSelect
                        ? () => {
                            onSelect({
                              index: visibleWindow.start + index,
                              label: period,
                              values: readout,
                            });
                          }
                        : undefined
                    }
                    className={cn(
                      'relative h-full min-w-0 flex-1',
                      onSelect ? 'cursor-pointer' : 'cursor-default',
                      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'absolute inset-y-0 start-1/2 w-px -translate-x-1/2 bg-border-strong',
                        'transition-opacity duration-(--animate-duration-fast)',
                        active ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    {visible.map((entry) => {
                      const point = slice(entry.data)[index];
                      if (!point) return null;
                      return (
                        <span
                          key={entry.label}
                          aria-hidden
                          className={cn(
                            'absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface',
                            bgTone[entry.tone ?? 'accent'],
                            'transition-[opacity,transform] duration-(--animate-duration-fast)',
                            active ? 'scale-125 opacity-100' : 'opacity-0',
                          )}
                          style={{
                            left: '50%',
                            top: `${String(100 - ((point.value - min) / span) * 100)}%`,
                          }}
                        />
                      );
                    })}
                  </button>
                </ChartMark>
              );
            })}
          </div>
        </div>
      </div>

      <div aria-hidden className="mt-1.5 flex justify-between ps-8 text-2xs text-fg-subtle">
        {shownPeriods.map((period) => (
          <span key={period}>{period}</span>
        ))}
      </div>

      {series.length > 1 ? (
        <ChartLegend
          className="mt-3"
          items={series.map((entry) => ({ label: entry.label, tone: entry.tone ?? 'accent' }))}
          hidden={hidden}
          onHiddenChange={setHidden}
        />
      ) : null}

      {/* Every series, always: including the ones switched off in the legend.
          A hidden line is hidden from the eye, not deleted from the data. */}
      {series.map((entry) => (
        <ChartDataTable
          key={entry.label}
          caption={`${label}, ${entry.label}`}
          data={entry.data}
          valueLabel={entry.label}
          format={format}
        />
      ))}
    </ChartFrame>
  );
}

export interface HorizontalBarChartProps extends ChartInteractionProps {
  data: readonly ChartPoint[];
  label: string;
  tone?: ChartTone;
  /** Prints the value at the end of each bar. */
  showValues?: boolean;
  /** Sorts descending before rendering. A ranking that is not sorted is a list. */
  sorted?: boolean;
  /** Caps the rows and adds a "+N more" line. */
  limit?: number;
  format?: (value: number) => string;
  onSelect?: (point: ChartPoint, index: number) => void;
  selectedIndex?: number;
  className?: string;
}

/**
 * A ranking.
 *
 * Horizontal, not vertical, and the reason is typography rather than taste: a
 * vertical bar chart puts its category labels under 60px-wide bars, where
 * "People Operations" becomes "Peop…" or gets rotated 45°. Rotated text is
 * roughly 20% slower to read. Turn the chart on its side and the label sits on
 * a full-width line where it belongs.
 *
 * Use it whenever the categories are words. Use the vertical `BarChart` when
 * they are periods: months read left to right, and turning time on its side
 * costs more than the labels save.
 */
export function HorizontalBarChart({
  data,
  label,
  tone = 'accent',
  showValues = true,
  sorted = true,
  limit,
  format = (v) => String(v),
  onSelect,
  selectedIndex,
  zoomable = false,
  window: controlledWindow,
  onWindowChange,
  menuItems,
  className,
}: HorizontalBarChartProps): JSX.Element {
  const ordered = sorted ? data.toSorted((a, b) => b.value - a.value) : [...data];
  // Original position by label, built once. `data.indexOf(point)` inside the
  // row map is a scan per row, and `ordered` is a sorted copy, so the drawn
  // position is not the index `selectedIndex` refers to.
  const dataIndex = useMemo(
    () => new Map(data.map((point, index) => [point.label, index])),
    [data],
  );
  const windowState = useChartWindow(ordered.length, controlledWindow, onWindowChange);
  const windowed = zoomable ? windowState.slice(ordered) : ordered;
  const shown = limit === undefined ? windowed : windowed.slice(0, limit);
  const hiddenCount = windowed.length - shown.length;
  const max = Math.max(...ordered.map((d) => d.value)) || 1;

  // Vertical here: the rows run down the chart, so the drag that selects a
  // range of them runs down it too.
  const drag = useDragZoom({
    total: Math.max(2, shown.length),
    enabled: zoomable,
    orientation: 'vertical',
    onZoom: (range) => {
      windowState.setWindow({
        start: windowState.window.start + range.start,
        end: windowState.window.start + range.end,
      });
    },
  });

  return (
    <ChartFrame
      label={label}
      rows={ordered}
      {...(zoomable ? { window: windowState } : {})}
      {...(menuItems ? { menuItems } : {})}
      className={cn('w-full', className)}
    >
      {zoomable ? (
        <ChartZoomControls
          className="mb-2"
          state={windowState}
          total={ordered.length}
          visibleLabels={shown.map((point) => point.label)}
        />
      ) : null}
      <ul
        className={cn(
          'relative space-y-1.5',
          zoomable && 'cursor-crosshair touch-none select-none',
        )}
        {...(zoomable ? drag.handlers : {})}
      >
        <ChartMarquee marquee={drag.marquee} orientation="vertical" />
        {shown.map((point) => {
          const index = dataIndex.get(point.label) ?? -1;
          const selected = selectedIndex === index;
          const readout = `${point.label}: ${format(point.value)}`;
          const row = (
            <>
              {/*
               * A fixed label column rather than a label above each bar: the
               * bars then start at the same x, which is the only way the eye
               * can compare their lengths. `ch` units, so the column is sized
               * by characters rather than by a guess.
               */}
              <span className="w-[14ch] shrink-0 truncate text-end text-xs text-fg-muted">
                {point.label}
              </span>
              <span className="relative h-5 min-w-0 flex-1 overflow-hidden rounded-sm bg-surface-sunken">
                <span
                  className={cn(
                    'absolute inset-y-0 start-0 origin-left rounded-sm',
                    'transition-[width,opacity] duration-(--animate-duration-slow) ease-standard',
                    'motion-safe:animate-grow-x',
                    bgTone[tone],
                    selected ? 'opacity-100' : 'opacity-80',
                  )}
                  style={{
                    width: `max(${String((point.value / max) * 100)}%, 2px)`,
                    animationDelay: `min(calc(${String(index)} * 40ms), 320ms)`,
                  }}
                />
              </span>
              {showValues ? (
                <span className="w-[6ch] shrink-0 text-end text-xs tabular-nums text-fg">
                  {format(point.value)}
                </span>
              ) : null}
            </>
          );

          return (
            <li key={point.label}>
              <ChartMark content={readout}>
                {onSelect ? (
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      onSelect(point, index);
                    }}
                    className="flex w-full items-center gap-2 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                  >
                    <span className="sr-only">{readout}</span>
                    {row}
                  </button>
                ) : (
                  <span
                    tabIndex={0}
                    role="img"
                    aria-label={readout}
                    className="flex w-full items-center gap-2 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                  >
                    {row}
                  </span>
                )}
              </ChartMark>
            </li>
          );
        })}
      </ul>

      {hiddenCount > 0 ? (
        <p aria-hidden className="mt-2 text-xs text-fg-subtle">
          +{hiddenCount} more
        </p>
      ) : null}

      <ChartDataTable caption={label} data={ordered} format={format} />
    </ChartFrame>
  );
}

export interface StackedSeries {
  label: string;
  tone?: ChartTone;
  /** One value per category, in the same order as `categories`. */
  values: readonly number[];
}

export interface StackedBarChartProps extends ChartInteractionProps {
  categories: readonly string[];
  series: readonly StackedSeries[];
  label: string;
  height?: number;
  /** Each column fills the height, so the chart reads as proportions. */
  normalise?: boolean;
  format?: (value: number) => string;
  /** Series the reader has switched off from the legend. */
  hiddenSeries?: readonly string[];
  onHiddenSeriesChange?: (hidden: readonly string[]) => void;
  onSelect?: (selection: { series: string; category: string; value: number }) => void;
  className?: string;
}

const stackOrder: readonly ChartTone[] = ['accent', 'success', 'warning', 'danger', 'info'];

/**
 * Composition across categories: headcount by team, split by status.
 *
 * Honest about what a stack can and cannot show. Only the **bottom** segment
 * shares a baseline, so only it can be compared across columns by eye.
 * Everything above floats. That is fine for "what is this made of" and wrong
 * for "which team has the most leavers"; the second question wants a grouped
 * chart or a separate one.
 *
 * `normalise` turns every column into 100%, which answers "what proportion"
 * and destroys "how many". The absolute total is printed above each column so
 * the destroyed fact is still on screen.
 */
export function StackedBarChart({
  categories,
  series,
  label,
  height = 200,
  normalise = false,
  format = (v) => String(v),
  hiddenSeries = [],
  onHiddenSeriesChange,
  onSelect,
  zoomable = false,
  window: controlledWindow,
  onWindowChange,
  menuItems,
  className,
}: StackedBarChartProps): JSX.Element {
  const windowState = useChartWindow(categories.length, controlledWindow, onWindowChange);
  const shownCategories = zoomable ? windowState.slice(categories) : [...categories];
  const offset = zoomable ? windowState.window.start : 0;

  const drag = useDragZoom({
    total: Math.max(2, shownCategories.length),
    enabled: zoomable,
    onZoom: (range) => {
      windowState.setWindow({ start: offset + range.start, end: offset + range.end });
    },
  });
  // A hidden series is excluded from the totals as well as from the stack.
  // Leaving it in the total would make every visible segment a share of
  // something not on screen.
  const visible = series.filter((entry) => !hiddenSeries.includes(entry.label));
  const totals = shownCategories.map((_, position) =>
    visible.reduce((sum, entry) => sum + (entry.values[position + offset] ?? 0), 0),
  );
  const max = normalise ? 1 : Math.max(...totals) || 1;

  return (
    <ChartFrame
      label={label}
      rows={categories.map((category, index) => ({
        label: category,
        value: visible.reduce((sum, entry) => sum + (entry.values[index] ?? 0), 0),
      }))}
      {...(zoomable ? { window: windowState } : {})}
      {...(menuItems ? { menuItems } : {})}
      className={cn('w-full', className)}
    >
      {zoomable ? (
        <ChartZoomControls
          className="mb-2"
          state={windowState}
          total={categories.length}
          visibleLabels={shownCategories}
        />
      ) : null}

      {/* `items-stretch` and `h-full` columns: a percentage height needs a
          parent with a definite height, and `items-end` gave the columns a
          content height instead. */}
      <div
        className={cn(
          'relative flex items-stretch gap-2',
          zoomable && 'cursor-crosshair touch-none select-none',
        )}
        style={{ height }}
        {...(zoomable ? drag.handlers : {})}
      >
        <ChartMarquee marquee={drag.marquee} />
        {shownCategories.map((category, position) => {
          const index = position + offset;
          const total = totals[position] ?? 0;
          const columnHeight = normalise ? 100 : (total / max) * 100;

          return (
            <div key={category} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1">
              <span
                aria-hidden
                className="shrink-0 text-center text-2xs tabular-nums text-fg-muted"
              >
                {format(total)}
              </span>
              <div className="flex min-h-0 flex-1 items-end">
                <div
                  className="flex w-full flex-col-reverse overflow-hidden rounded-t-sm"
                  style={{ height: `max(${String(columnHeight)}%, 2px)` }}
                >
                  {visible.map((entry, seriesIndex) => {
                    const value = entry.values[index] ?? 0;
                    const share = total === 0 ? 0 : (value / total) * 100;
                    if (share === 0) return null;
                    const readout = `${category} · ${entry.label}: ${format(value)}`;
                    return (
                      <ChartMark key={entry.label} content={readout}>
                        <span
                          role={onSelect ? 'button' : 'img'}
                          aria-label={readout}
                          tabIndex={0}
                          onClick={
                            onSelect
                              ? () => {
                                  onSelect({ series: entry.label, category, value });
                                }
                              : undefined
                          }
                          className={cn(
                            'w-full origin-bottom transition-[height,opacity] duration-(--animate-duration-slow) ease-standard',
                            'motion-safe:animate-grow-y',
                            'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
                            onSelect && 'cursor-pointer hover:opacity-80',
                            bgTone[
                              entry.tone ?? stackOrder[seriesIndex % stackOrder.length] ?? 'accent'
                            ],
                          )}
                          style={{
                            height: `${String(share)}%`,
                            animationDelay: `min(calc(${String(index)} * 60ms), 320ms)`,
                          }}
                        />
                      </ChartMark>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div aria-hidden className="mt-1.5 flex gap-2">
        {shownCategories.map((category) => (
          <span
            key={category}
            className="min-w-0 flex-1 truncate text-center text-2xs text-fg-subtle"
          >
            {category}
          </span>
        ))}
      </div>

      <ChartLegend
        className="mt-3"
        items={series.map((entry, seriesIndex) => ({
          label: entry.label,
          tone: entry.tone ?? stackOrder[seriesIndex % stackOrder.length] ?? 'accent',
        }))}
        hidden={hiddenSeries}
        {...(onHiddenSeriesChange ? { onHiddenChange: onHiddenSeriesChange } : {})}
      />

      {/* One table per series rather than one table of stacks: a stacked
          column read aloud as five numbers with no structure is worse than
          five short tables with headers. */}
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

export interface HeatmapCell {
  /** Row key, a person, a team. */
  row: string;
  /** Column key, a date, a week. */
  column: string;
  value: number;
}

export interface HeatmapChartProps extends ChartInteractionProps {
  rows: readonly string[];
  columns: readonly string[];
  cells: readonly HeatmapCell[];
  label: string;
  tone?: ChartTone;
  /** Turns a value into its cell description: "3 days of leave". */
  describe?: (value: number, row: string, column: string) => string;
  /** Upper bound for the colour scale. Defaults to the largest value present. */
  max?: number;
  format?: (value: number) => string;
  onSelect?: (cell: HeatmapCell) => void;
  className?: string;
}

/**
 * Density over two dimensions: absence by person by week, cover by team by day.
 *
 * ### Colour is never the only channel here either
 *
 * Every cell carries a `title` and a screen-reader description, and the whole
 * grid is repeated as a table. A heatmap read only by colour is a heatmap that
 * excludes about 8% of men outright, and a further slice of everyone on a
 * projector or in sunlight.
 *
 * The scale is a single hue at varying opacity rather than a rainbow. A
 * red-to-green ramp encodes *two* things: hue and lightness, and the first
 * of them is exactly the one that fails.
 */
export function HeatmapChart({
  rows,
  columns,
  cells,
  label,
  tone = 'accent',
  describe,
  max,
  format = (v) => String(v),
  onSelect,
  zoomable = false,
  window: controlledWindow,
  onWindowChange,
  menuItems,
  className,
}: HeatmapChartProps): JSX.Element {
  const lookup = new Map(cells.map((cell) => [`${cell.row}|${cell.column}`, cell.value]));
  const ceiling = max ?? Math.max(...cells.map((cell) => cell.value), 1);

  // The columns are the axis, a heatmap of twelve weeks zooms to four weeks,
  // never to four people. Rows are a set, not a sequence.
  const windowState = useChartWindow(columns.length, controlledWindow, onWindowChange);
  const shownColumns = zoomable ? windowState.slice(columns) : [...columns];
  const offset = zoomable ? windowState.window.start : 0;

  const drag = useDragZoom({
    total: Math.max(2, shownColumns.length),
    enabled: zoomable,
    onZoom: (range) => {
      windowState.setWindow({ start: offset + range.start, end: offset + range.end });
    },
  });

  return (
    <ChartFrame
      label={label}
      rows={cells.map((cell) => ({ label: `${cell.row} · ${cell.column}`, value: cell.value }))}
      {...(zoomable ? { window: windowState } : {})}
      {...(menuItems ? { menuItems } : {})}
      className={cn('w-full', className)}
    >
      {zoomable ? (
        <ChartZoomControls
          className="mb-2"
          state={windowState}
          total={columns.length}
          visibleLabels={shownColumns}
        />
      ) : null}
      {/* The grid scrolls sideways rather than shrinking its cells: a 6px cell
          is a colour, not a datum. */}
      <div
        className={cn(
          'relative overflow-x-auto',
          zoomable && 'cursor-crosshair touch-none select-none',
        )}
        {...(zoomable ? drag.handlers : {})}
      >
        <ChartMarquee marquee={drag.marquee} />
        <table className="border-separate border-spacing-0.5">
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Row</span>
              </th>
              {shownColumns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="pb-1 text-center text-2xs font-normal text-fg-subtle"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row}>
                <th
                  scope="row"
                  className="pe-2 text-end text-xs font-normal whitespace-nowrap text-fg-muted"
                >
                  {row}
                </th>
                {shownColumns.map((column) => {
                  const value = lookup.get(`${row}|${column}`) ?? 0;
                  const intensity = ceiling === 0 ? 0 : value / ceiling;
                  const description =
                    describe?.(value, row, column) ?? `${row}, ${column}: ${format(value)}`;
                  return (
                    <td key={column} className="p-0">
                      <ChartMark content={description}>
                        <div
                          role={onSelect ? 'button' : 'img'}
                          aria-label={description}
                          tabIndex={0}
                          onClick={
                            onSelect
                              ? () => {
                                  onSelect({ row, column, value });
                                }
                              : undefined
                          }
                          className={cn(
                            // Grows where the pointer is a finger. 24px is a
                            // comfortable mouse target and a missed tap.
                            'size-6 touch:size-9 rounded-xs',
                            'transition-[opacity,transform] duration-(--animate-duration-normal)',
                            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus',
                            onSelect && 'cursor-pointer hover:scale-110',
                            value === 0 ? 'bg-surface-sunken' : bgTone[tone],
                          )}
                          // Opacity rather than a second colour: one channel,
                          // legible to everyone, and it composes with the theme.
                          style={value === 0 ? undefined : { opacity: 0.25 + intensity * 0.75 }}
                        />
                      </ChartMark>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div aria-hidden className="mt-3 flex items-center gap-2 text-2xs text-fg-subtle">
        <span>Less</span>
        {[0, 0.25, 0.5, 0.75, 1].map((step) => (
          <span
            key={step}
            className={cn('size-3 rounded-xs', step === 0 ? 'bg-surface-sunken' : bgTone[tone])}
            style={step === 0 ? undefined : { opacity: 0.25 + step * 0.75 }}
          />
        ))}
        <span>More · up to {format(ceiling)}</span>
      </div>
    </ChartFrame>
  );
}

export interface FunnelStage extends ChartPoint {
  tone?: ChartTone;
}

export interface FunnelChartProps extends ChartInteractionProps {
  data: readonly FunnelStage[];
  label: string;
  /** Prints the drop between consecutive stages. */
  showConversion?: boolean;
  format?: (value: number) => string;
  onSelect?: (stage: FunnelStage, index: number) => void;
  selectedIndex?: number;
  className?: string;
}

/**
 * A sequence people fall out of: applied → screened → onsite → offer → hired.
 *
 * ### Not a trapezoid
 *
 * The classic funnel shape encodes value as *area*, and people judge area
 * badly, a stage with half the count looks like a third. These are bars whose
 * length is the value, on a shared baseline, which is the comparison the eye
 * is actually good at. It happens to look like a funnel because the numbers
 * fall; if they do not fall, the chart says so instead of pretending.
 *
 * The conversion between consecutive stages is the number people are usually
 * after, so it is printed rather than left to be worked out.
 */
export function FunnelChart({
  data,
  label,
  showConversion = true,
  format = (v) => String(v),
  onSelect,
  selectedIndex,
  zoomable = false,
  window: controlledWindow,
  onWindowChange,
  menuItems,
  className,
}: FunnelChartProps): JSX.Element {
  const first = data[0]?.value ?? 0;
  const max = Math.max(...data.map((stage) => stage.value)) || 1;

  // A funnel is an ordered sequence, so it windows like one: useful on a
  // twelve-stage recruitment process, pointless on four. The overall
  // percentage still counts from the *real* first stage: a conversion measured
  // from the middle of a funnel is a number that means nothing.
  const windowState = useChartWindow(data.length, controlledWindow, onWindowChange);
  const shown = zoomable ? windowState.slice(data) : [...data];
  const offset = zoomable ? windowState.window.start : 0;

  const drag = useDragZoom({
    total: Math.max(2, shown.length),
    enabled: zoomable,
    orientation: 'vertical',
    onZoom: (range) => {
      windowState.setWindow({ start: offset + range.start, end: offset + range.end });
    },
  });

  return (
    <ChartFrame
      label={label}
      rows={data}
      {...(zoomable ? { window: windowState } : {})}
      {...(menuItems ? { menuItems } : {})}
      className={cn('w-full', className)}
    >
      {zoomable ? (
        <ChartZoomControls
          className="mb-2"
          state={windowState}
          total={data.length}
          visibleLabels={shown.map((stage) => stage.label)}
        />
      ) : null}

      <ol
        className={cn('relative space-y-1', zoomable && 'cursor-crosshair touch-none select-none')}
        {...(zoomable ? drag.handlers : {})}
      >
        <ChartMarquee marquee={drag.marquee} orientation="vertical" />
        {shown.map((stage, position) => {
          const index = position + offset;
          const previous = data[index - 1]?.value;
          const stepRate = previous === undefined || previous === 0 ? null : stage.value / previous;
          const overall = first === 0 ? null : stage.value / first;

          return (
            <li key={stage.label}>
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="truncate text-fg">{stage.label}</span>
                <span className="shrink-0 tabular-nums text-fg-muted">
                  {format(stage.value)}
                  {overall !== null && index > 0 ? (
                    <span className="ms-2 text-fg-subtle">{Math.round(overall * 100)}%</span>
                  ) : null}
                </span>
              </div>
              <ChartMark content={`${stage.label}: ${format(stage.value)}`}>
                <div
                  role={onSelect ? 'button' : 'img'}
                  aria-label={`${stage.label}: ${format(stage.value)}`}
                  tabIndex={0}
                  onClick={
                    onSelect
                      ? () => {
                          onSelect(stage, index);
                        }
                      : undefined
                  }
                  className={cn(
                    'mt-1 h-6 overflow-hidden rounded-sm bg-surface-sunken',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
                    onSelect && 'cursor-pointer',
                    selectedIndex !== undefined && selectedIndex !== index && 'opacity-60',
                  )}
                >
                  <div
                    className={cn(
                      'h-full origin-left rounded-sm',
                      'transition-[width,opacity] duration-(--animate-duration-slow) ease-standard',
                      'motion-safe:animate-grow-x',
                      bgTone[stage.tone ?? 'accent'],
                    )}
                    style={{
                      width: `max(${String((stage.value / max) * 100)}%, 2px)`,
                      animationDelay: `min(calc(${String(index)} * 60ms), 320ms)`,
                    }}
                  />
                </div>
              </ChartMark>
              {showConversion && stepRate !== null ? (
                <p className="mt-0.5 text-2xs text-fg-subtle">
                  {Math.round(stepRate * 100)}% of the previous stage ·{' '}
                  {format((previous ?? 0) - stage.value)} lost
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>

      <ChartDataTable caption={label} data={data} format={format} />
    </ChartFrame>
  );
}
