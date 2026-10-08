import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native-css/components';
import { Path } from 'react-native-svg';

import { cn } from '../../lib/cn.ts';
import type { StackedSeries } from './bar-chart.tsx';
import {
  AxisLabels,
  ChartFrame,
  ChartGrid,
  ChartLegend,
  ChartReadout,
  decor,
  Ink,
  pct,
  useWidth,
} from './parts.tsx';
import { bgTone, inkTone, seriesTone, type ChartTone } from './tones.ts';
import { spreadLabels } from './trend-chart.tsx';

export interface ComboPoint {
  label: string;
  /** What the axis prints where the label does not fit. */
  axisLabel?: string;
  bar: number;
  line: number;
}

export interface ComboChartProps {
  data: readonly ComboPoint[];
  label: string;
  /** What the bars count, with the axis it reads against: "Hires (left)". */
  barLabel: string;
  /** What the line measures: "Attrition % (right)". */
  lineLabel: string;
  formatBar?: (value: number) => string;
  formatLine?: (value: number) => string;
  /** Quiet by default, so the line reads over it. */
  barTone?: ChartTone | 'quiet';
  lineTone?: ChartTone;
  height?: number;
  summary?: string;
  className?: string | undefined;
}

/**
 * Bars and a line over one period, when two measures share time but not a
 * unit. Each has its own scale, so both are named in the legend with the side
 * they read against, and a tap on a period says both values in words.
 */
export function ComboChart({
  data,
  label,
  barLabel,
  lineLabel,
  formatBar = (v) => String(v),
  formatLine = (v) => String(v),
  barTone = 'quiet',
  lineTone = 'chart-4',
  height = 160,
  summary,
  className,
}: ComboChartProps): React.JSX.Element {
  const [width, onLayout] = useWidth();
  const [inspected, setInspected] = useState<number | undefined>();
  const n = data.length;
  const gap = 6;
  const barMax = Math.max(...data.map((d) => d.bar)) * 1.1 || 1;
  const lineMax = Math.max(...data.map((d) => d.line)) * 1.2 || 1;
  const column = (width - gap * (n - 1)) / Math.max(n, 1);
  const cx = (i: number): number => i * (column + gap) + column / 2;
  const cy = (v: number): number => height - (v / lineMax) * height;
  // The line, once per data and size: a tap on a bar re-renders the chart.
  const path = useMemo(
    () =>
      data
        .map((d, i) => `${i === 0 ? 'M' : 'L'}${cx(i).toFixed(1)},${cy(d.line).toFixed(1)}`)
        .join(' '),
    // `cx` and `cy` are read off these.
    [data, width, height],
  );
  const quiet = barTone === 'quiet';

  return (
    <ChartFrame
      label={label}
      summary={summary}
      rows={data.map((d) => ({ label: d.label, value: d.bar }))}
      valueLabel={barLabel}
      format={formatBar}
      className={cn('w-full', className)}
    >
      <View onLayout={onLayout} className="relative" style={{ height }}>
        <ChartGrid />
        <View className="absolute inset-0 flex-row" style={{ gap }}>
          {data.map((d, i) => (
            <Pressable
              key={`${d.label}-${String(i)}`}
              accessibilityRole="image"
              accessibilityLabel={`${d.label}: ${barLabel} ${formatBar(d.bar)}, ${lineLabel} ${formatLine(d.line)}`}
              onPress={() => {
                setInspected(inspected === i ? undefined : i);
              }}
              className="h-full min-w-0 flex-1 items-center justify-end"
            >
              <View
                className={cn(
                  'w-full max-w-8 rounded-t-[7px] rounded-b-[3px]',
                  quiet ? 'bg-accent-subtle-hover' : bgTone[barTone],
                  inspected === i && 'outline-2 outline-offset-2 outline-accent',
                )}
                style={{ height: pct((d.bar / barMax) * 100), minHeight: 2 }}
              />
            </Pressable>
          ))}
        </View>
        {width > 0 ? (
          <Ink width={width} height={height} className={inkTone[lineTone]}>
            <Path
              d={path}
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </Ink>
        ) : null}
        {inspected !== undefined && width > 0 ? (
          <View
            className="absolute top-1 z-20"
            style={
              cx(inspected) > width / 2
                ? { right: width - cx(inspected) + 12 }
                : { left: cx(inspected) + 12 }
            }
          >
            <ChartReadout>
              {`${data[inspected]?.label ?? ''} · ${formatBar(data[inspected]?.bar ?? 0)} · ${formatLine(data[inspected]?.line ?? 0)}`}
            </ChartReadout>
          </View>
        ) : null}
      </View>
      <AxisLabels columns gap={gap} labels={data.map((d) => d.axisLabel ?? d.label)} />
      <ChartLegend
        items={[
          {
            label: barLabel,
            tone: quiet ? 'accent' : barTone,
            swatch: quiet ? 'bg-accent-subtle-hover' : undefined,
          },
          { label: lineLabel, tone: lineTone },
        ]}
      />
    </ChartFrame>
  );
}

export interface StackedAreaChartProps {
  categories: readonly string[];
  /** Biggest first: the first series is the floor the rest stand on. */
  series: readonly StackedSeries[];
  label: string;
  height?: number;
  /** Every period fills the height: shares rather than amounts. */
  normalise?: boolean;
  /** Labels under the axis. A handful, spread edge to edge, when omitted. */
  axisLabels?: readonly string[];
  format?: (value: number) => string;
  summary?: string;
  className?: string | undefined;
}

const toneOf = (s: StackedSeries, k: number): ChartTone => s.tone ?? seriesTone(k);

/**
 * How a total changes over time and what makes it up: up to five layers, the
 * biggest at the bottom. Only the bottom layer shares a floor, so only it
 * compares by eye; the hidden table carries every layer's own figures.
 */
export function StackedAreaChart({
  categories,
  series,
  label,
  height = 160,
  normalise = false,
  axisLabels,
  format = (v) => String(v),
  summary,
  className,
}: StackedAreaChartProps): React.JSX.Element {
  const [width, onLayout] = useWidth();
  const n = categories.length;
  const totals = categories.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const layers = series.map((s) =>
    s.values.map((v, i) => (normalise ? (v / (totals[i] || 1)) * 100 : v)),
  );
  const cumulative: number[][] = [];
  layers.forEach((layer, k) => {
    cumulative.push(layer.map((v, i) => v + (k > 0 ? (cumulative[k - 1]?.[i] ?? 0) : 0)));
  });
  const top = normalise ? 100 : Math.max(...(cumulative.at(-1) ?? [1])) * 1.08 || 1;
  const x = (i: number): number => (n > 1 ? (i / (n - 1)) * width : 0);
  const y = (v: number): number => height - (v / top) * height;

  return (
    <ChartFrame
      label={label}
      summary={summary}
      rows={series.flatMap((s) =>
        categories.map((category, i) => ({
          label: `${category}, ${s.label}`,
          value: s.values[i] ?? 0,
        })),
      )}
      format={format}
      className={cn('w-full', className)}
    >
      <View {...decor} onLayout={onLayout} className="relative" style={{ height }}>
        {width > 0
          ? series.map((s, k) => {
              const upper = cumulative[k] ?? [];
              const lower = k > 0 ? (cumulative[k - 1] ?? []) : categories.map(() => 0);
              const d = [
                ...upper.map(
                  (v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`,
                ),
                ...lower.map((v, i) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`).reverse(),
                'Z',
              ].join(' ');
              return (
                <Ink key={s.label} width={width} height={height} className={inkTone[toneOf(s, k)]}>
                  <Path d={d} fill="currentColor" fillOpacity={0.88} />
                </Ink>
              );
            })
          : null}
      </View>
      <AxisLabels labels={axisLabels ?? spreadLabels(categories, 7)} />
      <ChartLegend items={series.map((s, k) => ({ label: s.label, tone: toneOf(s, k) }))} />
    </ChartFrame>
  );
}
