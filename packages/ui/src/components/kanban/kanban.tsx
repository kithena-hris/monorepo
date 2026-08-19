'use client';

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCorners,
  defaultDropAnimationSideEffects,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
  type ScreenReaderInstructions,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  defaultAnimateLayoutChanges,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  type AnimateLayoutChanges,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useVirtualizer } from '@tanstack/react-virtual';
import { GripVertical, MoreHorizontal, MoveRight, X } from 'lucide-react';
import { useCallback, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '../alert-dialog/alert-dialog';
import { Badge } from '../badge/badge';
import { Button } from '../button/button';
import { Checkbox } from '../checkbox/checkbox';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '../context-menu/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../dropdown-menu/dropdown-menu';
import { Reveal, staggerStyle } from '../reveal/reveal';
import { Separator } from '../separator/separator';

/**
 * A board of columns you can drag cards between.
 *
 * ### Why `@dnd-kit` and not the HTML drag-and-drop API
 *
 * The native API has no touch support at all, it simply does not fire on a
 * phone, its drag image is unstyleable, and it has no keyboard story. Every
 * one of those is disqualifying for an HRIS board that runs on an iPad in a
 * warehouse office. dnd-kit is pointer-event based, so touch, mouse and pen
 * all work, and it ships a keyboard sensor plus the live-region plumbing that
 * makes a drag audible. That plumbing is the part nobody hand-rolls correctly.
 *
 * ### Drag is never the only way to move a card
 *
 * Every card carries a "Move to" menu listing every other column. This is not
 * a fallback for old browsers. It is the primary path for a screen-reader
 * user, a switch user, anyone with a tremor, and anyone on a train. A board
 * where the only way to change state is a sustained precise gesture is a board
 * that excludes people, and the menu costs one dropdown.
 *
 * The keyboard drag still works too: Tab to a card's grip, press Space, use
 * the arrow keys, press Space again. Every step is announced.
 *
 * ### Controlled, committed once, with a live preview while dragging
 *
 * `onMove` fires once, on drop, with the destination column and index, so the
 * optimistic update and its rollback stay with the caller: only the caller
 * knows whether the server accepted the transition.
 *
 * *During* a drag the board keeps a throwaway preview of itself. That preview
 * is what makes a gap open in the column you are dragging **into**. Without it
 * the destination column has no idea a card is coming, its `SortableContext`
 * only knows about the cards it already has, so nothing shifts, and the drop
 * lands with a jump. Reordering within one column appears to work because
 * there the item is already in that context.
 *
 * The preview is discarded on drop and on cancel; the props are the truth
 * either side of the gesture.
 */

export interface KanbanColumnDef {
  id: string;
  title: string;
  description?: string;
  /** Colour for the count badge. Never the only signal, the title carries the meaning. */
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
  /** Work-in-progress limit. Exceeded is shown, not enforced: enforcement is a domain rule. */
  limit?: number;
  /** Blocks drops into this column. The move menu hides it too. */
  locked?: boolean;
}

export interface KanbanMove {
  itemId: string;
  from: string;
  to: string;
  /** Insertion index within the destination column, after removal from the source. */
  toIndex: number;
}

/**
 * Where the grip sits on a card. The eight positions of a nine-point box,
 * named the way CSS logical properties are: `start` and `end` follow the
 * writing direction, so a board in Arabic puts a `top-start` grip on the
 * right without a second set of classes.
 *
 * `middle-start` is the conventional place for a list handle, `top-end` for a
 * card whose first line is a title you do not want pushed inward.
 */
export type KanbanHandlePosition =
  | 'top-start'
  | 'top-center'
  | 'top-end'
  | 'middle-start'
  | 'middle-end'
  | 'bottom-start'
  | 'bottom-center'
  | 'bottom-end';

/**
 * What starts a drag.
 *
 * A discriminated union rather than a bag of optional props, because the
 * options are genuinely exclusive: `position` and `reveal` are meaningless
 * without a handle, and a type that lets you pass them anyway is a type that
 * lets you write a call nobody can explain.
 */
export type KanbanDragActivator =
  /**
   * A dedicated grip. The default, and the safe one: a card can then contain
   * links, buttons and selectable text that all still work.
   */
  | { mode: 'handle'; position?: KanbanHandlePosition; reveal?: 'hover' | 'always' }
  /**
   * The whole card. Faster to hit and better on a phone, at a price: text
   * inside it can no longer be selected by dragging, and any button in the
   * card needs its own `pointerdown` guard. A hidden focusable activator is
   * still rendered, so the keyboard drag survives.
   */
  | { mode: 'card' }
  /** Nothing drags. The move menu remains the way to change a column. */
  | { mode: 'none' };

/**
 * Edge scrolling while dragging.
 *
 * The default is deliberately slower than dnd-kit's: a board scrolls
 * *sideways*, and horizontal auto-scroll at the speed that feels right
 * vertically overshoots two columns before the hand reacts.
 */
export type KanbanAutoScroll =
  | { mode: 'off' }
  | {
      mode: 'auto';
      /** `slow` for wide boards, `fast` only for a short one. */
      speed?: 'slow' | 'normal' | 'fast';
      /** How close to the edge scrolling starts, as a fraction of the container. */
      edgeSize?: number;
    }
  | {
      mode: 'custom';
      /** dnd-kit acceleration. Higher is faster; 10 is its default. */
      acceleration: number;
      threshold: { x: number; y: number };
      /** Milliseconds between scroll steps. Larger is choppier, not slower. */
      interval?: number;
    };

/**
 * How the cards move.
 *
 * `smooth` is the default: long enough to follow a card across a column,
 * short enough that a board of forty does not feel syrupy. `none` is not an
 * accessibility setting. `prefers-reduced-motion` already collapses every
 * duration in the system. It is for a board being screenshotted.
 */
export type KanbanMotion =
  | { preset: 'snappy' | 'smooth' | 'calm' }
  | { preset: 'custom'; duration: number; easing: string }
  | { preset: 'none' };

const handlePlacement: Record<KanbanHandlePosition, { grip: string; pad: string }> = {
  'top-start': { grip: 'top-1 start-1', pad: 'ps-8 pt-1' },
  'top-center': { grip: 'top-1 start-1/2 -translate-x-1/2', pad: 'pt-7' },
  'top-end': { grip: 'top-1 end-1', pad: 'pe-8 pt-1' },
  'middle-start': { grip: 'top-1/2 start-1 -translate-y-1/2', pad: 'ps-8' },
  'middle-end': { grip: 'top-1/2 end-1 -translate-y-1/2', pad: 'pe-8' },
  'bottom-start': { grip: 'bottom-1 start-1', pad: 'ps-8 pb-1' },
  'bottom-center': { grip: 'bottom-1 start-1/2 -translate-x-1/2', pad: 'pb-7' },
  'bottom-end': { grip: 'bottom-1 end-1', pad: 'pe-8 pb-1' },
};

/** Acceleration, not pixels per second: dnd-kit scales it by edge proximity. */
const scrollSpeed = { slow: 3, normal: 6, fast: 14 } as const;

const motionPreset = {
  snappy: { duration: 160, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
  // easeOutQuart: most of the distance early, a long tail settling in. The
  // curve that reads as weight rather than as delay.
  smooth: { duration: 260, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' },
  calm: { duration: 380, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
  none: { duration: 0, easing: 'linear' },
} as const;

function resolveMotion(motion: KanbanMotion): { duration: number; easing: string } {
  return motion.preset === 'custom'
    ? { duration: motion.duration, easing: motion.easing }
    : motionPreset[motion.preset];
}

/**
 * One command, usable on one card or on a selection of them.
 *
 * The same shape serves both because the difference is only ever *how many*
 * items arrive, a bulk action is not a different kind of thing, and giving it
 * a second interface is how "Archive" ends up meaning two subtly different
 * operations depending on where it was invoked from.
 */
export interface KanbanAction<T extends { id: string }> {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Printed right-aligned in the menus. Only claim a shortcut that exists. */
  shortcut?: string;
  /** Colours the item. Colour is not consent: pair it with `confirm`. */
  destructive?: boolean;
  /**
   * Raises an `AlertDialog` before running. Required for anything
   * irreversible: a bulk action on forty records is forty mistakes at once,
   * and the count belongs in the sentence the user reads.
   */
  confirm?: {
    title: (items: readonly T[]) => string;
    description: (items: readonly T[]) => string;
    confirmLabel?: string;
  };
  /** Hide the command entirely for this selection, a permission it fails. */
  hidden?: (items: readonly T[]) => boolean;
  /** Show it, greyed. Prefer this to `hidden`: an absent command teaches nothing. */
  disabled?: (items: readonly T[]) => boolean;
  run: (items: readonly T[]) => void;
}

/**
 * Card selection, for bulk actions.
 *
 * A discriminated union like the rest of this component's configuration:
 * `selected` and `onSelectionChange` have no meaning without a selection mode,
 * and a controlled selection with no handler is a checkbox that cannot be
 * unticked.
 */
export type KanbanSelection =
  | { mode: 'none' }
  | {
      mode: 'multiple';
      selected: readonly string[];
      onSelectionChange: (ids: readonly string[]) => void;
    };

export interface KanbanProps<T extends { id: string }> {
  columns: readonly KanbanColumnDef[];
  /** Items per column id. Order within the array is the order on the board. */
  items: Readonly<Record<string, readonly T[]>>;
  renderCard: (item: T, context: { columnId: string; dragging: boolean }) => ReactNode;
  onMove: (move: KanbanMove) => void;
  /** Names the board for assistive tech. */
  label: string;
  /** Turns a card into the string used in drag announcements. Defaults to its id. */
  describeItem?: (item: T) => string;
  /** Rendered under a column's cards, an "Add card" control, usually. */
  renderColumnFooter?: (column: KanbanColumnDef) => ReactNode;
  /** Fixed column width. The board scrolls horizontally past the viewport. */
  columnWidth?: string;
  /** What starts a drag: a grip, the whole card, or nothing. */
  dragActivator?: KanbanDragActivator;
  /** Edge scrolling while dragging. */
  autoScroll?: KanbanAutoScroll;
  /** Duration and easing of every card movement. */
  motion?: KanbanMotion;
  /**
   * Commands for a single card. They appear in the card's menu **and** in its
   * right-click menu, the same list in both, because a command that exists
   * only on right-click does not exist.
   */
  cardActions?: readonly KanbanAction<T>[];
  /**
   * Commands for the current selection. Requires `selection.mode: 'multiple'`;
   * without it there is nothing to act on and the bar never appears.
   */
  bulkActions?: readonly KanbanAction<T>[];
  /**
   * Commands for a column: rename, clear, delete, set a limit.
   *
   * Typed as `KanbanAction<KanbanColumnDef>` rather than as a fourth
   * interface, a column has an `id`, `run` still takes an array of the thing
   * being acted on, and the confirmation plumbing is the same. One shape for
   * every command on this board is worth an array of one.
   *
   * They appear in the column header's menu **and** on right-click of the
   * header. Not of the whole column: a card already owns that gesture, and two
   * context menus opening from one click is worse than either.
   */
  columnActions?: readonly KanbanAction<KanbanColumnDef>[];
  selection?: KanbanSelection;
  className?: string;
}

interface PendingConfirmation {
  title: string;
  description: string;
  confirmLabel: string;
  destructive: boolean;
  run: () => void;
}

const toneFor = (column: KanbanColumnDef): NonNullable<KanbanColumnDef['tone']> =>
  column.tone ?? 'neutral';

/**
 * Cards keep animating while another card is being dragged. dnd-kit's default
 * suppresses the layout animation when an item changes container mid-drag,
 * which is exactly the case this board needs animated, so `wasDragging` is
 * forced on.
 */
const animateLayoutChanges: AnimateLayoutChanges = (args) =>
  defaultAnimateLayoutChanges({ ...args, wasDragging: true });

/**
 * The lifted card settles into its slot rather than snapping.
 *
 * `defaultDropAnimationSideEffects` rather than writing `style.opacity` by
 * hand: dnd-kit restores what it set, keyframes it on the compositor, and
 * cleans up if the drop is interrupted. The hand-written version left an
 * inline opacity behind whenever a drag was cancelled mid-animation, which is
 * how a card ends up permanently half-transparent.
 */
function makeDropAnimation({
  duration,
  easing,
}: {
  duration: number;
  easing: string;
}): DropAnimation {
  return {
    duration,
    easing,
    sideEffects: defaultDropAnimationSideEffects({
      styles: { active: { opacity: '0.4' } },
    }),
  };
}

/** Move an item between columns, purely. Used for the in-drag preview. */
function moveWithin<T extends { id: string }>(
  board: Record<string, T[]>,
  itemId: string,
  from: string,
  to: string,
  toIndex: number,
): Record<string, T[]> {
  const source = [...(board[from] ?? [])];
  const position = source.findIndex((item) => item.id === itemId);
  if (position === -1) return board;
  const [moved] = source.splice(position, 1);
  if (!moved) return board;

  if (from === to) {
    const clamped = Math.max(0, Math.min(toIndex, source.length));
    source.splice(clamped, 0, moved);
    return { ...board, [from]: source };
  }

  const target = [...(board[to] ?? [])];
  target.splice(Math.max(0, Math.min(toIndex, target.length)), 0, moved);
  return { ...board, [from]: source, [to]: target };
}

const instructions: ScreenReaderInstructions = {
  draggable:
    'To pick up a card, press Space or Enter on its drag handle. Use the arrow keys to move it between positions and columns. Press Space or Enter again to drop it, or Escape to cancel. Every card also has a "Move to" menu, which does the same thing without dragging.',
};

export function Kanban<T extends { id: string }>({
  columns,
  items,
  renderCard,
  onMove,
  label,
  describeItem,
  renderColumnFooter,
  columnWidth = '19rem',
  dragActivator = { mode: 'handle' },
  autoScroll = { mode: 'auto' },
  motion = { preset: 'smooth' },
  cardActions,
  bulkActions,
  columnActions,
  selection = { mode: 'none' },
  className,
}: KanbanProps<T>): JSX.Element {
  /** The action waiting on its confirmation dialog, and what it will run on. */
  /**
   * The confirmation waiting to be answered, flattened to strings and a
   * closure. Erasing the generic here is what lets one dialog serve both a
   * `KanbanAction<T>` on cards and a `KanbanAction<KanbanColumnDef>` on
   * columns, the dialog does not care what was acted on, only what to say and
   * what to run.
   */
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  /**
   * The board as it looks mid-drag. `null` outside a drag, so the props are the
   * single source of truth every moment except the ~400ms of a gesture.
   */
  const [preview, setPreview] = useState<Record<string, T[]> | null>(null);
  /** Where the drag started, so the commit reports the real origin column. */
  const origin = useRef<string | null>(null);

  const board = useMemo<Record<string, T[]>>(
    () =>
      preview ??
      Object.fromEntries(columns.map((column) => [column.id, [...(items[column.id] ?? [])]])),
    [preview, columns, items],
  );

  const timing = resolveMotion(motion);

  const autoScrollOptions = useMemo(() => {
    if (autoScroll.mode === 'off') return false;
    if (autoScroll.mode === 'custom') {
      return {
        acceleration: autoScroll.acceleration,
        threshold: autoScroll.threshold,
        interval: autoScroll.interval ?? 5,
      };
    }
    const edge = autoScroll.edgeSize ?? 0.2;
    return {
      acceleration: scrollSpeed[autoScroll.speed ?? 'normal'],
      threshold: { x: edge, y: edge },
      // 5ms between steps: the smallest dnd-kit accepts, and the reason the
      // scroll reads as continuous rather than as a series of jumps. Slowing
      // the scroll is `acceleration`'s job, never this.
      interval: 5,
    };
  }, [autoScroll]);

  const selectable = selection.mode === 'multiple';
  const selectedIds = selection.mode === 'multiple' ? selection.selected : [];

  const allItems = useMemo(() => Object.values(board).flat(), [board]);
  const selectedItems = useMemo(
    () => allItems.filter((item) => selectedIds.includes(item.id)),
    [allItems, selectedIds],
  );

  const setSelection = useCallback(
    (ids: readonly string[]): void => {
      if (selection.mode === 'multiple') selection.onSelectionChange(ids);
    },
    [selection],
  );

  const toggleSelected = useCallback(
    (id: string): void => {
      setSelection(
        selectedIds.includes(id)
          ? selectedIds.filter((current) => current !== id)
          : [...selectedIds, id],
      );
    },
    [selectedIds, setSelection],
  );

  /**
   * Every command goes through here, so the confirmation is impossible to
   * forget at a call site, a card menu and the bulk bar cannot disagree about
   * whether "Reject" asks first.
   */
  const runAction = useCallback(
    // `subjects`, not `items`: the board's own `items` prop is in scope here,
    // and two different lists under one name is how an action ends up running
    // against the whole board instead of the selection.
    <A extends { id: string }>(action: KanbanAction<A>, subjects: readonly A[]): void => {
      if (subjects.length === 0) return;
      if (action.confirm) {
        setPending({
          title: action.confirm.title(subjects),
          description: action.confirm.description(subjects),
          confirmLabel: action.confirm.confirmLabel ?? action.label,
          destructive: action.destructive ?? false,
          run: () => {
            action.run(subjects);
          },
        });
        return;
      }
      action.run(subjects);
    },
    [],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Without a distance threshold every click on a card starts a drag, and
      // the card's own buttons stop working. 6px is below the noise floor of a
      // deliberate click and above the wobble of a tap.
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const index = useMemo(() => {
    const map = new Map<string, { columnId: string; item: T; position: number }>();
    for (const column of columns) {
      (board[column.id] ?? []).forEach((item, position) => {
        map.set(item.id, { columnId: column.id, item, position });
      });
    }
    return map;
  }, [columns, board]);

  const describe = (id: UniqueIdentifier): string => {
    const entry = index.get(String(id));
    if (!entry) return String(id);
    return describeItem ? describeItem(entry.item) : String(id);
  };

  const columnTitle = (id: string): string => columns.find((c) => c.id === id)?.title ?? id;

  /**
   * `over.id` is a card id when hovering a card and a column id when hovering
   * empty space, so both have to resolve to a column and an insertion point.
   */
  const resolveTarget = (
    overId: UniqueIdentifier,
    activeColumnId: string,
  ): { to: string; toIndex: number } | null => {
    const overEntry = index.get(String(overId));
    if (overEntry) {
      // The index is the hovered card's position: "take the place of the card
      // I am over", which is what the drop indicator showed.
      return { to: overEntry.columnId, toIndex: overEntry.position };
    }
    const column = columns.find((c) => c.id === String(overId));
    if (!column) return null;
    // Hovering the empty part of a column means "the end of it". Within the
    // same column that end is one shorter, because the card being dragged is
    // still counted in the array it is leaving.
    const length = (board[column.id] ?? []).length;
    return { to: column.id, toIndex: column.id === activeColumnId ? length - 1 : length };
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const entry = index.get(String(active.id));
      return entry
        ? `Picked up ${describe(active.id)} from ${columnTitle(entry.columnId)}, position ${String(entry.position + 1)}.`
        : `Picked up ${describe(active.id)}.`;
    },
    onDragOver: ({ active, over }) => {
      if (!over) return undefined;
      const entry = index.get(String(active.id));
      if (!entry) return undefined;
      const target = resolveTarget(over.id, entry.columnId);
      if (!target) return undefined;
      return `${describe(active.id)} is over ${columnTitle(target.to)}, position ${String(target.toIndex + 1)}.`;
    },
    onDragEnd: ({ active, over }) => {
      if (!over) return `${describe(active.id)} was dropped where it started.`;
      const entry = index.get(String(active.id));
      if (!entry) return undefined;
      const target = resolveTarget(over.id, entry.columnId);
      if (!target) return undefined;
      return `${describe(active.id)} was moved to ${columnTitle(target.to)}, position ${String(target.toIndex + 1)}.`;
    },
    onDragCancel: ({ active }) =>
      `Moving ${describe(active.id)} was cancelled. It is back where it started.`,
  };

  const onDragStart = ({ active }: DragStartEvent): void => {
    setActiveId(active.id);
    origin.current = index.get(String(active.id))?.columnId ?? null;
  };

  /**
   * The whole reason cross-column drops animate. Moving the card in the preview
   * as it crosses a boundary puts it inside the destination's `SortableContext`,
   * which is what opens the gap, the same mechanism that already made
   * reordering within one column work.
   */
  const onDragOver = useCallback(
    ({ active, over }: DragOverEvent): void => {
      if (!over) return;
      const entry = index.get(String(active.id));
      if (!entry) return;

      const target = resolveTarget(over.id, entry.columnId);
      if (!target) return;
      if (columns.find((column) => column.id === target.to)?.locked) return;
      // Same column: leave it to the sortable strategy, which is already
      // shifting the siblings. Rewriting the preview here would fight it.
      if (target.to === entry.columnId) return;

      setPreview(moveWithin(board, entry.item.id, entry.columnId, target.to, target.toIndex));
    },
    [board, columns, index],
  );

  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    const entry = index.get(String(active.id));
    const from = origin.current;
    setActiveId(null);
    setPreview(null);
    origin.current = null;

    if (!over || !entry || from === null) return;

    const target = resolveTarget(over.id, entry.columnId);
    if (!target) return;
    if (columns.find((c) => c.id === target.to)?.locked) return;
    if (target.to === from && target.toIndex === entry.position) return;

    // `from` is the column the gesture started in, not the one the preview has
    // it in, the caller's data still has it where it began.
    onMove({ itemId: entry.item.id, from, to: target.to, toIndex: target.toIndex });
  };

  const activeEntry = activeId === null ? null : index.get(String(activeId));

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      accessibility={{ announcements, screenReaderInstructions: instructions }}
      // Droppables are re-measured continuously. Without this a column that
      // grew or shrank because of the preview keeps its stale rectangle, and
      // the card drops into the slot the column occupied a moment ago.
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      // Edge scrolling. The default acceleration is 6 rather than dnd-kit's
      // 10: a board scrolls *sideways*, and the speed that feels right
      // vertically overshoots two columns before the hand reacts.
      autoScroll={autoScrollOptions}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveId(null);
        setPreview(null);
        origin.current = null;
      }}
    >
      {selectable && bulkActions && bulkActions.length > 0 ? (
        // `Reveal`, not a conditional render. The bar sits above the board and
        // displaces it; rendered conditionally that displacement happens in a
        // single frame, and the jump lands under the pointer that has just
        // ticked a checkbox.
        <Reveal open={selectedItems.length > 0} from="top">
          <KanbanSelectionBar
            items={selectedItems}
            actions={bulkActions}
            total={allItems.length}
            onRun={runAction}
            onClear={() => {
              setSelection([]);
            }}
            onSelectAll={() => {
              setSelection(allItems.map((item) => item.id));
            }}
          />
        </Reveal>
      ) : null}

      <div
        role="group"
        aria-label={label}
        className={cn(
          'flex min-h-0 gap-3 overflow-x-auto overscroll-x-contain pb-2',
          // Snap so a flick on a phone lands on a column rather than between
          // two of them.
          'snap-x snap-mandatory scroll-px-3',
          // Smooth for the scrolls this component causes, the keyboard sensor
          // bringing a card into view, a column jumped to from a menu. It has
          // no effect on a finger flick, and `prefers-reduced-motion` turns it
          // back to `auto` in the base layer.
          'scroll-smooth',
          className,
        )}
      >
        {columns.map((column) => (
          <KanbanColumn
            key={column.id}
            column={column}
            columns={columns}
            items={board[column.id] ?? []}
            renderCard={renderCard}
            renderColumnFooter={renderColumnFooter}
            onMove={onMove}
            describeItem={describeItem}
            width={columnWidth}
            activeId={activeId}
            dragActivator={dragActivator}
            timing={timing}
            cardActions={cardActions}
            columnActions={columnActions}
            selectable={selectable}
            selectedIds={selectedIds}
            onToggleSelected={toggleSelected}
            onSelectColumn={setSelection}
            onRunAction={runAction}
          />
        ))}
      </div>

      {/*
       * The lifted card is rendered in an overlay rather than by transforming
       * the original: the original stays in flow at reduced opacity, so the gap
       * it leaves shows where "back where it started" is, and the overlay is
       * not clipped by the column's `overflow`.
       */}
      <DragOverlay
        dropAnimation={makeDropAnimation(timing)}
        // dnd-kit writes `transform` on the overlay node every frame. Anything
        // else that writes `transform` on that same node, a CSS keyframe, a
        // tilt class: is a second author of one property at 60fps, which is
        // exactly the jitter this used to have at drag start. The tilt now
        // lives on an inner element that dnd-kit never touches.
        style={{ willChange: 'transform' }}
      >
        {activeEntry ? (
          <div
            className={cn(
              'origin-center cursor-grabbing rounded-lg border border-accent bg-surface shadow-xl',
              'motion-safe:animate-lift',
            )}
            // Capped: the tilt is a pick-up cue and wants to be over quickly,
            // even on `calm`, where 450ms of a card slowly rotating reads as a
            // glitch rather than as a lift.
            style={{
              animationDuration: `${String(Math.min(timing.duration, 200))}ms`,
              animationTimingFunction: timing.easing,
            }}
          >
            {renderCard(activeEntry.item, { columnId: activeEntry.columnId, dragging: true })}
          </div>
        ) : null}
      </DragOverlay>

      {/*
       * One dialog for the whole board rather than one per card. Forty cards
       * each holding a mounted `AlertDialog` is forty portals and forty focus
       * scopes for a thing at most one of them will ever show.
       */}
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>{pending?.title ?? ''}</AlertDialogTitle>
          <AlertDialogDescription>{pending?.description ?? ''}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button>Cancel</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant={pending?.destructive ? 'destructive' : 'primary'}
                onClick={() => {
                  if (!pending) return;
                  pending.run();
                  setPending(null);
                }}
              >
                {pending?.confirmLabel ?? 'Confirm'}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DndContext>
  );
}

/**
 * The bar that appears when something is selected.
 *
 * It sits above the board rather than floating over it: a floating bar covers
 * the bottom row of every column, which is where the cards a person is about
 * to select usually are. The count is a live region, because a selection that
 * changes silently is a selection a screen-reader user cannot audit before
 * running something on forty records.
 */
function KanbanSelectionBar<T extends { id: string }>({
  items,
  actions,
  total,
  onRun,
  onClear,
  onSelectAll,
}: {
  items: readonly T[];
  actions: readonly KanbanAction<T>[];
  total: number;
  onRun: (action: KanbanAction<T>, items: readonly T[]) => void;
  onClear: () => void;
  onSelectAll: () => void;
}): JSX.Element {
  const visible = actions.filter((action) => !(action.hidden?.(items) ?? false));
  // Three buttons and the rest in a menu. A bar of nine buttons is a toolbar
  // nobody reads, and the first three are what people actually use.
  const inline = visible.slice(0, 3);
  const overflow = visible.slice(3);

  return (
    <div
      role="region"
      aria-label="Selection"
      // No entrance animation of its own: the `Reveal` around it owns both
      // directions, and two animations on one arrival fight each other.
      className={cn(
        'mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-accent bg-accent-subtle px-3 py-2',
      )}
    >
      <p aria-live="polite" className="text-sm font-medium text-accent-fg">
        {items.length} selected
      </p>

      {items.length < total ? (
        <Button size="sm" variant="ghost" onClick={onSelectAll}>
          Select all {total}
        </Button>
      ) : null}

      <Separator orientation="vertical" className="h-5 max-sm:hidden" />

      <div className="flex flex-wrap items-center gap-2">
        {inline.map((action) => (
          <Button
            key={action.id}
            size="sm"
            variant={action.destructive ? 'destructive' : 'secondary'}
            disabled={action.disabled?.(items) ?? false}
            startIcon={action.icon}
            onClick={() => {
              onRun(action, items);
            }}
          >
            {action.label}
          </Button>
        ))}

        {overflow.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" aria-label="More actions">
                <MoreHorizontal className="size-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>{items.length} selected</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {overflow.map((action) => (
                <DropdownMenuItem
                  key={action.id}
                  destructive={action.destructive ?? false}
                  disabled={action.disabled?.(items) ?? false}
                  onSelect={() => {
                    onRun(action, items);
                  }}
                >
                  {action.icon}
                  {action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <Button size="sm" variant="ghost" className="ms-auto" startIcon={<X />} onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}

interface KanbanColumnProps<T extends { id: string }> {
  column: KanbanColumnDef;
  columns: readonly KanbanColumnDef[];
  items: readonly T[];
  renderCard: KanbanProps<T>['renderCard'];
  renderColumnFooter: KanbanProps<T>['renderColumnFooter'];
  onMove: KanbanProps<T>['onMove'];
  describeItem: KanbanProps<T>['describeItem'];
  width: string;
  activeId: UniqueIdentifier | null;
  dragActivator: KanbanDragActivator;
  timing: { duration: number; easing: string };
  cardActions: readonly KanbanAction<T>[] | undefined;
  columnActions: readonly KanbanAction<KanbanColumnDef>[] | undefined;
  selectable: boolean;
  selectedIds: readonly string[];
  onToggleSelected: (id: string) => void;
  onSelectColumn: (ids: readonly string[]) => void;
  onRunAction: <A extends { id: string }>(action: KanbanAction<A>, items: readonly A[]) => void;
}

/**
 * Cards in a column past which it renders only the visible window.
 *
 * Virtualizing a sortable list is a trade, not a free win: dnd-kit resolves a
 * drop against mounted nodes, so a card scrolled out of the DOM is not a drop
 * target. Auto-scroll during a drag mounts cards as they come into view, which
 * keeps a drag to anywhere reachable working, but a drop onto a position
 * hundreds of cards away without scrolling there is not.
 *
 * The threshold is set where that trade stops mattering. Dragging through more
 * than this many cards is already impractical by hand, and the alternative
 * below it, mounting the lot, is what makes a long board stutter.
 *
 * It also needs the board to have a bounded height. A column is `flex-1` inside
 * it, so on an unbounded board every column grows to fit its cards: nothing
 * scrolls, and a virtualizer with no viewport to measure has nothing to do.
 */
const VIRTUALIZE_COLUMN_AT = 80;

/** First guess at a card's height, replaced by measurement once painted. */
const ESTIMATED_CARD_HEIGHT = 108;

function KanbanColumn<T extends { id: string }>({
  column,
  columns,
  items,
  renderCard,
  renderColumnFooter,
  onMove,
  describeItem,
  width,
  activeId,
  dragActivator,
  timing,
  cardActions,
  columnActions,
  selectable,
  selectedIds,
  onToggleSelected,
  onSelectColumn,
  onRunAction,
}: KanbanColumnProps<T>): JSX.Element {
  // The column itself is a drop target, which is what makes an *empty* column
  // reachable, with only the cards as targets there is nothing to drop onto.
  const { setNodeRef, isOver } = useDroppable({ id: column.id, disabled: column.locked ?? false });

  /*
   * The column body is both dnd-kit's drop target and the element the
   * virtualizer measures, so the two refs are composed rather than one of them
   * winning. Handing the virtualizer a different element would fail silently:
   * it would measure something that never scrolls and mount every card anyway.
   */
  const listRef = useRef<HTMLDivElement | null>(null);
  const setListRef = useCallback(
    (node: HTMLDivElement | null) => {
      listRef.current = node;
      setNodeRef(node);
    },
    [setNodeRef],
  );

  const virtualized = items.length >= VIRTUALIZE_COLUMN_AT;
  // Memoised: see the note in `virtual-list.tsx`. An unstable option identity
  // makes the virtualizer recompute on every render, and a drag renders a lot.
  const getScrollElement = useCallback(() => listRef.current, []);
  const estimateSize = useCallback(() => ESTIMATED_CARD_HEIGHT, []);

  const virtualizer = useVirtualizer({
    count: virtualized ? items.length : 0,
    getScrollElement,
    estimateSize,
    // Generous, because these are the cards a drag can reach without the board
    // having to auto-scroll first.
    overscan: 10,
  });

  const virtualCards = virtualized ? virtualizer.getVirtualItems() : [];
  const cardsBefore = virtualCards.length > 0 ? (virtualCards[0]?.start ?? 0) : 0;
  const cardsAfter =
    virtualCards.length > 0
      ? virtualizer.getTotalSize() - (virtualCards[virtualCards.length - 1]?.end ?? 0)
      : 0;

  /** The cards to mount, each with the position it really holds in the column. */
  const visibleCards: { item: T; position: number }[] = virtualized
    ? virtualCards.flatMap((entry) => {
        const item = items[entry.index];
        return item ? [{ item, position: entry.index }] : [];
      })
    : items.map((item, position) => ({ item, position }));
  // A fresh array identity every render makes dnd-kit recompute the sortable
  // order on each frame of a drag. Over a long column that is the difference
  // between a smooth reflow and a stutter.
  const sortableIds = useMemo(() => items.map((item) => item.id), [items]);
  // A `Set` for the membership test: `selectedIds.includes` per card is
  // O(cards x selected), which a select-all turns into the worst case.
  const selectedLookup = useMemo(() => new Set(selectedIds), [selectedIds]);
  const columnSelectedCount = items.reduce(
    (total, item) => (selectedLookup.has(item.id) ? total + 1 : total),
    0,
  );
  const overLimit = column.limit !== undefined && items.length > column.limit;
  const visibleColumnActions = (columnActions ?? []).filter(
    (action) => !(action.hidden?.([column]) ?? false),
  );

  const header = (
    <header className="flex items-start gap-2 px-3.5 pt-3.5 pb-1.5">
      {selectable && items.length > 0 ? (
        <Checkbox
          className="mt-0.5"
          aria-label={`Select every card in ${column.title}`}
          // `indeterminate` is a real third state, not a styling flag: a
          // partially selected column reports `aria-checked="mixed"`, which is
          // the difference between "some of these" and "none of these".
          checked={
            columnSelectedCount === 0
              ? false
              : columnSelectedCount === items.length
                ? true
                : 'indeterminate'
          }
          onCheckedChange={(checked) => {
            const columnIds = items.map((item) => item.id);
            onSelectColumn(
              checked === true
                ? [...new Set([...selectedIds, ...columnIds])]
                : selectedIds.filter((id) => !columnIds.includes(id)),
            );
          }}
        />
      ) : null}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-fg">{column.title}</h3>
          <Badge size="sm" tone={overLimit ? 'danger' : toneFor(column)}>
            {column.limit === undefined
              ? items.length
              : `${String(items.length)}/${String(column.limit)}`}
          </Badge>
        </div>
        {column.description ? (
          <p className="mt-0.5 truncate text-xs text-fg-muted">{column.description}</p>
        ) : null}
      </div>

      {visibleColumnActions.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Actions for ${column.title}`}
              className="-me-1.5 -mt-1 shrink-0"
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{column.title}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {visibleColumnActions.map((action) => (
              <DropdownMenuItem
                key={action.id}
                destructive={action.destructive ?? false}
                disabled={action.disabled?.([column]) ?? false}
                onSelect={() => {
                  onRunAction(action, [column]);
                }}
              >
                {action.icon}
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </header>
  );

  return (
    <section
      aria-label={`${column.title}, ${String(items.length)} ${items.length === 1 ? 'card' : 'cards'}`}
      className="flex min-h-0 shrink-0 snap-start flex-col rounded-lg bg-surface-sunken"
      style={{ width }}
    >
      {/*
       * The context menu is on the header, not on the whole column. A card
       * already owns the right-click inside the list, and two context menus
       * opening from one click is worse than either. Radix has no notion of
       * an "inner trigger wins", because the event simply bubbles.
       *
       * A panel title as the right-click target is the convention anyway: it
       * is where a tab, a sidebar section and a window title bar all put it.
       */}
      {visibleColumnActions.length > 0 ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{header}</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuLabel>{column.title}</ContextMenuLabel>
            <ContextMenuSeparator />
            {visibleColumnActions.map((action) => (
              <ContextMenuItem
                key={action.id}
                destructive={action.destructive ?? false}
                disabled={action.disabled?.([column]) ?? false}
                {...(action.shortcut ? { shortcut: action.shortcut } : {})}
                onSelect={() => {
                  onRunAction(action, [column]);
                }}
              >
                {action.icon}
                {action.label}
              </ContextMenuItem>
            ))}
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        header
      )}

      {overLimit ? (
        <p
          role="status"
          className="mx-3 mb-2 rounded-sm bg-danger-subtle px-2 py-1 text-xs text-danger-fg"
        >
          Over the work-in-progress limit.
        </p>
      ) : null}

      <div
        ref={setListRef}
        className={cn(
          // Padding on all four sides, top included. The list is a scroll
          // container, so it clips anything drawn outside a child's box, and
          // a selected card's focus ring is drawn 3px outside its box. With no
          // top padding the first card in a column had its ring sheared off.
          'flex min-h-24 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain p-2.5',
          'scroll-smooth transition-colors duration-(--animate-duration-normal)',
          // The whole column lights up while a card is over it. A 2px line
          // between two cards is not visible on a moving board.
          isOver && !column.locked && 'bg-accent-subtle/60',
          column.locked && 'opacity-70',
        )}
      >
        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
          {cardsBefore > 0 ? <div aria-hidden style={{ height: cardsBefore }} /> : null}

          {visibleCards.map(({ item, position }) => (
            <KanbanCard
              key={item.id}
              id={item.id}
              item={item}
              columnId={column.id}
              columns={columns}
              itemLabel={describeItem ? describeItem(item) : item.id}
              onMove={onMove}
              position={position}
              dragging={activeId === item.id}
              dragActivator={dragActivator}
              timing={timing}
              actions={cardActions}
              selectable={selectable}
              selected={selectedIds.includes(item.id)}
              onToggleSelected={onToggleSelected}
              onRunAction={onRunAction}
            >
              {renderCard(item, { columnId: column.id, dragging: activeId === item.id })}
            </KanbanCard>
          ))}

          {cardsAfter > 0 ? <div aria-hidden style={{ height: cardsAfter }} /> : null}
        </SortableContext>

        {items.length === 0 ? (
          <p
            className={cn(
              'rounded-md border border-dashed px-3 py-6 text-center text-xs',
              'transition-[background-color,border-color,color] duration-(--animate-duration-normal)',
              'animate-fade-in',
              isOver && !column.locked
                ? 'border-accent bg-accent-subtle text-accent-fg'
                : 'border-border text-fg-subtle',
            )}
          >
            {column.locked ? 'Locked' : 'Drop a card here'}
          </p>
        ) : null}

        {renderColumnFooter?.(column)}
      </div>
    </section>
  );
}

interface KanbanCardProps<T extends { id: string }> {
  id: string;
  item: T;
  columnId: string;
  columns: readonly KanbanColumnDef[];
  itemLabel: string;
  position: number;
  onMove: (move: KanbanMove) => void;
  dragging: boolean;
  dragActivator: KanbanDragActivator;
  timing: { duration: number; easing: string };
  actions: readonly KanbanAction<T>[] | undefined;
  selectable: boolean;
  selected: boolean;
  onToggleSelected: (id: string) => void;
  onRunAction: <A extends { id: string }>(action: KanbanAction<A>, items: readonly A[]) => void;
  children: ReactNode;
}

function KanbanCard<T extends { id: string }>({
  id,
  item,
  columnId,
  columns,
  itemLabel,
  position,
  onMove,
  dragging,
  dragActivator,
  timing,
  actions,
  selectable,
  selected,
  onToggleSelected,
  onRunAction,
  children,
}: KanbanCardProps<T>): JSX.Element {
  const {
    attributes,
    listeners,
    setNodeRef,
    // The activator is the grip, not the card. The keyboard sensor uses this
    // node to decide what "picked up" applies to, and it is what a screen
    // reader announces the drag instructions on.
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    // Without this the arriving card has no layout animation, because dnd-kit
    // suppresses it whenever an item changes container mid-drag.
    animateLayoutChanges,
    transition: timing.duration === 0 ? null : { duration: timing.duration, easing: timing.easing },
  });

  const handle = dragActivator.mode === 'handle' ? dragActivator : null;
  const placement = handlePlacement[handle?.position ?? 'middle-start'];
  const alwaysVisible = handle?.reveal === 'always';
  const cardActivator = dragActivator.mode === 'card';

  const visibleActions = (actions ?? []).filter((action) => !(action.hidden?.([item]) ?? false));
  const moveTargets = columns.filter((column) => column.id !== columnId && !column.locked);

  /*
   * `CSS.Transform` and not `CSS.Translate`: translate alone drops the scale
   * dnd-kit computes when a neighbour is a different height, and a card that
   * should be shrinking instead jumps its full height in one frame. That is
   * the second half of the jitter.
   */
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Promotes the card to its own compositor layer for the duration of the
    // drag only. Leaving `will-change` on every card on a 200-card board is
    // how a browser runs out of layers.
    willChange: transform ? ('transform' as const) : undefined,
  };

  const card = (
    <article
      ref={setNodeRef}
      style={style}
      {...(cardActivator ? { ...attributes, ...listeners } : {})}
      className={cn(
        'group relative rounded-lg border border-border bg-surface',
        // Only shadow and opacity transition here. `transform` is dnd-kit's,
        // written inline every frame; a Tailwind `transition-all` over it is a
        // transition on a value that changes 60 times a second, which reads as
        // lag on drag start and as a rubber band on drop.
        'transition-[box-shadow,opacity] duration-(--animate-duration-fast) ease-standard',
        'hover:shadow-sm focus-within:shadow-sm',
        // The original keeps its place at low opacity while the overlay flies,
        // so the hole it leaves is visible.
        (isDragging || dragging) && 'opacity-40',

        cardActivator && 'cursor-grab touch-none select-none active:cursor-grabbing',
      )}
      data-selected={selected || undefined}
    >
      {/*
       * The selection ring is its own element, for two reasons. It can then
       * fade rather than appear, a ring is a box-shadow, and putting a
       * shadow transition on the card would also slow its hover response. And
       * it can carry a per-card delay, so ticking a column header reads as a
       * sweep down the column instead of forty cards changing in one frame.
       *
       * A ring rather than a border swap: a border change moves the content by
       * a pixel, and a column flickering by a pixel is worse than no
       * indication at all.
       */}
      <span
        aria-hidden
        style={staggerStyle(position)}
        className={cn(
          'pointer-events-none absolute inset-0 rounded-lg',
          'ring-2 ring-accent ring-offset-1 ring-offset-surface-sunken',
          'transition-opacity duration-(--animate-duration-normal) ease-standard',
          selected ? 'opacity-100' : 'opacity-0',
        )}
      />
      {/*
       * 12px on every side, and the grip's side widened to 36px so the
       * content clears it. The old 4px was the padding of a control, not of a
       * card: text sat on the border, and two stacked cards read as one block
       * with a line through it.
       */}
      <div className={cn('flex items-start gap-2 p-3', handle && placement.pad)}>
        {handle ? (
          /*
           * The handle, not the card, is draggable by default. A draggable card
           * cannot contain a link or a button that still works, and it hijacks
           * text selection, which people do constantly on a board of names.
           */
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Drag ${itemLabel}`}
            className={cn(
              'absolute z-10 grid size-6 place-items-center rounded-sm text-fg-subtle',
              placement.grip,
              'cursor-grab touch-none',
              'transition-[color,background-color,opacity] duration-(--animate-duration-fast)',
              'hover:bg-surface-hover hover:text-fg active:cursor-grabbing',
              'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus',
              // Revealed on hover, on focus, and on any touch device, where
              // there is no hover to reveal it with. `always` opts out.
              alwaysVisible
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 touch:opacity-100',
            )}
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
        ) : null}

        {cardActivator ? (
          /*
           * Pointer events are on the card, but a keyboard has no card to press,
           * so the activator still exists. It is simply not visible. Without
           * it `mode: 'card'` would be a drag no keyboard user can start.
           */
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Drag ${itemLabel}`}
            className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:start-1 focus-visible:top-1 focus-visible:z-10 focus-visible:grid focus-visible:size-6 focus-visible:place-items-center focus-visible:rounded-sm focus-visible:bg-surface focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus"
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
        ) : null}

        {selectable ? (
          <Checkbox
            className="mt-0.5 shrink-0"
            aria-label={`Select ${itemLabel}`}
            checked={selected}
            onCheckedChange={() => {
              onToggleSelected(id);
            }}
            // A pointer-down on the checkbox must not also start a drag when
            // the whole card is the activator.
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
          />
        ) : null}

        <div className="min-w-0 flex-1">{children}</div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Move ${itemLabel}`}
              className={cn(
                '-me-1 -mt-1 shrink-0',
                'transition-opacity duration-(--animate-duration-fast)',
                'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 touch:opacity-100',
              )}
              startIcon={<MoveRight />}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {visibleActions.length > 0 ? (
              <>
                <DropdownMenuLabel>{itemLabel}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {visibleActions.map((action) => (
                  <DropdownMenuItem
                    key={action.id}
                    destructive={action.destructive ?? false}
                    disabled={action.disabled?.([item]) ?? false}
                    onSelect={() => {
                      onRunAction(action, [item]);
                    }}
                  >
                    {action.icon}
                    {action.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuLabel>Move to</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {moveTargets.map((column) => (
              <DropdownMenuItem
                key={column.id}
                onSelect={() => {
                  onMove({ itemId: id, from: columnId, to: column.id, toIndex: 0 });
                }}
              >
                {column.title}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={position === 0}
              onSelect={() => {
                onMove({ itemId: id, from: columnId, to: columnId, toIndex: position - 1 });
              }}
            >
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                onMove({ itemId: id, from: columnId, to: columnId, toIndex: position + 1 });
              }}
            >
              Move down
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );

  if (visibleActions.length === 0) return card;

  /*
   * The same commands on right-click. Identical list, deliberately: the menu
   * button is what makes them discoverable and reachable on touch, and the
   * context menu is the accelerator for whoever works this board all day.
   * Building only one of the two is the mistake.
   */
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>{itemLabel}</ContextMenuLabel>
        <ContextMenuSeparator />
        {visibleActions.map((action) => (
          <ContextMenuItem
            key={action.id}
            destructive={action.destructive ?? false}
            disabled={action.disabled?.([item]) ?? false}
            {...(action.shortcut ? { shortcut: action.shortcut } : {})}
            onSelect={() => {
              onRunAction(action, [item]);
            }}
          >
            {action.icon}
            {action.label}
          </ContextMenuItem>
        ))}
        {moveTargets.length > 0 ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <MoveRight aria-hidden />
                Move to
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {moveTargets.map((column) => (
                  <ContextMenuItem
                    key={column.id}
                    onSelect={() => {
                      onMove({ itemId: id, from: columnId, to: column.id, toIndex: 0 });
                    }}
                  >
                    {column.title}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}
