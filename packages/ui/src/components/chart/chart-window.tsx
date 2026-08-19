'use client';

import { Copy, Maximize2, MoveHorizontal, ZoomIn, ZoomOut } from 'lucide-react';
import {
  useCallback,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';
import { Button } from '../button/button';
import { useClipboard } from '../clipboard/clipboard';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../context-menu/context-menu';

/**
 * Windowing, dragging and the right-click menu, shared by every chart that has
 * an ordered axis.
 *
 * Kept out of the chart components because otherwise each of the six would
 * grow its own copy, and six copies of a clamping rule is five chances to
 * clamp differently. It is not exported from the package: charts compose it,
 * callers configure it through their props.
 */

export interface ChartWindow {
  /** Inclusive index of the first visible item. */
  start: number;
  /** Inclusive index of the last visible item. */
  end: number;
}

export interface UseChartWindowResult {
  window: ChartWindow;
  setWindow: (next: ChartWindow) => void;
  zoom: (factor: number) => void;
  pan: (direction: -1 | 1) => void;
  reset: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
  windowed: boolean;
  /** `[start, end]` sliced out of any array of the same length. */
  slice: <T>(items: readonly T[]) => T[];
}

/**
 * Controlled or not, with the clamping in one place.
 *
 * The clamp is the whole reason this is a hook. A window whose end precedes
 * its start renders an empty chart with no way back, and a window past the end
 * of the data renders a chart of nothing. Both are one arithmetic slip away
 * in every caller that does this by hand.
 */
export function useChartWindow(
  total: number,
  controlled?: ChartWindow,
  onChange?: (next: ChartWindow) => void,
): UseChartWindowResult {
  const [internal, setInternal] = useState<ChartWindow>({ start: 0, end: Math.max(0, total - 1) });
  const active = controlled ?? internal;

  const setWindow = useCallback(
    (next: ChartWindow): void => {
      const start = Math.max(0, Math.min(next.start, total - 1));
      // At least two items: a window of one is a chart with no comparison in
      // it, and there is no gesture that gets back out of it.
      const end = Math.max(start + 1, Math.min(next.end, total - 1));
      const clamped = { start, end };
      if (controlled === undefined) setInternal(clamped);
      onChange?.(clamped);
    },
    [controlled, onChange, total],
  );

  const zoom = useCallback(
    (factor: number): void => {
      const centre = (active.start + active.end) / 2;
      const half = ((active.end - active.start) / 2) * factor;
      setWindow({ start: Math.round(centre - half), end: Math.round(centre + half) });
    },
    [active, setWindow],
  );

  const pan = useCallback(
    (direction: -1 | 1): void => {
      const width = active.end - active.start;
      const delta = Math.max(1, Math.round(width / 3)) * direction;
      if (direction === -1 && active.start === 0) return;
      if (direction === 1 && active.end === total - 1) return;
      setWindow({ start: active.start + delta, end: active.end + delta });
    },
    [active, setWindow, total],
  );

  const reset = useCallback((): void => {
    setWindow({ start: 0, end: Math.max(0, total - 1) });
  }, [setWindow, total]);

  const slice = useCallback(
    <T,>(items: readonly T[]): T[] => items.slice(active.start, active.end + 1),
    [active.start, active.end],
  );

  return {
    window: active,
    setWindow,
    zoom,
    pan,
    reset,
    canZoomIn: active.end - active.start > 1,
    canZoomOut: active.start > 0 || active.end < total - 1,
    windowed: active.start > 0 || active.end < total - 1,
    slice,
  };
}

export interface ChartZoomControlsProps {
  state: UseChartWindowResult;
  total: number;
  /** Labels of the currently visible items, for the live readout. */
  visibleLabels: readonly string[];
  className?: string;
}

/**
 * The keyboard path. Every zoom gesture in this system has one of these behind
 * it, because a drag is unreachable by a keyboard, a switch, or an unsteady
 * hand, and a chart that can only be zoomed by dragging is a chart that
 * cannot be zoomed at all by a large number of people.
 */
export function ChartZoomControls({
  state,
  total,
  visibleLabels,
  className,
}: ChartZoomControlsProps): JSX.Element {
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      <Button
        size="sm"
        variant="ghost"
        aria-label="Pan left"
        disabled={state.window.start === 0}
        onClick={() => {
          state.pan(-1);
        }}
        startIcon={<MoveHorizontal className="rotate-180" />}
      />
      <Button
        size="sm"
        variant="ghost"
        aria-label="Zoom in"
        disabled={!state.canZoomIn}
        onClick={() => {
          state.zoom(0.5);
        }}
        startIcon={<ZoomIn />}
      />
      <Button
        size="sm"
        variant="ghost"
        aria-label="Zoom out"
        disabled={!state.canZoomOut}
        onClick={() => {
          state.zoom(2);
        }}
        startIcon={<ZoomOut />}
      />
      <Button
        size="sm"
        variant="ghost"
        aria-label="Pan right"
        disabled={state.window.end === total - 1}
        onClick={() => {
          state.pan(1);
        }}
        startIcon={<MoveHorizontal />}
      />
      {state.windowed ? (
        <Button size="sm" variant="ghost" startIcon={<Maximize2 />} onClick={state.reset}>
          Reset
        </Button>
      ) : null}

      {/* The window in words. A zoomed chart that does not say what it is
          showing is a chart people misread with confidence. */}
      <p aria-live="polite" className="ms-1 text-xs text-fg-muted">
        {visibleLabels[0]} – {visibleLabels.at(-1)} · {visibleLabels.length} of {total}
      </p>
    </div>
  );
}

export interface UseDragZoomResult {
  /** Spread onto the plot container. */
  handlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: () => void;
    onClickCapture: (event: { stopPropagation: () => void; preventDefault: () => void }) => void;
  };
  /** The selection rectangle, or `null` while nothing is being dragged. */
  marquee: { from: number; to: number } | null;
  dragging: boolean;
}

/**
 * Drag across the plot to zoom into the range you dragged.
 *
 * ### The two details that make it usable
 *
 * **A threshold.** Nothing happens until the pointer has moved 6px, so a click
 * on a bar is still a click on a bar. Without it, every selection becomes an
 * accidental zoom to a single column.
 *
 * **Click suppression.** A drag that ends over a button still fires that
 * button's `click`. The capture-phase handler swallows exactly one click after
 * a real drag, which is why releasing over a bar zooms rather than zooming
 * *and* selecting it.
 *
 * Pointer events, not mouse events: the same code then works for a finger and
 * a pen, and `setPointerCapture` keeps the drag alive when the pointer leaves
 * the plot: dragging off the edge is how people select the last column.
 */
export function useDragZoom({
  total,
  enabled,
  orientation = 'horizontal',
  onZoom,
}: {
  total: number;
  enabled: boolean;
  orientation?: 'horizontal' | 'vertical';
  onZoom: (range: ChartWindow) => void;
}): UseDragZoomResult {
  const [marquee, setMarquee] = useState<{ from: number; to: number } | null>(null);
  const origin = useRef<number | null>(null);
  const moved = useRef(false);
  const suppressClick = useRef(false);

  const fractionOf = (event: ReactPointerEvent<HTMLElement>): number => {
    const box = event.currentTarget.getBoundingClientRect();
    const value =
      orientation === 'horizontal'
        ? (event.clientX - box.left) / box.width
        : (event.clientY - box.top) / box.height;
    return Math.max(0, Math.min(1, value));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    // Primary button only: a right-click here is the context menu's, and a
    // middle-click is the browser's.
    if (!enabled || event.button !== 0) return;
    origin.current = fractionOf(event);
    moved.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
    if (!enabled || origin.current === null) return;
    const current = fractionOf(event);
    const box = event.currentTarget.getBoundingClientRect();
    const distance =
      Math.abs(current - origin.current) * (orientation === 'horizontal' ? box.width : box.height);
    // 6px: below the wobble of a deliberate click, above the noise of a tap.
    if (distance < 6) return;
    moved.current = true;
    setMarquee({ from: Math.min(origin.current, current), to: Math.max(origin.current, current) });
  };

  const finish = (event: ReactPointerEvent<HTMLElement>): void => {
    if (!enabled || origin.current === null) return;
    const start = origin.current;
    origin.current = null;
    setMarquee(null);
    if (!moved.current) return;

    const end = fractionOf(event);
    const from = Math.min(start, end);
    const to = Math.max(start, end);
    suppressClick.current = true;

    // Fractions to indices. `floor` on the near edge and `ceil` on the far one,
    // so a drag that visually covers a column includes it: rounding both ends
    // drops whichever column the pointer stopped inside.
    onZoom({
      start: Math.floor(from * (total - 1)),
      end: Math.ceil(to * (total - 1)),
    });
  };

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: () => {
        origin.current = null;
        setMarquee(null);
      },
      onClickCapture: (event) => {
        if (!suppressClick.current) return;
        suppressClick.current = false;
        event.stopPropagation();
        event.preventDefault();
      },
    },
    marquee,
    dragging: marquee !== null,
  };
}

export interface ChartFrameProps {
  /** Names the chart in the context menu. */
  label: string;
  /** Rows for the "copy data" item. */
  rows: readonly { label: string; value: number }[];
  /** Present when the chart has an axis to window. */
  window?: UseChartWindowResult;
  /** Extra commands, appended under a separator. */
  menuItems?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * The right-click menu every chart gets.
 *
 * Two of its commands exist because a chart is where people get stuck:
 * **Copy as CSV** is what someone reaches for when the chart nearly answers
 * their question, and **Reset zoom** is the way out of a window they dragged
 * by accident.
 *
 * Everything in it also exists elsewhere, the zoom controls are buttons above
 * the plot, and the data is in the accessibility table. Right-click is an
 * accelerator, never the only route, which is the same rule `ContextMenu`
 * states for itself.
 */
export function ChartFrame({
  label,
  rows,
  window: windowState,
  menuItems,
  children,
  className,
}: ChartFrameProps): JSX.Element {
  const { copy } = useClipboard();

  const toCsv = (): string =>
    // Quotes doubled and every field quoted: a label containing a comma is a
    // label that would otherwise become two columns. A leading `=`, `+`, `-`
    // or `@` is prefixed with a quote, because Excel treats those as formulas,
    // the CSV-injection case that turns an export into code execution.
    ['label,value', ...rows.map((row) => `${csvField(row.label)},${String(row.value)}`)].join('\n');

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className={cn('min-w-0', className)}>{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>{label}</ContextMenuLabel>
        <ContextMenuSeparator />

        {windowState ? (
          <>
            <ContextMenuItem
              disabled={!windowState.canZoomIn}
              onSelect={() => {
                windowState.zoom(0.5);
              }}
            >
              <ZoomIn aria-hidden />
              Zoom in
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!windowState.canZoomOut}
              onSelect={() => {
                windowState.zoom(2);
              }}
            >
              <ZoomOut aria-hidden />
              Zoom out
            </ContextMenuItem>
            <ContextMenuItem disabled={!windowState.windowed} onSelect={windowState.reset}>
              <Maximize2 aria-hidden />
              Reset zoom
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        ) : null}

        <ContextMenuItem
          onSelect={() => {
            void copy(toCsv());
          }}
        >
          <Copy aria-hidden />
          Copy as CSV
        </ContextMenuItem>

        {menuItems ? (
          <>
            <ContextMenuSeparator />
            {menuItems}
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Quoted, escaped, and de-fanged against Excel's formula parsing. */
function csvField(value: string): string {
  const neutralised = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${neutralised.replace(/"/g, '""')}"`;
}

/** The selection rectangle drawn while a drag is in progress. */
export function ChartMarquee({
  marquee,
  orientation = 'horizontal',
}: {
  marquee: { from: number; to: number } | null;
  orientation?: 'horizontal' | 'vertical';
}): JSX.Element | null {
  if (!marquee) return null;
  const size = `${String((marquee.to - marquee.from) * 100)}%`;
  const offset = `${String(marquee.from * 100)}%`;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-20 rounded-xs border border-accent bg-accent-subtle/40"
      style={
        orientation === 'horizontal'
          ? { insetBlock: 0, insetInlineStart: offset, width: size }
          : { insetInline: 0, top: offset, height: size }
      }
    />
  );
}
