'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type JSX,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';
import { Tooltip } from '../tooltip/tooltip';
import {
  ChartBrush,
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

/**
 * The colour of a mark.
 *
 * Two families. `chart-1` … `chart-6` are the categorical palette: equal
 * lightness and chroma at six hues, so a series means "this one, not that one"
 * and none of them shouts. The status names (`success`, `danger` …) are for a
 * mark whose colour *is* the meaning, a loss in a waterfall or the worst step
 * in a funnel, and they point at the `-fg` end of each ramp (see below).
 */
export type ChartTone =
  | 'chart-1'
  | 'chart-2'
  | 'chart-3'
  | 'chart-4'
  | 'chart-5'
  | 'chart-6'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral';

/** The categorical order a multi-series chart hands out when a series names no tone. */
export const seriesTones: readonly ChartTone[] = [
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'chart-6',
];

export function seriesTone(index: number): ChartTone {
  return seriesTones[index % seriesTones.length] ?? 'chart-1';
}

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

// Status tones point at the `-fg` end of each ramp, not the base.
//
// A base tone is mixed to sit on its own tinted wash, which is right for a
// badge and wrong for a mark drawn straight onto the card: amber-600 on white
// measures 2.76:1, and a donut slice is a graphical object that WCAG 1.4.11
// asks 3:1 of. `neutral` already points at a foreground token and stays put.
//
// The categorical `chart-N` tones are the palette as the tokens define it.
// Three of them (2, 3 and 6) sit under 3:1 on a white card in the light theme,
// which is why every chart here also prints its values, labels its series in
// text, and carries a data table: the colour tells series apart, it is never
// the only way to read a number. `tools/a11y/contrast-sweep.mjs` measures the
// status tones; the categorical ones are a token decision, not a chart one.
export const fillTone: Record<ChartTone, string> = {
  'chart-1': 'fill-chart-1',
  'chart-2': 'fill-chart-2',
  'chart-3': 'fill-chart-3',
  'chart-4': 'fill-chart-4',
  'chart-5': 'fill-chart-5',
  'chart-6': 'fill-chart-6',
  accent: 'fill-accent-fg',
  success: 'fill-success-fg',
  warning: 'fill-warning-fg',
  danger: 'fill-danger-fg',
  info: 'fill-info-fg',
  neutral: 'fill-fg-subtle',
};

export const strokeTone: Record<ChartTone, string> = {
  'chart-1': 'stroke-chart-1',
  'chart-2': 'stroke-chart-2',
  'chart-3': 'stroke-chart-3',
  'chart-4': 'stroke-chart-4',
  'chart-5': 'stroke-chart-5',
  'chart-6': 'stroke-chart-6',
  accent: 'stroke-accent-fg',
  success: 'stroke-success-fg',
  warning: 'stroke-warning-fg',
  danger: 'stroke-danger-fg',
  info: 'stroke-info-fg',
  neutral: 'stroke-fg-subtle',
};

export const bgTone: Record<ChartTone, string> = {
  'chart-1': 'bg-chart-1',
  'chart-2': 'bg-chart-2',
  'chart-3': 'bg-chart-3',
  'chart-4': 'bg-chart-4',
  'chart-5': 'bg-chart-5',
  'chart-6': 'bg-chart-6',
  accent: 'bg-accent-fg',
  success: 'bg-success-fg',
  warning: 'bg-warning-fg',
  danger: 'bg-danger-fg',
  info: 'bg-info-fg',
  neutral: 'bg-fg-subtle',
};

const borderTone: Record<ChartTone, string> = {
  'chart-1': 'border-chart-1',
  'chart-2': 'border-chart-2',
  'chart-3': 'border-chart-3',
  'chart-4': 'border-chart-4',
  'chart-5': 'border-chart-5',
  'chart-6': 'border-chart-6',
  accent: 'border-accent-fg',
  success: 'border-success-fg',
  warning: 'border-warning-fg',
  danger: 'border-danger-fg',
  info: 'border-info-fg',
  neutral: 'border-fg-subtle',
};

/**
 * The same colours as CSS values, for the places a class cannot reach: a
 * `color-mix()` ramp in a heatmap cell, a gradient in a scale key.
 */
export const toneVar: Record<ChartTone, string> = {
  'chart-1': 'var(--color-chart-1)',
  'chart-2': 'var(--color-chart-2)',
  'chart-3': 'var(--color-chart-3)',
  'chart-4': 'var(--color-chart-4)',
  'chart-5': 'var(--color-chart-5)',
  'chart-6': 'var(--color-chart-6)',
  accent: 'var(--color-accent-fg)',
  success: 'var(--color-success-fg)',
  warning: 'var(--color-warning-fg)',
  danger: 'var(--color-danger-fg)',
  info: 'var(--color-info-fg)',
  neutral: 'var(--color-fg-subtle)',
};

/**
 * A tone at `percent` strength over the sunken fill: one hue, varying only in
 * strength, which is the single channel a heatmap should use.
 *
 * Mixed in Oklab, not Oklch: the neutral surfaces carry a hue of their own
 * (an explicit 0, or the brand's slight tint), and an Oklch mix interpolates
 * the hue towards it, which turned indigo pink half way.
 */
export function toneMix(tone: ChartTone, percent: number): string {
  const clamped = Math.round(Math.min(Math.max(percent, 0), 100));
  return `color-mix(in oklab, ${toneVar[tone]} ${String(clamped)}%, var(--color-surface-sunken))`;
}

/**
 * Soft gridlines behind a plot: hairlines in the quiet border colour, with the
 * baseline one step stronger so the zero the bars stand on reads as a floor.
 */
export function ChartGrid({ lines = 4 }: { lines?: number }): JSX.Element {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex flex-col justify-between">
      {Array.from({ length: Math.max(lines - 1, 0) }, (_, index) => (
        <span key={index} className="h-px bg-border" />
      ))}
      <span className="h-px bg-border-strong" />
    </div>
  );
}

/**
 * Axis labels thin out as the plot narrows: every other one is hidden (kept in
 * place, so the rest stay where their marks are) and the ones left may spill
 * into the empty slots beside them instead of truncating to "J…". The
 * threshold comes from the count, so nothing is measured; the class strings
 * are literal so Tailwind can see them.
 */
export function thinLabels(count: number): string {
  if (count <= 6) return '';
  if (count <= 9) {
    return '@max-[22rem]:[&>*:nth-child(even)]:invisible @max-[22rem]:[&>*]:overflow-visible';
  }
  if (count <= 13) {
    return '@max-[30rem]:[&>*:nth-child(even)]:invisible @max-[30rem]:[&>*]:overflow-visible';
  }
  return '@max-[44rem]:[&>*:nth-child(even)]:invisible @max-[44rem]:[&>*]:overflow-visible';
}

/** The key under a heatmap: the ramp from nothing to the most, with its ends named. */
export function ChartScaleKey({
  tone,
  low,
  high,
}: {
  tone: ChartTone;
  low: string;
  high: string;
}): JSX.Element {
  return (
    <div
      aria-hidden
      className="mt-3 flex items-center gap-2 text-[11px] font-medium text-fg-subtle"
    >
      <span className="whitespace-nowrap">{low}</span>
      <span
        className="h-2 max-w-40 min-w-6 flex-[0_1_10rem] rounded-full"
        style={{
          background: `linear-gradient(90deg, var(--color-surface-sunken), ${toneVar[tone]})`,
        }}
      />
      <span className="whitespace-nowrap">{high}</span>
    </div>
  );
}

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
/**
 * Under a finger, an axis chart keeps every mark at the tap floor and scrolls
 * sideways instead of squeezing them. Twelve months in 340px is twelve 28px
 * targets and a smear; the same twelve at 44px each, in a strip that scrolls,
 * is a chart a thumb can use. Under a mouse this is an ordinary block.
 *
 * `marks` is how many columns the plot draws; `pitch` is each column's width
 * at the floor, gap included; `gutter` is whatever sits beside the columns (a
 * value axis).
 */
function TouchScroll({
  marks,
  pitch = 2.75,
  gutter = 0,
  children,
}: {
  marks: number;
  pitch?: number;
  gutter?: number;
  children: ReactNode;
}): JSX.Element {
  const style: CSSProperties & { '--chart-min': string } = {
    '--chart-min': `${String(marks * pitch + gutter)}rem`,
  };
  return (
    <div className="touch:overflow-x-auto touch:overscroll-x-contain">
      <div className="touch:min-w-(--chart-min)" style={style}>
        {children}
      </div>
    </div>
  );
}

export function ChartMark({
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
  /** Drawn as a dashed stroke: a plan, a forecast, anything not yet measured. */
  dashed?: boolean;
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
 *
 * `marker="line"` draws a short stroke rather than a square, so the key of a
 * line chart looks like the thing it keys.
 */
export function ChartLegend({
  items,
  hidden = [],
  onHiddenChange,
  marker = 'square',
  className,
}: {
  items: readonly ChartLegendItem[];
  hidden?: readonly string[];
  onHiddenChange?: (hidden: readonly string[]) => void;
  marker?: 'square' | 'line';
  className?: string;
}): JSX.Element {
  const toggle = (label: string): void => {
    onHiddenChange?.(
      hidden.includes(label) ? hidden.filter((entry) => entry !== label) : [...hidden, label],
    );
  };

  return (
    <ul
      className={cn('flex flex-wrap gap-y-2', onHiddenChange ? 'gap-x-1.5' : 'gap-x-4', className)}
    >
      {items.map((item) => {
        const off = hidden.includes(item.label);
        const swatch = (
          <>
            <span
              aria-hidden
              className={cn(
                'w-2.5 shrink-0 transition-colors duration-(--animate-duration-fast)',
                item.dashed
                  ? cn(
                      'h-0 border-t-2 border-dashed',
                      off ? 'border-fg-disabled' : borderTone[item.tone],
                    )
                  : cn(
                      'rounded-[3px]',
                      marker === 'line' ? 'h-[3px]' : 'h-2.5',
                      off ? 'bg-surface-active' : bgTone[item.tone],
                    ),
              )}
            />
            <span className={cn('truncate', off && 'line-through')}>{item.label}</span>
          </>
        );

        return (
          <li key={item.label}>
            {onHiddenChange ? (
              <button
                type="button"
                // `aria-pressed` reads as "shown" or "not shown". Strike-through
                // as well as the grey swatch, because a legend that says which
                // series are off only in grey says it to nobody in sunlight.
                aria-pressed={!off}
                onClick={() => {
                  toggle(item.label);
                }}
                className={cn(
                  // A pill at rest, grown to the tap floor under a finger
                  // without drawing any bigger.
                  'relative tap-target flex h-7 items-center gap-1.5 rounded-control bg-surface-sunken px-2.5',
                  'text-xs font-medium',
                  off ? 'text-fg-subtle' : 'text-fg-muted',
                  'transition-colors duration-(--animate-duration-fast)',
                  'hover:bg-surface-hover hover:text-fg',
                  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus',
                )}
              >
                {swatch}
              </button>
            ) : (
              <span className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
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
    <div className="sr-only">
      <table>
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
    </div>
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
  tone = 'chart-1',
  area = true,
  showLastPoint = true,
  className,
  format = (value) => String(value),
}: SparklineProps): JSX.Element {
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
        {area ? (
          <path
            d={`${line} L ${String(lastX)},32 L 0,32 Z`}
            className={cn(fillTone[tone], 'opacity-15 motion-safe:animate-fade-in')}
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
          className={cn(strokeTone[tone], 'motion-safe:animate-draw-line')}
        />
      </svg>
      {showLastPoint ? (
        // HTML, not an SVG circle: the plot is stretched, and a circle in a
        // stretched viewBox is an ellipse.
        <span
          aria-hidden
          className={cn(
            'absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-3 ring-surface',
            bgTone[tone],
          )}
          style={{ left: `${String(lastX)}%`, top: `${String((lastY / 32) * 100)}%` }}
        />
      ) : null}
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
  /**
   * Draws one bar in the series colour and the rest in a quiet tint, to point
   * at a period without taking the others away: "this month", "the median".
   */
  highlightIndex?: number;
  /**
   * Bars 2px apart and as wide as their column. For a histogram, where the
   * ranges are continuous and a gap would say they are not.
   */
  touching?: boolean;
  /**
   * Periods from this index on have not happened yet. They keep their slot on
   * the axis, drawn as a quiet placeholder, so a year-to-date chart still
   * reads as a year.
   */
  futureFrom?: number;
  /** Paints a bar under the reference line in the warning tone. */
  warnBelowReference?: boolean;
  /** What the chart shows, in a sentence, read before the data table. */
  summary?: string;
}

/**
 * Categorical comparison.
 *
 * Laid out with CSS grid and percentage heights rather than SVG, deliberately:
 * the bars then reflow with the container at any width, the labels are real
 * text that wraps and truncates like text, and each bar can be a real
 * `<button>` when the chart is interactive, none of which is true of a `<rect>`.
 *
 * Bars stop growing at 32px wide. A bar is read by its height; past a certain
 * width it becomes a block, and a chart of five blocks reads as a floor plan.
 */
export function BarChart({
  data,
  label,
  tone = 'chart-1',
  height = 200,
  showValues = false,
  reference,
  format = (v) => String(v),
  className,
  onSelect,
  selectedIndex,
  highlightIndex,
  touching = false,
  futureFrom,
  warnBelowReference = false,
  summary,
  zoomable = false,
  window: controlledWindow,
  onWindowChange,
  menuItems,
}: BarChartProps): JSX.Element {
  const windowState = useChartWindow(data.length, controlledWindow, onWindowChange);
  const shown = zoomable ? windowState.slice(data) : [...data];
  // Headroom over the tallest bar, so it does not touch the top gridline and a
  // printed value above it has somewhere to sit.
  const max = Math.max(...shown.map((d) => d.value), reference?.value ?? 0) * 1.1 || 1;

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

  const gap = touching ? 'gap-0.5' : 'gap-2 touch:gap-1.5';

  return (
    <ChartFrame
      label={label}
      rows={data}
      {...(summary === undefined ? {} : { summary })}
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

      {/* Only a chart whose bars are buttons needs each one at the tap floor;
          a read-only chart fits the phone like any other block. */}
      <TouchScroll marks={onSelect ? shown.length : 0} pitch={3.125}>
        {/*
         * `items-stretch`, and every column is `h-full`. With `items-end` the
         * columns were content-height, so the bars' percentage heights had
         * nothing to resolve against and every bar collapsed to its 2px floor.
         * A percentage height needs a parent with a definite height, every time.
         */}
        <div
          className={cn(
            'relative flex items-stretch',
            gap,
            zoomable && 'cursor-crosshair touch-none select-none',
          )}
          style={{ height }}
          {...(zoomable ? drag.handlers : {})}
        >
          <ChartGrid />
          <ChartMarquee marquee={drag.marquee} />

          {reference ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-dashed border-fg-muted"
              style={{ bottom: `${String((reference.value / max) * 100)}%` }}
            >
              <span className="absolute -top-6 end-0 rounded-xs bg-surface px-1.5 py-0.5 text-xs font-semibold text-fg-muted">
                {reference.label}
              </span>
            </div>
          ) : null}

          {shown.map((point, index) => {
            const percent = (point.value / max) * 100;
            const selected = selectedIndex === index;
            const dimmed = selectedIndex !== undefined && !selected;
            const quiet = highlightIndex !== undefined && highlightIndex !== index;
            const future = futureFrom !== undefined && index >= futureFrom;
            const below =
              warnBelowReference && reference !== undefined && point.value < reference.value;
            const readout = `${point.label}: ${format(point.value)}`;

            const bar = (
              <span
                className={cn(
                  'block w-full origin-bottom rounded-t-[7px] rounded-b-[3px]',
                  !touching && 'mx-auto max-w-8',
                  'transition-[height,background-color,opacity] duration-(--animate-duration-slow) ease-standard',
                  'motion-safe:animate-grow-y',
                  dimmed || future
                    ? 'bg-surface-active'
                    : below
                      ? 'bg-warning-fg'
                      : quiet
                        ? 'bg-accent-subtle-hover'
                        : bgTone[tone],
                  onSelect && 'group-hover:opacity-85',
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

            const focusRing =
              'rounded-t-[7px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus';

            return (
              <div
                key={point.label}
                className="relative flex h-full min-w-0 flex-1 flex-col justify-end gap-1"
              >
                {selected ? (
                  // The chosen bar says its own number, in a dark pill over the
                  // bar, so a click answers "how many" without a hover.
                  <span
                    aria-hidden
                    className="absolute start-1/2 z-10 -translate-x-1/2 rounded-[8px] bg-invert px-2 py-1 text-xs leading-none font-bold whitespace-nowrap tabular-nums text-fg-on-invert"
                    style={{ bottom: `calc(${String(percent)}% + 8px)` }}
                  >
                    {format(point.value)}
                  </span>
                ) : null}
                {showValues ? (
                  <span
                    aria-hidden
                    className="shrink-0 text-center text-[11px] font-semibold tabular-nums text-fg-muted"
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
                        className={cn(
                          'group flex h-full w-full items-end',
                          focusRing,
                          selected &&
                            '[&>span]:outline-2 [&>span]:outline-offset-2 [&>span]:outline-accent',
                        )}
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
                        className={cn('flex h-full w-full items-end', focusRing)}
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

        <div aria-hidden className={cn('@container mt-2 flex', gap, thinLabels(shown.length))}>
          {shown.map((point, index) => (
            <span
              key={point.label}
              className={cn(
                'min-w-0 flex-1 truncate text-center text-[11px] font-medium',
                highlightIndex === index ? 'text-fg' : 'text-fg-subtle',
              )}
            >
              {point.label}
            </span>
          ))}
        </div>
      </TouchScroll>

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
  const stroke = Math.round(size * (thin ? 0.08 : 0.13));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  // `pathLength="1"` renormalises the circle so every dash figure below is a
  // fraction of the whole ring rather than a length in pixels. That is what
  // lets one keyframe animate a slice of any size, and it makes the arithmetic
  // here read as percentages of a total, which is what a donut *is*.
  const gap = data.length > 1 ? Math.min(2 / circumference, 0.01) : 0;

  // Where each arc begins, as a fraction of the ring. Accumulated rather than
  // derived per slice so a rounding error cannot open a seam.
  let offset = 0;

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
                  strokeTone[slice.tone ?? seriesTone(index)],
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
        {center === null ? null : (
          <div className="absolute inset-0 grid place-items-center text-center">
            {typeof center === 'string' || typeof center === 'number' ? (
              // A bare figure is set as the headline it is, sized to the ring
              // rather than to the page; anything richer is the caller's.
              <span>
                <span className="block font-display text-[17cqi] leading-none font-bold tracking-[-0.03em] tabular-nums">
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

      <ul className={cn('min-w-0 flex-[1_1_10.5rem]', !showLegend && 'hidden')}>
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

      <ChartDataTable caption={label} data={data} format={format} />
    </ChartFrame>
  );
}

export interface TrendChartProps extends ChartInteractionProps {
  series: readonly {
    label: string;
    tone?: ChartTone;
    /** Dashed and never filled: a plan or a forecast beside the actuals. */
    dashed?: boolean;
    data: readonly ChartPoint[];
  }[];
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
  /** Marks where each line ends, so "where it is now" reads at a glance. */
  showLastPoint?: boolean;
  /** What the chart shows, in a sentence, read before the data tables. */
  summary?: string;
  /**
   * Series switched off from the legend. Uncontrolled when omitted, the chart
   * keeps its own set, which is what a dashboard usually wants.
   */
  hiddenSeries?: readonly string[];
  onHiddenSeriesChange?: (hidden: readonly string[]) => void;
  /** Fires with the period and every series' value at it. */
  onSelect?: (selection: { index: number; label: string; values: Record<string, number> }) => void;
  /**
   * An overview strip under the plot: the whole of the first visible series,
   * with the window drawn over it. Drag its edges or its body, or draw a new
   * range on it; each part is also a keyboard slider. It drives the same
   * `window` as `zoomable`, and the two combine.
   */
  brush?: boolean;
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
  showLastPoint = false,
  summary,
  hiddenSeries,
  onHiddenSeriesChange,
  onSelect,
  window: controlledWindow,
  onWindowChange,
  zoomable = false,
  brush = false,
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
  const top = values.length > 0 ? Math.max(...values) : 1;
  const bottom = values.length > 0 ? Math.min(...values) : 0;
  // A little air above and below the data, so a line at its peak does not run
  // along the top gridline and read as clipped. Never below zero for a series
  // that never is: a headcount axis reading "-4" is a small lie.
  const pad = (top - bottom) * 0.12 || 1;
  const max = top + pad;
  const min = bottom >= 0 ? Math.max(0, bottom - pad) : bottom - pad;
  const span = max - min || 1;
  const ticks = [max, min + (span * 2) / 3, min + span / 3, min];
  const toneOf = (entry: (typeof series)[number]): ChartTone =>
    entry.tone ?? seriesTone(series.indexOf(entry));

  const step = shownPeriods.length > 1 ? 100 / (shownPeriods.length - 1) : 0;

  const readoutFor = (index: number): Record<string, number> =>
    Object.fromEntries(visible.map((entry) => [entry.label, slice(entry.data)[index]?.value ?? 0]));

  return (
    <ChartFrame
      label={label}
      {...(summary === undefined ? {} : { summary })}
      rows={(series[0]?.data ?? []).map((point, index) => ({
        label: point.label,
        value: visible.reduce((sum, entry) => sum + (entry.data[index]?.value ?? 0), 0),
      }))}
      {...(zoomable || brush ? { window: windowState } : {})}
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

      <TouchScroll marks={shownPeriods.length} gutter={2.5}>
        <div className="flex gap-2">
          <div
            aria-hidden
            className="flex shrink-0 flex-col justify-between text-[11px] leading-none font-medium tabular-nums text-fg-subtle"
            style={{ height }}
          >
            {ticks.map((tick, index) => (
              <span key={index} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
                {format(Math.round(tick))}
              </span>
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
            <ChartGrid lines={ticks.length} />

            <svg
              aria-hidden
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 size-full overflow-visible"
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
                    {area && entry.dashed !== true ? (
                      <path
                        d={`${path} L 100,100 L 0,100 Z`}
                        className={cn(
                          fillTone[toneOf(entry)],
                          visible.length > 1 ? 'opacity-12' : 'opacity-18',
                          'motion-safe:animate-fade-in',
                        )}
                        stroke="none"
                      />
                    ) : null}
                    <path
                      d={path}
                      fill="none"
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      // Drawn in with a wipe from the left, so the dashed
                      // plan draws the same way as the solid line.
                      {...(entry.dashed === true ? { strokeDasharray: '6 5' } : {})}
                      className={cn(strokeTone[toneOf(entry)], 'motion-safe:animate-draw-line')}
                    />
                  </g>
                );
              })}
            </svg>

            {showLastPoint
              ? visible.map((entry) => {
                  const last = slice(entry.data).at(-1);
                  if (!last) return null;
                  return (
                    <span
                      key={entry.label}
                      aria-hidden
                      className={cn(
                        'absolute end-0 size-2.5 translate-x-1/2 -translate-y-1/2 rounded-full ring-3 ring-surface',
                        bgTone[toneOf(entry)],
                      )}
                      style={{ top: `${String(100 - ((last.value - min) / span) * 100)}%` }}
                    />
                  );
                })
              : null}

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
                              'absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-3 ring-surface',
                              bgTone[toneOf(entry)],
                              'transition-[opacity,transform] duration-(--animate-duration-fast)',
                              active ? 'opacity-100' : 'opacity-0',
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

        <div
          aria-hidden
          className={cn(
            '@container mt-2 flex justify-between ps-8 text-[11px] font-medium text-fg-subtle',
            thinLabels(shownPeriods.length),
          )}
        >
          {shownPeriods.map((period) => (
            <span key={period}>{period}</span>
          ))}
        </div>
      </TouchScroll>

      {brush ? (
        <ChartBrush
          state={windowState}
          values={(visible[0] ?? series[0])?.data.map((point) => point.value) ?? []}
          labels={periods}
        />
      ) : null}

      {series.length > 1 ? (
        <ChartLegend
          className="mt-3"
          marker="line"
          items={series.map((entry) => ({
            label: entry.label,
            tone: toneOf(entry),
            ...(entry.dashed === true ? { dashed: true } : {}),
          }))}
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
  /**
   * A bar's own colour, where it is the meaning: the one value being judged
   * in `warning` against its comparisons in `neutral`. Its label still has to
   * say which it is; colour alone tells one reader in twelve nothing.
   */
  toneOf?: (point: ChartPoint) => ChartTone;
  onSelect?: (point: ChartPoint, index: number) => void;
  selectedIndex?: number;
  className?: string;
}

/**
 * A ranking, or a comparison: `sorted={false}` and `toneOf` set one value
 * against the figures it is judged by.
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
  tone = 'chart-1',
  showValues = true,
  sorted = true,
  limit,
  format = (v) => String(v),
  toneOf,
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
          'relative space-y-2.5 touch:space-y-3',
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
               * can compare their lengths. Narrower under a finger, where the
               * phone needs the width for the bar.
               */}
              <span className="w-[120px] shrink-0 truncate text-start text-sm font-medium text-fg-muted touch:w-[88px]">
                {point.label}
              </span>
              <span className="relative h-5 min-w-0 flex-1 touch:h-[22px]">
                <span
                  className={cn(
                    'absolute inset-y-0 start-0 origin-left rounded-xs',
                    'transition-[width,opacity] duration-(--animate-duration-slow) ease-standard',
                    'motion-safe:animate-grow-x',
                    bgTone[toneOf?.(point) ?? tone],
                    selectedIndex !== undefined && !selected && 'opacity-40',
                  )}
                  style={{
                    width: `max(${String((point.value / max) * 100)}%, 2px)`,
                    animationDelay: `min(calc(${String(index)} * 40ms), 320ms)`,
                  }}
                />
              </span>
              {showValues ? (
                <span className="w-[52px] shrink-0 text-end text-sm font-semibold tabular-nums text-fg">
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
                    className="flex w-full touch:min-h-tap items-center gap-3 rounded-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                  >
                    <span className="sr-only">{readout}</span>
                    {row}
                  </button>
                ) : (
                  <span
                    tabIndex={0}
                    role="img"
                    aria-label={readout}
                    className="flex w-full items-center gap-3 rounded-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
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
          'relative flex items-stretch gap-2 touch:gap-1.5',
          zoomable && 'cursor-crosshair touch-none select-none',
        )}
        style={{ height }}
        {...(zoomable ? drag.handlers : {})}
      >
        <ChartGrid />
        <ChartMarquee marquee={drag.marquee} />
        {shownCategories.map((category, position) => {
          const index = position + offset;
          const total = totals[position] ?? 0;
          const columnHeight = normalise ? 100 : (total / max) * 100;

          return (
            <div key={category} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1">
              <span
                aria-hidden
                className="shrink-0 text-center text-[11px] font-semibold tabular-nums text-fg-muted"
              >
                {format(total)}
              </span>
              <div className="flex min-h-0 flex-1 items-end">
                <div
                  className="mx-auto flex w-full max-w-8 flex-col-reverse gap-0.5 overflow-hidden rounded-t-[7px] rounded-b-[3px]"
                  style={{ height: `max(${String(columnHeight)}%, 2px)` }}
                >
                  {visible.map((entry) => {
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
                            'min-h-0.5 w-full basis-0 origin-bottom rounded-[2px] transition-[flex-grow,opacity] duration-(--animate-duration-slow) ease-standard',
                            'motion-safe:animate-grow-y',
                            'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
                            onSelect && 'cursor-pointer hover:opacity-80',
                            bgTone[entry.tone ?? seriesTone(series.indexOf(entry))],
                          )}
                          style={{
                            flexGrow: share,
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

      <div aria-hidden className="mt-2 flex gap-2 touch:gap-1.5">
        {shownCategories.map((category) => (
          <span
            key={category}
            className="min-w-0 flex-1 truncate text-center text-[11px] font-medium text-fg-subtle"
          >
            {category}
          </span>
        ))}
      </div>

      <ChartLegend
        className="mt-3"
        items={series.map((entry, seriesIndex) => ({
          label: entry.label,
          tone: entry.tone ?? seriesTone(seriesIndex),
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
  /**
   * Prints each value in its cell. The ramp then stops at 60% strength, so the
   * darkest cell still carries its number at text contrast in either theme.
   */
  showValues?: boolean;
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
  tone = 'chart-1',
  describe,
  showValues = false,
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
        <table className="border-separate border-spacing-[3px]">
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
                  className="pb-1 text-center text-[11px] font-medium text-fg-subtle"
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
                  className="pe-2 text-start text-xs font-medium whitespace-nowrap text-fg-muted"
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
                            // Grows where the pointer is a finger, to the tap
                            // floor. 24px is a comfortable mouse target and a
                            // missed tap; the table scrolls sideways instead.
                            'size-6 touch:size-11 rounded-[6px] touch:rounded-[5px]',
                            'transition-[opacity,transform] duration-(--animate-duration-normal)',
                            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus',
                            onSelect && 'cursor-pointer hover:scale-110',
                            'bg-surface-sunken motion-safe:animate-fade-in',
                            showValues &&
                              'grid place-items-center text-[11px] font-semibold tabular-nums text-fg',
                          )}
                          // One hue mixed into the sunken fill by value: one
                          // channel, and it resolves against either theme.
                          style={
                            value === 0
                              ? undefined
                              : {
                                  background: toneMix(
                                    tone,
                                    showValues ? 10 + intensity * 50 : 15 + intensity * 85,
                                  ),
                                }
                          }
                        >
                          {showValues ? format(value) : null}
                        </div>
                      </ChartMark>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ChartScaleKey tone={tone} low="Less" high={`More · up to ${format(ceiling)}`} />
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
  /** Paints the stage with the worst step conversion in the danger tone, and says so. */
  highlightBiggestDrop?: boolean;
  /** The colour of every stage that names none of its own. */
  tone?: ChartTone;
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
  highlightBiggestDrop = false,
  tone = 'chart-1',
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
  // The stage that loses the largest share of the one before it. A share, not
  // a count: losing 40 of 50 is a worse step than losing 100 of 1,000.
  let biggestDrop = -1;
  let lowestRate = Infinity;
  data.forEach((stage, index) => {
    const previous = data[index - 1]?.value;
    if (previous === undefined || previous === 0) return;
    const rate = stage.value / previous;
    if (rate < lowestRate) {
      lowestRate = rate;
      biggestDrop = index;
    }
  });

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
        className={cn(
          '@container relative flex flex-col gap-1.5',
          zoomable && 'cursor-crosshair touch-none select-none',
        )}
        {...(zoomable ? drag.handlers : {})}
      >
        <ChartMarquee marquee={drag.marquee} orientation="vertical" />
        {shown.map((stage, position) => {
          const index = position + offset;
          const previous = data[index - 1]?.value;
          const stepRate = previous === undefined || previous === 0 ? null : stage.value / previous;
          const overall = first === 0 ? null : stage.value / first;
          const worst = highlightBiggestDrop && index === biggestDrop;
          const grew = stepRate !== null && stepRate > 1;
          const readout = `${stage.label}: ${format(stage.value)}`;
          const StepIcon = grew ? ArrowUp : ArrowDown;

          return (
            <li key={stage.label}>
              {showConversion && stepRate !== null ? (
                <p
                  className={cn(
                    'mb-1.5 flex items-center gap-1.5 ps-[132px] text-xs font-semibold touch:ps-0 @max-[26rem]:ps-0',
                    worst ? 'text-danger-fg' : grew ? 'text-warning-fg' : 'text-fg-subtle',
                  )}
                >
                  <StepIcon aria-hidden className="size-3 shrink-0" />
                  {Math.round(stepRate * 100)}%{' '}
                  {grew
                    ? '· more than the step before'
                    : `continue · ${format((previous ?? 0) - stage.value)} lost`}
                  {worst ? ' · biggest drop' : null}
                </p>
              ) : null}
              <div className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3 touch:grid-cols-1 touch:gap-1.5 @max-[26rem]:grid-cols-1 @max-[26rem]:gap-1.5">
                <span className="truncate text-sm font-medium text-fg-muted">{stage.label}</span>
                <ChartMark content={readout}>
                  <div
                    role={onSelect ? 'button' : 'img'}
                    aria-label={readout}
                    tabIndex={0}
                    onClick={
                      onSelect
                        ? () => {
                            onSelect(stage, index);
                          }
                        : undefined
                    }
                    className={cn(
                      'relative tap-target flex min-w-0 items-center gap-2.5 rounded-[8px]',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
                      onSelect && 'cursor-pointer',
                      selectedIndex !== undefined && selectedIndex !== index && 'opacity-50',
                    )}
                  >
                    <span
                      className={cn(
                        'h-[30px] origin-left rounded-[8px] touch:h-[26px]',
                        'transition-[width,opacity] duration-(--animate-duration-slow) ease-standard',
                        'motion-safe:animate-grow-x',
                        worst ? 'bg-danger-fg' : bgTone[stage.tone ?? tone],
                      )}
                      style={{
                        // The bar leaves room for its own figure at the end,
                        // so the widest stage never pushes its number off.
                        width: `max(calc((100% - 4.5rem) * ${String(stage.value / max)}), 4px)`,
                        // Each stage a shade lighter than the last: the eye
                        // reads the sequence as one thing thinning out.
                        opacity: worst ? 1 : Math.max(1 - index * 0.1, 0.5),
                        animationDelay: `min(calc(${String(index)} * 60ms), 320ms)`,
                      }}
                    />
                    <span className="shrink-0 text-sm font-semibold whitespace-nowrap tabular-nums text-fg">
                      {format(stage.value)}
                      {overall !== null && index > 0 ? (
                        <span className="ms-1.5 text-xs font-medium text-fg-muted">
                          {Math.round(overall * 100)}%
                        </span>
                      ) : null}
                    </span>
                  </div>
                </ChartMark>
              </div>
            </li>
          );
        })}
      </ol>

      <ChartDataTable caption={label} data={data} format={format} />
    </ChartFrame>
  );
}
