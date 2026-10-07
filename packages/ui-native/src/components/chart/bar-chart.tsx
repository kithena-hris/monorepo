import { useState } from 'react';
import { Pressable, Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import {
  AxisLabels,
  ChartFrame,
  ChartGrid,
  ChartLegend,
  ChartReadout,
  decor,
  pct,
  WEB,
  type ChartMenuItem,
  type ChartPoint,
} from './parts.tsx';
import { bgTone, seriesTone, type ChartTone } from './tones.ts';

/** What a mark is to a screen reader: a button when it selects, otherwise a named picture. */
function markProps(readout: string, selectable: boolean, selected: boolean) {
  return {
    accessibilityLabel: readout,
    ...(selectable
      ? WEB
        ? ({ role: 'button', 'aria-pressed': selected } as const)
        : ({ accessibilityRole: 'button', accessibilityState: { selected } } as const)
      : ({ accessibilityRole: 'image' } as const)),
  };
}

/** The props every axis chart here shares with the web's `ChartInteractionProps`. */
export interface ChartCommonProps {
  /** Names the chart, for a screen reader and the long-press menu. */
  label: string;
  /** What the chart shows, in a sentence, read before the values. */
  summary?: string;
  format?: (value: number) => string;
  /** Extra commands in the long-press menu. */
  menuItems?: readonly ChartMenuItem[];
  className?: string | undefined;
}

export interface BarChartProps extends ChartCommonProps {
  data: readonly ChartPoint[];
  tone?: ChartTone;
  /** Height of the plot area. 160 on a phone. */
  height?: number;
  /** Draws a dashed line at this value: a target, a budget, an average. */
  reference?: { value: number; label: string };
  /** Prints the value above each bar. Drop it when the bars get thin. */
  showValues?: boolean;
  /** Paints a bar under the reference line in the warning tone. */
  warnBelowReference?: boolean;
  /** Periods from this index on have not happened yet: a quiet placeholder in their slot. */
  futureFrom?: number;
  /** One bar in the series colour and the rest in a quiet tint. */
  highlightIndex?: number;
  /** Makes every bar a button. */
  onSelect?: (point: ChartPoint, index: number) => void;
  selectedIndex?: number;
  /**
   * The bar a tap is reading out. A tap on a bar says its number in a pill
   * over it (the phone's hover); this is where it starts.
   */
  defaultInspectedIndex?: number;
  /** Bars stop growing at this width: 32, or wider for a chart of four. */
  maxBarWidth?: number;
  /**
   * Bars 2 apart and as wide as their column, for a histogram, whose ranges
   * are continuous: a gap would say they are not.
   */
  touching?: boolean;
}

/**
 * Amounts over periods: the bars stand on a floor, labels under them, and a tap
 * on a bar says its number. Bars are views, laid out with the card, as the
 * web's are HTML, and each is a target a thumb can hit.
 */
export function BarChart({
  data,
  label,
  summary,
  tone = 'chart-1',
  height = 160,
  reference,
  showValues = false,
  warnBelowReference = false,
  futureFrom,
  highlightIndex,
  onSelect,
  selectedIndex,
  defaultInspectedIndex,
  maxBarWidth = 32,
  touching = false,
  format = (v) => String(v),
  menuItems,
  className,
}: BarChartProps): React.JSX.Element {
  const [inspected, setInspected] = useState<number | undefined>(defaultInspectedIndex);
  // Headroom over the tallest bar, so a readout above it has somewhere to sit.
  const max = Math.max(...data.map((d) => d.value), reference?.value ?? 0) * 1.1 || 1;
  const gap = touching ? 2 : 6;
  const readoutAt = selectedIndex ?? inspected;

  return (
    <ChartFrame
      label={label}
      summary={summary}
      rows={data}
      format={format}
      menuItems={menuItems}
      className={cn('w-full', className)}
    >
      <View className="relative" style={{ height }}>
        <ChartGrid />
        {reference ? (
          <View
            {...decor}
            className="pointer-events-none absolute right-0 left-0 z-10 border-t-2 border-dashed border-fg-muted"
            style={{ bottom: pct((reference.value / max) * 100) }}
          >
            <View className="absolute -top-6 right-0 rounded-[6px] bg-surface px-1.5 py-[3px]">
              <CssText className="text-[12px] leading-none font-semibold text-fg-muted">
                {reference.label}
              </CssText>
            </View>
          </View>
        ) : null}
        <View className="absolute inset-0 flex-row items-stretch" style={{ gap }}>
          {data.map((point, index) => {
            const percent = (point.value / max) * 100;
            const selected = selectedIndex === index;
            const dimmed = selectedIndex !== undefined && !selected;
            const quiet = highlightIndex !== undefined && highlightIndex !== index;
            const future = futureFrom !== undefined && index >= futureFrom;
            const below =
              warnBelowReference && reference !== undefined && point.value < reference.value;
            const readout = `${point.label}: ${format(point.value)}`;
            return (
              <Pressable
                key={`${point.label}-${String(index)}`}
                {...markProps(readout, onSelect !== undefined, selected)}
                onPress={() => {
                  if (onSelect) onSelect(point, index);
                  else setInspected(inspected === index ? undefined : index);
                }}
                className="relative h-full min-w-0 flex-1 items-center justify-end"
              >
                <View
                  className={cn(
                    'w-full rounded-t-[7px] rounded-b-[3px]',
                    selected && 'outline-2 outline-offset-2 outline-accent',
                    dimmed || future
                      ? 'bg-surface-active'
                      : below
                        ? 'bg-warning'
                        : quiet
                          ? 'bg-accent-subtle-hover'
                          : bgTone[tone],
                  )}
                  // A zero keeps a 2pt sliver: "none" and "no data" must not look alike.
                  style={{
                    height: pct(percent),
                    minHeight: 2,
                    ...(touching ? {} : { maxWidth: maxBarWidth }),
                  }}
                />
                {readoutAt === index ? (
                  <View
                    className="absolute -right-6 -left-6 z-20 items-center"
                    style={{ bottom: pct(percent), marginBottom: 8 }}
                  >
                    <ChartReadout>{format(point.value)}</ChartReadout>
                  </View>
                ) : showValues && !future ? (
                  <View
                    {...decor}
                    className="absolute -right-6 -left-6 items-center"
                    style={{ bottom: pct(percent), marginBottom: 4 }}
                  >
                    <CssText className="text-[11px] leading-none font-semibold text-fg-muted tabular-nums">
                      {format(point.value)}
                    </CssText>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </View>
      <AxisLabels
        columns
        gap={gap}
        labels={data.map((d) => d.axisLabel ?? d.label)}
        highlightIndex={highlightIndex}
      />
    </ChartFrame>
  );
}

export interface HorizontalBarChartProps extends ChartCommonProps {
  data: readonly ChartPoint[];
  tone?: ChartTone;
  /** Sorts descending before rendering. A ranking that is not sorted is a list. */
  sorted?: boolean;
  /** Caps the rows and adds a "+N more" line. */
  limit?: number;
  /** A bar's own colour, where it is the meaning. Its label still says which it is. */
  toneOf?: (point: ChartPoint) => ChartTone;
  /** One bar in the series colour and the rest in a quiet tint. */
  highlightIndex?: number;
  onSelect?: (point: ChartPoint, index: number) => void;
  selectedIndex?: number;
}

/** One row of a horizontal chart: the name, the bar, the figure. */
function Row({
  name,
  value,
  children,
  dimmed,
  onPress,
  readout,
  selectable,
  selected,
}: {
  name: string;
  value?: string | undefined;
  children: React.ReactNode;
  dimmed?: boolean;
  onPress?: (() => void) | undefined;
  readout: string;
  selectable: boolean;
  selected: boolean;
}): React.JSX.Element {
  return (
    <Pressable
      {...markProps(readout, selectable, selected)}
      {...(onPress ? { onPress } : {})}
      className={cn('min-h-[22px] flex-row items-center gap-3', dimmed && 'opacity-40')}
    >
      <CssText
        numberOfLines={1}
        className="w-[88px] text-subhead leading-[1.2] font-medium text-fg-muted"
      >
        {name}
      </CssText>
      <View className="min-w-0 flex-1">{children}</View>
      {value === undefined ? null : (
        <CssText className="w-[52px] text-right text-subhead leading-none font-semibold text-fg tabular-nums">
          {value}
        </CssText>
      )}
    </Pressable>
  );
}

/**
 * A ranking of named categories. On its side because the labels are words:
 * "Engineering" on a full line, not "Engi…" under a 30pt bar.
 */
export function HorizontalBarChart({
  data,
  label,
  summary,
  tone = 'chart-1',
  sorted = false,
  limit,
  toneOf,
  highlightIndex,
  onSelect,
  selectedIndex,
  format = (v) => String(v),
  menuItems,
  className,
}: HorizontalBarChartProps): React.JSX.Element {
  const ordered = sorted ? data.toSorted((a, b) => b.value - a.value) : [...data];
  const shown = limit === undefined ? ordered : ordered.slice(0, limit);
  const rest = ordered.length - shown.length;
  const max = Math.max(...shown.map((d) => d.value)) * 1.1 || 1;
  return (
    <ChartFrame
      label={label}
      summary={summary}
      rows={data}
      format={format}
      menuItems={menuItems}
      className={cn('w-full gap-3', className)}
    >
      {shown.map((point, index) => {
        const selected = selectedIndex === index;
        const own = toneOf?.(point);
        return (
          <Row
            key={`${point.label}-${String(index)}`}
            name={point.label}
            value={format(point.value)}
            readout={`${point.label}: ${format(point.value)}`}
            selectable={onSelect !== undefined}
            selected={selected}
            dimmed={selectedIndex !== undefined && !selected}
            onPress={
              onSelect
                ? () => {
                    onSelect(point, index);
                  }
                : undefined
            }
          >
            <View
              {...decor}
              className={cn(
                'h-[22px] rounded-[6px]',
                highlightIndex !== undefined && highlightIndex !== index
                  ? 'bg-accent-subtle-hover'
                  : bgTone[own ?? tone],
              )}
              style={{ width: pct((point.value / max) * 100), minWidth: 2 }}
            />
          </Row>
        );
      })}
      {rest > 0 ? (
        <CssText className="text-footnote text-fg-subtle">{`+${String(rest)} more`}</CssText>
      ) : null}
    </ChartFrame>
  );
}

export interface StackedSeries {
  label: string;
  tone?: ChartTone;
  /** One value per category, in the same order as `categories`. */
  values: readonly number[];
}

export interface StackedBarChartProps extends ChartCommonProps {
  categories: readonly string[];
  series: readonly StackedSeries[];
  /** Height of the plot, for vertical columns. */
  height?: number;
  /** Each column fills the space, so the chart reads as proportions. */
  normalise?: boolean;
  /**
   * Columns for periods, rows for named categories: the same rule as
   * `BarChart` and `HorizontalBarChart`, for a stack.
   */
  orientation?: 'vertical' | 'horizontal';
  /** Series switched off from the legend. Uncontrolled when omitted. */
  hiddenSeries?: readonly string[];
  onHiddenSeriesChange?: (hidden: readonly string[]) => void;
  /** Bars stop growing at this width. */
  maxBarWidth?: number;
}

/** Rounded at the ends of a stack, 2 between its segments. */
function segmentRadius(first: boolean, last: boolean, vertical: boolean) {
  const end = vertical ? 7 : 6;
  const start = vertical ? 3 : 6;
  return vertical
    ? {
        borderTopLeftRadius: last ? end : 2,
        borderTopRightRadius: last ? end : 2,
        borderBottomLeftRadius: first ? start : 2,
        borderBottomRightRadius: first ? start : 2,
      }
    : {
        borderTopLeftRadius: first ? start : 2,
        borderBottomLeftRadius: first ? start : 2,
        borderTopRightRadius: last ? end : 2,
        borderBottomRightRadius: last ? end : 2,
      };
}

/**
 * What each category is made of. Only the first segment shares a baseline, so
 * only it compares across categories by eye; `normalise` answers "what share"
 * and gives up "how many".
 */
export function StackedBarChart({
  categories,
  series,
  label,
  summary,
  height = 160,
  normalise = false,
  orientation = 'vertical',
  hiddenSeries,
  onHiddenSeriesChange,
  maxBarWidth = 32,
  format = (v) => String(v),
  menuItems,
  className,
}: StackedBarChartProps): React.JSX.Element {
  const [ownHidden, setOwnHidden] = useState<readonly string[]>([]);
  const hidden = hiddenSeries ?? ownHidden;
  const setHidden = (next: readonly string[]): void => {
    if (hiddenSeries === undefined) setOwnHidden(next);
    onHiddenSeriesChange?.(next);
  };
  const visible = series
    .map((s, index) => ({ ...s, tone: s.tone ?? seriesTone(index) }))
    .filter((s) => !hidden.includes(s.label));
  const totals = categories.map((_, c) => visible.reduce((sum, s) => sum + (s.values[c] ?? 0), 0));
  const max = Math.max(...totals) * 1.1 || 1;
  const rows: ChartPoint[] = series.flatMap((s) =>
    categories.map((category, c) => ({
      label: `${category}, ${s.label}`,
      value: s.values[c] ?? 0,
    })),
  );
  const vertical = orientation === 'vertical';

  const stack = (c: number) => {
    const parts = visible.filter((s) => (s.values[c] ?? 0) > 0);
    return parts.map((s, j) => (
      <View
        key={s.label}
        className={bgTone[s.tone]}
        style={{
          flexGrow: s.values[c] ?? 0,
          flexBasis: 0,
          ...(vertical ? { minHeight: 2 } : { minWidth: 2 }),
          ...segmentRadius(j === 0, j === parts.length - 1, vertical),
        }}
      />
    ));
  };

  const readout = (c: number): string =>
    `${categories[c] ?? ''}: ${visible
      .map((s) => `${s.label} ${format(s.values[c] ?? 0)}`)
      .join(', ')}`;

  return (
    <ChartFrame
      label={label}
      summary={summary}
      rows={rows}
      format={format}
      menuItems={menuItems}
      className={cn('w-full', className)}
    >
      {vertical ? (
        <>
          <View className="relative" style={{ height }}>
            <ChartGrid />
            <View className="absolute inset-0 flex-row items-stretch gap-1.5">
              {categories.map((category, c) => {
                const total = totals[c] ?? 0;
                return (
                  <View
                    key={category}
                    {...markProps(readout(c), false, false)}
                    accessible
                    className="h-full min-w-0 flex-1 items-center justify-end"
                  >
                    {total > 0 ? (
                      <View
                        className="w-full flex-col-reverse gap-0.5"
                        style={{
                          height: normalise ? '100%' : pct((total / max) * 100),
                          maxWidth: maxBarWidth,
                        }}
                      >
                        {stack(c)}
                      </View>
                    ) : (
                      <View
                        className="w-full rounded-t-[7px] rounded-b-[3px] bg-surface-active"
                        style={{ height: 2, maxWidth: maxBarWidth }}
                      />
                    )}
                  </View>
                );
              })}
            </View>
          </View>
          <AxisLabels columns labels={categories} />
        </>
      ) : (
        <View className="gap-3">
          {categories.map((category, c) => {
            const total = totals[c] ?? 0;
            return (
              <Row
                key={category}
                name={category}
                {...(normalise ? {} : { value: format(total) })}
                readout={readout(c)}
                selectable={false}
                selected={false}
              >
                <View
                  {...decor}
                  className="h-[22px] flex-row gap-0.5"
                  style={{ width: normalise ? '100%' : pct((total / max) * 100) }}
                >
                  {stack(c)}
                </View>
              </Row>
            );
          })}
        </View>
      )}
      <ChartLegend
        items={series.map((s, index) => ({ label: s.label, tone: s.tone ?? seriesTone(index) }))}
        hidden={hidden}
        {...(onHiddenSeriesChange ? { onHiddenChange: setHidden } : {})}
      />
    </ChartFrame>
  );
}
