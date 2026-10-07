import { useMemo, useRef, useState } from 'react';
import { Text as CssText, View } from 'react-native-css/components';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Path, Polyline } from 'react-native-svg';

import { cn } from '../../lib/cn.ts';
import type { ChartCommonProps } from './bar-chart.tsx';
import {
  AxisLabels,
  ChartFrame,
  ChartGrid,
  ChartLegend,
  ChartZoomControls,
  decor,
  pct,
  Ink,
  useChartWindow,
  useWidth,
  WEB,
  type ChartPoint,
  type ChartWindow,
  type UseChartWindowResult,
} from './parts.tsx';
import { bgTone, inkTone, seriesTone, type ChartTone } from './tones.ts';

/** `M x,y L …` through every point. */
function linePath(points: readonly [number, number][]): string {
  return points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
}

/** Up to `count` labels, evenly spaced and always the first and the last. */
export function spreadLabels(labels: readonly string[], count = 5): string[] {
  if (labels.length <= count) return [...labels];
  return Array.from(
    { length: count },
    (_, i) => labels[Math.round((i * (labels.length - 1)) / (count - 1))] ?? '',
  );
}

export interface SparklineProps {
  data: readonly ChartPoint[];
  /** Names the trend for a screen reader. Required. */
  label: string;
  tone?: ChartTone;
  /** Fills under the line. Reads as volume rather than as a rate. */
  area?: boolean;
  /** Marks the final point, so "where it ended" survives being 80 wide. */
  showLastPoint?: boolean;
  /** In points. Fills its container when omitted. */
  width?: number;
  height?: number;
  format?: (value: number) => string;
  className?: string | undefined;
}

/**
 * A trend with no axes, sized to sit in a stat tile or a list row. A screen
 * reader hears the first and last value, not a picture.
 */
export function Sparkline({
  data,
  label,
  tone = 'chart-1',
  area = true,
  showLastPoint = true,
  width: fixed,
  height = 32,
  format = (value) => String(value),
  className,
}: SparklineProps): React.JSX.Element {
  const [measured, onLayout] = useWidth();
  const width = fixed ?? measured;
  const { points, line } = useMemo(() => {
    const values = data.map((d) => d.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const x = (i: number): number => (data.length > 1 ? (i / (data.length - 1)) * width : 0);
    // A flat series draws through the middle, not along the floor like a collapse.
    const y = (v: number): number =>
      max === min ? height / 2 : height - 3 - ((v - min) / span) * (height - 6);
    const at = data.map((d, i): [number, number] => [x(i), y(d.value)]);
    return { points: at, line: linePath(at) };
  }, [data, width, height]);
  const last = points.at(-1);
  const first = data[0];
  const end = data.at(-1);
  const said =
    first && end ? `${label}: from ${format(first.value)} to ${format(end.value)}` : label;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={said}
      {...(WEB ? { role: 'img', 'aria-label': said } : {})}
      onLayout={onLayout}
      className={cn(fixed === undefined && 'w-full', className)}
      style={{ height, ...(fixed === undefined ? {} : { width: fixed }) }}
    >
      {width > 0 && points.length > 1 ? (
        <Ink width={width} height={height} className={inkTone[tone]}>
          {area ? (
            <Path
              d={`${line} L${width.toFixed(1)},${String(height)} L0,${String(height)} Z`}
              fill="currentColor"
              fillOpacity={0.15}
            />
          ) : null}
          <Path
            d={line}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Ink>
      ) : null}
      {showLastPoint && last && width > 0 ? (
        <View
          {...decor}
          className={cn('absolute size-3 rounded-full border-[3px] border-surface', bgTone[tone])}
          style={{ left: last[0] - 6, top: last[1] - 6, width: 12, height: 12 }}
        />
      ) : null}
    </View>
  );
}

export interface TrendSeries {
  label: string;
  tone?: ChartTone;
  /** Dashed and never filled: a plan or a forecast beside the actuals. */
  dashed?: boolean;
  data: readonly ChartPoint[];
}

export interface TrendChartProps extends ChartCommonProps {
  series: readonly TrendSeries[];
  /** Height of the plot. 160 on a phone. */
  height?: number;
  /** Fills under the first line. Right for a headcount, wrong for a rate. */
  area?: boolean;
  /** Marks where each line ends, so "where it is now" reads at a glance. */
  showLastPoint?: boolean;
  /** Draws no gridlines: a small multiple, a thumbnail. */
  plain?: boolean;
  /** Labels under the axis. A handful, spread from the first period to the last, when omitted. */
  axisLabels?: readonly string[];
  /** Series switched off from the legend. Uncontrolled when omitted. */
  hiddenSeries?: readonly string[];
  /** The series hidden to start with, when the chart keeps its own set. */
  defaultHiddenSeries?: readonly string[];
  onHiddenSeriesChange?: (hidden: readonly string[]) => void;
  /** Shows the legend under the plot, as toggles when there is more than one series. */
  showLegend?: boolean;
  /** Fires with the period and every series' value at it, on a tap. */
  onSelect?: (selection: { index: number; label: string; values: Record<string, number> }) => void;
  /** The period a tap is reading out, to start with. */
  defaultInspectedIndex?: number;
  /** Pinch to zoom, drag to pan, and the zoom buttons above the plot. */
  zoomable?: boolean;
  /** An overview strip under the plot with the window drawn on it; drag it to pan. */
  brush?: boolean;
  /** The visible slice, as inclusive indices. Uncontrolled when omitted. */
  window?: ChartWindow;
  /** The window to start with, when the chart keeps its own. */
  defaultWindow?: ChartWindow;
  onWindowChange?: (window: ChartWindow) => void;
  /** The long-press menu, controlled. */
  menuOpen?: boolean;
  onMenuOpenChange?: (open: boolean) => void;
  /** The overlay host the menu draws in, when not the root one. */
  portalHost?: string;
}

/**
 * One or more lines over a shared period. A tap, or a finger dragged along
 * it, reads out the period under it, where the web hovers; a pinch zooms and
 * a drag pans when it is zoomable, with buttons and the long-press menu doing
 * the same for anyone who cannot pinch.
 */
export function TrendChart({
  series,
  label,
  summary,
  height = 160,
  area = false,
  showLastPoint = false,
  plain = false,
  axisLabels,
  hiddenSeries,
  defaultHiddenSeries = [],
  onHiddenSeriesChange,
  showLegend,
  onSelect,
  defaultInspectedIndex,
  zoomable = false,
  brush = false,
  window: controlledWindow,
  defaultWindow,
  onWindowChange,
  menuOpen,
  onMenuOpenChange,
  portalHost,
  format = (v) => String(v),
  menuItems,
  className,
}: TrendChartProps): React.JSX.Element {
  const periods = series[0]?.data.map((point) => point.label) ?? [];
  const total = periods.length;
  const [ownHidden, setOwnHidden] = useState<readonly string[]>(defaultHiddenSeries);
  const hidden = hiddenSeries ?? ownHidden;
  const setHidden = (next: readonly string[]): void => {
    if (hiddenSeries === undefined) setOwnHidden(next);
    onHiddenSeriesChange?.(next);
  };
  const windowState = useChartWindow(total, controlledWindow, onWindowChange, defaultWindow);
  const { start } = windowState.window;
  const [inspected, setInspected] = useState<number | undefined>(defaultInspectedIndex);
  const [width, onLayout] = useWidth();

  const toneOf = (entry: TrendSeries): ChartTone => entry.tone ?? seriesTone(series.indexOf(entry));
  const { end } = windowState.window;
  // The geometry, once per data, window and size: a tap that reads a value out
  // re-renders the chart, and recomputing every path for it would be waste.
  const { visible, shownPeriods, n, min, span, paths } = useMemo(() => {
    const on = series.filter((entry) => !hidden.includes(entry.label));
    const cut = <V,>(list: readonly V[]): V[] => list.slice(start, end + 1);
    const periodsShown = cut(periods);
    const count = periodsShown.length;
    const values = on.flatMap((entry) => cut(entry.data).map((p) => p.value));
    const top = values.length > 0 ? Math.max(...values) : 1;
    const bottom = values.length > 0 ? Math.min(...values) : 0;
    // A little air above and below, so a peak does not run along the top line.
    const pad = (top - bottom) * 0.12 || 1;
    const max = top + pad;
    const low = bottom >= 0 ? Math.max(0, bottom - pad) : bottom - pad;
    const range = max - low || 1;
    const px = (i: number): number => (count > 1 ? (i / (count - 1)) * width : 0);
    const py = (v: number): number => height - ((v - low) / range) * height;
    return {
      visible: on,
      shownPeriods: periodsShown,
      n: count,
      min: low,
      span: range,
      paths: new Map(
        on.map((entry) => [
          entry.label,
          linePath(cut(entry.data).map((p, i): [number, number] => [px(i), py(p.value)])),
        ]),
      ),
    };
    // `periods` is read off `series`, which is listed.
  }, [series, hidden, start, end, width, height]);
  const x = (i: number): number => (n > 1 ? (i / (n - 1)) * width : 0);
  const y = (v: number): number => height - ((v - min) / span) * height;
  const at = (px: number): number =>
    Math.min(n - 1, Math.max(0, Math.round((px / Math.max(width, 1)) * (n - 1))));

  // A scrub crosses a period every few frames: only a new one is news.
  const read = useRef(inspected);
  read.current = inspected;
  const inspect = (index: number): void => {
    if (index === read.current) return;
    read.current = index;
    setInspected(index);
    if (onSelect) {
      onSelect({
        index: start + index,
        label: shownPeriods[index] ?? '',
        values: Object.fromEntries(
          visible.map((entry) => [entry.label, windowState.slice(entry.data)[index]?.value ?? 0]),
        ),
      });
    }
  };

  // Pinch and pan move the window from where it was when the fingers landed.
  const origin = useRef(windowState.window);
  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((e) => {
      const index = at(e.x);
      if (read.current === index) {
        read.current = undefined;
        setInspected(undefined);
      } else inspect(index);
    });
  const drag = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-8, 8])
    .failOffsetY([-12, 12])
    .onBegin(() => {
      origin.current = windowState.window;
    })
    .onUpdate((e) => {
      if (zoomable && windowState.windowed) {
        const w = origin.current.end - origin.current.start;
        const delta = Math.round((e.translationX / Math.max(width, 1)) * w);
        const from = Math.max(0, Math.min(origin.current.start - delta, total - 1 - w));
        windowState.setWindow({ start: from, end: from + w });
      } else {
        inspect(at(e.x));
      }
    });
  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .enabled(zoomable)
    .onBegin(() => {
      origin.current = windowState.window;
    })
    .onUpdate((e) => {
      const centre = (origin.current.start + origin.current.end) / 2;
      const half = (origin.current.end - origin.current.start) / 2 / Math.max(e.scale, 0.05);
      windowState.setWindow({ start: Math.round(centre - half), end: Math.round(centre + half) });
    });
  const gesture = Gesture.Race(pinch, drag, tap);

  const shownInspected = inspected !== undefined && inspected < n ? inspected : undefined;
  const legendItems = series.map((entry) => ({
    label: entry.label,
    tone: toneOf(entry),
    ...(entry.dashed ? { dashed: true } : {}),
  }));
  const legend = showLegend ?? series.length > 1;

  return (
    <ChartFrame
      label={label}
      summary={summary}
      rows={(series[0]?.data ?? []).map((point, index) => ({
        label: point.label,
        value: visible.reduce((sum, entry) => sum + (entry.data[index]?.value ?? 0), 0),
      }))}
      format={format}
      {...(zoomable || brush ? { window: windowState } : {})}
      menuItems={menuItems}
      menuOpen={menuOpen}
      onMenuOpenChange={onMenuOpenChange}
      portalHost={portalHost}
      className={cn('w-full', className)}
    >
      {zoomable ? <ChartZoomControls state={windowState} className="mb-2 self-start" /> : null}
      <GestureDetector gesture={gesture}>
        <View onLayout={onLayout} className="relative" style={{ height }}>
          {plain ? null : <ChartGrid />}
          {width > 0
            ? visible.map((entry) => {
                const path = paths.get(entry.label) ?? '';
                const fill = area && !entry.dashed && series.indexOf(entry) === 0;
                return (
                  <Ink
                    key={entry.label}
                    width={width}
                    height={height}
                    className={inkTone[toneOf(entry)]}
                  >
                    {fill ? (
                      <Path
                        d={`${path} L${width.toFixed(1)},${String(height)} L0,${String(height)} Z`}
                        fill="currentColor"
                        fillOpacity={visible.length > 1 ? 0.12 : 0.18}
                      />
                    ) : null}
                    <Path
                      d={path}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={plain ? 2 : 2.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      {...(entry.dashed ? { strokeDasharray: '6 5' } : {})}
                    />
                  </Ink>
                );
              })
            : null}
          {showLastPoint && width > 0
            ? visible.map((entry) => {
                const last = windowState.slice(entry.data).at(-1);
                if (!last) return null;
                return (
                  <View
                    key={entry.label}
                    {...decor}
                    className={cn(
                      'pointer-events-none',
                      'absolute rounded-full border-[3px] border-surface',
                      bgTone[toneOf(entry)],
                    )}
                    style={{ left: width - 8, top: y(last.value) - 8, width: 16, height: 16 }}
                  />
                );
              })
            : null}
          {shownInspected !== undefined && width > 0 ? (
            <Inspection
              x={x(shownInspected)}
              width={width}
              period={shownPeriods[shownInspected] ?? ''}
              entries={visible.map((entry) => ({
                label: entry.label,
                tone: toneOf(entry),
                value: windowState.slice(entry.data)[shownInspected]?.value ?? 0,
              }))}
              y={y}
              format={format}
            />
          ) : null}
        </View>
      </GestureDetector>
      <AxisLabels labels={axisLabels ?? spreadLabels(shownPeriods)} />
      {legend ? (
        <ChartLegend
          items={legendItems}
          hidden={hidden}
          marker="line"
          {...(series.length > 1 && (onHiddenSeriesChange || hiddenSeries === undefined)
            ? { onHiddenChange: setHidden }
            : {})}
        />
      ) : null}
      {brush ? (
        <ChartBrush state={windowState} values={series[0]?.data.map((p) => p.value) ?? []} />
      ) : null}
    </ChartFrame>
  );
}

/** The tapped period: a hairline down the plot, a dot on each line, the values in a dark label. */
function Inspection({
  x,
  width,
  period,
  entries,
  y,
  format,
}: {
  x: number;
  width: number;
  period: string;
  entries: { label: string; tone: ChartTone; value: number }[];
  y: (v: number) => number;
  format: (v: number) => string;
}): React.JSX.Element {
  const right = x > width / 2;
  return (
    <>
      <View
        {...decor}
        className="pointer-events-none absolute top-0 bottom-0 w-px bg-border-strong"
        style={{ left: x }}
      />
      {entries.map((entry) => (
        <View
          key={entry.label}
          {...decor}
          className={cn(
            'pointer-events-none',
            'absolute rounded-full border-[3px] border-surface',
            bgTone[entry.tone],
          )}
          style={{ left: x - 9, top: y(entry.value) - 9, width: 18, height: 18 }}
        />
      ))}
      <View
        // Said, as the period changes, without moving focus.
        accessibilityLiveRegion="polite"
        {...(WEB ? { 'aria-live': 'polite' as const } : {})}
        className="pointer-events-none absolute top-1 z-20 rounded-[10px] bg-invert px-2.5 py-2"
        style={right ? { right: width - x + 14 } : { left: x + 14 }}
      >
        <CssText className="text-[12px] leading-[1.5] font-bold text-fg-on-invert">
          {period}
        </CssText>
        <CssText className="text-[12px] leading-[1.5] font-medium text-fg-on-invert tabular-nums">
          {entries.map((entry) => `${entry.label} ${format(entry.value)}`).join(' · ')}
        </CssText>
      </View>
    </>
  );
}

/**
 * The whole series in a strip under the plot, with the visible window drawn
 * over it. Drag the strip to move the window; a screen reader adjusts it
 * with the swipe-up and swipe-down actions.
 */
export function ChartBrush({
  state,
  values,
  className,
}: {
  state: UseChartWindowResult;
  values: readonly number[];
  className?: string | undefined;
}): React.JSX.Element {
  const [width, onLayout] = useWidth();
  const height = 40;
  const total = values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const points = values.map((v, i) => {
    const px = total > 1 ? (i / (total - 1)) * width : 0;
    const py = height - 4 - ((v - min) / (max - min || 1)) * 30;
    return `${px.toFixed(1)},${py.toFixed(1)}`;
  });
  const { start, end } = state.window;
  const left = total > 1 ? (start / (total - 1)) * 100 : 0;
  const right = total > 1 ? (end / (total - 1)) * 100 : 100;
  const origin = useRef(state.window);
  const move = (delta: number): void => {
    const w = state.window.end - state.window.start;
    const from = Math.max(0, Math.min(state.window.start + delta, total - 1 - w));
    state.setWindow({ start: from, end: from + w });
  };
  const pan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-4, 4])
    .onBegin(() => {
      origin.current = state.window;
    })
    .onUpdate((e) => {
      const w = origin.current.end - origin.current.start;
      const delta = Math.round((e.translationX / Math.max(width, 1)) * (total - 1));
      const from = Math.max(0, Math.min(origin.current.start + delta, total - 1 - w));
      state.setWindow({ start: from, end: from + w });
    });

  return (
    <GestureDetector gesture={pan}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Visible range"
        accessibilityValue={{
          text: `${String(start + 1)} to ${String(end + 1)} of ${String(total)}`,
        }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          move(event.nativeEvent.actionName === 'increment' ? 1 : -1);
        }}
        {...(WEB
          ? {
              role: 'slider',
              'aria-valuemin': 0,
              'aria-valuemax': Math.max(0, total - 1),
              'aria-valuenow': start,
              'aria-valuetext': `${String(start + 1)} to ${String(end + 1)} of ${String(total)}`,
            }
          : {})}
        onLayout={onLayout}
        className={cn('mt-3.5 overflow-hidden rounded-[10px] bg-surface-sunken', className)}
        style={{ height }}
      >
        {width > 0 ? (
          <Ink width={width} height={height} className="text-fg-subtle">
            <Polyline
              points={points.join(' ')}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            />
          </Ink>
        ) : null}
        <View
          {...decor}
          className="pointer-events-none absolute top-0 bottom-0 overflow-hidden rounded-[10px] border-2 border-accent"
          style={{ left: pct(left), width: pct(right - left) }}
        >
          <View className="absolute inset-0 bg-accent opacity-[0.18]" />
        </View>
      </View>
    </GestureDetector>
  );
}
