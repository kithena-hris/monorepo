'use client';

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type Announcements,
  type KeyboardCoordinateGetter,
  type Modifier,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

import { cn } from '../../lib/cn';
import { springEasing, springSettleTime, springs } from '../../lib/spring';
import { useCoarsePointer, usePrefersReducedMotion } from '../../lib/use-media-query';
import { addMonths, formatIsoDate, parseIsoDate, type IsoDate } from '../calendar/calendar';
import { Tooltip } from '../tooltip/tooltip';
import {
  ChartFrame,
  ChartMarquee,
  ChartZoomControls,
  useChartWindow,
  useDragZoom,
} from './chart-window';
import { bgTone, type ChartInteractionProps, type ChartTone } from './chart';

/**
 * A schedule drawn against a date axis: onboarding plans, leave cover,
 * assignments, probation and notice periods. A Gantt chart, in other words,
 * for the things an HRIS actually schedules.
 *
 * ### Dates are calendar dates, not timestamps
 *
 * Every date here is an ISO `YYYY-MM-DD` string, parsed as UTC. A hire date is
 * a date, not an instant: parsing `'2026-02-01'` with `new Date()` in a
 * negative-offset timezone yields the 31st of January, and a bar that starts a
 * day early in Denver and on time in Berlin is a bug nobody reproduces. All
 * the arithmetic below is on integer day numbers for the same reason, no DST,
 * no drift, no hour that happens twice.
 *
 * ### It never reads the clock
 *
 * The "today" marker is a prop. A component that calls `new Date()` renders
 * differently on every run, which makes it untestable and makes a screenshot
 * diff meaningless, the same reason domain code takes an injected `Clock`.
 *
 * ### Overlapping items stack, they never intersect
 *
 * Two things happening to one person at the same time is the normal case, a
 * handover running past a last day, cover overlapping the leave it covers, so
 * a lane splits into as many sub-lanes as it takes and gets taller. Drawing
 * them on top of each other would hide one of them entirely, and hiding a
 * conflict is exactly the opposite of what this chart is opened for.
 *
 * ### Rescheduling is a drag, and also not
 *
 * With `editable`, a bar drags along the axis, resizes by either end, and drops
 * onto another lane. It snaps to whole days, because a schedule has no sub-day
 * resolution and a bar landing on "the 3rd and a bit" has dates that cannot be
 * written down.
 *
 * The drag writes transforms straight onto the element rather than going
 * through state: twenty frames a second of React would re-render every bar in
 * the chart for each frame of one gesture. State changes once, on drop, and
 * only through `onItemMove`: the chart never edits its own input.
 *
 * Every gesture has a key behind it. Shift with the arrows moves a bar by a
 * day or a lane, Shift and Alt change the end date, and the result is announced,
 * a reschedule that only works by dragging is a reschedule a large number of
 * people cannot do at all.
 *
 * ### Lanes have edges, and empty ones say so
 *
 * `separator` draws a rule between lanes, a wash behind alternate ones, or
 * both. It earns its keep exactly where it is least obvious: a lane whose
 * items collide splits into sub-lanes and stands several bars tall, and
 * without a boundary nothing says whether the bar below belongs to this person
 * or the next one. `banded` is the one that groups a lane's own sub-lanes
 * together, which a line between lanes cannot do.
 *
 * A lane with nothing in it draws a dashed placeholder rather than a blank
 * strip, "nobody is scheduled" and "the bars failed to render" want very
 * different reactions, and a gap says both. A lane whose items are all outside
 * the current window says *that* instead, because it is a different fact.
 *
 * ### It is a table underneath
 *
 * A row of coloured rectangles is unreadable to a screen reader however many
 * `aria-label`s it carries, so every bar's dates are also written out in a real
 * table below the chart. The bars themselves are focusable and carry the same
 * text, because a tooltip that only opens on hover opens for only half the
 * people reading.
 */

const MS_PER_DAY = 86_400_000;

/** Days since the epoch. */
function toDay(iso: IsoDate): number {
  return Math.round(parseIsoDate(iso) / MS_PER_DAY);
}

function toIso(day: number): IsoDate {
  return formatIsoDate(day * MS_PER_DAY);
}

export interface TimelineEntry {
  id: string;
  label: string;
  /** Inclusive ISO start date. */
  start: IsoDate;
  /**
   * Inclusive ISO end date. Omit for a milestone, a thing that happens on a
   * day rather than across days, drawn as a diamond.
   */
  end?: IsoDate;
  tone?: ChartTone;
  /** `0`–`1`. Draws a completion fill inside the bar. */
  progress?: number;
  /** Pins the item: no dragging, no resizing, no dropping it elsewhere. */
  locked?: boolean;
  /**
   * `pill` rounds the ends fully: a state that runs across dates, such as a
   * hiring freeze, rather than a piece of work with edges.
   */
  shape?: 'bar' | 'pill';
  /** Not confirmed yet: drawn as an outline with no fill, and said in words. */
  tentative?: boolean;
  /**
   * A real conflict with something else in the lane: a red outline, and said
   * in words. Overlap alone is not a clash; the lane already stacks overlaps.
   */
  clash?: boolean;
}

/** How a drag on a bar is being interpreted. */
export type TimelineDragMode = 'move' | 'resize-start' | 'resize-end';

/** A reschedule the caller has to apply, the chart never mutates its input. */
export interface TimelineMove {
  id: string;
  /** Lane it came from, and the one it was dropped on. Equal for a pure reschedule. */
  fromRow: string;
  toRow: string;
  /** The dates it had. */
  from: { start: IsoDate; end?: IsoDate };
  /** The dates it should have. A milestone keeps `end` undefined. */
  to: { start: IsoDate; end?: IsoDate };
  mode: TimelineDragMode;
}

export interface TimelineRow {
  /** The lane: a person, a team, a requisition. */
  label: string;
  /** A second line under the label, a role, a location. */
  meta?: string;
  items: readonly TimelineEntry[];
}

export type TimelineUnit = 'day' | 'week' | 'month';

/**
 * How one lane is told apart from the next.
 *
 * It matters most where it is least obvious: a lane whose items collide splits
 * into sub-lanes and grows several bars tall, and without a boundary there is
 * nothing to say whether the bar below belongs to this person or the next one.
 */
export type TimelineSeparator = 'none' | 'line' | 'banded' | 'both';

/**
 * `gantt` fits the axis to the items and stacks bars with their labels inside.
 * `track` is a plan laid over a fixed axis: thin bars with the label under
 * them, tentative segments hatched, dates called out below the axis, and
 * segments that slide along the axis only, in steps of `snapDays`.
 */
export type TimelineVariant = 'gantt' | 'track';

/** A date called out under the axis: a due date, a deadline. */
export interface TimelineMarker {
  date: IsoDate;
  label: string;
}

export interface TimelineChartProps extends ChartInteractionProps {
  rows: readonly TimelineRow[];
  label: string;
  /** Axis granularity, and the unit a zoom step works in. */
  unit?: TimelineUnit;
  /** ISO date for the "now" line. Omitted means no line, never `new Date()`. */
  today?: IsoDate;
  /**
   * Rules between lanes, a wash behind alternate ones, or both. `banded` is
   * the one to reach for when lanes are several sub-lanes tall: it groups a
   * lane's own bars together, which a line between lanes cannot do.
   */
  separator?: TimelineSeparator;
  /** Upper bound for the lane-label column. It shrinks with the chart. */
  labelWidth?: number;
  /**
   * Height of one sub-lane. A lane whose items overlap splits into several and
   * gets taller, it never packs them closer together.
   */
  rowHeight?: number;
  /** Overrides the axis tick text. Defaults to the reader's own locale. */
  formatTick?: (iso: IsoDate, unit: TimelineUnit) => string;
  /** Overrides the date text in tooltips and the table. */
  formatDate?: (iso: IsoDate) => string;
  onSelect?: (item: TimelineEntry, row: TimelineRow) => void;
  selectedId?: string;

  /**
   * Lets bars be dragged along the axis, resized by their ends, and dropped on
   * another lane.
   *
   * An affordance, not a permission: it decides which handles exist, and
   * nothing else. Whatever writes the new dates has to authorise the change
   * itself, because a rule enforced in a React component is not enforced.
   */
  editable?: boolean;
  /** Veto a particular item, or a particular destination. */
  canMove?: (item: TimelineEntry, from: TimelineRow, to: TimelineRow) => boolean;
  /** Apply the reschedule to your own data. Nothing moves without it. */
  onItemMove?: (move: TimelineMove) => void;
  /** Fires with the item picked up, then with `null` when the drag ends. */
  onDraggingChange?: (item: TimelineEntry | null) => void;
  /**
   * Fires on every release, whether or not anything changed. `applied` is
   * false when the drop was a no-op or was refused, which is exactly the
   * event you want when you are trying to work out why nothing happened.
   */
  onDrop?: (move: TimelineMove, applied: boolean) => void;
  /** Shown when the whole chart has nothing to draw. */
  empty?: ReactNode;
  /** Shown in a lane that has no items at all. */
  emptyRow?: ReactNode;
  /** Shown in a lane whose items are all outside the visible window. */
  emptyWindow?: ReactNode;
  variant?: TimelineVariant;
  /** `track` only: the axis, fixed rather than fitted, so it holds still while a segment moves. */
  domain?: { start: IsoDate; end: IsoDate };
  /** `track` only: the days one drag or arrow step moves a segment by, 7 for whole weeks. */
  snapDays?: number;
  /** `track` only: dates called out under the axis. */
  markers?: readonly TimelineMarker[];
  className?: string;
}

interface Tick {
  key: string;
  label: string;
  /** Inclusive first day. */
  from: number;
  /** Exclusive last day, so `to - from` is the length. */
  to: number;
}

/** The outline a tentative item is drawn with instead of a fill. */
const ghostTone: Record<ChartTone, string> = {
  'chart-1': 'inset-ring-chart-1',
  'chart-2': 'inset-ring-chart-2',
  'chart-3': 'inset-ring-chart-3',
  'chart-4': 'inset-ring-chart-4',
  'chart-5': 'inset-ring-chart-5',
  'chart-6': 'inset-ring-chart-6',
  accent: 'inset-ring-accent',
  success: 'inset-ring-success',
  warning: 'inset-ring-warning',
  danger: 'inset-ring-danger',
  info: 'inset-ring-info',
  neutral: 'inset-ring-fg-subtle',
};

/** What an item's outline says, in words: colour and shape are never the only signal. */
function notes(item: TimelineEntry): string {
  return `${item.tentative === true ? ', tentative' : ''}${item.clash === true ? ', clashes with another item' : ''}`;
}

/** The solid fill: the completed part of a bar, and a milestone. */
const solidTone: Record<ChartTone, string> = {
  'chart-1': 'bg-chart-1',
  'chart-2': 'bg-chart-2',
  'chart-3': 'bg-chart-3',
  'chart-4': 'bg-chart-4',
  'chart-5': 'bg-chart-5',
  'chart-6': 'bg-chart-6',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  neutral: 'bg-fg-subtle',
};

/**
 * The bar itself: a tint, not the full colour. Opacity on the bar would take
 * its label and its progress fill down with it: opacity applies to the whole
 * subtree, so the wash lives in the colour rather than in `opacity`.
 */
const washTone: Record<ChartTone, string> = {
  'chart-1': 'bg-chart-1/20',
  'chart-2': 'bg-chart-2/20',
  'chart-3': 'bg-chart-3/20',
  'chart-4': 'bg-chart-4/20',
  'chart-5': 'bg-chart-5/20',
  'chart-6': 'bg-chart-6/20',
  accent: 'bg-accent/20',
  success: 'bg-success/20',
  warning: 'bg-warning/20',
  danger: 'bg-danger/20',
  info: 'bg-info/20',
  neutral: 'bg-fg-subtle/20',
};

/** The completed part of a bar: stronger than the wash, weaker than the fill,
 *  so the bar's own label stays readable across the join. */
const progressTone: Record<ChartTone, string> = {
  'chart-1': 'bg-chart-1/45',
  'chart-2': 'bg-chart-2/45',
  'chart-3': 'bg-chart-3/45',
  'chart-4': 'bg-chart-4/45',
  'chart-5': 'bg-chart-5/45',
  'chart-6': 'bg-chart-6/45',
  accent: 'bg-accent/45',
  success: 'bg-success/45',
  warning: 'bg-warning/45',
  danger: 'bg-danger/45',
  info: 'bg-info/45',
  neutral: 'bg-fg-subtle/45',
};

const HEADER_HEIGHT = 28;

function defaultTickFormat(iso: IsoDate, unit: TimelineUnit): string {
  const options: Intl.DateTimeFormatOptions =
    unit === 'month'
      ? { month: 'short', year: '2-digit' }
      : unit === 'week'
        ? { day: 'numeric', month: 'short' }
        : { day: 'numeric' };
  // UTC, because the day numbers are UTC. Locale left to the reader: how a
  // date is written is one of the few things a design system must not decide.
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(
    new Date(parseIsoDate(iso)),
  );
}

function defaultDateFormat(iso: IsoDate): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(parseIsoDate(iso)));
}

/**
 * Everything a drag needs, captured once at pointer-down.
 *
 * Held in a ref and written straight to the element: a bar being dragged
 * changes twenty times a second, and putting that through React state would
 * re-render every bar in the chart for each of those frames.
 */
/** An item's position after a drop, held until the caller's `rows` catch up. */
interface Placement {
  rowLabel: string;
  start: IsoDate;
  end?: IsoDate;
}

interface GestureState {
  id: string;
  mode: TimelineDragMode;
  /** Pixels per day at the scale the drag started on. */
  pxPerDay: number;
  startX: number;
  startY: number;
  /** The item's own days, before the drag. */
  from: number;
  to: number;
  /** Lane rectangles, so a vertical drag can be hit-tested against them. */
  laneTops: { label: string; top: number; bottom: number }[];
  originLane: string;
  element: HTMLElement;
  /** How wide it started, for a resize. */
  width: number;
  /**
   * Where the element was drawn when it was picked up, relative to where its
   * layout puts it. Non-zero when it is grabbed mid-settle: the drag carries
   * on from the picture under the finger rather than jumping to the slot.
   */
  baseX: number;
  baseY: number;
  /** How far up and down it may travel, so it cannot leave the plot. */
  minY: number;
  maxY: number;
  /** The result so far, committed on pointer-up. */
  dayShift: number;
  targetLane: string;
  moved: boolean;
}

/** A fraction of the visible span, as a CSS length. */
function percent(value: number): string {
  return `${String(value * 100)}%`;
}

/** Monday of the week containing `day`. Epoch day 0 was a Thursday. */
function startOfWeek(day: number): number {
  return day - ((day + 3) % 7);
}

function buildTicks(
  first: number,
  last: number,
  unit: TimelineUnit,
  format: (iso: IsoDate, unit: TimelineUnit) => string,
): Tick[] {
  const ticks: Tick[] = [];

  if (unit === 'month') {
    let cursor = `${toIso(first).slice(0, 7)}-01`;
    while (toDay(cursor) <= last) {
      const next = addMonths(cursor, 1);
      ticks.push({
        key: cursor,
        label: format(cursor, unit),
        from: toDay(cursor),
        to: toDay(next),
      });
      cursor = next;
    }
    return ticks;
  }

  const step = unit === 'week' ? 7 : 1;
  let cursor = unit === 'week' ? startOfWeek(first) : first;
  while (cursor <= last) {
    const iso = toIso(cursor);
    ticks.push({ key: iso, label: format(iso, unit), from: cursor, to: cursor + step });
    cursor += step;
  }
  return ticks;
}

interface PlacedItem {
  item: TimelineEntry;
  /** Inclusive first day. */
  from: number;
  /** Exclusive last day. A milestone occupies its own day and no more. */
  to: number;
  /** Which sub-lane of the row it was packed into. */
  lane: number;
}

/**
 * Splits a lane into as many sub-lanes as it takes for nothing to overlap.
 *
 * Two things happening to the same person at the same time is the normal case,
 * not the exception, a handover that runs past a last day, cover that
 * overlaps the leave it covers, and drawing them on top of each other hides
 * one of them completely. So a lane grows downward instead.
 *
 * Greedy first-fit over items sorted by start date, which is the standard
 * interval-partitioning result: it uses the minimum number of sub-lanes, and
 * it is stable, so a bar does not hop rows when its neighbour changes.
 *
 * The packing runs over the *whole* series, never the visible window. Lanes
 * that rearranged themselves as you zoomed would make the chart impossible to
 * read across a zoom step.
 */
function packLanes(items: readonly TimelineEntry[]): { placed: PlacedItem[]; lanes: number } {
  const intervals = items.map((item) => ({
    item,
    from: toDay(item.start),
    // Inclusive end, so a bar ending on the 10th and one starting on the 11th
    // are adjacent rather than overlapping.
    to: toDay(item.end ?? item.start) + 1,
  }));

  const ordered = intervals.toSorted((a, b) => a.from - b.from || a.to - b.to);
  // The day each sub-lane is free from.
  const laneFreeFrom: number[] = [];
  const placed: PlacedItem[] = [];

  for (const interval of ordered) {
    let lane = laneFreeFrom.findIndex((free) => free <= interval.from);
    if (lane === -1) lane = laneFreeFrom.length;
    laneFreeFrom[lane] = interval.to;
    placed.push({ ...interval, lane });
  }

  return { placed, lanes: Math.max(laneFreeFrom.length, 1) };
}

export function TimelineChart(props: TimelineChartProps): JSX.Element {
  return props.variant === 'track' ? <TimelineTrack {...props} /> : <TimelineGantt {...props} />;
}

function TimelineGantt({
  rows,
  label,
  unit = 'week',
  today,
  separator = 'line',
  labelWidth = 148,
  rowHeight: rowHeightProp = 40,
  formatTick = defaultTickFormat,
  formatDate = defaultDateFormat,
  onSelect,
  selectedId,
  editable = false,
  canMove,
  onItemMove,
  onDraggingChange,
  onDrop,
  empty = 'Nothing scheduled.',
  emptyRow = 'Nothing scheduled',
  emptyWindow = 'Nothing in this range',
  zoomable = false,
  window: controlledWindow,
  onWindowChange,
  menuItems,
  className,
}: TimelineChartProps): JSX.Element {
  /*
   * A bar is its lane less 12px. Under a finger a lane is at least 56px, so a
   * bar reaches the 44px tap floor whatever height the screen asked for. The
   * pointer, not the window: a phone and a touchscreen laptop both get it.
   */
  const rowHeight = Math.max(rowHeightProp, useCoarsePointer() ? 56 : 0);
  /**
   * Where a dragged item has been put, until the caller's data says otherwise.
   *
   * A drop has to land. Requiring `onItemMove` to be wired before a bar will
   * move makes the gesture feel broken in every screen that has not got round
   * to it yet, so the chart keeps the result itself and hands it over as an
   * event. Pass a new `rows` array back and this is discarded: the caller's
   * data is always the authority. It is just not the only copy.
   */
  const [dropped, setPlaced] = useState<ReadonlyMap<string, Placement>>(new Map());
  const lastRows = useRef(rows);
  useEffect(() => {
    if (lastRows.current === rows) return;
    lastRows.current = rows;
    setPlaced(new Map());
  }, [rows]);

  const effectiveRows = useMemo<TimelineRow[]>(() => {
    if (dropped.size === 0) return [...rows];
    const buckets = new Map<string, TimelineEntry[]>(rows.map((row) => [row.label, []]));
    for (const row of rows) {
      for (const item of row.items) {
        const move = dropped.get(item.id);
        const target = move === undefined ? row.label : move.rowLabel;
        const next =
          move === undefined
            ? item
            : { ...item, start: move.start, ...(move.end === undefined ? {} : { end: move.end }) };
        (buckets.get(target) ?? buckets.get(row.label))?.push(next);
      }
    }
    return rows.map((row) => ({ ...row, items: buckets.get(row.label) ?? [] }));
  }, [rows, dropped]);

  const entries = effectiveRows.flatMap((row) => row.items.map((item) => ({ row, item })));
  const lanes = effectiveRows.map((row) => ({ row, ...packLanes(row.items) }));
  const days = entries.flatMap(({ item }) => [toDay(item.start), toDay(item.end ?? item.start)]);
  const ticks =
    days.length === 0 ? [] : buildTicks(Math.min(...days), Math.max(...days), unit, formatTick);

  const windowState = useChartWindow(Math.max(ticks.length, 1), controlledWindow, onWindowChange);
  const shownTicks = zoomable ? windowState.slice(ticks) : ticks;
  const offset = zoomable ? windowState.window.start : 0;

  const plot = useRef<HTMLDivElement | null>(null);
  const bars = useRef(new Map<string, HTMLElement>());
  const rowBoxes = useRef(new Map<string, HTMLDivElement>());
  const live = useRef<HTMLParagraphElement | null>(null);
  const gesture = useRef<GestureState | null>(null);
  const instructionsId = useId();
  const reducedMotion = usePrefersReducedMotion();

  /*
   * Items that have already made their entrance. A drop into another lane
   * remounts the element, and replaying its pop-in there is a flicker at the
   * exact moment the eye is on it. The entrance is for arriving, once.
   */
  const seen = useRef(new Set<string>());
  useEffect(() => {
    for (const id of bars.current.keys()) seen.current.add(id);
  });

  /*
   * Where every bar was drawn just before a change, so the layout that follows
   * can be played as motion rather than as a cut (FLIP: measure First, apply
   * the Last layout, Invert the difference, Play it back to zero).
   *
   * Every bar, not only the one that moved. A drop that collides splits a lane
   * into sub-lanes and pushes its neighbours down; animating the dropped bar
   * alone left those to jump, which read as a flicker around a smooth drop.
   */
  const before = useRef<Map<string, DOMRect> | null>(null);
  const captureLayout = (): void => {
    before.current = new Map(
      [...bars.current].map(([id, element]) => [id, element.getBoundingClientRect()]),
    );
  };

  /** Plays whatever changed since `captureLayout` as motion, then forgets it. */
  const settle = (): void => {
    const first = before.current;
    if (first === null) return;
    before.current = null;
    if (reducedMotion) return;

    const easing = springEasing(springs.move);
    const duration = springSettleTime(springs.move, 0.004) * 1000;
    for (const [id, element] of bars.current) {
      const from = first.get(id);
      if (!from) continue;
      for (const running of element.getAnimations()) running.cancel();
      const to = element.getBoundingClientRect();
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      const resized = Math.abs(from.width - to.width) > 0.5;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && !resized) continue;
      // `transform` composes with the diamond's own `translate` and `rotate`,
      // which are separate properties, so a milestone keeps its shape while it
      // travels. Width is animated in pixels for a resize; the percentage in
      // the style attribute takes over again when the animation finishes.
      element.animate(
        [
          {
            transform: `translate(${String(dx)}px, ${String(dy)}px)`,
            ...(resized ? { width: `${String(from.width)}px` } : {}),
          },
          { transform: 'none', ...(resized ? { width: `${String(to.width)}px` } : {}) },
        ],
        { duration, easing },
      );
    }
  };
  // After a drop that changed the layout, once the new layout is in the DOM
  // and before it is painted, so the old position is never shown for a frame.
  useLayoutEffect(settle);

  const drag = useDragZoom({
    total: Math.max(2, shownTicks.length),
    enabled: zoomable && ticks.length > 1,
    onZoom: (range) => {
      windowState.setWindow({ start: offset + range.start, end: offset + range.end });
    },
  });

  if (entries.length === 0) {
    return (
      <p
        className={cn('rounded-md border border-dashed border-border p-6 text-fg-muted', className)}
      >
        {empty}
      </p>
    );
  }

  // The visible span in days. Everything below is a fraction of it, which is
  // what lets the whole chart be percentages and stay fluid at any width.
  const domainStart = shownTicks[0]?.from ?? 0;
  const domainEnd = shownTicks.at(-1)?.to ?? domainStart + 1;
  const span = Math.max(domainEnd - domainStart, 1);
  const fraction = (day: number): number => (day - domainStart) / span;
  const width = (tick: Tick): string => percent((tick.to - tick.from) / span);

  const describe = (row: TimelineRow, item: TimelineEntry): string => {
    const dates = item.end
      ? `${formatDate(item.start)} to ${formatDate(item.end)}`
      : `${formatDate(item.start)}, milestone`;
    const done =
      item.progress === undefined ? '' : `, ${String(Math.round(item.progress * 100))}% complete`;
    return `${row.label}, ${item.label}: ${dates}${done}${notes(item)}`;
  };

  const csvRows = entries.map(({ row, item }) => ({
    label: `${row.label} · ${item.label} (${item.start}${item.end ? ` – ${item.end}` : ''})`,
    // Length in days, inclusive of both ends. A milestone is one day.
    value: toDay(item.end ?? item.start) - toDay(item.start) + 1,
  }));

  const rowOf = (name: string): TimelineRow | undefined =>
    effectiveRows.find((entry) => entry.label === name);

  const allowed = (item: TimelineEntry, from: TimelineRow, to: TimelineRow): boolean => {
    if (!editable || item.locked === true) return false;
    return canMove?.(item, from, to) ?? true;
  };

  const announce = (text: string): void => {
    if (live.current) live.current.textContent = text;
  };

  /** Turn a day shift and a destination lane into the move the caller applies. */
  const commit = (
    item: TimelineEntry,
    fromRow: TimelineRow,
    toRowLabel: string,
    dayShift: number,
    mode: TimelineDragMode,
  ): boolean => {
    const target = rowOf(toRowLabel) ?? fromRow;
    const startDay = toDay(item.start);
    const endDay = item.end === undefined ? undefined : toDay(item.end);

    let nextStart = startDay;
    let nextEnd = endDay;
    if (mode === 'move') {
      nextStart = startDay + dayShift;
      nextEnd = endDay === undefined ? undefined : endDay + dayShift;
    } else if (mode === 'resize-start') {
      // Never past its own end: a bar that finishes before it starts is not a
      // shorter bar. It is a broken record.
      nextStart = Math.min(startDay + dayShift, endDay ?? startDay);
    } else if (endDay !== undefined) {
      nextEnd = Math.max(endDay + dayShift, startDay);
    }

    const move: TimelineMove = {
      id: item.id,
      fromRow: fromRow.label,
      toRow: target.label,
      from: { start: item.start, ...(item.end === undefined ? {} : { end: item.end }) },
      to: {
        start: toIso(nextStart),
        ...(nextEnd === undefined ? {} : { end: toIso(nextEnd) }),
      },
      mode,
    };

    // Refused, or a drop that changed nothing. Still an event: "why did that
    // do nothing" is the question a drag most often prompts.
    const applied =
      allowed(item, fromRow, target) && (dayShift !== 0 || target.label !== fromRow.label);
    onDrop?.(move, applied);
    if (!applied) return false;

    // Applied here as well as announced. The caller's data is the authority;
    // this is the copy that keeps the gesture honest until it arrives.
    setPlaced((current) => {
      const next = new Map(current);
      next.set(item.id, {
        rowLabel: target.label,
        start: move.to.start,
        ...(move.to.end === undefined ? {} : { end: move.to.end }),
      });
      return next;
    });
    onItemMove?.(move);

    announce(
      `${item.label} ${target.label === fromRow.label ? '' : `moved to ${target.label}, `}${formatDate(toIso(nextStart))}${
        nextEnd === undefined ? '' : ` to ${formatDate(toIso(nextEnd))}`
      }`,
    );
    return true;
  };

  const beginDrag = (
    event: ReactPointerEvent<HTMLElement>,
    item: TimelineEntry,
    row: TimelineRow,
    mode: TimelineDragMode,
  ): void => {
    if (event.button !== 0 || !allowed(item, row, row)) return;
    const box = plot.current?.getBoundingClientRect();
    const element = bars.current.get(item.id);
    if (!box || !element) return;

    // The bar owns this gesture, not the plot's drag-to-zoom underneath it.
    event.preventDefault();
    event.stopPropagation();

    // Grabbed while still settling from the last drop: measure where it is
    // drawn, stop the settle, and carry on from there. Cancelling alone would
    // snap it to its slot under a finger that is holding it somewhere else.
    const drawn = element.getBoundingClientRect();
    for (const running of element.getAnimations()) running.cancel();
    const laidOut = element.getBoundingClientRect();
    const laneRects = lanes.map(({ row: lane }) => {
      const rect = rowBoxes.current.get(lane.label)?.getBoundingClientRect();
      return { label: lane.label, top: rect?.top ?? 0, bottom: rect?.bottom ?? 0 };
    });

    gesture.current = {
      id: item.id,
      mode,
      pxPerDay: box.width / span,
      startX: event.clientX,
      startY: event.clientY,
      from: toDay(item.start),
      to: toDay(item.end ?? item.start) + 1,
      laneTops: laneRects,
      originLane: row.label,
      element,
      width: laidOut.width,
      baseX: drawn.left - laidOut.left,
      baseY: drawn.top - laidOut.top,
      minY: (laneRects[0]?.top ?? laidOut.top) - laidOut.top,
      maxY: (laneRects.at(-1)?.bottom ?? laidOut.bottom) - laidOut.bottom,
      dayShift: 0,
      targetLane: row.label,
      moved: false,
    };

    element.setPointerCapture(event.pointerId);
    onDraggingChange?.(item);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    const state = gesture.current;
    if (!state) return;

    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    // The bar follows the pointer exactly; the *result* snaps. A schedule has
    // no sub-day resolution, so the drop lands on a whole day and a lane, but
    // a bar that jumped a day at a time under the finger was a bar that did
    // not feel held. The readout says which day it will land on, and the
    // release glides it there.
    const dayShift = Math.round(dx / state.pxPerDay);
    const lane =
      state.mode === 'move'
        ? (state.laneTops.find(
            (entry) => event.clientY >= entry.top && event.clientY < entry.bottom,
          )?.label ?? state.targetLane)
        : state.originLane;

    // Written straight to the element. Sixty of these a second through React
    // would re-render every bar in the chart for each frame of one drag.
    const style = state.element.style;
    const x = state.baseX + dx;
    if (state.mode === 'move') {
      const y = Math.min(Math.max(state.baseY + dy, state.minY), state.maxY);
      style.transform = `translate(${String(x)}px, ${String(y)}px)`;
    } else if (state.mode === 'resize-end') {
      style.width = `${String(Math.max(state.width + dx, state.pxPerDay))}px`;
    } else {
      const shift = Math.min(dx, state.width - state.pxPerDay);
      style.transform = `translateX(${String(state.baseX + shift)}px)`;
      style.width = `${String(state.width - shift)}px`;
    }
    style.zIndex = '30';
    style.opacity = '0.85';

    if (dayShift === state.dayShift && lane === state.targetLane) return;
    state.dayShift = dayShift;
    state.targetLane = lane;
    state.moved = state.moved || dayShift !== 0 || lane !== state.originLane;

    const edge = state.mode === 'resize-end' ? state.to - 1 + dayShift : state.from + dayShift;
    announce(`${formatDate(toIso(edge))}${lane === state.originLane ? '' : `, ${lane}`}`);
  };

  const endDrag = (): void => {
    const state = gesture.current;
    gesture.current = null;
    if (!state) return;
    onDraggingChange?.(null);

    // Measured before the drag's transform is cleared, so the glide into the
    // slot starts from under the finger. See the layout effect above.
    captureLayout();
    const style = state.element.style;
    style.transform = '';
    style.width = '';
    style.zIndex = '';
    style.opacity = '';

    const entry = entries.find(({ item }) => item.id === state.id);
    if (!entry) return;
    // `commit` decides whether anything changed and reports either way, so a
    // release that went nowhere still produces one `onDrop`. When nothing
    // changed there is no render to settle in, so the bar glides back to its
    // slot from here: a refused drop returns rather than teleporting.
    if (!commit(entry.item, entry.row, state.targetLane, state.dayShift, state.mode)) settle();
  };

  /**
   * The keyboard path. A drag is unreachable by a keyboard, a switch, or an
   * unsteady hand, so every gesture above has a key behind it.
   */
  const onBarKeyDown = (
    event: ReactKeyboardEvent<HTMLElement>,
    item: TimelineEntry,
    row: TimelineRow,
  ): void => {
    if (!editable || !event.shiftKey) return;
    const laneIndex = lanes.findIndex(({ row: lane }) => lane.label === row.label);

    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      captureLayout();
      const step = event.key === 'ArrowLeft' ? -1 : 1;
      if (!commit(item, row, row.label, step, event.altKey ? 'resize-end' : 'move')) settle();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const next = lanes[laneIndex + (event.key === 'ArrowUp' ? -1 : 1)];
      if (next) {
        captureLayout();
        if (!commit(item, row, next.row.label, 0, 'move')) settle();
      }
    }
  };

  // Both columns ask the same function, so the rules line up across the gap.
  const laneEdge = (index: number): string =>
    cn(
      (separator === 'line' || separator === 'both') &&
        index < lanes.length - 1 &&
        'border-b border-border/70',
      (separator === 'banded' || separator === 'both') && index % 2 === 1 && 'bg-fg/[0.035]',
    );

  // A lane that splits into sub-lanes after a drop grows rather than jumps, on
  // the same spring as the bars settling into it.
  const laneTransition =
    'motion-safe:transition-[height] motion-safe:duration-(--animate-duration-spring-move) motion-safe:ease-(--ease-spring-move)';

  const todayDay = today === undefined ? null : toDay(today);
  const todayVisible = todayDay !== null && todayDay >= domainStart && todayDay < domainEnd;

  return (
    <ChartFrame
      label={label}
      rows={csvRows}
      {...(zoomable ? { window: windowState } : {})}
      {...(menuItems ? { menuItems } : {})}
      className={cn('w-full', className)}
    >
      {zoomable ? (
        <ChartZoomControls
          className="mb-2"
          state={windowState}
          total={ticks.length}
          visibleLabels={shownTicks.map((tick) => tick.label)}
        />
      ) : null}

      <div className="flex min-w-0">
        {/* Hidden from assistive tech: the lane name is repeated inside every
            bar's label and again in the table, and a column of names read on
            its own tells a screen-reader user nothing about the schedule. */}
        <div
          aria-hidden
          className="shrink-0" // `clamp` rather than a breakpoint: the label column gives up its width
          // gradually as the chart narrows, down to a floor that still fits a
          // name. A fixed 148px is 38% of a phone screen spent on labels.
          style={{ width: `clamp(5.5rem, 30%, ${String(labelWidth)}px)` }}
        >
          <div style={{ height: HEADER_HEIGHT }} />
          {lanes.map(({ row, lanes: count }, laneIndex) => (
            <div
              key={row.label}
              // Centred across the whole row however many sub-lanes it split
              // into: the name belongs to the lane, not to any one bar in it.
              className={cn(
                'flex flex-col justify-center pe-3',
                laneTransition,
                laneEdge(laneIndex),
              )}
              style={{ height: rowHeight * count }}
            >
              <span className="truncate text-sm font-medium text-fg" title={row.label}>
                {row.label}
              </span>
              {row.meta === undefined ? null : (
                <span className="truncate text-2xs text-fg-subtle">{row.meta}</span>
              )}
            </div>
          ))}
        </div>

        <div
          ref={plot}
          className={cn(
            'relative min-w-0 flex-1 border-s border-border',
            zoomable && 'cursor-crosshair touch-none select-none',
          )}
          {...(zoomable ? drag.handlers : {})}
        >
          <ChartMarquee marquee={drag.marquee} />

          {/* Gridlines run the full height behind everything, so a bar can be
              read back to a date without a ruler. */}
          <div aria-hidden className="pointer-events-none absolute inset-0 flex">
            {shownTicks.map((tick) => (
              <div
                key={tick.key}
                className="border-e border-border/60"
                style={{ width: width(tick) }}
              />
            ))}
          </div>

          <div aria-hidden className="flex items-end" style={{ height: HEADER_HEIGHT }}>
            {shownTicks.map((tick) => (
              <span
                key={tick.key}
                className="min-w-0 truncate ps-1 pb-1 text-[11px] font-semibold text-fg-muted"
                style={{ width: width(tick) }}
              >
                {tick.label}
              </span>
            ))}
          </div>

          {lanes.map(({ row, placed, lanes: count }, laneIndex) => (
            <div
              key={row.label}
              ref={(element) => {
                if (element) rowBoxes.current.set(row.label, element);
                else rowBoxes.current.delete(row.label);
              }}
              className={cn('relative', laneTransition, laneEdge(laneIndex))}
              style={{ height: rowHeight * count }}
            >
              {/* An empty lane says so. A blank strip is indistinguishable from
                  a lane whose bars failed to render, and the two want very
                  different reactions from whoever is looking. */}
              {/* `every` is true for an empty lane as well, which is exactly
                  what is wanted here: both cases draw a placeholder, and only
                  the wording differs. */}
              {placed.every(({ from, to }) => to <= domainStart || from >= domainEnd) ? (
                <div
                  aria-hidden
                  className={cn(
                    'absolute inset-x-2 top-1/2 flex h-5 -translate-y-1/2 items-center justify-center',
                    'rounded-sm border border-dashed border-border text-2xs text-fg-subtle',
                  )}
                >
                  {placed.length === 0 ? emptyRow : emptyWindow}
                </div>
              ) : null}
              {placed.map(({ item, from, to, lane }, index) => {
                // Off-window bars are not drawn at all. They stay in the table.
                if (to <= domainStart || from >= domainEnd) return null;

                const tone = item.tone ?? 'chart-1';
                const selected = selectedId === item.id;
                const clippedStart = from < domainStart;
                const clippedEnd = to > domainEnd;
                const left = fraction(Math.max(from, domainStart));
                const stagger = `min(calc(${String(index)} * 40ms), 240ms)`;
                // The sub-lane it was packed into. Nothing in a row overlaps,
                // so a bar never has to be read through another one.
                const top = lane * rowHeight;

                const draggable = editable && item.locked !== true;

                if (item.end === undefined) {
                  // A milestone has no duration, so a bar would have to invent
                  // one. A diamond on the day says what it is, and it can be
                  // moved, but never resized.
                  return (
                    <TimelineMark
                      key={item.id}
                      description={describe(row, item)}
                      selectable={onSelect !== undefined || draggable}
                      elementRef={(element) => {
                        if (element) bars.current.set(item.id, element);
                        else bars.current.delete(item.id);
                      }}
                      {...(draggable
                        ? {
                            onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
                              beginDrag(event, item, row, 'move');
                            },
                            onPointerMove: moveDrag,
                            onPointerUp: endDrag,
                            onPointerCancel: endDrag,
                            onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
                              onBarKeyDown(event, item, row);
                            },
                            describedBy: instructionsId,
                          }
                        : {})}
                      onActivate={() => {
                        onSelect?.(item, row);
                      }}
                      className={cn(
                        // Square and upright. The diamond is drawn inside it:
                        // rotating this element would rotate every transform
                        // written onto it too, and a drag would then move the
                        // mark along the diagonals instead of under the pointer.
                        'tap-target absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-[3px]',
                        !seen.current.has(item.id) && 'motion-safe:animate-pop-in',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
                        onSelect && 'cursor-pointer',
                        draggable && 'cursor-grab touch-none active:cursor-grabbing',
                        selectedId !== undefined && !selected && 'opacity-50',
                      )}
                      style={{
                        insetInlineStart: percent(fraction(from + 0.5)),
                        top: top + rowHeight / 2,
                        animationDelay: stagger,
                      }}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'absolute inset-0 rotate-45 rounded-[3px]',
                          item.tentative === true
                            ? cn('bg-surface inset-ring-2', ghostTone[tone])
                            : solidTone[tone],
                          item.clash === true && 'ring-2 ring-danger',
                          selected && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
                        )}
                      />
                    </TimelineMark>
                  );
                }

                return (
                  <TimelineMark
                    key={item.id}
                    description={describe(row, item)}
                    selectable={onSelect !== undefined || draggable}
                    elementRef={(element) => {
                      if (element) bars.current.set(item.id, element);
                      else bars.current.delete(item.id);
                    }}
                    {...(draggable
                      ? {
                          onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
                            beginDrag(event, item, row, 'move');
                          },
                          onPointerMove: moveDrag,
                          onPointerUp: endDrag,
                          onPointerCancel: endDrag,
                          onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
                            onBarKeyDown(event, item, row);
                          },
                          describedBy: instructionsId,
                        }
                      : {})}
                    onActivate={() => {
                      onSelect?.(item, row);
                    }}
                    className={cn(
                      'absolute flex items-center overflow-hidden px-2 text-xs font-semibold',
                      item.shape === 'pill' ? 'rounded-full px-3' : 'rounded-[8px]',
                      'origin-left transition-[opacity,box-shadow] duration-(--animate-duration-fast)',
                      !seen.current.has(item.id) && 'motion-safe:animate-grow-x',
                      'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus',
                      item.tentative === true
                        ? cn('bg-transparent inset-ring-[1.5px]', ghostTone[tone])
                        : washTone[tone],
                      item.clash === true && 'inset-ring-2 inset-ring-danger',

                      onSelect && 'cursor-pointer hover:brightness-105',
                      draggable && 'group/bar cursor-grab touch-none active:cursor-grabbing',
                      selected && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
                      selectedId !== undefined && !selected && 'opacity-50',
                      // A bar cut off by the window keeps a square edge on that
                      // side: a rounded end reads as "it finishes here", which
                      // would be a lie.
                      clippedStart && 'rounded-s-none',
                      clippedEnd && 'rounded-e-none',
                    )}
                    style={{
                      insetInlineStart: percent(left),
                      width: percent(fraction(Math.min(to, domainEnd)) - left),
                      top: top + 6,
                      height: rowHeight - 12,
                      animationDelay: stagger,
                    }}
                  >
                    {/* Progress as a stronger tint under the same bar: one
                        shape, two facts, and the label stays legible over both
                        because neither is the full-strength colour. */}
                    {item.progress === undefined ? null : (
                      <span
                        aria-hidden
                        className={cn('absolute inset-y-0 start-0', progressTone[tone])}
                        style={{ width: percent(Math.min(Math.max(item.progress, 0), 1)) }}
                      />
                    )}
                    <span className="relative truncate font-medium text-fg">{item.label}</span>

                    {/* Resize grips. Only on hover and focus, because a bar
                        covered in permanent handles reads as a control rather
                        than as a fact about a schedule. */}
                    {draggable ? (
                      <>
                        <span
                          aria-hidden
                          role="presentation"
                          onPointerDown={(event) => {
                            beginDrag(event, item, row, 'resize-start');
                          }}
                          className={cn(
                            'absolute inset-y-0 start-0 w-2 cursor-ew-resize rounded-s-sm opacity-0',
                            'transition-opacity duration-(--animate-duration-fast)',
                            'bg-fg/20 group-hover/bar:opacity-100 group-focus-visible/bar:opacity-100',
                          )}
                        />
                        <span
                          aria-hidden
                          role="presentation"
                          onPointerDown={(event) => {
                            beginDrag(event, item, row, 'resize-end');
                          }}
                          className={cn(
                            'absolute inset-y-0 end-0 w-2 cursor-ew-resize rounded-e-sm opacity-0',
                            'transition-opacity duration-(--animate-duration-fast)',
                            'bg-fg/20 group-hover/bar:opacity-100 group-focus-visible/bar:opacity-100',
                          )}
                        />
                      </>
                    ) : null}
                  </TimelineMark>
                );
              })}
            </div>
          ))}

          {todayVisible ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-accent"
              style={{ insetInlineStart: percent(fraction(todayDay)) }}
            >
              <span className="absolute -top-0.5 -start-[3px] size-2 rounded-full bg-accent" />
            </div>
          ) : null}
        </div>
      </div>

      {editable ? (
        <>
          <p id={instructionsId} className="sr-only">
            Drag to reschedule, drag the ends to resize, drop on another lane to move it there.
            Without a pointer: Shift with Left or Right moves it a day, Shift and Alt with Left or
            Right changes the end date, Shift with Up or Down moves it to the lane above or below.
          </p>
          {/* Where the bar is *going*, said out loud while it is being dragged.
              A gesture whose result only exists in pixels is one nobody using a
              screen reader can steer. */}
          <p ref={live} aria-live="polite" className="sr-only" />
        </>
      ) : null}

      {/* Every bar in words. The whole schedule, never only the window. */}
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">Lane</th>
              <th scope="col">Item</th>
              <th scope="col">Start</th>
              <th scope="col">End</th>
              <th scope="col">Progress</th>
            </tr>
          </thead>
          <tbody>
            {/* Built from the lanes rather than from the items, so an empty lane
              is a row that says it is empty rather than a lane that silently
              vanishes from the only version of this a screen reader gets. */}
            {effectiveRows.flatMap((row) =>
              row.items.length === 0
                ? [
                    <tr key={row.label}>
                      <th scope="row">{row.label}</th>
                      <td colSpan={4}>{emptyRow}</td>
                    </tr>,
                  ]
                : row.items.map((item) => (
                    <tr key={`${row.label}|${item.id}`}>
                      <th scope="row">{row.label}</th>
                      <td>
                        {item.label}
                        {notes(item)}
                      </td>
                      <td>{formatDate(item.start)}</td>
                      <td>{item.end === undefined ? 'Milestone' : formatDate(item.end)}</td>
                      <td>
                        {item.progress === undefined
                          ? 'Not tracked'
                          : `${String(Math.round(item.progress * 100))}%`}
                      </td>
                    </tr>
                  )),
            )}
          </tbody>
        </table>
      </div>
    </ChartFrame>
  );
}

/**
 * A bar or a milestone, with its readout attached.
 *
 * A `<button>` when it does something and a focusable `role="img"` when it does
 * not: the tooltip cannot open on focus if nothing can take focus, and a value
 * reachable only with a pointer is a value half the readers never get.
 */
function TimelineMark({
  description,
  selectable,
  onActivate,
  className,
  style,
  children,
  elementRef,
  describedBy,
  ...handlers
}: {
  description: string;
  selectable: boolean;
  onActivate: () => void;
  className: string;
  style: CSSProperties;
  children?: ReactNode;
  /** The DOM node, for the drag to write transforms straight onto. */
  elementRef?: (element: HTMLElement | null) => void;
  describedBy?: string;
  onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove?: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp?: () => void;
  onPointerCancel?: () => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void;
}): JSX.Element {
  const shared = {
    ref: elementRef,
    className,
    style,
    'aria-label': description,
    ...(describedBy === undefined ? {} : { 'aria-describedby': describedBy }),
    ...handlers,
  };

  return (
    <Tooltip content={description} side="top">
      {selectable ? (
        <button type="button" {...shared} onClick={onActivate}>
          {children}
        </button>
      ) : (
        <div role="img" tabIndex={0} {...shared}>
          {children}
        </div>
      )}
    </Tooltip>
  );
}

/** A track lane: an 18px bar, its label under it, and the gap to the next lane. */
const TRACK_LANE_HEIGHT = 50;

/**
 * The `track` variant: a plan over a fixed axis.
 *
 * ### Dragged through dnd-kit, along the axis only
 *
 * A segment slides sideways and never changes lane: a lane here is a kind of
 * thing, not a person, and a segment dropped into another kind would change
 * what it is rather than when. The pointer and the keyboard go through the
 * same `DndContext`, so Space or Enter picks a segment up, the arrows move it
 * by `snapDays`, and dnd-kit's live region says where it is at every step.
 *
 * The bar snaps under the finger rather than gliding to the result, the
 * opposite of the gantt: a step is a week, and a bar that floated between
 * weeks would hide which one it will land on.
 *
 * ### Clamped to the axis
 *
 * The axis is the `domain`, fixed, so a segment cannot be dragged past its
 * ends: an axis that grew under a drag would move every other segment too.
 */
function TimelineTrack({
  rows,
  label,
  unit = 'month',
  separator = 'line',
  labelWidth = 148,
  formatTick = defaultTickFormat,
  formatDate = defaultDateFormat,
  editable = false,
  canMove,
  onItemMove,
  onDraggingChange,
  onDrop,
  domain,
  snapDays = 1,
  markers = [],
  empty = 'Nothing scheduled.',
  emptyRow = 'Nothing scheduled',
  menuItems,
  className,
}: TimelineChartProps): JSX.Element {
  // Where a dropped segment landed, until the caller's `rows` say otherwise (see the gantt).
  const [dropped, setDropped] = useState<ReadonlyMap<string, { start: IsoDate; end?: IsoDate }>>(
    new Map(),
  );
  const lastRows = useRef(rows);
  useEffect(() => {
    if (lastRows.current === rows) return;
    lastRows.current = rows;
    setDropped(new Map());
  }, [rows]);

  const plot = useRef<HTMLDivElement | null>(null);
  /** Pixels per day, measured when a drag starts. */
  const pxPerDay = useRef(0);
  /** Days the active segment has moved, as last drawn. */
  const shift = useRef(0);
  const announced = useRef(0);
  const outcome = useRef('');

  const sensors = useSensors(
    // A click is not a drag: 4px before anything moves.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: trackKeys(pxPerDay, snapDays) }),
  );

  const effectiveRows = rows.map((row) => ({
    ...row,
    items: row.items.map((item) => {
      const moved = dropped.get(item.id);
      return moved === undefined ? item : { ...item, ...moved };
    }),
  }));
  const entries = effectiveRows.flatMap((row) => row.items.map((item) => ({ row, item })));
  const days = entries.flatMap(({ item }) => [toDay(item.start), toDay(item.end ?? item.start)]);

  if (domain === undefined && days.length === 0) {
    return (
      <p
        className={cn('rounded-md border border-dashed border-border p-6 text-fg-muted', className)}
      >
        {empty}
      </p>
    );
  }

  const ticks = buildTicks(
    domain === undefined ? Math.min(...days) : toDay(domain.start),
    domain === undefined ? Math.max(...days) : toDay(domain.end),
    unit,
    formatTick,
  );
  const domainStart = ticks[0]?.from ?? 0;
  const domainEnd = ticks.at(-1)?.to ?? domainStart + 1;
  const span = Math.max(domainEnd - domainStart, 1);
  const fraction = (day: number): number => (day - domainStart) / span;
  const lanes = effectiveRows.map((row) => ({ row, ...packLanes(row.items) }));

  const find = (id: string | number) => entries.find(({ item }) => item.id === String(id));
  const allowed = (item: TimelineEntry, row: TimelineRow): boolean =>
    editable && item.locked !== true && (canMove?.(item, row, row) ?? true);

  /** The days a drag of `x` pixels moves a segment: whole steps, never off the axis. */
  const shiftFor = (x: number, item: TimelineEntry): number => {
    if (pxPerDay.current === 0) return 0;
    const steps = Math.round(x / pxPerDay.current / snapDays) * snapDays;
    const from = toDay(item.start);
    const to = toDay(item.end ?? item.start) + 1;
    return Math.min(Math.max(steps, domainStart - from), domainEnd - to);
  };

  const dates = (item: TimelineEntry, by: number): string => {
    const start = formatDate(toIso(toDay(item.start) + by));
    return item.end === undefined
      ? start
      : `${start} to ${formatDate(toIso(toDay(item.end) + by))}`;
  };
  const describe = (row: TimelineRow, item: TimelineEntry): string =>
    `${row.label}, ${item.label}: ${dates(item, 0)}${notes(item)}`;

  const snap: Modifier = ({ transform, active }) => {
    const entry = active === null ? undefined : find(active.id);
    if (!entry) return { ...transform, y: 0 };
    shift.current = shiftFor(transform.x, entry.item);
    return { ...transform, x: shift.current * pxPerDay.current, y: 0 };
  };

  const step = snapDays === 7 ? 'a week' : snapDays === 1 ? 'a day' : `${String(snapDays)} days`;
  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const entry = find(active.id);
      return entry ? `Picked up ${entry.item.label}, ${dates(entry.item, 0)}.` : undefined;
    },
    onDragMove: ({ active }) => {
      const entry = find(active.id);
      if (!entry || shift.current === announced.current) return undefined;
      announced.current = shift.current;
      return `${entry.item.label}, ${dates(entry.item, shift.current)}.`;
    },
    onDragOver: () => undefined,
    onDragEnd: () => outcome.current,
    onDragCancel: ({ active }) =>
      `Moving ${find(active.id)?.item.label ?? 'the segment'} was cancelled. It is back where it started.`,
  };

  const finish = (id: string | number): void => {
    const entry = find(id);
    onDraggingChange?.(null);
    if (!entry) return;
    const { item, row } = entry;
    const by = shift.current;
    const move: TimelineMove = {
      id: item.id,
      fromRow: row.label,
      toRow: row.label,
      from: { start: item.start, ...(item.end === undefined ? {} : { end: item.end }) },
      to: {
        start: toIso(toDay(item.start) + by),
        ...(item.end === undefined ? {} : { end: toIso(toDay(item.end) + by) }),
      },
      mode: 'move',
    };
    const applied = by !== 0 && allowed(item, row);
    onDrop?.(move, applied);
    outcome.current = applied
      ? `${item.label} moved to ${dates(item, by)}.`
      : `${item.label} was dropped where it started.`;
    if (!applied) return;
    setDropped((current) => new Map(current).set(item.id, move.to));
    onItemMove?.(move);
  };

  const laneEdge = (index: number): string =>
    cn(
      (separator === 'line' || separator === 'both') &&
        index < lanes.length - 1 &&
        'border-b border-border/70',
      (separator === 'banded' || separator === 'both') && index % 2 === 1 && 'bg-fg/[0.035]',
    );
  const shownMarkers = markers.filter(
    (m) => toDay(m.date) >= domainStart && toDay(m.date) < domainEnd,
  );

  return (
    <ChartFrame
      label={label}
      rows={entries.map(({ row, item }) => ({
        label: `${row.label} · ${item.label} (${item.start}${item.end ? ` – ${item.end}` : ''})`,
        value: toDay(item.end ?? item.start) - toDay(item.start) + 1,
      }))}
      {...(menuItems ? { menuItems } : {})}
      className={cn('w-full', className)}
    >
      <DndContext
        sensors={sensors}
        modifiers={[snap]}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable: `To move a segment, press Space or Enter, then Left or Right to move it ${step} at a time. Press Space or Enter again to drop it, or Escape to put it back.`,
          },
        }}
        onDragStart={({ active }) => {
          pxPerDay.current = (plot.current?.getBoundingClientRect().width ?? 0) / span;
          shift.current = 0;
          announced.current = 0;
          const entry = find(active.id);
          if (entry) onDraggingChange?.(entry.item);
        }}
        onDragEnd={({ active }) => {
          finish(active.id);
        }}
        onDragCancel={() => {
          shift.current = 0;
          onDraggingChange?.(null);
        }}
      >
        <div className="flex min-w-0">
          {/* Hidden from assistive tech, as in the gantt: every segment's name carries its lane. */}
          <div
            aria-hidden
            className="shrink-0"
            style={{ width: `clamp(5.5rem, 30%, ${String(labelWidth)}px)` }}
          >
            <div style={{ height: HEADER_HEIGHT }} />
            {lanes.map(({ row, lanes: count }, index) => (
              <div
                key={row.label}
                className={cn('flex flex-col justify-center pe-3', laneEdge(index))}
                style={{ height: TRACK_LANE_HEIGHT * count }}
              >
                <span className="truncate text-sm font-medium text-fg-muted" title={row.label}>
                  {row.label}
                </span>
              </div>
            ))}
          </div>

          <div className="min-w-0 flex-1">
            <div ref={plot} className="relative">
              <div aria-hidden className="pointer-events-none absolute inset-0 flex">
                {ticks.map((tick) => (
                  <div
                    key={tick.key}
                    className="border-e border-border/60"
                    style={{ width: percent((tick.to - tick.from) / span) }}
                  />
                ))}
              </div>
              <div
                aria-hidden
                className="flex items-end border-b border-border"
                style={{ height: HEADER_HEIGHT }}
              >
                {ticks.map((tick) => (
                  <span
                    key={tick.key}
                    className="min-w-0 truncate pb-1 text-[11px] font-semibold text-fg-subtle"
                    style={{ width: percent((tick.to - tick.from) / span) }}
                  >
                    {tick.label}
                  </span>
                ))}
              </div>
              {lanes.map(({ row, placed, lanes: count }, index) => (
                <div
                  key={row.label}
                  className={cn('relative', laneEdge(index))}
                  style={{ height: TRACK_LANE_HEIGHT * count }}
                >
                  {placed.every(({ from, to }) => to <= domainStart || from >= domainEnd) ? (
                    <div
                      aria-hidden
                      className="absolute inset-x-2 top-1/2 flex h-5 -translate-y-1/2 items-center justify-center rounded-sm border border-dashed border-border text-2xs text-fg-subtle"
                    >
                      {emptyRow}
                    </div>
                  ) : null}
                  {placed.map(({ item, from, to, lane }) => {
                    if (to <= domainStart || from >= domainEnd) return null;
                    const left = fraction(Math.max(from, domainStart));
                    return (
                      <TrackSegment
                        key={item.id}
                        item={item}
                        description={describe(row, item)}
                        draggable={allowed(item, row)}
                        // A label starting late on the axis hangs from the bar's end, or it runs off the chart.
                        alignEnd={left > 0.7}
                        style={{
                          insetInlineStart: percent(left),
                          width: percent(fraction(Math.min(to, domainEnd)) - left),
                          top: lane * TRACK_LANE_HEIGHT + 6,
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>

            {shownMarkers.length > 0 ? (
              <div aria-hidden className="relative h-6">
                {shownMarkers.map((marker) => (
                  <span
                    key={`${marker.date}|${marker.label}`}
                    className="absolute top-1.5 flex -translate-x-1/2 items-center gap-1 text-[11px] leading-none font-semibold whitespace-nowrap text-fg-muted"
                    style={{ insetInlineStart: percent(fraction(toDay(marker.date) + 0.5)) }}
                  >
                    <svg viewBox="0 0 10 10" className="size-2.5 fill-current">
                      <path d="M5 1 9.5 9h-9z" />
                    </svg>
                    {marker.label}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </DndContext>

      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">Lane</th>
              <th scope="col">Item</th>
              <th scope="col">Start</th>
              <th scope="col">End</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(({ row, item }) => (
              <tr key={`${row.label}|${item.id}`}>
                <th scope="row">{row.label}</th>
                <td>
                  {item.label}
                  {notes(item)}
                </td>
                <td>{formatDate(item.start)}</td>
                <td>{item.end === undefined ? 'Milestone' : formatDate(item.end)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shownMarkers.length > 0 ? (
          <ul>
            {shownMarkers.map((marker) => (
              <li key={`${marker.date}|${marker.label}`}>
                {marker.label}: {formatDate(marker.date)}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </ChartFrame>
  );
}

/**
 * Left and right move the picked-up segment by one step; nothing else does.
 * dnd-kit hands over where the segment is drawn, after the clamp, so presses
 * against an end of the axis are not banked and owed back on the way out.
 */
function trackKeys(
  pxPerDay: { readonly current: number },
  snapDays: number,
): KeyboardCoordinateGetter {
  return (event, { currentCoordinates }) => {
    const direction = event.code === 'ArrowRight' ? 1 : event.code === 'ArrowLeft' ? -1 : 0;
    if (direction === 0) return undefined;
    return {
      ...currentCoordinates,
      x: currentCoordinates.x + direction * snapDays * pxPerDay.current,
    };
  };
}

/** One segment of a track lane: the bar and the label under it, dragged as one. */
function TrackSegment({
  item,
  description,
  draggable,
  alignEnd,
  style,
}: {
  item: TimelineEntry;
  description: string;
  draggable: boolean;
  alignEnd: boolean;
  style: CSSProperties;
}): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
    disabled: !draggable,
  });
  const tone = item.tone ?? 'chart-1';
  return (
    <div
      ref={setNodeRef}
      {...(draggable ? { ...attributes, ...listeners } : { role: 'img' })}
      aria-label={description}
      className={cn(
        'group/segment tap-target absolute h-9.5 outline-none',
        draggable && 'cursor-grab touch-none active:cursor-grabbing',
        isDragging && 'z-30',
      )}
      style={{ ...style, transform: CSS.Translate.toString(transform) }}
    >
      <span
        aria-hidden
        className={cn(
          'block h-4.5 rounded-[6px]',
          bgTone[tone],
          // Not booked yet: the same hatch as every other "not final" in the system.
          item.tentative === true && 'pattern-hatched',
          item.clash === true && 'ring-2 ring-danger',
          'group-focus-visible/segment:outline-2 group-focus-visible/segment:outline-offset-2 group-focus-visible/segment:outline-border-focus',
          isDragging && 'shadow-md',
        )}
      />
      <span
        aria-hidden
        className={cn(
          'absolute top-6 text-xs leading-none font-semibold whitespace-nowrap text-fg-muted',
          alignEnd ? 'end-0' : 'start-0',
        )}
      >
        {item.label}
      </span>
    </div>
  );
}
