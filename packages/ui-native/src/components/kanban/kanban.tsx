import {
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUpToLine,
  Ellipsis,
  GripVertical,
  Lock,
  Plus,
  type LucideIcon,
} from 'lucide-react-native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Platform,
  View as NativeView,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector, type PanGesture } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  scrollTo,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Pressable, Text as CssText, View } from 'react-native-css/components';
import { scheduleOnRN } from 'react-native-worklets';

import { useLayoutTransition } from '../../lib/animate.ts';
import { cn } from '../../lib/cn.ts';
import { easings, gentleSpring, physics } from '../../lib/motion.ts';
import { useAnnouncer, useDragMotion } from '../../lib/reorder.tsx';
import { Button } from '../button/button.tsx';
import { CheckboxBox } from '../checkbox/checkbox.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../dropdown-menu/dropdown-menu.tsx';
import { Icon } from '../icon/icon.tsx';
import { BulkAction } from '../table/table.tsx';
import { SegmentedControl, SegmentedControlItem } from '../segmented-control/segmented-control.tsx';
import {
  GAP,
  indexAt,
  laneAt,
  laneOf,
  moveWithin,
  offsetOf,
  type Geometry,
  type Lane,
} from './kanban-geometry.ts';

/**
 * Work moving between stages, as the web's `Kanban`, drawn for a phone.
 *
 * Columns 300 wide on a board that snaps one column at a time, or
 * (`layout="single"`) one column under a segmented control. A card moves by
 * long-press and drag, within its column or onto another one, and always by a
 * non-drag way too: the card's ⋯ menu ("Move to…", top, bottom), arrow keys
 * on its handle (Space picks up, Esc puts back), and VoiceOver and TalkBack
 * actions. A full column refuses a card and says why; a locked column shows
 * its cards and moves none. Every move is announced in the web's words.
 *
 * ### One drag for the whole board, with a preview of itself
 *
 * The long-press lifts the card into an overlay that follows the finger on
 * the UI thread. Each frame, a worklet finds the column and slot under the
 * card from rectangles measured by layout (never per frame), scrolls the board
 * or the column near an edge, and only when the slot changes calls back once
 * to set a throwaway preview: the board with the card moved. The columns draw
 * that preview, so a gap opens where the card will land, in its own column or
 * in another, and the cards around it glide on the move spring. On release the
 * overlay settles into the gap on the gentle spring, `onMove` fires once with
 * the column and index, and the preview is discarded: the props are the truth
 * either side of the gesture.
 *
 * The lifted card's own view never moves or unmounts while the finger is down
 * (it collapses where it was): a gesture belongs to the view it started on,
 * and the web captures the pointer to that same element.
 */

export type KanbanTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

export type KanbanColumnDef = {
  id: string;
  title: string;
  /** A quiet line under the column's title. */
  description?: string;
  tone?: KanbanTone;
  /** Refuses cards past this many. */
  limit?: number;
  /** Shows its cards and moves none. */
  locked?: boolean;
  /** Shown instead of the number of cards: a total held elsewhere, 48 when 5 are loaded. */
  count?: number;
};

export type KanbanMove = { itemId: string; from: string; to: string; toIndex: number };

export type KanbanAction<T> = {
  id: string;
  label: string;
  /** A component, not an element: a phone's menu row sizes and tints it. */
  icon?: LucideIcon;
  destructive?: boolean;
  /** Hide the command for these items: a permission they fail. */
  hidden?: (items: readonly T[]) => boolean;
  /** Show it, greyed. Prefer this to `hidden`: an absent command teaches nothing. */
  disabled?: (items: readonly T[]) => boolean;
  run: (items: readonly T[]) => void;
};

/**
 * Where the grip sits, as the web names the eight places. A phone draws it on
 * the title's line: a `-start` place before the title, an `-end` one after it.
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

/** What starts a drag: a grip, the whole card, or nothing (the menu still moves it). */
export type KanbanDragActivator =
  { mode: 'handle'; position?: KanbanHandlePosition } | { mode: 'card' } | { mode: 'none' };

/** Card selection, for bulk actions. */
export type KanbanSelection =
  | { mode: 'none' }
  | {
      mode: 'multiple';
      selected: readonly string[];
      onSelectionChange: (ids: readonly string[]) => void;
    };

export type KanbanProps<T extends { id: string }> = {
  columns: readonly KanbanColumnDef[];
  items: Readonly<Record<string, readonly T[]>>;
  onMove: (move: KanbanMove) => void;
  /** The board's accessible name. */
  label: string;
  /** A card's title, and its name when a move is spoken. */
  cardTitle: (item: T) => string;
  /** Under the title: a role, tags, avatars. */
  renderCard?: (item: T, context: { columnId: string; dragging: boolean }) => ReactNode;
  /** What starts a drag. A grip before the title by default. */
  dragActivator?: KanbanDragActivator;
  /** A ⋯ menu on each card with "Move to…", top and bottom, then `cardActions`. */
  cardMenu?: boolean;
  cardActions?: readonly KanbanAction<T>[];
  /** A checkbox on each card, and a bulk bar for the chosen ones. */
  selection?: KanbanSelection;
  /** The bar's commands, for the selection. Requires `selection.mode: 'multiple'`. */
  bulkActions?: readonly KanbanAction<T>[];
  /** A column's own menu: rename, delete. */
  columnActions?: readonly KanbanAction<KanbanColumnDef>[];
  /** "+" in a column's header. */
  onAddCard?: (columnId: string) => void;
  /** Under a column's cards: "Add card", "+ 43 more". */
  renderColumnFooter?: (column: KanbanColumnDef) => ReactNode;
  /** `single`: one column at a time under a segmented control. */
  layout?: 'board' | 'single';
  /** The column a single layout opens on. */
  defaultColumn?: string;
  /** Each column this tall, its cards scrolling under a fixed header. */
  columnHeight?: number;
  /** A board column's width, in points. 300 under a thumb, as on the web. */
  columnWidth?: number;
  /** After the last column: a new section's form. */
  after?: ReactNode;
  /** The card the keyboard is on: a focus ring. */
  focusedId?: string;
  /** Opens this card's ⋯ menu as the board renders: for a walkthrough. */
  defaultMenuOpenFor?: string;
  /** The first column's cards alone, without the column: a card shown on its own. */
  bare?: boolean;
  className?: string | undefined;
};

const WEB = Platform.OS === 'web';
const NO_SELECTION: KanbanSelection = { mode: 'none' };
const GRIP: KanbanDragActivator = { mode: 'handle', position: 'top-start' };
const NO_ACTIONS: readonly never[] = [];

/** Edge scrolling starts this far from an edge, as a share of the view: the web's `edgeSize`. */
const EDGE = 0.2;
/**
 * Points a frame at the very edge, fewer further in. Slow on purpose, as the
 * web's: a board scrolls sideways, and a fast one overshoots a column.
 */
const SCROLL_STEP = 8;
/** The landing: the gentle spring, as a worklet takes it. */
const LAND = (({ mass, stiffness, damping }) => ({ mass, stiffness, damping }))(
  physics(gentleSpring),
);
/** The lift's curve, built before a worklet runs (see `animateTo`). */
const LIFT_EASING = Easing.bezier(...easings.standard);
/** The lifted card's own view while it is held: where it was, taking no room, unseen. */
const COLLAPSED = { height: 0, marginTop: -GAP, opacity: 0, overflow: 'hidden' } as const;
const OVERLAY = { position: 'absolute', left: 0, top: 0, zIndex: 10 } as const;

const MOVE_ACTIONS = [
  { name: 'decrement', label: 'Move up' },
  { name: 'increment', label: 'Move down' },
  { name: 'previous', label: 'Move to the previous column' },
  { name: 'next', label: 'Move to the next column' },
];
const ACTION_STEP: Record<string, 'up' | 'down' | 'left' | 'right'> = {
  decrement: 'up',
  increment: 'down',
  previous: 'left',
  next: 'right',
};

const DOT: Record<KanbanTone, string> = {
  neutral: 'bg-fg-subtle',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

/** The card a drag holds: where it was picked up. */
type Lift = { id: string; from: string; index: number };

/** Rectangles from layout events, kept off React state: a drag reads them, nothing renders them. */
type Measured = {
  lanes: Record<string, { x: number; w: number; left: number; top: number }>;
  heights: Record<string, number>;
  frameW: number;
  frameH: number;
  contentW: number;
};

/** What a column's own scroll reads of the drag, to scroll itself near an edge. */
type DragFeed = {
  phase: SharedValue<number>;
  hover: SharedValue<string>;
  oy: SharedValue<number>;
  oh: SharedValue<number>;
  colScroll: SharedValue<Record<string, number>>;
};

export function Kanban<T extends { id: string }>({
  columns,
  items,
  onMove,
  label,
  cardTitle,
  renderCard,
  dragActivator = GRIP,
  cardMenu = false,
  cardActions = NO_ACTIONS,
  selection = NO_SELECTION,
  bulkActions = NO_ACTIONS,
  columnActions = [],
  onAddCard,
  renderColumnFooter,
  layout = 'board',
  defaultColumn,
  columnHeight,
  columnWidth = 300,
  after,
  focusedId,
  bare = false,
  defaultMenuOpenFor,
  className,
}: KanbanProps<T>): React.JSX.Element {
  const drag = useDragMotion();
  const glide = useLayoutTransition();
  const { announce, region } = useAnnouncer();
  const selectable = selection.mode === 'multiple';
  const selected = selection.mode === 'multiple' ? selection.selected : NO_ACTIONS;
  const setSelected = (next: readonly string[]): void => {
    if (selection.mode === 'multiple') selection.onSelectionChange(next);
  };
  const draggable = dragActivator.mode !== 'none';
  const handle =
    dragActivator.mode === 'card'
      ? 'none'
      : dragActivator.mode === 'handle' && dragActivator.position?.endsWith('-end') === true
        ? 'right'
        : 'left';
  const [current, setCurrent] = useState(defaultColumn ?? columns[0]?.id ?? '');
  const [picked, setPicked] = useState<{ id: string; from: string; index: number } | null>(null);
  /** The card a finger holds, from the long-press until it has landed. */
  const [active, setActive] = useState<Lift | null>(null);
  /** The board mid-drag, the card where it would land. `null` outside a drag. */
  const [preview, setPreview] = useState<Readonly<Record<string, readonly T[]>> | null>(null);
  const lift = useRef<Lift | null>(null);
  const measured = useRef<Measured>({ lanes: {}, heights: {}, frameW: 0, frameH: 0, contentW: 0 });

  // The drag, on the UI thread. `phase`: 0 at rest, 1 held, 2 landing.
  const geo = useSharedValue<Geometry>({ lanes: [], frameW: 0, frameH: 0, contentW: 0 });
  const phase = useSharedValue(0);
  const heldId = useSharedValue('');
  const fromLane = useSharedValue('');
  const fromSlot = useSharedValue(0);
  const toLane = useSharedValue('');
  const toSlot = useSharedValue(0);
  const hover = useSharedValue('');
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const t0x = useSharedValue(0);
  const t0y = useSharedValue(0);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const ox = useSharedValue(0);
  const oy = useSharedValue(0);
  const ow = useSharedValue(0);
  const oh = useSharedValue(0);
  const scale = useSharedValue(1);
  const scrollX = useSharedValue(0);
  const colScroll = useSharedValue<Record<string, number>>({});
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const onBoardScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollX.value = e.contentOffset.x;
    },
  });
  const feed: DragFeed = { phase, hover, oy, oh, colScroll };

  const cardsOf = (id: string): readonly T[] => items[id] ?? [];
  const columnOf = (itemId: string): KanbanColumnDef | undefined =>
    columns.find((c) => cardsOf(c.id).some((i) => i.id === itemId));
  const find = (itemId: string): T | undefined =>
    Object.values(items)
      .flat()
      .find((i) => i.id === itemId);
  const titleOf = (id: string): string => columns.find((c) => c.id === id)?.title ?? id;

  /** The columns on screen: what a drag can land in. */
  const shown = bare
    ? columns.slice(0, 1)
    : layout === 'single'
      ? columns.filter((c) => c.id === current)
      : columns;

  /** Hands the UI thread the board's rectangles, from the props and the last layout. */
  const publish = (): void => {
    const m = measured.current;
    geo.value = {
      frameW: m.frameW,
      frameH: m.frameH,
      contentW: m.contentW,
      lanes: shown.flatMap((c): Lane[] => {
        const at = m.lanes[c.id];
        if (!at) return [];
        const cards = cardsOf(c.id);
        return [
          {
            id: c.id,
            ...at,
            locked: c.locked ?? false,
            full: c.limit !== undefined && cards.length >= c.limit,
            cards: cards.map((i) => ({ id: i.id, h: m.heights[i.id] ?? 0 })),
          },
        ];
      }),
    };
  };
  // After every render: the props, or the columns on screen, may have changed.
  useEffect(publish);
  const place = (id: string, part: Partial<Measured['lanes'][string]>): void => {
    const lanes = measured.current.lanes;
    lanes[id] = { ...(lanes[id] ?? { x: 0, w: 0, left: 0, top: 0 }), ...part };
    publish();
  };

  /** Why a column refuses a card, or nothing when it takes it. */
  const refusal = (to: KanbanColumnDef, from: string): string | null => {
    if (to.locked) return `${to.title} is locked`;
    if (to.id !== from && to.limit !== undefined && cardsOf(to.id).length >= to.limit) {
      return `${to.title} is full, ${String(to.limit)} of ${String(to.limit)}`;
    }
    return null;
  };

  /**
   * Commits a move and says it in the web's words: "was moved to" once it is
   * done, "is over" while a keyboard still holds the card.
   */
  const moveCard = (
    itemId: string,
    to: string,
    toIndex: number,
    said: 'moved' | 'over' | 'quiet' = 'moved',
  ): void => {
    const fromColumn = columnOf(itemId);
    const target = columns.find((c) => c.id === to);
    const item = find(itemId);
    if (!fromColumn || !target || !item) return;
    if (fromColumn.locked) {
      announce(`${fromColumn.title} is locked. ${cardTitle(item)} stays.`);
      return;
    }
    const refused = refusal(target, fromColumn.id);
    if (refused) {
      announce(`${refused}. ${cardTitle(item)} stays in ${fromColumn.title}.`);
      return;
    }
    const length = cardsOf(to).length - (to === fromColumn.id ? 1 : 0);
    const index = Math.max(0, Math.min(length, toIndex));
    onMove({ itemId, from: fromColumn.id, to, toIndex: index });
    const where = `${target.title}, position ${String(index + 1)}.`;
    if (said === 'moved') announce(`${cardTitle(item)} was moved to ${where}`);
    else if (said === 'over') announce(`${cardTitle(item)} is over ${where}`);
  };

  /** Arrow keys and screen-reader actions on a card. */
  const step = (
    itemId: string,
    key: 'up' | 'down' | 'left' | 'right',
    said: 'moved' | 'over' = 'moved',
  ): void => {
    const column = columnOf(itemId);
    if (!column) return;
    const index = cardsOf(column.id).findIndex((i) => i.id === itemId);
    if (key === 'up' || key === 'down') {
      moveCard(itemId, column.id, index + (key === 'up' ? -1 : 1), said);
      return;
    }
    const at = columns.findIndex((c) => c.id === column.id);
    const next = columns[at + (key === 'left' ? -1 : 1)];
    if (next) moveCard(itemId, next.id, Math.min(index, cardsOf(next.id).length), said);
  };
  const onMoveAction =
    (itemId: string) =>
    (e: AccessibilityActionEvent): void => {
      const direction = ACTION_STEP[e.nativeEvent.actionName];
      if (direction) step(itemId, direction);
    };

  const keyHandler = (item: T) => (e: { key: string; preventDefault: () => void }) => {
    const column = columnOf(item.id);
    if (!column) return;
    const name = cardTitle(item);
    const index = cardsOf(column.id).findIndex((i) => i.id === item.id);
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (picked?.id === item.id) {
        setPicked(null);
        announce(
          picked.from === column.id && picked.index === index
            ? `${name} was dropped where it started.`
            : `${name} was moved to ${column.title}, position ${String(index + 1)}.`,
        );
      } else {
        setPicked({ id: item.id, from: column.id, index });
        announce(`Picked up ${name} from ${column.title}, position ${String(index + 1)}.`);
      }
      return;
    }
    if (e.key === 'Escape' && picked?.id === item.id) {
      e.preventDefault();
      moveCard(item.id, picked.from, picked.index, 'quiet');
      setPicked(null);
      announce(`Moving ${name} was cancelled. It is back where it started.`);
      return;
    }
    const arrows: Record<string, 'up' | 'down' | 'left' | 'right'> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
    };
    const direction = arrows[e.key];
    if (direction && picked?.id === item.id) {
      e.preventDefault();
      step(item.id, direction, 'over');
    }
  };

  // The drag's calls back to React: once at the lift, once per new slot, once at the drop.

  /** The slot under the card changed: the preview moves the card there. */
  const overSlot = (laneId: string, index: number): void => {
    const held = lift.current;
    if (!held) return;
    // Off the board: the preview shows the card back where it was, and letting go cancels.
    setPreview(
      moveWithin(items, held.id, held.from, laneId || held.from, laneId ? index : held.index),
    );
    const item = find(held.id);
    if (item && laneId) {
      announce(`${cardTitle(item)} is over ${titleOf(laneId)}, position ${String(index + 1)}.`);
    }
  };
  const refused = (laneId: string): void => {
    const held = lift.current;
    const column = columns.find((c) => c.id === laneId);
    const why = held && column ? refusal(column, held.from) : null;
    if (why) announce(`${why}.`);
  };

  const ticker = useFrameCallback(() => {
    if (phase.value !== 1) return;
    const g = geo.value;
    ox.value = sx.value + tx.value;
    oy.value = sy.value + ty.value;
    const cx = ox.value + ow.value / 2;
    const cy = oy.value + oh.value / 2;

    // Near an edge, the board scrolls, faster the closer the card.
    const room = g.contentW - g.frameW;
    if (layout === 'board' && !bare && room > 0) {
      const edge = g.frameW * EDGE;
      const push =
        cx > g.frameW - edge ? (cx - g.frameW + edge) / edge : cx < edge ? (cx - edge) / edge : 0;
      const next = Math.max(
        0,
        Math.min(room, scrollX.value + SCROLL_STEP * Math.max(-1, Math.min(1, push))),
      );
      if (next !== scrollX.value) {
        scrollX.value = next;
        scrollTo(scrollRef, next, 0, false);
      }
    }

    const lane = laneAt(g, cx + scrollX.value);
    const inside = lane !== undefined && cy >= 0 && cy <= g.frameH;
    const closed = lane !== undefined && (lane.locked || (lane.full && lane.id !== fromLane.value));
    const under = inside ? lane.id : '';
    if (under !== hover.value) {
      hover.value = under;
      if (inside && closed) scheduleOnRN(refused, under);
    }
    // A column that refuses the card leaves it where it last was taken.
    if (inside && closed) return;
    const nextLane = inside ? lane.id : '';
    const nextSlot = inside
      ? indexAt(lane, heldId.value, cy - lane.top + (colScroll.value[lane.id] ?? 0))
      : -1;
    if (nextLane !== toLane.value || nextSlot !== toSlot.value) {
      toLane.value = nextLane;
      toSlot.value = nextSlot;
      scheduleOnRN(overSlot, nextLane, nextSlot);
    }
  }, false);

  const begin = (itemId: string, laneId: string, index: number): void => {
    lift.current = { id: itemId, from: laneId, index };
    setActive(lift.current);
    ticker.setActive(true);
    const item = find(itemId);
    if (item) {
      announce(
        `Picked up ${cardTitle(item)} from ${titleOf(laneId)}, position ${String(index + 1)}.`,
      );
    }
  };
  /** The finger is up: commit, or say why nothing moved. The overlay is still landing. */
  const drop = (laneId: string, index: number): void => {
    ticker.setActive(false);
    setPreview(null);
    const held = lift.current;
    const item = held ? find(held.id) : undefined;
    if (!held || !item) return;
    if (!laneId) announce(`Moving ${cardTitle(item)} was cancelled. It is back where it started.`);
    else if (laneId === held.from && index === held.index) {
      announce(`${cardTitle(item)} was dropped where it started.`);
    } else moveCard(held.id, laneId, index);
  };
  /** Landed: the card is drawn in its place again. */
  const settle = (): void => {
    lift.current = null;
    setActive(null);
    phase.value = 0;
  };

  const lifting = { duration: drag.activationAnimationDuration, easing: LIFT_EASING };
  const grown = drag.activeItemScale;
  const jump = drag.dropAnimationDuration === 0;

  /** The long-press drag on one card, as its column holds it in the props. */
  const panFor = (itemId: string, laneId: string): PanGesture =>
    Gesture.Pan()
      .activateAfterLongPress(drag.dragActivationDelay)
      .onStart((e) => {
        const lane = laneOf(geo.value, laneId);
        const index = lane ? lane.cards.findIndex((c) => c.id === itemId) : -1;
        const held = lane?.cards[index];
        if (!lane || !held || phase.value !== 0) return;
        phase.value = 1;
        heldId.value = itemId;
        fromLane.value = laneId;
        fromSlot.value = index;
        toLane.value = laneId;
        toSlot.value = index;
        hover.value = laneId;
        t0x.value = e.translationX;
        t0y.value = e.translationY;
        tx.value = 0;
        ty.value = 0;
        sx.value = lane.x + lane.left - scrollX.value;
        sy.value = lane.top + offsetOf(lane, itemId, index) - (colScroll.value[laneId] ?? 0);
        ox.value = sx.value;
        oy.value = sy.value;
        ow.value = lane.w - 2 * lane.left;
        oh.value = held.h;
        scale.value = withTiming(grown, lifting);
        scheduleOnRN(begin, itemId, laneId, index);
      })
      .onUpdate((e) => {
        if (phase.value !== 1 || heldId.value !== itemId) return;
        tx.value = e.translationX - t0x.value;
        ty.value = e.translationY - t0y.value;
      })
      .onFinalize((_e, success) => {
        if (phase.value !== 1 || heldId.value !== itemId) return;
        phase.value = 2;
        const cancelled = !success || toLane.value === '';
        const laneTo = cancelled ? fromLane.value : toLane.value;
        const index = cancelled ? fromSlot.value : toSlot.value;
        const lane = laneOf(geo.value, laneTo);
        const x = lane ? lane.x + lane.left - scrollX.value : sx.value;
        const y = lane
          ? lane.top + offsetOf(lane, itemId, index) - (colScroll.value[laneTo] ?? 0)
          : sy.value;
        scheduleOnRN(drop, cancelled ? '' : laneTo, index);
        if (jump) {
          scale.value = 1;
          ox.value = x;
          oy.value = y;
          scheduleOnRN(settle);
          return;
        }
        scale.value = withTiming(1, lifting);
        ox.value = withSpring(x, LAND);
        oy.value = withSpring(y, LAND, () => {
          scheduleOnRN(settle);
        });
      });

  const grip = (item: T, column: KanbanColumnDef, pan?: PanGesture): ReactNode => {
    const name = cardTitle(item);
    if (column.locked) return <Icon icon={Lock} size={15} tone="subtle" label="Locked" />;
    const control = (
      <Pressable
        accessibilityRole="adjustable"
        accessibilityLabel={`Move ${name}`}
        accessibilityHint="Long-press and drag, or use the actions, to move it"
        accessibilityActions={MOVE_ACTIONS}
        onAccessibilityAction={onMoveAction(item.id)}
        {...(WEB
          ? ({
              role: 'button',
              'aria-label': `Move ${name}. Space picks it up, arrows move it, Escape puts it back`,
              'aria-pressed': picked?.id === item.id,
              onKeyDown: keyHandler(item),
            } as object)
          : {})}
        hitSlop={12}
        className="-m-1 p-1"
      >
        <Icon icon={GripVertical} size={15} tone="subtle" />
      </Pressable>
    );
    return pan ? (
      <GestureDetector gesture={pan}>
        <NativeView collapsable={false}>{control}</NativeView>
      </GestureDetector>
    ) : (
      control
    );
  };

  const menu = (item: T, column: KanbanColumnDef): ReactNode => {
    const cards = cardsOf(column.id);
    const name = cardTitle(item);
    return (
      <DropdownMenu defaultOpen={defaultMenuOpenFor === item.id}>
        <DropdownMenuTrigger>
          <Button
            variant="ghost"
            size="xs"
            startIcon={<Icon icon={Ellipsis} />}
            accessibilityLabel={`Actions for ${name}`}
            className="-my-1.5 -mr-1.5"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent label={`Actions for ${name}`} className="w-[240px]">
          {column.locked ? (
            <DropdownMenuItem
              icon={ArrowRightLeft}
              disabled
              description={`${column.title} is locked`}
            >
              Move to
            </DropdownMenuItem>
          ) : (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger icon={ArrowRightLeft}>Move to</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {columns
                  .filter((c) => c.id !== column.id)
                  .map((c) => {
                    const why = refusal(c, column.id);
                    return (
                      <DropdownMenuItem
                        key={c.id}
                        disabled={why !== null}
                        {...(why ? { description: why } : {})}
                        onSelect={() => {
                          moveCard(item.id, c.id, cardsOf(c.id).length);
                        }}
                      >
                        {c.title}
                      </DropdownMenuItem>
                    );
                  })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuItem
            icon={ArrowUpToLine}
            disabled={(column.locked ?? false) || cards[0]?.id === item.id}
            onSelect={() => {
              moveCard(item.id, column.id, 0);
            }}
          >
            Move to top
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={ArrowDownToLine}
            disabled={(column.locked ?? false) || cards.at(-1)?.id === item.id}
            onSelect={() => {
              moveCard(item.id, column.id, cards.length);
            }}
          >
            Move to bottom
          </DropdownMenuItem>
          {cardActions.length > 0 ? <DropdownMenuSeparator /> : null}
          {cardActions
            .filter((a) => a.hidden?.([item]) !== true)
            .map((a) => (
              <DropdownMenuItem
                key={a.id}
                {...(a.icon ? { icon: a.icon } : {})}
                destructive={a.destructive ?? false}
                disabled={a.disabled?.([item]) ?? false}
                onSelect={() => {
                  a.run([item]);
                }}
              >
                {a.label}
              </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  /** A card at rest in its column, or (`lifted`) the copy that follows the finger. */
  const card = (item: T, column: KanbanColumnDef, lifted = false): React.JSX.Element => {
    const name = cardTitle(item);
    const on = selected.includes(item.id);
    const pan = !lifted && draggable && !column.locked ? panFor(item.id, column.id) : undefined;
    const whole = handle === 'none' && pan !== undefined;
    const body = (
      <View
        className={cn(
          'gap-2.5 rounded-[14px] bg-surface p-3 shadow-sm',
          lifted && 'bg-surface-raised shadow-lg',
          column.locked && 'opacity-70',
        )}
      >
        <View className="flex-row items-start gap-2">
          {draggable && (handle === 'left' || (column.locked && handle !== 'right'))
            ? grip(item, column, pan)
            : null}
          <CssText
            // Without a grip, the title carries the moves for VoiceOver and TalkBack.
            {...(whole && !WEB
              ? {
                  accessibilityRole: 'adjustable' as const,
                  accessibilityHint: 'Long-press and drag, or use the actions, to move it',
                  accessibilityActions: MOVE_ACTIONS,
                  onAccessibilityAction: onMoveAction(item.id),
                }
              : {})}
            className="min-w-0 flex-1 text-[15px] leading-[1.35] font-semibold text-fg"
          >
            {name}
          </CssText>
          {draggable && handle === 'right' ? grip(item, column, pan) : null}
          {cardMenu ? menu(item, column) : null}
          {selectable ? (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel={`Select ${name}`}
              accessibilityState={{ checked: on }}
              aria-checked={on}
              hitSlop={10}
              onPress={() => {
                setSelected(on ? selected.filter((s) => s !== item.id) : [...selected, item.id]);
              }}
            >
              <CheckboxBox checked={on} />
            </Pressable>
          ) : null}
        </View>
        {renderCard
          ? renderCard(item, { columnId: column.id, dragging: lifted || active?.id === item.id })
          : null}
        {focusedId === item.id || picked?.id === item.id ? (
          <View
            aria-hidden
            className="absolute -inset-[3px] rounded-[17px] border-[3px] border-border-focus"
          />
        ) : null}
      </View>
    );
    return whole ? (
      <GestureDetector gesture={pan}>
        <NativeView collapsable={false}>{body}</NativeView>
      </GestureDetector>
    ) : (
      body
    );
  };

  const header = (column: KanbanColumnDef): React.JSX.Element => {
    const n = cardsOf(column.id).length;
    const over = column.limit !== undefined && n >= column.limit;
    const count =
      column.limit !== undefined
        ? `${String(n)} / ${String(column.limit)}`
        : String(column.count ?? n);
    return (
      <View className="flex-row items-center gap-2 px-1.5 pt-1 pb-1.5">
        <View className={cn('size-2 rounded-full', DOT[column.tone ?? 'neutral'])} />
        <CssText
          accessibilityRole="header"
          className="text-[14px] leading-none font-semibold text-fg"
        >
          {column.title}
        </CssText>
        <CssText
          accessibilityLabel={over ? `${count}, full` : `${count} cards`}
          className={cn(
            'text-[12px] leading-none font-semibold',
            over ? 'text-danger-fg' : 'text-fg-muted',
          )}
        >
          {count}
        </CssText>
        {column.locked ? <Icon icon={Lock} size={13} tone="subtle" label="Locked" /> : null}
        {column.description ? (
          <CssText numberOfLines={1} className="shrink text-[12px] leading-none text-fg-muted">
            {column.description}
          </CssText>
        ) : null}
        <View className="ml-auto flex-row">
          {onAddCard && !column.locked ? (
            <Button
              variant="ghost"
              size="xs"
              startIcon={<Icon icon={Plus} size={16} tone="subtle" />}
              accessibilityLabel={`Add a card to ${column.title}`}
              onPress={() => {
                onAddCard(column.id);
              }}
              className="-my-2"
            />
          ) : null}
          {columnActions.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger>
                <Button
                  variant="ghost"
                  size="xs"
                  startIcon={<Icon icon={Ellipsis} size={16} tone="subtle" />}
                  accessibilityLabel={`Actions for ${column.title}`}
                  className="-my-2"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent label={`Actions for ${column.title}`} className="w-[220px]">
                {columnActions
                  .filter((a) => a.hidden?.([column]) !== true)
                  .map((a) => (
                    <DropdownMenuItem
                      key={a.id}
                      {...(a.icon ? { icon: a.icon } : {})}
                      destructive={a.destructive ?? false}
                      disabled={a.disabled?.([column]) ?? false}
                      onSelect={() => {
                        a.run([column]);
                      }}
                    >
                      {a.label}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </View>
      </View>
    );
  };

  /**
   * A column's cards as the preview has them. The cards stay in the props'
   * order, so no view moves under a finger; the gap is a view of its own,
   * keyed by its slot so that moving it inserts one rather than moving any
   * card, and the held card collapses where it was.
   */
  const cardList = (
    def: KanbanColumnDef,
    onLayout?: (e: LayoutChangeEvent) => void,
  ): React.JSX.Element => {
    const real = cardsOf(def.id);
    const slot = active
      ? ((preview ?? items)[def.id] ?? []).findIndex((i) => i.id === active.id)
      : -1;
    const gap =
      slot >= 0 && active ? (
        <View
          key={`gap-${String(slot)}`}
          aria-hidden
          className="rounded-[14px] border-[1.5px] border-dashed border-accent bg-accent-subtle"
          style={{ height: measured.current.heights[active.id] ?? 0 }}
        />
      ) : null;
    const rows: ReactNode[] = [];
    let others = 0;
    for (const item of real) {
      const held = item.id === active?.id;
      if (!held && others === slot) rows.push(gap);
      if (!held) others += 1;
      rows.push(
        <Animated.View
          key={item.id}
          role="listitem"
          style={held ? COLLAPSED : undefined}
          {...(held
            ? {}
            : {
                ...(glide ? { layout: glide } : {}),
                onLayout: (e: LayoutChangeEvent) => {
                  measured.current.heights[item.id] = e.nativeEvent.layout.height;
                  publish();
                },
              })}
        >
          {card(item, def)}
        </Animated.View>,
      );
    }
    if (slot >= 0 && others === slot) rows.push(gap);
    return (
      <View
        role="list"
        aria-label={`${def.title}, ${String(real.length)} cards`}
        className="gap-2"
        {...(onLayout ? { onLayout } : {})}
      >
        {rows}
      </View>
    );
  };

  const column = (def: KanbanColumnDef, width: number | '100%'): React.JSX.Element => {
    const at = (e: LayoutChangeEvent): void => {
      place(def.id, { left: e.nativeEvent.layout.x, top: e.nativeEvent.layout.y });
    };
    return (
      <View
        key={def.id}
        style={{ width }}
        onLayout={(e: LayoutChangeEvent) => {
          place(def.id, { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width });
        }}
      >
        <View
          className="gap-2 rounded-[18px] bg-surface-sunken p-2.5"
          style={columnHeight ? { height: columnHeight } : undefined}
        >
          {header(def)}
          {columnHeight ? (
            <LaneScroll id={def.id} feed={feed} dragging={active !== null} onLayout={at}>
              {cardList(def)}
              {renderColumnFooter?.(def)}
            </LaneScroll>
          ) : (
            <>
              {cardList(def, at)}
              {renderColumnFooter?.(def)}
            </>
          )}
        </View>
      </View>
    );
  };

  const lifted = useAnimatedStyle(() => ({
    width: ow.value,
    transform: [{ translateX: ox.value }, { translateY: oy.value }, { scale: scale.value }],
  }));
  const liftedItem = active ? find(active.id) : undefined;
  const liftedColumn = active ? columns.find((c) => c.id === active.from) : undefined;

  /** The columns, and over them the card a finger holds. */
  const frame = (children: ReactNode): React.JSX.Element => (
    <View
      onLayout={(e: LayoutChangeEvent) => {
        measured.current.frameW = e.nativeEvent.layout.width;
        measured.current.frameH = e.nativeEvent.layout.height;
        publish();
      }}
    >
      {children}
      {liftedItem && liftedColumn ? (
        <Animated.View pointerEvents="none" aria-hidden style={[OVERLAY, lifted]}>
          {card(liftedItem, liftedColumn, true)}
        </Animated.View>
      ) : null}
    </View>
  );

  const first = columns[0];
  const chosen = Object.values(items)
    .flat()
    .filter((i) => selected.includes(i.id));

  return (
    <View role="group" aria-label={label} className={cn('gap-3', className)}>
      {bare ? (
        first ? (
          frame(
            cardList(first, (e: LayoutChangeEvent) => {
              const { x, y, width } = e.nativeEvent.layout;
              place(first.id, { x, w: width, left: 0, top: y });
            }),
          )
        ) : null
      ) : layout === 'single' ? (
        <>
          <SegmentedControl
            size="sm"
            fullWidth
            value={current}
            onValueChange={setCurrent}
            accessibilityLabel={`${label}: stage`}
          >
            {columns.map((c) => (
              <SegmentedControlItem key={c.id} value={c.id}>
                {`${c.title} ${String(c.count ?? cardsOf(c.id).length)}`}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
          {frame(columns.filter((c) => c.id === current).map((c) => column(c, '100%')))}
        </>
      ) : (
        frame(
          <Animated.ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            // Held still while a card is: the finger is the card's, and a snap
            // would pull the edge scrolling back to a column.
            scrollEnabled={active === null}
            {...(active === null ? { snapToInterval: columnWidth + 12 } : {})}
            decelerationRate="fast"
            onScroll={onBoardScroll}
            scrollEventThrottle={16}
            onContentSizeChange={(w: number) => {
              measured.current.contentW = w;
              publish();
            }}
            contentContainerStyle={{ gap: 12, alignItems: 'flex-start', paddingBottom: 6 }}
          >
            {columns.map((c) => column(c, columnWidth))}
            {after}
          </Animated.ScrollView>,
        )
      )}
      {selectable && chosen.length > 0 ? (
        <View className="flex-row items-center gap-1.5 self-center rounded-full bg-invert py-1.5 pr-1.5 pl-[18px] shadow-lg">
          <CssText
            role="status"
            className="text-[14px] leading-none font-semibold text-fg-on-invert"
          >
            {`${String(chosen.length)} selected`}
          </CssText>
          <View className="mx-2 h-5 w-px bg-fg-on-invert opacity-25" />
          {bulkActions
            .filter((a) => a.hidden?.(chosen) !== true)
            .map((a) => (
              <BulkAction
                key={a.id}
                disabled={a.disabled?.(chosen) ?? false}
                onPress={() => {
                  a.run(chosen);
                }}
              >
                {a.label}
              </BulkAction>
            ))}
        </View>
      ) : null}
      {region}
    </View>
  );
}

/**
 * A column's own scroll, for `columnHeight`: it scrolls itself when the held
 * card nears its top or bottom edge, on the UI thread, and tells the drag how
 * far it has scrolled.
 */
function LaneScroll({
  id,
  feed,
  dragging,
  onLayout,
  children,
}: {
  id: string;
  feed: DragFeed;
  dragging: boolean;
  onLayout: (e: LayoutChangeEvent) => void;
  children: ReactNode;
}): React.JSX.Element {
  const ref = useAnimatedRef<Animated.ScrollView>();
  const { phase, hover, oy, oh, colScroll } = feed;
  const top = useSharedValue(0);
  const height = useSharedValue(0);
  const content = useSharedValue(0);
  const y = useSharedValue(0);
  const record = (offset: number): void => {
    'worklet';
    y.value = offset;
    colScroll.modify((all) => {
      'worklet';
      all[id] = offset;
      return all;
    });
  };
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      record(e.contentOffset.y);
    },
  });
  const ticker = useFrameCallback(() => {
    const room = content.value - height.value;
    if (phase.value !== 1 || hover.value !== id || room <= 0) return;
    const cy = oy.value + oh.value / 2 - top.value;
    const edge = height.value * EDGE;
    const push =
      cy > height.value - edge
        ? (cy - height.value + edge) / edge
        : cy < edge
          ? (cy - edge) / edge
          : 0;
    const next = Math.max(
      0,
      Math.min(room, y.value + SCROLL_STEP * Math.max(-1, Math.min(1, push))),
    );
    if (next === y.value) return;
    record(next);
    scrollTo(ref, 0, next, false);
  }, false);
  useEffect(() => {
    ticker.setActive(dragging);
  }, [dragging, ticker]);
  return (
    <Animated.ScrollView
      ref={ref}
      showsVerticalScrollIndicator={false}
      scrollEnabled={!dragging}
      onScroll={onScroll}
      scrollEventThrottle={16}
      onLayout={(e: LayoutChangeEvent) => {
        top.value = e.nativeEvent.layout.y;
        height.value = e.nativeEvent.layout.height;
        onLayout(e);
      }}
      onContentSizeChange={(_w: number, h: number) => {
        content.value = h;
      }}
      contentContainerStyle={{ gap: GAP }}
    >
      {children}
    </Animated.ScrollView>
  );
}

/** A card's line under its title: the role, its tags, its people. */
export function KanbanCardMeta({
  description,
  children,
  people,
}: {
  description?: string;
  /** Tags: `Badge`s. */
  children?: ReactNode;
  /** An `AvatarGroup`, at the end. */
  people?: ReactNode;
}): React.JSX.Element {
  return (
    <View className="flex-row flex-wrap items-center gap-2">
      {description ? (
        <CssText className="text-[13px] leading-[1.3] text-fg-muted">{description}</CssText>
      ) : null}
      {children}
      {people ? <View className="ml-auto">{people}</View> : null}
    </View>
  );
}
