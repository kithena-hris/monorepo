'use client';

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';
import { addMonths, formatIsoDate, parseIsoDate, type IsoDate } from '../calendar/calendar';
import { Tooltip } from '../tooltip/tooltip';
import {
  ChartFrame,
  ChartMarquee,
  ChartZoomControls,
  useChartWindow,
  useDragZoom,
} from './chart-window';
import type { ChartInteractionProps, ChartTone } from './chart';

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

/** The solid fill: the completed part of a bar, and a milestone. */
const solidTone: Record<ChartTone, string> = {
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
  accent: 'bg-accent/45',
  success: 'bg-success/45',
  warning: 'bg-warning/45',
  danger: 'bg-danger/45',
  info: 'bg-info/45',
  neutral: 'bg-fg-subtle/45',
};

const edgeTone: Record<ChartTone, string> = {
  accent: 'border-s-accent',
  success: 'border-s-success',
  warning: 'border-s-warning',
  danger: 'border-s-danger',
  info: 'border-s-info',
  neutral: 'border-s-fg-subtle',
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

export function TimelineChart({
  rows,
  label,
  unit = 'week',
  today,
  separator = 'line',
  labelWidth = 148,
  rowHeight = 40,
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
    return `${row.label}, ${item.label}: ${dates}${done}`;
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
  ): void => {
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
    if (!applied) return;

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

    gesture.current = {
      id: item.id,
      mode,
      pxPerDay: box.width / span,
      startX: event.clientX,
      startY: event.clientY,
      from: toDay(item.start),
      to: toDay(item.end ?? item.start) + 1,
      laneTops: lanes.map(({ row: lane }) => {
        const rect = rowBoxes.current.get(lane.label)?.getBoundingClientRect();
        return { label: lane.label, top: rect?.top ?? 0, bottom: rect?.bottom ?? 0 };
      }),
      originLane: row.label,
      element,
      width: element.getBoundingClientRect().width,
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
    // Snap to whole days. A schedule has no sub-day resolution, and a bar that
    // lands on "the 3rd and a bit" is a bar whose dates cannot be written down.
    const dayShift = Math.round(dx / state.pxPerDay);
    const lane =
      state.mode === 'move'
        ? (state.laneTops.find(
            (entry) => event.clientY >= entry.top && event.clientY < entry.bottom,
          )?.label ?? state.targetLane)
        : state.originLane;

    if (dayShift === state.dayShift && lane === state.targetLane) return;
    state.dayShift = dayShift;
    state.targetLane = lane;
    state.moved = state.moved || dayShift !== 0 || lane !== state.originLane;

    const originTop = state.laneTops.find((entry) => entry.label === state.originLane)?.top ?? 0;
    const targetTop = state.laneTops.find((entry) => entry.label === lane)?.top ?? originTop;
    const shiftPx = dayShift * state.pxPerDay;

    // Written straight to the element. Twenty of these a second through React
    // would re-render every bar in the chart for each frame of one drag.
    const style = state.element.style;
    if (state.mode === 'move') {
      style.transform = `translate(${String(shiftPx)}px, ${String(targetTop - originTop)}px)`;
    } else if (state.mode === 'resize-end') {
      style.width = `${String(Math.max(state.width + shiftPx, state.pxPerDay))}px`;
    } else {
      style.transform = `translateX(${String(shiftPx)}px)`;
      style.width = `${String(Math.max(state.width - shiftPx, state.pxPerDay))}px`;
    }
    style.zIndex = '30';
    style.opacity = '0.85';

    const edge = state.mode === 'resize-end' ? state.to - 1 + dayShift : state.from + dayShift;
    announce(`${formatDate(toIso(edge))}${lane === state.originLane ? '' : `, ${lane}`}`);
  };

  const endDrag = (): void => {
    const state = gesture.current;
    gesture.current = null;
    if (!state) return;
    onDraggingChange?.(null);

    const style = state.element.style;
    style.transform = '';
    style.width = '';
    style.zIndex = '';
    style.opacity = '';

    const entry = entries.find(({ item }) => item.id === state.id);
    if (!entry) return;
    // `commit` decides whether anything changed and reports either way, so a
    // release that went nowhere still produces one `onDrop`.
    commit(entry.item, entry.row, state.targetLane, state.dayShift, state.mode);
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
      const step = event.key === 'ArrowLeft' ? -1 : 1;
      commit(item, row, row.label, step, event.altKey ? 'resize-end' : 'move');
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const next = lanes[laneIndex + (event.key === 'ArrowUp' ? -1 : 1)];
      if (next) commit(item, row, next.row.label, 0, 'move');
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
              className={cn('flex flex-col justify-center pe-3', laneEdge(laneIndex))}
              style={{ height: rowHeight * count }}
            >
              <span className="truncate text-sm text-fg" title={row.label}>
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
                className="min-w-0 truncate ps-1 pb-1 text-2xs text-fg-subtle"
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
              className={cn('relative', laneEdge(laneIndex))}
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

                const tone = item.tone ?? 'accent';
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
                        'absolute size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-xs',
                        'motion-safe:animate-pop-in',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
                        solidTone[tone],
                        onSelect && 'cursor-pointer',
                        draggable && 'cursor-grab touch-none active:cursor-grabbing',
                        selected && 'ring-2 ring-border-focus ring-offset-2 ring-offset-surface',
                        selectedId !== undefined && !selected && 'opacity-50',
                      )}
                      style={{
                        insetInlineStart: percent(fraction(from + 0.5)),
                        top: top + rowHeight / 2,
                        animationDelay: stagger,
                      }}
                    />
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
                      'absolute flex items-center overflow-hidden rounded-sm border-s-2 px-1.5 text-2xs',
                      'origin-left transition-[opacity,box-shadow] duration-(--animate-duration-fast)',
                      'motion-safe:animate-grow-x',
                      'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus',
                      washTone[tone],
                      edgeTone[tone],
                      onSelect && 'cursor-pointer hover:brightness-105',
                      draggable && 'group/bar cursor-grab touch-none active:cursor-grabbing',
                      selected && 'ring-2 ring-border-focus ring-offset-1 ring-offset-surface',
                      selectedId !== undefined && !selected && 'opacity-50',
                      // A bar cut off by the window keeps a square edge on that
                      // side: a rounded end reads as "it finishes here", which
                      // would be a lie.
                      clippedStart && 'rounded-s-none border-s-0',
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
              className="pointer-events-none absolute inset-y-0 z-10 w-px bg-danger"
              style={{ insetInlineStart: percent(fraction(todayDay)) }}
            >
              <span className="absolute -top-0.5 -start-1 size-2 rounded-full bg-danger" />
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
      <table className="sr-only">
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
                    <td>{item.label}</td>
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
