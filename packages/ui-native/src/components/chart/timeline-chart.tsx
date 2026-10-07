import { useRef, useState, type ReactNode } from 'react';
import { Pressable, Text as CssText, View } from 'react-native-css/components';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Line } from 'react-native-svg';

import { cn } from '../../lib/cn.ts';
import {
  dayNumber,
  isoOf,
  isoWeek,
  MONTHS,
  shortDate,
  weekdayOf,
  WEEKDAYS,
  type IsoDate,
} from './dates.ts';
import { ChartFrame, decor, Ink, useWidth, WEB } from './parts.tsx';
import { bgTone, borderTone, type ChartTone, softTone, solidTone } from './tones.ts';

export interface TimelineEntry {
  id: string;
  label: string;
  /** Inclusive ISO start date. */
  start: IsoDate;
  /** Inclusive ISO end date. Omit for a milestone: a day, drawn as a diamond. */
  end?: IsoDate;
  tone?: ChartTone;
  /** Pins the item: no dragging. */
  locked?: boolean;
  /** `pill` rounds the ends fully: a state across dates, such as a hiring freeze. */
  shape?: 'bar' | 'pill';
  /** Not confirmed yet: an outline with no fill, and said in words. */
  tentative?: boolean;
  /** A real conflict in the lane: a red outline, and said in words. */
  clash?: boolean;
  /** The full colour with white text, for the one thing that must be seen: a cover gap. */
  emphasis?: boolean;
}

export interface TimelineRow {
  /** The lane: a person, a team. */
  label: string;
  /** Before the label: an `Avatar` for a person. */
  leading?: ReactNode;
  /** A small square in this tone before the label, to tell lanes apart. */
  tone?: ChartTone;
  items: readonly TimelineEntry[];
}

export type TimelineUnit = 'day' | 'week' | 'month';
export type TimelineSeparator = 'line' | 'banded' | 'both';

/** A reschedule the caller applies; the chart never changes its input. */
export interface TimelineMove {
  id: string;
  from: { start: IsoDate; end?: IsoDate };
  to: { start: IsoDate; end?: IsoDate };
}

export interface TimelineChartProps {
  rows: readonly TimelineRow[];
  label: string;
  summary?: string;
  /** The first and last day drawn. */
  domain: { start: IsoDate; end: IsoDate };
  /** One column a day, a week or a month. */
  unit?: TimelineUnit;
  /** The day the "now" line is drawn on. Never `new Date()`: the caller says. */
  today?: IsoDate;
  /** Hatches Saturdays and Sundays, on a day axis. */
  shadeWeekends?: boolean;
  separator?: TimelineSeparator;
  /** The lane-label column, in points. 80 on a phone. */
  labelWidth?: number;
  formatTick?: (iso: IsoDate, unit: TimelineUnit) => string;
  onSelect?: (item: TimelineEntry, row: TimelineRow) => void;
  selectedId?: string;
  /**
   * Lets a bar be moved: long-press it and drag along the lane, or use the
   * screen reader's "later" and "earlier" actions. An affordance, not a
   * permission: whatever writes the dates authorises the change.
   */
  editable?: boolean;
  onItemMove?: (move: TimelineMove) => void;
  /** A range of days picked across the lanes. */
  selection?: { start: IsoDate; end: IsoDate };
  /** Drag across empty days to pick a range: then the caller offers what to do with it. */
  onSelectionChange?: (range: { start: IsoDate; end: IsoDate }) => void;
  className?: string | undefined;
}

/** A day nobody works: diagonal hatching in the strong fill, as the design draws weekends. */
function Hatch({
  left,
  width,
  height,
}: {
  left: number;
  width: number;
  height: number;
}): React.JSX.Element {
  const lines = Math.ceil((width + height) / 7);
  return (
    <View
      {...decor}
      className="pointer-events-none absolute top-0 bottom-0 overflow-hidden"
      style={{ left, width }}
    >
      <Ink width={width} height={height} className="text-surface-active">
        {Array.from({ length: lines }, (_, i) => (
          <Line
            key={i}
            x1={i * 7 - height}
            y1={height}
            x2={i * 7}
            y2={0}
            stroke="currentColor"
            strokeWidth={2}
          />
        ))}
      </Ink>
    </View>
  );
}

interface Tick {
  key: string;
  label: string;
  from: number;
  to: number;
}

function ticksOf(
  start: number,
  end: number,
  unit: TimelineUnit,
  format?: TimelineChartProps['formatTick'],
): Tick[] {
  const ticks: Tick[] = [];
  let at = start;
  while (at <= end) {
    const date = new Date(at * 86_400_000);
    let next = at + 1;
    let label = WEEKDAYS[weekdayOf(at)] ?? '';
    if (unit === 'week') {
      next = at + 7 - weekdayOf(at);
      label = `W${String(isoWeek(at))}`;
    } else if (unit === 'month') {
      next = dayNumber(
        isoOf(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / 86_400_000),
      );
      label = MONTHS[date.getUTCMonth()] ?? '';
    }
    ticks.push({
      key: isoOf(at),
      label: format ? format(isoOf(at), unit) : label,
      from: at,
      to: Math.min(next, end + 1),
    });
    at = next;
  }
  return ticks;
}

/** Items that overlap stack into sub-lanes, first come first placed. */
function stack(items: readonly TimelineEntry[]): Map<string, number> {
  const ends: number[] = [];
  const out = new Map<string, number>();
  for (const item of [...items].toSorted((a, b) => dayNumber(a.start) - dayNumber(b.start))) {
    const s = dayNumber(item.start);
    const e = dayNumber(item.end ?? item.start);
    let line = ends.findIndex((end) => end < s);
    if (line === -1) line = ends.length;
    ends[line] = e;
    out.set(item.id, line);
  }
  return out;
}

/**
 * Who is doing what, and when: lanes of people or teams, bars across days.
 * A tap on a bar selects it; a long-press lifts it to move, and the move is
 * also two screen-reader actions. Every bar is read with its dates and
 * whether it is tentative or clashing, never only by its colour or outline.
 */
export function TimelineChart({
  rows,
  label,
  summary,
  domain,
  unit = 'day',
  today,
  shadeWeekends = true,
  separator = 'line',
  labelWidth = 80,
  formatTick,
  onSelect,
  selectedId,
  editable = false,
  onItemMove,
  selection,
  onSelectionChange,
  className,
}: TimelineChartProps): React.JSX.Element {
  const [width, onLayout] = useWidth();
  const first = dayNumber(domain.start);
  const last = dayNumber(domain.end);
  const days = last - first + 1;
  const ticks = ticksOf(first, last, unit, formatTick);
  const plot = Math.max(width - labelWidth, 0);
  const x = (day: number): number => ((day - first) / days) * plot;
  const [drag, setDrag] = useState<{ id: string; delta: number } | null>(null);
  const [picking, setPicking] = useState<{ start: number; end: number } | null>(null);
  const anchor = useRef(0);

  const dayAt = (px: number): number =>
    Math.min(last, Math.max(first, first + Math.floor((px / Math.max(plot, 1)) * days)));

  const pick = Gesture.Pan()
    .runOnJS(true)
    .enabled(onSelectionChange !== undefined)
    .activeOffsetX([-8, 8])
    .failOffsetY([-10, 10])
    .onBegin((e) => {
      anchor.current = dayAt(e.x - labelWidth);
    })
    .onUpdate((e) => {
      const at = dayAt(e.x - labelWidth);
      const start = Math.min(anchor.current, at);
      const end = Math.max(anchor.current, at);
      // A day is many frames wide: the same range keeps the same state, so nothing redraws.
      setPicking((now) => (now?.start === start && now.end === end ? now : { start, end }));
    })
    .onEnd((e) => {
      const at = dayAt(e.x - labelWidth);
      onSelectionChange?.({
        start: isoOf(Math.min(anchor.current, at)),
        end: isoOf(Math.max(anchor.current, at)),
      });
      setPicking(null);
    });

  const range =
    picking ??
    (selection ? { start: dayNumber(selection.start), end: dayNumber(selection.end) } : null);
  const todayDay = today === undefined ? undefined : dayNumber(today);
  const rowsForTable = rows.flatMap((row) =>
    row.items.map((item) => ({
      label: `${row.label}, ${item.label}, ${shortDate(dayNumber(item.start))}${item.end ? ` to ${shortDate(dayNumber(item.end))}` : ''}`,
      value: dayNumber(item.end ?? item.start) - dayNumber(item.start) + 1,
    })),
  );

  const move = (item: TimelineEntry, delta: number): void => {
    if (delta === 0 || !onItemMove) return;
    onItemMove({
      id: item.id,
      from: { start: item.start, ...(item.end ? { end: item.end } : {}) },
      to: {
        start: isoOf(dayNumber(item.start) + delta),
        ...(item.end ? { end: isoOf(dayNumber(item.end) + delta) } : {}),
      },
    });
  };

  return (
    <ChartFrame
      label={label}
      summary={summary}
      rows={rowsForTable}
      valueLabel="Days"
      className={cn('w-full', className)}
    >
      <GestureDetector gesture={pick}>
        <View onLayout={onLayout} className="relative">
          <View {...decor} className="h-8 flex-row items-center border-b border-border">
            <View style={{ width: labelWidth }} />
            {ticks.map((tick) => {
              const isToday = todayDay !== undefined && todayDay >= tick.from && todayDay < tick.to;
              const off = unit === 'day' && shadeWeekends && weekdayOf(tick.from) >= 5;
              return (
                // A label may run a little past its column, as the design's do, rather than
                // truncate "Mon" to "M…" on a narrow day.
                <View
                  key={tick.key}
                  className="items-center"
                  style={{ width: x(tick.to) - x(tick.from) }}
                >
                  <CssText
                    className={cn(
                      '-mx-2 text-center text-[11px] leading-none font-semibold',
                      isToday ? 'text-accent-fg' : off ? 'text-fg-subtle' : 'text-fg-muted',
                    )}
                    style={{ width: x(tick.to) - x(tick.from) + 16 }}
                  >
                    {tick.label}
                  </CssText>
                </View>
              );
            })}
          </View>
          {rows.map((row, r) => {
            const lines = stack(row.items);
            const depth = Math.max(1, ...[...lines.values()].map((l) => l + 1));
            const height = depth > 1 ? Math.max(48, 10 + depth * 21) + 14 : 48;
            return (
              <View
                key={row.label}
                className={cn(
                  'relative flex-row items-center',
                  separator !== 'banded' && 'border-b border-border',
                  separator !== 'line' && r % 2 === 1 && 'bg-surface-sunken',
                )}
                style={{ minHeight: height }}
              >
                <View className="flex-row items-center gap-2 pr-2" style={{ width: labelWidth }}>
                  {row.leading}
                  {row.tone ? (
                    <View className={cn('size-2 rounded-[3px]', bgTone[row.tone])} />
                  ) : null}
                  <CssText
                    numberOfLines={1}
                    className="shrink text-footnote leading-[1.2] font-medium text-fg"
                  >
                    {row.label}
                  </CssText>
                </View>
                {unit === 'day' && shadeWeekends
                  ? ticks
                      .filter((tick) => weekdayOf(tick.from) >= 5)
                      .map((tick) => (
                        <Hatch
                          key={tick.key}
                          left={labelWidth + x(tick.from)}
                          width={x(tick.to) - x(tick.from)}
                          height={height}
                        />
                      ))
                  : null}
                {row.items.map((item) => {
                  const s = dayNumber(item.start);
                  const e = item.end === undefined ? undefined : dayNumber(item.end);
                  const tone = item.tone ?? 'accent';
                  const line = lines.get(item.id) ?? 0;
                  const selected = selectedId === item.id;
                  const moving = drag?.id === item.id ? drag.delta : 0;
                  const said = `${item.label}, ${row.label}, ${shortDate(s)}${e === undefined ? '' : ` to ${shortDate(e)}`}${item.tentative ? ', tentative' : ''}${item.clash ? ', clashes with another item' : ''}`;
                  const canMove = editable && !item.locked && onItemMove !== undefined;
                  const lift = Gesture.Pan()
                    .runOnJS(true)
                    .enabled(canMove)
                    .activateAfterLongPress(350)
                    .onUpdate((ev) => {
                      const delta = Math.round((ev.translationX / Math.max(plot, 1)) * days);
                      // Redraw on a new day, not on every frame of the finger.
                      setDrag((now) =>
                        now?.id === item.id && now.delta === delta ? now : { id: item.id, delta },
                      );
                    })
                    .onEnd((ev) => {
                      move(item, Math.round((ev.translationX / Math.max(plot, 1)) * days));
                    })
                    .onFinalize(() => {
                      setDrag(null);
                    });
                  const a11y = {
                    accessibilityLabel: said,
                    ...(onSelect
                      ? WEB
                        ? { role: 'button' as const, 'aria-pressed': selected }
                        : { accessibilityRole: 'button' as const, accessibilityState: { selected } }
                      : { accessibilityRole: 'image' as const }),
                    ...(canMove
                      ? {
                          accessibilityActions: [
                            { name: 'later', label: 'Move a day later' },
                            { name: 'earlier', label: 'Move a day earlier' },
                          ],
                          onAccessibilityAction: (event: {
                            nativeEvent: { actionName: string };
                          }) => {
                            move(item, event.nativeEvent.actionName === 'later' ? 1 : -1);
                          },
                        }
                      : {}),
                  };
                  const press = onSelect
                    ? {
                        onPress: () => {
                          onSelect(item, row);
                        },
                      }
                    : {};
                  if (e === undefined) {
                    return (
                      <Pressable
                        key={item.id}
                        {...a11y}
                        {...press}
                        className="absolute flex-row items-center"
                        style={{ left: labelWidth + x(s + 0.5) - 7, top: height / 2 - 7 }}
                      >
                        <View className={cn('size-3.5 rotate-45 rounded-[3px]', bgTone[tone])} />
                        {item.label ? (
                          <CssText
                            {...decor}
                            numberOfLines={1}
                            className={cn(
                              'ml-1.5 text-[12px] leading-none font-semibold',
                              softTone[tone].text,
                            )}
                          >
                            {item.label}
                          </CssText>
                        ) : null}
                      </Pressable>
                    );
                  }
                  const left = labelWidth + x(s + moving) + 2;
                  const barWidth = Math.max(x(e + 1) - x(s) - 4, 6);
                  const bar = (key?: string) => (
                    <Pressable
                      key={key}
                      {...a11y}
                      {...press}
                      className={cn(
                        'absolute flex-row items-center overflow-hidden px-2',
                        item.shape === 'pill' ? 'rounded-full' : 'rounded-[8px]',
                        item.tentative
                          ? cn('border-[1.5px] bg-transparent', borderTone[tone])
                          : item.emphasis
                            ? solidTone[tone]
                            : softTone[tone].bg,
                        item.clash && 'border-2 border-danger',
                        selected && 'outline-2 outline-offset-2 outline-accent',
                        moving !== 0 && 'z-10 shadow-lg',
                      )}
                      style={{
                        left,
                        width: barWidth,
                        ...(depth > 1
                          ? { top: 7 + line * 21, height: 18 }
                          : { top: height / 2 - 14, height: 28 }),
                        ...(moving !== 0 ? { transform: [{ translateY: -3 }] } : {}),
                      }}
                    >
                      <CssText
                        {...decor}
                        numberOfLines={1}
                        className={cn(
                          'text-[12px] leading-none font-semibold',
                          item.emphasis && !item.tentative ? 'text-white' : softTone[tone].text,
                        )}
                      >
                        {moving !== 0
                          ? `${item.label} · ${shortDate(s + moving)}–${shortDate(e + moving)}`
                          : item.label}
                      </CssText>
                    </Pressable>
                  );
                  return canMove ? (
                    <GestureDetector key={item.id} gesture={lift}>
                      {bar()}
                    </GestureDetector>
                  ) : (
                    bar(item.id)
                  );
                })}
                {todayDay !== undefined && todayDay >= first && todayDay <= last ? (
                  <View
                    {...decor}
                    className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 bg-accent"
                    style={{ left: labelWidth + x(todayDay + 0.5) - 1 }}
                  />
                ) : null}
              </View>
            );
          })}
          {range ? (
            <View
              {...decor}
              className="pointer-events-none absolute bottom-0 rounded-[4px] border-[1.5px] border-accent"
              style={{
                top: 32,
                left: labelWidth + x(range.start),
                width: x(range.end + 1) - x(range.start),
              }}
            >
              <View className="absolute inset-0 bg-accent opacity-[0.12]" />
            </View>
          ) : null}
        </View>
      </GestureDetector>
    </ChartFrame>
  );
}
