import { useMemo, useState } from 'react';
import { Pressable, Text as CssText, View } from 'react-native-css/components';
import { Line } from 'react-native-svg';

import { linearFit } from './geometry.ts';
import { cn } from '../../lib/cn.ts';
import type { ChartCommonProps } from './bar-chart.tsx';
import {
  AxisText,
  ChartFrame,
  ChartGrid,
  ChartLegend,
  ChartReadout,
  decor,
  Ink,
  pct,
  useWidth,
  WEB,
} from './parts.tsx';
import { bgTone, inkTone, seriesTone, type ChartTone } from './tones.ts';

export interface RangeBand {
  label: string;
  min: number;
  max: number;
  /** The reference point in the band: a midpoint for a policy, a median for people. */
  mid?: number;
  /** An inner range drawn across the band: where most of the figures sit. */
  spread?: { low: number; high: number };
  /** Individual figures, one dot each. Those outside the band are ringed in red. */
  people?: readonly number[];
}

export interface RangeChartProps extends ChartCommonProps {
  data: readonly RangeBand[];
  /** What the numbers are: "Base salary, EUR". Read before every band. */
  valueLabel: string;
  /** The ends of the shared scale. The bands' own extremes when omitted. */
  domain?: readonly [number, number];
  /** Figures printed under the scale, edge to edge. */
  ticks?: readonly number[];
  /** What `spread` is: "Middle half". With `midLabel`, a key under the chart says both. */
  spreadLabel?: string;
  /** What `mid` is: "Midpoint" for a policy, "Median" for people. */
  midLabel?: string;
  /** What the band itself is, in the key: "Band". */
  bandLabel?: string;
  onSelect?: (band: RangeBand) => void;
  selectedLabel?: string;
}

/** How many of a band's people sit outside it. */
function outsideOf(band: RangeBand): number {
  return (band.people ?? []).filter((figure) => figure < band.min || figure > band.max).length;
}

/**
 * Salary bands on one scale: the band, where the middle half sits, the
 * median, and each person as a dot, with anyone outside the band filled red
 * and counted in words. Money arrives in minor units; `format` says it.
 */
export function RangeChart({
  data,
  label,
  summary,
  valueLabel,
  domain,
  ticks,
  spreadLabel,
  midLabel,
  bandLabel = 'Band',
  onSelect,
  selectedLabel,
  format = (v) => String(v),
  menuItems,
  className,
}: RangeChartProps): React.JSX.Element {
  const lo = domain?.[0] ?? Math.min(...data.map((b) => Math.min(b.min, ...(b.people ?? []))));
  const hi = domain?.[1] ?? Math.max(...data.map((b) => Math.max(b.max, ...(b.people ?? []))));
  const x = (v: number): number => ((v - lo) / (hi - lo || 1)) * 100;

  return (
    <ChartFrame
      label={label}
      summary={summary}
      rows={data.map((band) => ({
        label: band.label,
        value: band.mid ?? (band.min + band.max) / 2,
      }))}
      valueLabel={valueLabel}
      format={format}
      menuItems={menuItems}
      className={cn('w-full gap-3.5', className)}
    >
      {data.map((band) => {
        const outside = outsideOf(band);
        const selected = selectedLabel === band.label;
        const said = [
          `${band.label}: ${valueLabel} ${format(band.min)} to ${format(band.max)}`,
          band.mid === undefined ? '' : `${midLabel ?? 'midpoint'} ${format(band.mid)}`,
          band.spread
            ? `${spreadLabel ?? 'spread'} ${format(band.spread.low)} to ${format(band.spread.high)}`
            : '',
          band.people
            ? `${String(band.people.length)} people, ${String(outside)} outside the band`
            : '',
        ]
          .filter(Boolean)
          .join(', ');
        return (
          <Pressable
            key={band.label}
            accessibilityLabel={said}
            {...(onSelect
              ? WEB
                ? { role: 'button' as const, 'aria-pressed': selected }
                : { accessibilityRole: 'button' as const, accessibilityState: { selected } }
              : { accessibilityRole: 'image' as const })}
            {...(onSelect
              ? {
                  onPress: () => {
                    onSelect(band);
                  },
                }
              : {})}
            className={cn('gap-1.5', selectedLabel !== undefined && !selected && 'opacity-50')}
          >
            <CssText {...decor} className="text-subhead leading-[1.2] font-medium text-fg-muted">
              {band.label}
            </CssText>
            <View {...decor} className="relative h-7">
              <View className="absolute top-1/2 right-0 left-0 h-px bg-border" />
              <View
                className="absolute top-1.5 bottom-1.5 rounded-full bg-accent-subtle-hover"
                style={{ left: pct(x(band.min)), width: pct(x(band.max) - x(band.min)) }}
              />
              {band.spread ? (
                <View
                  className="absolute top-1 bottom-1 rounded-[6px] bg-accent opacity-45"
                  style={{
                    left: pct(x(band.spread.low)),
                    width: pct(x(band.spread.high) - x(band.spread.low)),
                  }}
                />
              ) : null}
              {band.mid === undefined ? null : (
                <View
                  className="absolute top-px bottom-px w-0.5 rounded-[2px] bg-fg"
                  style={{ left: pct(x(band.mid)), marginLeft: -1 }}
                />
              )}
              {(band.people ?? []).map((figure, i) => {
                const out = figure < band.min || figure > band.max;
                const size = out ? 12 : 9;
                return (
                  <View
                    key={`${String(figure)}-${String(i)}`}
                    className={cn(
                      'absolute top-1/2 rounded-full border-2',
                      out
                        ? 'border-danger bg-danger outline-3 outline-danger-subtle'
                        : 'border-accent bg-surface',
                    )}
                    style={{
                      left: pct(x(figure)),
                      width: size,
                      height: size,
                      marginLeft: -size / 2,
                      marginTop: -size / 2,
                    }}
                  />
                );
              })}
            </View>
          </Pressable>
        );
      })}
      {ticks ? (
        <View {...decor} className="flex-row justify-between">
          {ticks.map((tick) => (
            <AxisText key={tick}>{format(tick)}</AxisText>
          ))}
        </View>
      ) : null}
      {spreadLabel !== undefined || midLabel !== undefined ? (
        <View {...decor} className="flex-row flex-wrap gap-x-4 gap-y-2">
          {[
            [bandLabel, 'bg-accent-subtle-hover'],
            ...(spreadLabel === undefined ? [] : [[spreadLabel, 'bg-accent opacity-45']]),
            ...(midLabel === undefined ? [] : [[midLabel, 'bg-fg']]),
          ].map(([name, swatch]) => (
            <View key={name} className="flex-row items-center gap-1.5">
              <View className={cn('size-2.5 rounded-[3px]', swatch)} />
              <CssText className="text-[12px] leading-none font-medium text-fg-muted">
                {name}
              </CssText>
            </View>
          ))}
        </View>
      ) : null}
    </ChartFrame>
  );
}

export interface ScatterPoint {
  /** Who this is, for the readout and the hidden table. */
  label: string;
  x: number;
  y: number;
  tone?: ChartTone;
  /** The group this point belongs to: "Women". Names the legend and the fit line. */
  group?: string;
}

export interface ScatterChartProps extends ChartCommonProps {
  data: readonly ScatterPoint[];
  /** Axis names, read with every point. */
  xLabel: string;
  yLabel: string;
  height?: number;
  xRange?: readonly [number, number];
  yRange?: readonly [number, number];
  /** Labels under the plot, each at its own x. */
  xTicks?: readonly { value: number; label: string }[];
  formatX?: (value: number) => string;
  formatY?: (value: number) => string;
  /** A dashed least-squares line per group, in the group's tone. */
  fitLines?: boolean;
  onSelect?: (point: ScatterPoint) => void;
  selectedLabel?: string;
}

/** A little breathing room, so points never sit on the frame. */
function padded(values: readonly number[]): [number, number] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.08 || 1;
  return [min - pad, max + pad];
}

/**
 * Two measures per person, one dot each, with a fit line per group: two
 * roughly parallel lines a step apart is what "paid less at the same level"
 * looks like. A tap on a dot says who and how much.
 */
export function ScatterChart({
  data,
  label,
  summary,
  xLabel,
  yLabel,
  height = 200,
  xRange,
  yRange,
  xTicks,
  formatX = (v) => String(v),
  formatY = (v) => String(v),
  fitLines = false,
  onSelect,
  selectedLabel,
  menuItems,
  className,
}: ScatterChartProps): React.JSX.Element {
  const [width, onLayout] = useWidth();
  const [inspected, setInspected] = useState<string | undefined>();
  const [x0, x1] = xRange ?? padded(data.map((p) => p.x));
  const [y0, y1] = yRange ?? padded(data.map((p) => p.y));
  const fx = (v: number): number => ((v - x0) / (x1 - x0 || 1)) * width;
  const fy = (v: number): number => height - ((v - y0) / (y1 - y0 || 1)) * height;
  const groups = [...new Set(data.map((p) => p.group).filter((g): g is string => Boolean(g)))];
  const toneOf = (p: ScatterPoint): ChartTone =>
    p.tone ?? (p.group ? seriesTone(groups.indexOf(p.group)) : 'chart-1');
  const groupTone = (g: string): ChartTone =>
    data.find((p) => p.group === g)?.tone ?? seriesTone(groups.indexOf(g));
  const shown = selectedLabel ?? inspected;
  // A least-squares line per group: once per data, not once per tap on a dot.
  const fits = useMemo(
    () =>
      new Map(
        [...new Set(data.map((p) => p.group).filter((g): g is string => Boolean(g)))].map((g) => [
          g,
          linearFit(data.filter((p) => p.group === g)),
        ]),
      ),
    [data],
  );

  return (
    <ChartFrame
      label={label}
      summary={summary}
      rows={data.map((p) => ({ label: `${p.label}, ${xLabel} ${formatX(p.x)}`, value: p.y }))}
      valueLabel={yLabel}
      format={formatY}
      menuItems={menuItems}
      className={cn('w-full', className)}
    >
      <View onLayout={onLayout} className="relative" style={{ height }}>
        <ChartGrid />
        {fitLines && width > 0
          ? groups.map((g) => {
              const fit = fits.get(g);
              if (!fit) return null;
              return (
                <Ink key={g} width={width} height={height} className={inkTone[groupTone(g)]}>
                  <Line
                    x1={0}
                    y1={fy(fit.slope * x0 + fit.intercept)}
                    x2={width}
                    y2={fy(fit.slope * x1 + fit.intercept)}
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeDasharray="6 5"
                  />
                </Ink>
              );
            })
          : null}
        {width > 0
          ? data.map((p) => {
              const said = `${p.label}${p.group ? `, ${p.group}` : ''}: ${xLabel} ${formatX(p.x)}, ${yLabel} ${formatY(p.y)}`;
              const on = shown === p.label;
              return (
                <Pressable
                  key={p.label}
                  accessibilityLabel={said}
                  {...(onSelect
                    ? { accessibilityRole: 'button' as const, accessibilityState: { selected: on } }
                    : { accessibilityRole: 'image' as const })}
                  hitSlop={12}
                  onPress={() => {
                    if (onSelect) onSelect(p);
                    else setInspected(on ? undefined : p.label);
                  }}
                  className="absolute items-center justify-center"
                  style={{ left: fx(p.x) - 10, top: fy(p.y) - 10, width: 20, height: 20 }}
                >
                  <View
                    className={cn(
                      'size-[13px] rounded-full border-[1.5px] border-surface opacity-90',
                      bgTone[toneOf(p)],
                      on && 'opacity-100 outline-2 outline-offset-1 outline-fg',
                    )}
                  />
                </Pressable>
              );
            })
          : null}
        {shown !== undefined && width > 0
          ? (() => {
              const p = data.find((point) => point.label === shown);
              if (!p) return null;
              return (
                <View
                  className="absolute z-20"
                  style={
                    fx(p.x) > width / 2
                      ? { right: width - fx(p.x) + 10, top: Math.max(0, fy(p.y) - 30) }
                      : { left: fx(p.x) + 10, top: Math.max(0, fy(p.y) - 30) }
                  }
                >
                  <ChartReadout>{`${p.label} · ${formatY(p.y)}`}</ChartReadout>
                </View>
              );
            })()
          : null}
      </View>
      {xTicks && width > 0 ? (
        <View {...decor} className="relative mt-2 h-3">
          {xTicks.map((tick) => (
            <View
              key={tick.label}
              className="absolute w-10 items-center"
              style={{ left: fx(tick.value) - 20 }}
            >
              <AxisText>{tick.label}</AxisText>
            </View>
          ))}
        </View>
      ) : null}
      {groups.length > 0 ? (
        <ChartLegend items={groups.map((g) => ({ label: g, tone: groupTone(g) }))} />
      ) : null}
    </ChartFrame>
  );
}
