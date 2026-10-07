import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { BarChart } from './bar-chart.tsx';
import { binValues, squarify, type HistogramBin } from './geometry.ts';
import { AxisLabels, ChartFrame, ChartGrid, decor, pct, useWidth, WEB } from './parts.tsx';
import { bgTone, borderTone, seriesTone, type ChartTone } from './tones.ts';

export interface TreemapItem {
  label: string;
  value: number;
  tone?: ChartTone;
}

export interface TreemapChartProps {
  data: readonly TreemapItem[];
  label: string;
  format?: (value: number) => string;
  /** One part in its colour and the rest quiet: the one the card's sentence is about. */
  highlightIndex?: number;
  /** Height of the map. 220 on a phone. */
  height?: number;
  summary?: string;
  className?: string | undefined;
}

/**
 * Parts of a whole when there are too many for a donut: each part's area is
 * its value, laid out squarified (the web's own arithmetic) so the cells stay
 * close to square, the only shape whose area an eye can compare. Each part
 * names itself and its value inside its cell.
 */
export function TreemapChart({
  data,
  label,
  format = (v) => String(v),
  highlightIndex,
  height = 220,
  summary,
  className,
}: TreemapChartProps): React.JSX.Element {
  const [width, onLayout] = useWidth();
  const rects = useMemo(
    () =>
      squarify(
        data.map((d) => d.value),
        { x: 0, y: 0, width, height },
      ),
    [data, width, height],
  );
  const total = data.reduce((sum, d) => sum + d.value, 0) || 1;
  return (
    <ChartFrame
      label={label}
      summary={summary}
      rows={data}
      format={format}
      className={cn('w-full', className)}
    >
      <View onLayout={onLayout} className="relative" style={{ height }}>
        {width > 0
          ? data.map((item, i) => {
              const r = rects[i];
              if (!r || r.width <= 0) return null;
              const quiet = highlightIndex !== undefined && highlightIndex !== i;
              const roomy = r.width > 36 && r.height > 44;
              return (
                <View
                  key={item.label}
                  accessible
                  accessibilityRole="image"
                  accessibilityLabel={`${item.label}: ${format(item.value)}, ${String(Math.round((item.value / total) * 100))}%`}
                  className={cn(
                    'absolute justify-between overflow-hidden rounded-[10px] p-2.5',
                    // The web's treatment: the tone at 40% over the card with a
                    // 3pt cap in the full tone, so the label stays at text
                    // contrast on every hue, in both themes.
                    quiet
                      ? 'bg-surface-active'
                      : cn('border-t-[3px] bg-surface', borderTone[item.tone ?? seriesTone(i)]),
                  )}
                  style={{
                    left: r.x + 1.5,
                    top: r.y + 1.5,
                    width: Math.max(r.width - 3, 0),
                    height: Math.max(r.height - 3, 0),
                  }}
                >
                  {quiet ? null : (
                    <View
                      {...decor}
                      className={cn(
                        'absolute -top-[3px] right-0 bottom-0 left-0',
                        bgTone[item.tone ?? seriesTone(i)],
                      )}
                      style={{ opacity: 0.4 }}
                    />
                  )}
                  {roomy ? (
                    <>
                      <CssText
                        {...decor}
                        numberOfLines={1}
                        className={cn(
                          'text-footnote leading-[1.2] font-semibold',
                          quiet ? 'text-fg-muted' : 'text-fg',
                        )}
                      >
                        {item.label}
                      </CssText>
                      <CssText
                        {...decor}
                        numberOfLines={1}
                        className={cn(
                          'text-[18px] leading-none font-bold',
                          quiet ? 'text-fg-muted' : 'text-fg',
                        )}
                      >
                        {format(item.value)}
                      </CssText>
                    </>
                  ) : null}
                </View>
              );
            })
          : null}
      </View>
    </ChartFrame>
  );
}

export interface HistogramChartProps {
  /** The raw figures. They are counted into bins here, never in the caller. */
  values: readonly number[];
  /** Width of every closed bin. */
  step: number;
  /** First closed edge: values under it are an open "under" bin. */
  start?: number;
  /** Last closed edge: values at or over it are an open "and over" bin. */
  end?: number;
  label: string;
  /** What a bin prints under its bar. The lower edge, "<1" and "6+" for the open ends. */
  formatBin?: (bin: HistogramBin) => string;
  format?: (count: number) => string;
  highlightIndex?: number;
  tone?: ChartTone;
  height?: number;
  summary?: string;
  className?: string | undefined;
}

function binName(bin: HistogramBin): string {
  if (!Number.isFinite(bin.from)) return `<${String(bin.to)}`;
  if (!Number.isFinite(bin.to)) return `${String(bin.from)}+`;
  return String(bin.from);
}

/**
 * How values are spread. The bars touch because the ranges are continuous,
 * and a tap on one says its range and its count.
 */
export function HistogramChart({
  values,
  step,
  start,
  end,
  label,
  formatBin = binName,
  format = (v) => String(v),
  highlightIndex,
  tone = 'chart-1',
  height = 160,
  summary,
  className,
}: HistogramChartProps): React.JSX.Element {
  const bins = binValues(values, {
    step,
    ...(start === undefined ? {} : { start }),
    ...(end === undefined ? {} : { end }),
  });
  return (
    <BarChart
      label={label}
      {...(summary === undefined ? {} : { summary })}
      data={bins.map((bin) => ({ label: formatBin(bin), value: bin.count }))}
      touching
      tone={tone}
      height={height}
      format={format}
      {...(highlightIndex === undefined ? {} : { highlightIndex })}
      className={className}
    />
  );
}

export interface CohortRow {
  label: string;
  /** One per period; `null` where the cohort has not reached it yet. */
  values: readonly (number | null)[];
}

export interface CohortChartProps {
  periods: readonly string[];
  cohorts: readonly CohortRow[];
  label: string;
  format?: (value: number) => string;
  /** The scale's ends. 0 and 100 by default, for a percentage. */
  min?: number;
  max?: number;
  tone?: ChartTone;
  summary?: string;
  className?: string | undefined;
}

/**
 * How each group of joiners stays over time: across a row for one cohort,
 * down a column to compare cohorts. Every cell prints its value; the colour
 * only says where to look.
 */
export function CohortChart({
  periods,
  cohorts,
  label,
  format = (v) => `${String(v)}%`,
  min = 0,
  max = 100,
  tone = 'accent',
  summary,
  className,
}: CohortChartProps): React.JSX.Element {
  return (
    <ChartFrame
      label={label}
      summary={summary}
      rows={cohorts.flatMap((row) =>
        row.values.flatMap((value, i) =>
          value === null ? [] : [{ label: `${row.label}, ${periods[i] ?? ''}`, value }],
        ),
      )}
      format={format}
      className={cn('w-full', className)}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="min-w-[320px] flex-1 gap-[3px]">
          <View {...decor} className="flex-row gap-[3px]">
            <View className="w-16" />
            {periods.map((period) => (
              <CssText
                key={period}
                className="min-w-[38px] flex-1 pb-1 text-center text-[11px] leading-none font-semibold text-fg-subtle"
              >
                {period}
              </CssText>
            ))}
          </View>
          {cohorts.map((row) => (
            <View key={row.label} className="flex-row items-center gap-[3px]">
              <CssText
                {...decor}
                numberOfLines={1}
                className="w-16 text-[12px] leading-none font-medium text-fg-muted"
              >
                {row.label}
              </CssText>
              {periods.map((period, i) => {
                const value = row.values[i] ?? null;
                if (value === null)
                  return <View key={period} className="h-[34px] min-w-[38px] flex-1" />;
                // The web's ramp, 8% to 60%: the darkest cell still carries its number at text contrast.
                const strength =
                  0.08 + Math.min(Math.max((value - min) / (max - min || 1), 0), 1) * 0.52;
                return (
                  <View
                    key={period}
                    accessible
                    accessibilityRole="image"
                    accessibilityLabel={`${row.label}, ${period}: ${format(value)}`}
                    className="h-[34px] min-w-[38px] flex-1 items-center justify-center overflow-hidden rounded-[6px] bg-surface-sunken"
                  >
                    <View
                      className={cn('absolute inset-0', bgTone[tone])}
                      style={{ opacity: strength }}
                    />
                    <CssText
                      {...decor}
                      className="text-[11px] leading-none font-semibold text-fg tabular-nums"
                    >
                      {format(value)}
                    </CssText>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </ChartFrame>
  );
}

export interface BulletMeasure {
  label: string;
  value: number;
  target: number;
  max: number;
  /** The poor and fair ranges' upper edges; above the second is good. */
  bands: readonly [number, number];
  /** The figure as printed: "30 / 25", "81%". */
  display?: string;
  /** Whether more is better. When it is not, under the target is the win. */
  higherIsBetter?: boolean;
}

export interface BulletChartProps {
  data: readonly BulletMeasure[];
  label: string;
  summary?: string;
  className?: string | undefined;
}

/**
 * Many targets in little space: a measure as a bar, its target as a tick,
 * over quiet qualitative bands. On a phone the figure sits beside the name.
 */
export function BulletChart({
  data,
  label,
  summary,
  className,
}: BulletChartProps): React.JSX.Element {
  const x = (m: BulletMeasure, v: number): `${number}%` =>
    pct((Math.min(v, m.max) / (m.max || 1)) * 100);
  return (
    <ChartFrame
      label={label}
      summary={summary}
      rows={data.map((m) => ({ label: m.label, value: m.value }))}
      className={cn('w-full gap-3.5', className)}
    >
      {data.map((m) => {
        const met = (m.higherIsBetter ?? true) ? m.value >= m.target : m.value <= m.target;
        const shown = m.display ?? String(m.value);
        return (
          <View
            key={m.label}
            accessible
            accessibilityRole="image"
            accessibilityLabel={`${m.label}: ${shown}, target ${String(m.target)}, ${met ? 'met' : 'not met'}`}
            className="gap-1.5"
          >
            <CssText {...decor} className="text-subhead leading-[1.2] font-medium text-fg-muted">
              {`${m.label} · `}
              <CssText className="font-bold text-fg">{shown}</CssText>
            </CssText>
            <View
              {...decor}
              className="relative h-6 overflow-hidden rounded-[6px] bg-surface-sunken"
            >
              <View
                className="absolute top-0 bottom-0 left-0 bg-surface-active"
                style={{ width: x(m, m.bands[1]) }}
              />
              <View
                className="absolute top-0 bottom-0 left-0 bg-surface-active"
                style={{ width: x(m, m.bands[0]) }}
              >
                <View className="absolute inset-0 bg-fg-subtle opacity-35" />
              </View>
              <View
                className={cn(
                  'absolute top-2 bottom-2 left-0 rounded-[3px]',
                  met ? 'bg-success' : 'bg-accent',
                )}
                style={{ width: x(m, m.value) }}
              />
              <View
                className="absolute top-[3px] bottom-[3px] w-[3px] rounded-[2px] bg-fg"
                style={{ left: x(m, m.target), marginLeft: -1.5 }}
              />
            </View>
          </View>
        );
      })}
    </ChartFrame>
  );
}

export interface BubblePoint {
  label: string;
  x: number;
  y: number;
  size: number;
  tone?: ChartTone;
}

export interface BubbleChartProps {
  data: readonly BubblePoint[];
  label: string;
  xLabel: string;
  yLabel: string;
  sizeLabel: string;
  xRange?: readonly [number, number];
  yRange?: readonly [number, number];
  formatX?: (value: number) => string;
  formatY?: (value: number) => string;
  formatSize?: (value: number) => string;
  /** The largest bubble, across. Area, not diameter, is the value. */
  maxDiameter?: number;
  height?: number;
  /** Words under the plot, spread edge to edge: "Tenure: short", "long". */
  axisLabels?: readonly string[];
  /** A sentence under the plot saying what the axes and sizes mean. */
  note?: string;
  summary?: string;
  className?: string | undefined;
}

/**
 * A scatter whose bubble size is a third value, sized by area so twice the
 * people is twice the ink. Bubbles big enough carry their name; a tap on any
 * says all three figures.
 */
export function BubbleChart({
  data,
  label,
  xLabel,
  yLabel,
  sizeLabel,
  xRange = [0, 100],
  yRange = [0, 100],
  formatX = (v) => String(v),
  formatY = (v) => String(v),
  formatSize = (v) => String(v),
  maxDiameter = 64,
  height = 220,
  axisLabels,
  note,
  summary,
  className,
}: BubbleChartProps): React.JSX.Element {
  const [inspected, setInspected] = useState<string | undefined>();
  const biggest = Math.max(...data.map((p) => p.size), 1);
  const fx = (v: number): number => ((v - xRange[0]) / (xRange[1] - xRange[0] || 1)) * 100;
  const fy = (v: number): number => ((v - yRange[0]) / (yRange[1] - yRange[0] || 1)) * 100;
  return (
    <ChartFrame
      label={label}
      summary={summary}
      rows={data.map((p) => ({
        label: `${p.label}, ${xLabel} ${formatX(p.x)}, ${yLabel} ${formatY(p.y)}`,
        value: p.size,
      }))}
      valueLabel={sizeLabel}
      format={formatSize}
      className={cn('w-full', className)}
    >
      <View className="relative" style={{ height }}>
        <ChartGrid />
        {data.map((p, i) => {
          const d = Math.sqrt(p.size / biggest) * maxDiameter;
          const tone = p.tone ?? seriesTone(i);
          const on = inspected === p.label;
          return (
            <View
              key={p.label}
              className="absolute"
              style={{
                left: pct(fx(p.x)),
                bottom: pct(fy(p.y)),
                marginLeft: -d / 2,
                marginBottom: -d / 2,
              }}
            >
              <Pressable
                accessibilityRole="image"
                accessibilityLabel={`${p.label}: ${xLabel} ${formatX(p.x)}, ${yLabel} ${formatY(p.y)}, ${sizeLabel} ${formatSize(p.size)}`}
                {...(WEB ? {} : { hitSlop: Math.max(0, (44 - d) / 2) })}
                onPress={() => {
                  setInspected(on ? undefined : p.label);
                }}
                className={cn(
                  'items-center justify-center overflow-hidden rounded-full border-[1.5px]',
                  borderTone[tone],
                  on && 'outline-2 outline-offset-2 outline-fg',
                )}
                style={{ width: d, height: d }}
              >
                <View className={cn('absolute inset-0', bgTone[tone])} style={{ opacity: 0.4 }} />
                {d >= 40 || on ? (
                  <CssText
                    {...decor}
                    numberOfLines={1}
                    className="text-[11px] leading-none font-semibold text-fg"
                  >
                    {on ? formatSize(p.size) : p.label}
                  </CssText>
                ) : null}
              </Pressable>
            </View>
          );
        })}
      </View>
      {axisLabels ? <AxisLabels labels={axisLabels} /> : null}
      {note ? (
        <CssText className="mt-2.5 text-subhead leading-[1.5] text-fg-muted">{note}</CssText>
      ) : null}
    </ChartFrame>
  );
}
