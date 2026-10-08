import { ArrowDown, ArrowUp } from 'lucide-react-native';
import { useId, useState, type ReactNode } from 'react';
import { Pressable, Text as CssText, View } from 'react-native-css/components';
import { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { cn } from '../../lib/cn.ts';
import { Icon } from '../icon/icon.tsx';
import { dayNumber, isoOf, weekdayOf, WEEKDAYS } from './dates.ts';
import type { ChartCommonProps } from './bar-chart.tsx';
import { ChartFrame, decor, Ink, pct, useWidth, WEB, type ChartPoint } from './parts.tsx';
import { bgTone, inkTone, seriesTone, type ChartTone } from './tones.ts';

export interface DonutSlice extends ChartPoint {
  tone?: ChartTone;
}

export interface DonutChartProps extends ChartCommonProps {
  data: readonly DonutSlice[];
  /** Across, in points. 150 on a phone. */
  size?: number;
  /**
   * In the hole. Defaults to the total, which is what a reader looks for
   * first; `null` for an empty hole.
   */
  center?: ReactNode;
  /** A word under the centre figure: "people", "Permanent". */
  centerLabel?: string;
  /** Drop the legend where the donut is a thumbnail and the card says the rest. */
  showLegend?: boolean;
  /** A thinner ring, for a single share shown as a progress-like figure. */
  thin?: boolean;
  /** Makes each legend row selectable. */
  onSelect?: (slice: DonutSlice, index: number) => void;
  selectedIndex?: number;
}

/**
 * Parts of a whole, up to six, biggest first. The legend prints every value
 * and its share beside its name: an angle is not a number. The rows are the
 * targets, not the arcs, which are too thin for a thumb.
 */
export function DonutChart({
  data,
  label,
  summary,
  size = 150,
  center: centerProp,
  centerLabel,
  showLegend = true,
  thin = false,
  onSelect,
  selectedIndex,
  format = (v) => String(v),
  menuItems,
  className,
}: DonutChartProps): React.JSX.Element {
  const total = data.reduce((sum, slice) => sum + slice.value, 0) || 1;
  const center = centerProp === undefined ? format(total) : centerProp;
  const stroke = size * (thin ? 0.081 : 0.1286);
  const radius = (size - stroke) / 2;
  const c = 2 * Math.PI * radius;
  // A hairline between slices so two of a similar lightness do not merge.
  const gap = data.length > 1 ? 0.008 : 0;
  let offset = 0;

  const ring = (
    <View {...decor} style={{ width: size, height: size }}>
      <Ink width={size} height={size} className="text-surface-sunken">
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
        />
      </Ink>
      {data.map((slice, index) => {
        const fraction = slice.value / total;
        const start = offset;
        offset += fraction;
        const quiet = selectedIndex !== undefined && selectedIndex !== index;
        const length = Math.max(fraction - gap, fraction / 2) * c;
        return (
          <Ink
            key={`${slice.label}-${String(index)}`}
            width={size}
            height={size}
            className={quiet ? 'text-surface-active' : inkTone[slice.tone ?? seriesTone(index)]}
          >
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth={stroke}
              strokeDasharray={`${length.toFixed(2)} ${c.toFixed(2)}`}
              // From twelve o'clock, where the slice before ended: a circle's path starts at three.
              transform={`rotate(${(start * 360 - 90).toFixed(2)} ${String(size / 2)} ${String(size / 2)})`}
            />
          </Ink>
        );
      })}
      {center === null ? null : (
        <View className="absolute inset-0 items-center justify-center">
          {typeof center === 'string' || typeof center === 'number' ? (
            <>
              <CssText
                className="font-bold text-fg tabular-nums"
                // In points: a unitless `leading-none` becomes 1pt where the size is inline.
                style={{
                  fontSize: Math.round(size * 0.17),
                  lineHeight: Math.round(size * 0.17),
                  letterSpacing: -0.03 * size * 0.17,
                }}
              >
                {center}
              </CssText>
              {centerLabel === undefined ? null : (
                <CssText className="mt-1 text-[12px] leading-[1.3] font-medium text-fg-muted">
                  {centerLabel}
                </CssText>
              )}
            </>
          ) : (
            center
          )}
        </View>
      )}
    </View>
  );

  return (
    <ChartFrame
      label={label}
      summary={summary}
      rows={data}
      format={format}
      menuItems={menuItems}
      className={cn('flex-row flex-wrap items-center gap-6', className)}
    >
      {ring}
      {showLegend ? (
        <View className="min-w-[200px] flex-1">
          {data.map((slice, index) => {
            const share = Math.round((slice.value / total) * 100);
            const selected = selectedIndex === index;
            const row = (
              <>
                <View
                  className={cn('size-2.5 rounded-[3px]', bgTone[slice.tone ?? seriesTone(index)])}
                />
                <CssText
                  numberOfLines={1}
                  className="flex-1 text-subhead leading-[1.2] font-medium text-fg"
                >
                  {slice.label}
                </CssText>
                <CssText className="text-subhead leading-none font-semibold text-fg tabular-nums">
                  {format(slice.value)}
                </CssText>
                <CssText className="w-10 text-right text-[14px] leading-none text-fg-muted tabular-nums">
                  {`${String(share)}%`}
                </CssText>
              </>
            );
            const rowClass = cn(
              'min-h-8 flex-row items-center gap-2.5',
              index < data.length - 1 && 'border-b border-border',
              selectedIndex !== undefined && !selected && 'opacity-50',
            );
            return onSelect ? (
              <Pressable
                key={`${slice.label}-${String(index)}`}
                accessibilityLabel={`${slice.label}: ${format(slice.value)}, ${String(share)}%`}
                {...(WEB
                  ? { role: 'button' as const, 'aria-pressed': selected }
                  : { accessibilityRole: 'button' as const, accessibilityState: { selected } })}
                onPress={() => {
                  onSelect(slice, index);
                }}
                className={cn(rowClass, 'min-h-m-tap')}
              >
                {row}
              </Pressable>
            ) : (
              <View key={`${slice.label}-${String(index)}`} {...decor} className={rowClass}>
                {row}
              </View>
            );
          })}
        </View>
      ) : null}
    </ChartFrame>
  );
}

export interface HeatmapCell {
  /** Row key: a person, a team, a week. */
  row: string;
  /** Column key: a date, a day. */
  column: string;
  value: number;
}

export interface HeatmapChartProps extends ChartCommonProps {
  rows: readonly string[];
  columns: readonly string[];
  cells: readonly HeatmapCell[];
  tone?: ChartTone;
  /** What a column prints over its cells: "M" for Monday. The key when omitted. */
  columnLabel?: (column: string) => string;
  /** Prints the row keys down the left. */
  showRowLabels?: boolean;
  /** What a row prints down the left: "" to skip one. The key when omitted. */
  rowLabel?: (row: string) => string;
  /** The ends of the scale key. "0" and the top of the scale when omitted. */
  scaleLabels?: readonly [string, string];
  /** Turns a value into its cell's description: "3 days of leave". */
  describe?: (value: number, row: string, column: string) => string;
  /** Prints each value in its cell. */
  showValues?: boolean;
  /** Upper bound for the colour scale: lock two heatmaps to one. The largest value when omitted. */
  max?: number;
  /** The key under the grid, from nothing to `max`. */
  showScale?: boolean;
  /** A cell's width over its height. Square by default. */
  cellRatio?: number;
  onSelect?: (cell: HeatmapCell) => void;
}

/**
 * The key under a heatmap: the ramp from nothing to the most, its ends named.
 */
export function ChartScaleKey({
  tone,
  low,
  high,
}: {
  tone: ChartTone;
  low: string;
  high: string;
}): React.JSX.Element {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [width, onLayout] = useWidth();
  return (
    <View {...decor} className="mt-3 flex-row items-center gap-2">
      <CssText className="text-[11px] leading-none font-medium text-fg-subtle">{low}</CssText>
      <View
        onLayout={onLayout}
        className="h-2 max-w-40 min-w-6 flex-1 overflow-hidden rounded-full bg-surface-sunken"
      >
        {width > 0 ? (
          <Ink width={width} height={8} className={inkTone[tone]}>
            {(color) => (
              <>
                <Defs>
                  <LinearGradient id={`ramp${id}`} x1="0" y1="0" x2="1" y2="0">
                    <Stop offset="0" stopColor={color} stopOpacity={0} />
                    <Stop offset="1" stopColor={color} stopOpacity={1} />
                  </LinearGradient>
                </Defs>
                <Rect width={width} height={8} fill={`url(#ramp${id})`} />
              </>
            )}
          </Ink>
        ) : null}
      </View>
      <CssText className="text-[11px] leading-none font-medium text-fg-subtle">{high}</CssText>
    </View>
  );
}

/**
 * Intensity across two dimensions: one hue, stronger for more, over the
 * sunken fill. Every cell is named for a screen reader, and a tap on one
 * says its number.
 */
export function HeatmapChart({
  rows,
  columns,
  cells,
  label,
  summary,
  tone = 'accent',
  columnLabel,
  showRowLabels = true,
  rowLabel,
  scaleLabels,
  describe,
  showValues = false,
  max: maxProp,
  showScale = true,
  cellRatio = 1,
  onSelect,
  format = (v) => String(v),
  menuItems,
  className,
}: HeatmapChartProps): React.JSX.Element {
  const lookup = new Map(cells.map((cell) => [`${cell.row}\u0000${cell.column}`, cell]));
  const max = maxProp ?? Math.max(...cells.map((cell) => cell.value), 0);
  const [inspected, setInspected] = useState<string | undefined>();
  const heads = columns.map((column) => (columnLabel ? columnLabel(column) : column));
  const say = (cell: HeatmapCell): string =>
    describe
      ? describe(cell.value, cell.row, cell.column)
      : `${cell.row}, ${cell.column}: ${format(cell.value)}`;

  return (
    <ChartFrame
      label={label}
      summary={summary}
      rows={cells.map((cell) => ({ label: `${cell.row}, ${cell.column}`, value: cell.value }))}
      format={format}
      menuItems={menuItems}
      className={cn('w-full', className)}
    >
      <View className="gap-[3px]">
        {heads.some(Boolean) ? (
          <View {...decor} className="flex-row gap-[3px]">
            {showRowLabels ? <View className="w-9" /> : null}
            {heads.map((head, index) => (
              <View key={`${head}-${String(index)}`} className="min-w-0 flex-1 pb-1">
                <CssText className="text-center text-[11px] leading-none font-medium text-fg-subtle">
                  {head}
                </CssText>
              </View>
            ))}
          </View>
        ) : null}
        {rows.map((row) => (
          <View key={row} className="flex-row items-center gap-[3px]">
            {showRowLabels ? (
              <CssText
                {...decor}
                numberOfLines={1}
                className="w-9 text-[12px] leading-none font-medium text-fg-muted"
              >
                {rowLabel ? rowLabel(row) : row}
              </CssText>
            ) : null}
            {columns.map((column, index) => {
              const cell = lookup.get(`${row}\u0000${column}`);
              const key = `${row}\u0000${column}`;
              const strength = cell && max > 0 ? Math.min(cell.value / max, 1) : 0;
              return (
                <Pressable
                  key={`${column}-${String(index)}`}
                  {...(cell
                    ? {
                        accessibilityLabel: say(cell),
                        accessibilityRole: onSelect ? ('button' as const) : ('image' as const),
                      }
                    : { accessible: false })}
                  onPress={() => {
                    if (!cell) return;
                    if (onSelect) onSelect(cell);
                    else setInspected(inspected === key ? undefined : key);
                  }}
                  className={cn(
                    'relative min-w-0 flex-1 items-center justify-center overflow-hidden rounded-[5px]',
                    cell ? 'bg-surface-sunken' : 'border border-border',
                    inspected === key && 'outline-2 outline-offset-1 outline-fg',
                  )}
                  style={{ aspectRatio: cellRatio }}
                >
                  {cell ? (
                    <View
                      {...decor}
                      className={cn('absolute inset-0', bgTone[tone])}
                      style={{ opacity: strength }}
                    />
                  ) : null}
                  {(showValues || inspected === key) && cell ? (
                    <CssText
                      {...decor}
                      className={cn(
                        'text-[11px] leading-none font-semibold tabular-nums',
                        strength > 0.55 ? 'text-white' : 'text-fg-muted',
                      )}
                    >
                      {format(cell.value)}
                    </CssText>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
      {showScale ? (
        <ChartScaleKey
          tone={tone}
          low={scaleLabels?.[0] ?? '0'}
          high={scaleLabels?.[1] ?? format(max)}
        />
      ) : null}
    </ChartFrame>
  );
}

export interface FunnelStage extends ChartPoint {
  tone?: ChartTone;
}

export interface FunnelChartProps extends ChartCommonProps {
  data: readonly FunnelStage[];
  /** Prints the share that carries on between consecutive stages. */
  showConversion?: boolean;
  /** Paints the stage after the worst step in the danger tone, and says so. */
  highlightBiggestDrop?: boolean;
  /** The colour of every stage that names none of its own. */
  tone?: ChartTone;
  onSelect?: (stage: FunnelStage, index: number) => void;
  selectedIndex?: number;
}

/**
 * How many make it through each stage. Bars on a shared start, not a
 * trapezoid: length is the comparison an eye is good at. The share that
 * carries on is printed between stages, and a stage bigger than the one
 * before is called out rather than drawn as if it narrowed.
 */
export function FunnelChart({
  data,
  label,
  summary,
  showConversion = true,
  highlightBiggestDrop = false,
  tone = 'chart-1',
  onSelect,
  selectedIndex,
  format = (v) => v.toLocaleString('en-GB'),
  menuItems,
  className,
}: FunnelChartProps): React.JSX.Element {
  const max = Math.max(...data.map((stage) => stage.value), 1);
  const conversions = data.map((stage, i) => {
    const before = data[i - 1];
    return before && before.value > 0 ? Math.round((stage.value / before.value) * 100) : null;
  });
  let worst = -1;
  if (highlightBiggestDrop) {
    let lowest = Infinity;
    conversions.forEach((conversion, i) => {
      if (conversion !== null && conversion < lowest) {
        lowest = conversion;
        worst = i;
      }
    });
  }

  return (
    <ChartFrame
      label={label}
      summary={summary}
      rows={data}
      format={format}
      menuItems={menuItems}
      className={cn('w-full gap-1.5', className)}
    >
      {data.map((stage, i) => {
        const conversion = conversions[i] ?? null;
        const isWorst = worst === i;
        const up = conversion !== null && conversion > 100;
        const selected = selectedIndex === i;
        const readout = `${stage.label}: ${format(stage.value)}${
          conversion === null ? '' : `, ${String(conversion)}% of the stage before`
        }`;
        return (
          <View key={`${stage.label}-${String(i)}`} className="gap-1.5">
            {showConversion && conversion !== null ? (
              <View {...decor} className="flex-row items-center gap-1.5">
                <Icon
                  icon={up ? ArrowUp : ArrowDown}
                  size={12}
                  tone={isWorst ? 'danger' : up ? 'warning' : 'subtle'}
                />
                <CssText
                  className={cn(
                    'text-[12px] leading-none font-semibold',
                    isWorst ? 'text-danger-fg' : up ? 'text-warning-fg' : 'text-fg-subtle',
                  )}
                >
                  {`${String(conversion)}% ${up ? '· more than the step before' : 'continue'}${
                    isWorst ? ' · biggest drop' : ''
                  }`}
                </CssText>
              </View>
            ) : null}
            <Pressable
              accessibilityLabel={readout}
              {...(onSelect
                ? WEB
                  ? { role: 'button' as const, 'aria-pressed': selected }
                  : { accessibilityRole: 'button' as const, accessibilityState: { selected } }
                : { accessibilityRole: 'image' as const })}
              {...(onSelect
                ? {
                    onPress: () => {
                      onSelect(stage, i);
                    },
                  }
                : {})}
              className={cn('gap-1.5', selectedIndex !== undefined && !selected && 'opacity-50')}
            >
              <CssText {...decor} className="text-subhead leading-[1.2] font-medium text-fg-muted">
                {stage.label}
              </CssText>
              <View {...decor} className="flex-row items-center gap-2.5">
                <View
                  className={cn(
                    'h-[26px] rounded-[8px]',
                    isWorst ? 'bg-danger-fg' : bgTone[stage.tone ?? tone],
                  )}
                  style={{
                    width: pct((stage.value / max) * 100 * 0.82),
                    minWidth: 4,
                    opacity: Math.max(0.4, 1 - i * 0.1),
                  }}
                />
                <CssText className="text-subhead leading-none font-semibold text-fg tabular-nums">
                  {format(stage.value)}
                </CssText>
              </View>
            </Pressable>
          </View>
        );
      })}
    </ChartFrame>
  );
}

export interface CalendarDay {
  /** A calendar date, `YYYY-MM-DD`. Not a timestamp: a day has no time zone. */
  date: string;
  value: number;
}

export interface CalendarHeatmapProps extends ChartCommonProps {
  data: readonly CalendarDay[];
  /** First day shown, `YYYY-MM-DD`. */
  from: string;
  /** Last day shown, `YYYY-MM-DD`, inclusive. */
  to: string;
  tone?: ChartTone;
  /** Top of the colour scale. The busiest day when omitted. */
  max?: number;
  /** The day's sentence for a screen reader: "3 people off sick". */
  describe?: (value: number, date: string) => string;
  /** The ends of the scale key: "0" and "6+". */
  scaleLabels?: readonly [string, string];
}

/**
 * Activity per day across months: weeks run left to right, Monday to Sunday
 * top to bottom, and darker means more. Dates are days, never timestamps,
 * so no spring or autumn loses one. A screen reader hears the busy days, not
 * a season of zeros.
 */
export function CalendarHeatmap({
  data,
  from,
  to,
  label,
  summary,
  tone = 'chart-1',
  max,
  describe,
  scaleLabels,
  format = (v) => String(v),
  menuItems,
  className,
}: CalendarHeatmapProps): React.JSX.Element {
  const first = dayNumber(from);
  const last = dayNumber(to);
  // Days since the epoch: 0 was a Thursday, so Monday is (day + 3) % 7 === 0.
  const weekday = weekdayOf;
  const start = first - weekday(first);
  const weeks = Math.ceil((last - start + 1) / 7);
  const values = new Map(data.map((d) => [dayNumber(d.date), d.value]));
  const columns = Array.from({ length: weeks }, (_, w) => isoOf(start + w * 7));
  const cells: HeatmapCell[] = [];
  for (let day = first; day <= last; day += 1) {
    cells.push({
      row: WEEKDAYS[weekday(day)] ?? '',
      column: columns[Math.floor((day - start) / 7)] ?? '',
      value: values.get(day) ?? 0,
    });
  }
  const dateOf = (row: string, column: string): string =>
    isoOf(dayNumber(column) + WEEKDAYS.indexOf(row));
  return (
    <HeatmapChart
      label={label}
      {...(summary === undefined ? {} : { summary })}
      rows={WEEKDAYS}
      columns={columns}
      cells={cells}
      tone={tone}
      columnLabel={() => ''}
      rowLabel={(row) => (WEEKDAYS.indexOf(row) % 2 === 0 ? row : '')}
      {...(max === undefined ? {} : { max })}
      {...(scaleLabels === undefined ? {} : { scaleLabels })}
      describe={(value, row, column) => {
        const date = dateOf(row, column);
        return describe ? describe(value, date) : `${date}: ${format(value)}`;
      }}
      format={format}
      {...(menuItems === undefined ? {} : { menuItems })}
      className={className}
    />
  );
}
