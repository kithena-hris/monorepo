'use client';

import {
  Fragment,
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  ChevronDown,
  ChevronRight,
  CornerUpLeft,
  Crosshair,
  Frame,
  ListTree,
  Lock,
  Maximize2,
  Minimize2,
  Undo2,
  UserRoundCog,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

import { cn } from '../../lib/cn';
import { closestFrom } from '../../lib/dom';
import { Avatar } from '../avatar/avatar';
import { Badge } from '../badge/badge';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '../breadcrumb/breadcrumb';
import { Button } from '../button/button';
import { ChartFrame } from '../chart/chart-window';
import { Combobox } from '../combobox/combobox';
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
import type { ChartTone } from '../chart/chart';

/**
 * Reporting lines, drawn.
 *
 * ### It takes the shape a query returns
 *
 * A flat list of nodes with a `parentId`, not a nested object. That is what
 * comes back from a table, from an API and from a CSV import, and turning it
 * into a tree is arithmetic the component can do once rather than something
 * every caller reimplements.
 *
 * ### Cycles are expected, not impossible
 *
 * Two people made each other's manager during a reorg is a data state every
 * HRIS reaches eventually. A renderer that recurses into it hangs the tab, so
 * the tree is built from the roots outward and anything unreachable is
 * excluded and *reported*, a silent drop would be a chart that quietly
 * understates the company.
 *
 * ### The tree is the semantics, the boxes are the drawing
 *
 * `role="tree"` with arrow-key navigation, because that is what a screen reader
 * and a keyboard already know. The arrow keys keep their tree meaning.
 * Left collapses or goes to the manager, Right expands or goes to the first
 * report, in both orientations, since someone navigating by keyboard is
 * moving through a hierarchy rather than across a picture.
 *
 * ### Every gesture has a menu behind it
 *
 * Focusing a branch, expanding it, and changing who someone reports to are all
 * on each person's own right-click menu as well as on the pointer. Dragging a
 * card onto a manager is an accelerator for people who can drag; it is never
 * the only way to do the thing, because a drag is unreachable by a keyboard, a
 * switch, or an unsteady hand.
 *
 * ### Nothing moves under the pointer
 *
 * Expanding a branch changes the width of every ancestor above it, which in a
 * centred tree moves the card you just clicked. Before each toggle the card's
 * position is recorded, and a layout effect puts it back by adjusting the
 * scroll, so the tree grows around the person you are looking at instead of
 * sliding them out from under you.
 *
 * ### Permission is an affordance here, not a control
 *
 * `viewerRole` decides whether the drag and the "Report to" menu exist. It
 * decides nothing else. The mutation is the caller's, and the server has to
 * make the same decision again on the write path, a permission enforced only
 * in a React component is not enforced at all.
 */

export type OrgStatusTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

export interface OrgNode {
  id: string;
  name: string;
  /** Job title. Second line of the card. */
  title?: string;
  /** Anything else worth one line: location, team, employment type. */
  meta?: string;
  /** The manager. Absent, or pointing at an id that is not present, makes a root. */
  parentId?: string;
  /** Colours the card's leading edge. */
  tone?: ChartTone;
  /** Profile picture. Falls back to initials, which is what most rows have. */
  avatarUrl?: string;
  /** A short state worth a badge: "On leave", "Notice period", "Open req". */
  status?: string;
  statusTone?: OrgStatusTone;
  /**
   * Blocks this person being dragged, and blocks anyone being dropped onto
   * them. For the rows a reorg is not allowed to touch.
   */
  locked?: boolean;
}

/**
 * Who is looking. Only an HR admin may change a reporting line.
 *
 * **This is an affordance, not a control.** It decides which buttons exist, and
 * nothing more. Anyone can call the mutation directly, so the server has to
 * make the same decision again on the write path, a permission enforced only
 * in a React component is not enforced.
 */
export type OrgViewerRole = 'viewer' | 'manager' | 'hr-admin';

/** What a focused person's view draws. */
export type OrgFocusMode = 'chain' | 'branch';

/** A reassignment the caller has to apply, the chart never mutates its input. */
export interface OrgMove {
  nodeId: string;
  fromParentId: string | undefined;
  toParentId: string;
}

/** The pointer events every card forwards, so a screen can hang its own UI off them. */
export interface OrgNodeEvents {
  onNodeMouseEnter?: (node: OrgNode, event: ReactMouseEvent<HTMLElement>) => void;
  onNodeMouseLeave?: (node: OrgNode, event: ReactMouseEvent<HTMLElement>) => void;
  onNodeMouseDown?: (node: OrgNode, event: ReactMouseEvent<HTMLElement>) => void;
  onNodeDoubleClick?: (node: OrgNode, event: ReactMouseEvent<HTMLElement>) => void;
  onNodeContextMenu?: (node: OrgNode, event: ReactMouseEvent<HTMLElement>) => void;
}

export interface OrgChartProps extends OrgNodeEvents {
  nodes: readonly OrgNode[];
  /** Names the tree, and the right-click menu. */
  label: string;
  /** `vertical` draws reports below their manager, `horizontal` to the side. */
  orientation?: 'vertical' | 'horizontal';

  /** Ids whose reports are hidden. Uncontrolled when omitted. */
  collapsed?: readonly string[];
  onCollapsedChange?: (collapsed: readonly string[]) => void;
  defaultCollapsed?: readonly string[];

  onSelect?: (node: OrgNode) => void;
  selectedId?: string;

  /**
   * Draw only this person and everyone under them. `null` is the whole org.
   * Uncontrolled when omitted.
   */
  focusId?: string | null;
  onFocusChange?: (id: string | null) => void;
  defaultFocusId?: string | null;
  /**
   * `chain` keeps the managers above the focused person on screen as a spine;
   * `branch` draws the focused person as the only root.
   */
  focusMode?: OrgFocusMode;
  /** Renders the person search, which focuses whoever is picked. */
  searchable?: boolean;

  /** Canvas scale. Uncontrolled when omitted. */
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  defaultZoom?: number;
  /** How far the canvas may be scaled. */
  zoomRange?: readonly [min: number, max: number];
  /**
   * Height of the canvas. A tree taller than this scrolls inside it rather
   * than pushing the rest of the page down the screen.
   */
  height?: number | string;

  /**
   * Who is looking. Drag-to-reassign and the "Report to" menu appear only for
   * `hr-admin`, and only when `reassignable` is also set. Presentation only.
   * See {@link OrgViewerRole}.
   */
  viewerRole?: OrgViewerRole;
  /** Turns on drag-to-reassign, and the "Report to" menu that goes with it. */
  reassignable?: boolean;
  /** Apply the move to your own data. Nothing happens without it. */
  onReassign?: (move: OrgMove) => void;
  /** Veto a move the data model would allow. Cycles are already rejected. */
  canReassign?: (node: OrgNode, newManager: OrgNode) => boolean;
  /** Fires with the person being dragged, then with `null` when it ends. */
  onDraggingChange?: (node: OrgNode | null) => void;

  /** Replaces the card body. The counts are handed over rather than recomputed. */
  renderNode?: (node: OrgNode, info: OrgNodeInfo) => ReactNode;
  /** Extra commands on one person's own menu. */
  nodeMenuItems?: (node: OrgNode) => ReactNode;
  /** Extra commands on the chart's background menu. */
  menuItems?: ReactNode;
  className?: string;
}

export interface OrgNodeInfo {
  /** Direct reports. */
  reports: number;
  /** Everyone below, at any depth. */
  total: number;
  depth: number;
}

interface TreeNode {
  node: OrgNode;
  children: TreeNode[];
  total: number;
}

interface VisibleRow {
  id: string;
  level: number;
  parentId: string | undefined;
  hasChildren: boolean;
  expanded: boolean;
}

const edgeTone: Record<ChartTone, string> = {
  accent: 'border-s-accent',
  success: 'border-s-success',
  warning: 'border-s-warning',
  danger: 'border-s-danger',
  info: 'border-s-info',
  neutral: 'border-s-border',
};

/**
 * Roots outward, with a visited set. Anything the walk never reaches is in a
 * cycle (or hanging off one) and is returned separately rather than drawn.
 */
function buildTree(nodes: readonly OrgNode[]): {
  roots: TreeNode[];
  unreachable: OrgNode[];
  byId: Map<string, TreeNode>;
  /** Every id above a given id, for cycle-proofing a drop and for breadcrumbs. */
  ancestors: Map<string, string[]>;
} {
  const present = new Map(nodes.map((node) => [node.id, node]));
  const childrenOf = new Map<string, OrgNode[]>();
  const rootNodes: OrgNode[] = [];

  for (const node of nodes) {
    const parent = node.parentId;
    if (parent === undefined || !present.has(parent) || parent === node.id) {
      rootNodes.push(node);
      continue;
    }
    const siblings = childrenOf.get(parent);
    if (siblings) siblings.push(node);
    else childrenOf.set(parent, [node]);
  }

  const seen = new Set<string>();
  const byId = new Map<string, TreeNode>();
  const ancestors = new Map<string, string[]>();

  const build = (node: OrgNode, chain: string[]): TreeNode => {
    seen.add(node.id);
    ancestors.set(node.id, chain);
    const nextChain = [...chain, node.id];
    const children = (childrenOf.get(node.id) ?? [])
      .filter((child) => !seen.has(child.id))
      .map((child) => build(child, nextChain));
    const tree = {
      node,
      children,
      total: children.reduce((sum, child) => sum + child.total + 1, 0),
    };
    byId.set(node.id, tree);
    return tree;
  };

  const roots = rootNodes.map((node) => build(node, []));
  return { roots, unreachable: nodes.filter((node) => !seen.has(node.id)), byId, ancestors };
}

/**
 * Rebuilds the path from the root down to the focused person, each manager
 * carrying only the one child that leads onward, with the focused person's own
 * subtree intact at the bottom.
 *
 * The counts are the *real* ones throughout, a manager on the spine still says
 * how many people they have, even though only one of them is drawn. A spine
 * that reported its own trimmed headcount would be a chart that lies quietly.
 */
function buildSpine(
  focused: TreeNode,
  chain: readonly string[],
  byId: ReadonlyMap<string, TreeNode>,
): TreeNode {
  let current = focused;
  for (const id of chain.toReversed()) {
    const ancestor = byId.get(id);
    if (!ancestor) break;
    current = { node: ancestor.node, children: [current], total: ancestor.total };
  }
  return current;
}

/** Depth-first, skipping the reports of anything collapsed. Navigation order. */
function flatten(roots: readonly TreeNode[], collapsed: ReadonlySet<string>): VisibleRow[] {
  const rows: VisibleRow[] = [];
  const walk = (tree: TreeNode, level: number, parentId: string | undefined): void => {
    const hasChildren = tree.children.length > 0;
    const expanded = hasChildren && !collapsed.has(tree.node.id);
    rows.push({ id: tree.node.id, level, parentId, hasChildren, expanded });
    if (expanded) for (const child of tree.children) walk(child, level + 1, tree.node.id);
  };
  for (const root of roots) walk(root, 1, undefined);
  return rows;
}

interface OrgContextValue {
  orientation: 'vertical' | 'horizontal';
  rows: VisibleRow[];
  rowIndex: Map<string, number>;
  /** Row by id. Using `rows.find` per card is a linear scan per card, O(n²) a render. */
  rowsById: ReadonlyMap<string, VisibleRow>;
  tabStop: string | null;
  selectedId: string | undefined;
  focusId: string | null;
  reassignable: boolean;
  /** True when the viewer could reassign but this chart is read-only to them. */
  readOnly: boolean;
  draggingId: string | null;
  /** Ids on the spine above the focused person: drawn, but not expandable. */
  spine: ReadonlySet<string>;
  /**
   * Ids that were not on screen a render ago. Only these animate in, a card
   * that was already there and merely moved must not flash, and re-parenting
   * during a reorg would otherwise re-pop an entire branch.
   */
  entering: ReadonlySet<string>;
  events: OrgNodeEvents;
  renderNode: OrgChartProps['renderNode'];
  nodeMenuItems: OrgChartProps['nodeMenuItems'];
  managerOptions: (node: OrgNode) => OrgNode[];
  isValidTarget: (targetId: string) => boolean;
  cards: Map<string, HTMLLIElement>;
  /** The card element itself. The `<li>` grows with its subtree; the card does not. */
  cardBoxes: Map<string, HTMLElement>;
  setActiveId: (id: string) => void;
  focusRow: (id: string | undefined) => void;
  toggle: (id: string) => void;
  expandSubtree: (id: string) => void;
  setFocus: (id: string | null) => void;
  select: ((node: OrgNode) => void) | undefined;
  reassign: (nodeId: string, toParentId: string) => void;
}

const OrgContext = createContext<OrgContextValue | null>(null);

function useOrg(): OrgContextValue {
  const value = useContext(OrgContext);
  if (!value) throw new Error('OrgChart parts must be rendered inside OrgChart.');
  return value;
}

export function OrgChart({
  nodes,
  label,
  orientation = 'vertical',
  collapsed,
  onCollapsedChange,
  defaultCollapsed,
  onSelect,
  selectedId,
  focusId,
  onFocusChange,
  defaultFocusId = null,
  focusMode = 'chain',
  searchable = false,
  zoom: controlledZoom,
  onZoomChange,
  defaultZoom = 1,
  zoomRange = [0.3, 1.6],
  height = 520,
  viewerRole = 'viewer',
  reassignable = false,
  onReassign,
  canReassign,
  onDraggingChange,
  renderNode,
  nodeMenuItems,
  menuItems,
  className,
  ...events
}: OrgChartProps): JSX.Element {
  const [uncontrolledCollapsed, setUncontrolledCollapsed] = useState<readonly string[]>(
    defaultCollapsed ?? [],
  );
  const [uncontrolledFocus, setUncontrolledFocus] = useState<string | null>(defaultFocusId);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const cards = useRef(new Map<string, HTMLLIElement>());
  const cardBoxes = useRef(new Map<string, HTMLElement>());
  const canvas = useRef<HTMLDivElement | null>(null);
  /** Everyone drawn on the previous render, to work out who is new. */
  const drawn = useRef<ReadonlySet<string>>(new Set());
  const [uncontrolledZoom, setUncontrolledZoom] = useState(defaultZoom);
  /** The authoritative scale during a gesture, ahead of React's copy of it. */
  const zoomRef = useRef(controlledZoom ?? defaultZoom);
  const readout = useRef<HTMLOutputElement | null>(null);
  const commitZoom = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [panning, setPanning] = useState(false);
  /** Which card the one shared context menu is currently about. */
  const [menuNodeId, setMenuNodeId] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  /**
   * The card whose on-screen position must survive the next layout, and where
   * it was. Expanding a branch changes the width of everything above it, so
   * without this the person you clicked slides out from under the pointer.
   */
  const anchor = useRef<{ id: string; left: number; top: number } | null>(null);
  /** The root the view has already been centred on, so it happens once. */
  const centredOn = useRef<string | null>(null);
  const instructionsId = useId();

  // Rebuilt only when the roster changes. It was running on every render.
  // Every hover, every zoom step, every frame of a drag.
  const { roots, unreachable, byId, ancestors, nodeIndex } = useMemo(() => {
    const built = buildTree(nodes);
    return { ...built, nodeIndex: new Map(nodes.map((node) => [node.id, node])) };
  }, [nodes]);
  const collapsedIds = new Set(collapsed ?? uncontrolledCollapsed);
  const activeFocus = focusId === undefined ? uncontrolledFocus : focusId;

  // Focusing replaces the roots. Everything below: navigation, counts, the
  // keyboard, then falls out of the same code, because a focused view *is*
  // just a smaller forest.
  //
  // `chain` keeps the managers above the focused person, each with only the one
  // child that leads down to them. Somebody four levels down is meaningless
  // without the line that got you there; `branch` is the mode for when the
  // person *is* the whole question.
  const focusedTree = activeFocus === null ? null : (byId.get(activeFocus) ?? null);
  const spine = new Set<string>(
    focusedTree && focusMode === 'chain' ? (ancestors.get(focusedTree.node.id) ?? []) : [],
  );
  const visibleRoots = focusedTree
    ? focusMode === 'chain'
      ? [buildSpine(focusedTree, ancestors.get(focusedTree.node.id) ?? [], byId)]
      : [focusedTree]
    : roots;
  const rows = flatten(visibleRoots, collapsedIds);
  const rowIndex = new Map(rows.map((row, index) => [row.id, index]));
  const rowsById = new Map(rows.map((row) => [row.id, row]));

  const tabStop = activeId !== null && rowIndex.has(activeId) ? activeId : (rows[0]?.id ?? null);

  const entering = new Set(rows.map((row) => row.id).filter((id) => !drawn.current.has(id)));

  const [minZoom, maxZoom] = zoomRange;
  const activeZoom = controlledZoom ?? uncontrolledZoom;
  // Mid-gesture the ref is ahead of state, and it is the one telling the truth.
  // Any unrelated re-render in that window must not snap the canvas back to the
  // last committed scale.
  if (commitZoom.current === null) zoomRef.current = activeZoom;
  const liveZoom = commitZoom.current === null ? activeZoom : zoomRef.current;
  const clampZoom = (value: number): number =>
    Math.round(Math.min(maxZoom, Math.max(minZoom, value)) * 100) / 100;

  const setZoom = (next: number): void => {
    const value = clampZoom(next);
    zoomRef.current = value;
    if (controlledZoom === undefined) setUncontrolledZoom(value);
    onZoomChange?.(value);
  };

  /**
   * Zoom about a point, so the card under the pointer stays under the pointer.
   *
   * Scaling about the top-left instead is the difference between a chart you
   * can explore and one you have to re-find your place in after every step.
   */
  /**
   * Step from wherever the canvas *is*, not from React's copy of it.
   *
   * Buttons repeat faster than a commit, and a wheel far faster, so every step
   * after the first was computing "100% + 10%" from a scale that had already
   * moved on, the zoom appeared to stick after one step.
   */
  const zoomStep = (delta: number, clientX?: number): void => {
    zoomAbout(zoomRef.current + delta, clientX);
  };

  const zoomAbout = (next: number, clientX?: number): void => {
    const box = scroller.current;
    const surface = canvas.current;
    const from = zoomRef.current;
    const value = clampZoom(next);
    if (value === from) return;

    if (!box || !surface) {
      setZoom(value);
      return;
    }

    const rect = box.getBoundingClientRect();
    // Default to the middle of the frame: that is where a keyboard or a button
    // press is "pointing".
    const offset = (clientX ?? rect.left + rect.width / 2) - rect.left;
    const contentX = (box.scrollLeft + offset) / from;

    // Applied to the DOM now, told to React later.
    //
    // A wheel fires 50-100 times a second and re-rendering this tree costs
    // 9-30ms, so a state update per tick is a main thread that never catches
    // up: the gesture feels stuck and everything after it is late. Writing the
    // scale and the scroll straight to the elements keeps the gesture at the
    // browser's own frame rate, and React hears about it once, when the
    // fingers stop.
    zoomRef.current = value;
    surface.style.zoom = String(value);
    box.scrollTo({ left: contentX * value - offset, behavior: 'instant' });
    if (readout.current) readout.current.textContent = `${String(Math.round(value * 100))}%`;

    if (commitZoom.current !== null) clearTimeout(commitZoom.current);
    commitZoom.current = setTimeout(() => {
      commitZoom.current = null;
      setZoom(zoomRef.current);
    }, 140);
  };

  const setCollapsed = (next: readonly string[]): void => {
    if (collapsed === undefined) setUncontrolledCollapsed(next);
    onCollapsedChange?.(next);
  };

  const setFocus = (id: string | null): void => {
    if (focusId === undefined) setUncontrolledFocus(id);
    onFocusChange?.(id);
  };

  /**
   * Remembers where a card is, so the layout that follows can put it back.
   *
   * The card, not its `<li>`: the `<li>` is as wide as the subtree inside it,
   * so expanding a branch moves the `<li>`'s left edge by half the width that
   * just appeared. Compensating for *that* would move the card by exactly the
   * amount this exists to prevent.
   */
  const anchorOn = (id: string): void => {
    const rect = cardBoxes.current.get(id)?.getBoundingClientRect();
    if (rect) anchor.current = { id, left: rect.left, top: rect.top };
  };

  const toggle = (id: string): void => {
    anchorOn(id);
    setCollapsed(
      collapsedIds.has(id)
        ? [...collapsedIds].filter((entry) => entry !== id)
        : [...collapsedIds, id],
    );
  };

  /** Everything below this person, opened. "Show me their whole chart." */
  const expandSubtree = (id: string): void => {
    anchorOn(id);
    const below = new Set<string>();
    const walk = (tree: TreeNode): void => {
      below.add(tree.node.id);
      for (const child of tree.children) walk(child);
    };
    const start = byId.get(id);
    if (start) walk(start);
    setCollapsed([...collapsedIds].filter((entry) => !below.has(entry)));
  };

  const focusRow = (id: string | undefined): void => {
    if (id === undefined) return;
    setActiveId(id);
    const card = cards.current.get(id);
    // `preventScroll` then a smooth scroll of our own: the browser's default
    // focus scroll is instantaneous and lands the card against the edge of the
    // viewport, which is exactly where you cannot see its connectors.
    card?.focus({ preventScroll: true });
    card?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  };

  // Put the anchored card back where it was, before the browser paints. A
  // `useEffect` here would show one frame of the jump, which is the flicker
  // this exists to remove.
  const rowKey = rows.map((row) => row.id).join('|');
  const collapsedKey = [...collapsedIds].toSorted().join('|');
  useLayoutEffect(() => {
    drawn.current = new Set(rows.map((row) => row.id));
  }, [rowKey]);

  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;

    const pending = anchor.current;
    anchor.current = null;
    if (pending) {
      const rect = cardBoxes.current.get(pending.id)?.getBoundingClientRect();
      if (rect) {
        // `instant`, not a plain assignment: the container scrolls smoothly by
        // default, and a correction that animates is the jump it exists to
        // hide, arriving a few hundred milliseconds late.
        box.scrollTo({
          left: box.scrollLeft + rect.left - pending.left,
          top: box.scrollTop + rect.top - pending.top,
          behavior: 'instant',
        });
      }
      return;
    }

    // Open centred on whoever is at the top of the view, and re-centre when
    // that changes. A chart wider than its frame otherwise opens hard against
    // its left edge, which is the one place the root never is.
    const rootId = visibleRoots[0]?.node.id ?? null;
    if (rootId === null || centredOn.current === rootId) return;
    centredOn.current = rootId;
    const card = cardBoxes.current.get(rootId);
    if (!card) return;
    const cardRect = card.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    box.scrollTo({
      left:
        box.scrollLeft + (cardRect.left + cardRect.width / 2) - (boxRect.left + boxRect.width / 2),
      behavior: 'instant',
    });
    // Only when the layout actually changed. Reading `getBoundingClientRect`
    // on every render forces a synchronous layout on every render, which is
    // most of what "unresponsive" is made of.
  }, [rowKey, activeZoom]);

  // React attaches `wheel` passively at the root, so `preventDefault` inside an
  // `onWheel` prop does nothing. Ctrl/⌘ + wheel is the gesture every canvas in
  // the industry uses for zoom, and the one a trackpad pinch sends, so it has
  // to be stopped from zooming the whole page instead.
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;

    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
      zoomAbout(zoomRef.current * factor, event.clientX);
    };

    box.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      box.removeEventListener('wheel', onWheel);
    };
    // Rebound only when the scale it reads changes, not on every render.
  }, [activeZoom, minZoom, maxZoom]);

  /**
   * Drag the background to pan, the way every diagram tool works. Middle-drag
   * pans from anywhere, including from on top of a card, because that is the
   * gesture people already have in their hands.
   */
  const startPan = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const box = scroller.current;
    if (!box) return;
    const onCard = closestFrom(event.target, '[role="treeitem"]') !== null;
    if (event.button === 1 ? false : event.button !== 0 || onCard) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const fromLeft = box.scrollLeft;
    const fromTop = box.scrollTop;
    box.setPointerCapture(event.pointerId);
    setPanning(true);

    const move = (moveEvent: PointerEvent): void => {
      box.scrollTo({
        left: fromLeft - (moveEvent.clientX - startX),
        top: fromTop - (moveEvent.clientY - startY),
        behavior: 'instant',
      });
    };
    const stop = (): void => {
      setPanning(false);
      box.removeEventListener('pointermove', move);
      box.removeEventListener('pointerup', stop);
      box.removeEventListener('pointercancel', stop);
    };
    box.addEventListener('pointermove', move);
    box.addEventListener('pointerup', stop);
    box.addEventListener('pointercancel', stop);
  };

  const onCanvasKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomStep(0.1);
    } else if (event.key === '-') {
      event.preventDefault();
      zoomStep(-0.1);
    } else if (event.key === '0') {
      event.preventDefault();
      setZoom(1);
    }
  };

  useEffect(
    () => () => {
      if (commitZoom.current !== null) clearTimeout(commitZoom.current);
    },
    [],
  );

  /** Scale so the whole tree fits the frame, within the allowed range. */
  const fitToFrame = (): void => {
    const box = scroller.current;
    const inner = canvas.current;
    if (!box || !inner) return;
    const natural = inner.getBoundingClientRect().width / zoomRef.current;
    if (natural === 0) return;
    setZoom(box.clientWidth / natural);
    centredOn.current = null;
  };

  /**
   * A move is legal when it changes something and cannot close a loop. The
   * descendant check is the one that matters: making someone report to their
   * own report is exactly how an org chart becomes a doughnut.
   */
  const isValidMove = (sourceId: string, targetId: string): boolean => {
    if (sourceId === targetId) return false;
    const source = nodeIndex.get(sourceId);
    const target = nodeIndex.get(targetId);
    if (!source || !target) return false;
    if (source.locked === true || target.locked === true) return false;
    if (source.parentId === targetId) return false;
    if ((ancestors.get(targetId) ?? []).includes(sourceId)) return false;
    return canReassign?.(source, target) ?? true;
  };

  const reassign = (nodeId: string, toParentId: string): void => {
    if (!isValidMove(nodeId, toParentId)) return;
    onReassign?.({ nodeId, fromParentId: nodeIndex.get(nodeId)?.parentId, toParentId });
  };

  const managerOptions = (node: OrgNode): OrgNode[] =>
    nodes.filter((candidate) => isValidMove(node.id, candidate.id));

  // Presentation only. The server has to decide this again on the write path.
  const canEdit = reassignable && viewerRole === 'hr-admin';
  /** Editing exists here, but not for this viewer. Worth saying, not hiding. */
  const readOnly = reassignable && !canEdit;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Without a threshold every click on a card starts a drag and selection
      // stops working. 8px is above a deliberate click's wobble and well below
      // an intentional drag.
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor),
  );

  const nodeById = (id: string | null): OrgNode | null =>
    id === null ? null : (nodeIndex.get(id) ?? null);

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nodeById(String(active.id))?.name ?? 'person'}.`,
    onDragOver: ({ active, over }) => {
      if (!over) return undefined;
      const source = nodeById(String(active.id));
      const target = nodeById(String(over.id));
      if (!source || !target) return undefined;
      return isValidMove(source.id, target.id)
        ? `${source.name} will report to ${target.name}.`
        : `${target.name} is not a valid manager for ${source.name}.`;
    },
    onDragEnd: ({ active, over }) => {
      const source = nodeById(String(active.id));
      if (!source) return undefined;
      if (!over) return `${source.name} was not moved.`;
      const target = nodeById(String(over.id));
      return target && isValidMove(source.id, target.id)
        ? `${source.name} now reports to ${target.name}.`
        : `${source.name} was not moved.`;
    },
    onDragCancel: ({ active }) =>
      `Move cancelled. ${nodeById(String(active.id))?.name ?? 'The person'} stayed where they were.`,
  };

  const keyHandler = useRef<(event: KeyboardEvent<HTMLLIElement>, row: VisibleRow) => void>(
    () => undefined,
  );
  // One stable function identity for the life of the chart, forwarding to the
  // current render's closure. Without it every branch's props change on every
  // render and `memo` below buys nothing.
  const onKeyDown = useCallback((event: KeyboardEvent<HTMLLIElement>, row: VisibleRow): void => {
    keyHandler.current(event, row);
  }, []);

  keyHandler.current = (event: KeyboardEvent<HTMLLIElement>, row: VisibleRow): void => {
    const index = rowIndex.get(row.id) ?? 0;
    const handled = (): void => {
      event.preventDefault();
      event.stopPropagation();
    };

    switch (event.key) {
      case 'ArrowDown':
        handled();
        focusRow(rows[index + 1]?.id);
        break;
      case 'ArrowUp':
        handled();
        focusRow(rows[index - 1]?.id);
        break;
      case 'ArrowRight':
        handled();
        if (row.hasChildren && !row.expanded) toggle(row.id);
        else if (row.expanded) focusRow(rows[index + 1]?.id);
        break;
      case 'ArrowLeft':
        handled();
        if (row.expanded) toggle(row.id);
        else focusRow(row.parentId);
        break;
      case 'Home':
        handled();
        focusRow(rows[0]?.id);
        break;
      case 'End':
        handled();
        focusRow(rows.at(-1)?.id);
        break;
      case 'Enter':
      case ' ':
        if (onSelect) {
          handled();
          const node = nodeIndex.get(row.id);
          if (node) onSelect(node);
        }
        break;
      default:
        break;
    }
  };

  // Memoised on what a card actually reads. Zoom and pan are deliberately not
  // in here: they change the frame, not the tree, and rebuilding this object
  // for them would re-render every card on every wheel tick.
  const context = useMemo<OrgContextValue>(
    () => ({
      orientation,
      rows,
      rowIndex,
      rowsById,
      tabStop,
      selectedId,
      focusId: activeFocus,
      reassignable: canEdit,
      readOnly,
      draggingId,
      spine,
      entering,
      events,
      renderNode,
      nodeMenuItems,
      managerOptions,
      isValidTarget: (targetId) => draggingId !== null && isValidMove(draggingId, targetId),
      cards: cards.current,
      cardBoxes: cardBoxes.current,
      setActiveId,
      focusRow,
      toggle,
      expandSubtree,
      setFocus,
      select: onSelect,
      reassign,
    }),
    [
      orientation,
      rowKey,
      tabStop,
      selectedId,
      activeFocus,
      canEdit,
      readOnly,
      draggingId,
      renderNode,
      collapsedKey,
      nodes,
    ],
  );

  const trail = (ancestors.get(activeFocus ?? '') ?? []).map((id) => byId.get(id)?.node);

  // Counted once, not once per row. `nodes.filter` inside a map over `nodes`
  // is O(n squared), which is invisible at 24 people and not at 4,000.
  const directReports = new Map<string, number>();
  for (const node of nodes) {
    if (node.parentId === undefined) continue;
    directReports.set(node.parentId, (directReports.get(node.parentId) ?? 0) + 1);
  }
  const draggingNode = nodeById(draggingId);

  const menuRow = menuNodeId === null ? undefined : rowsById.get(menuNodeId);
  const menuTree = menuNodeId === null ? undefined : byId.get(menuNodeId);
  const menuNode = menuTree?.node;

  const tree = (
    <div
      ref={scroller}
      // A canvas, not a block that grows without limit: a 400-person tree is
      // several screens tall, and a chart that pushes the rest of the page off
      // the bottom is a chart nobody scrolls back up from.
      //
      // `scroll-smooth` under `motion-safe` only, a smooth scroll is an
      // animation, and someone who asked for less motion asked for less of it.
      // A scroll container only a mouse can scroll is unreachable, and the
      // `+`, `-` and `0` handlers below fire on nothing until something inside
      // has focus. Both are fixed by making the canvas a focusable region,
      // which is also what lets a test ask for it by role.
      role="region"
      aria-label={`${label}, pan and zoom canvas`}
      tabIndex={0}
      className={cn(
        'relative overflow-auto overscroll-contain rounded-md border border-border bg-surface-sunken/30',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
        'motion-safe:scroll-smooth',
        panning ? 'cursor-grabbing' : 'cursor-grab',
      )}
      style={{ height }}
      onPointerDown={startPan}
      onKeyDown={onCanvasKeyDown}
      onContextMenu={(event) => {
        // One menu for the whole canvas, retargeted to whichever card the
        // press landed on. A `ContextMenu` per card meant 24 Radix roots on
        // this chart and 200-odd on a docs page, every one of them mounted
        // and subscribed, to serve the single menu that can be open at a time.
        const card = closestFrom(event.target, '[data-org-node]');
        setMenuNodeId(card?.getAttribute('data-org-node') ?? null);
        // The chart frame has a menu of its own on an ancestor; without this
        // both open, stacked.
        event.stopPropagation();
      }}
    >
      <div
        ref={canvas}
        // `zoom` rather than `transform: scale()`: it re-runs layout, so the
        // scroll range grows with the content instead of needing a shadow
        // element sized to match. Every measurement below stays in one
        // coordinate space.
        //
        // The padding is not decoration. Without it the last row of cards sits
        // under the horizontal scrollbar, and a card at the edge of the canvas
        // has no room for its focus ring.
        className="w-max min-w-full px-8 pt-3 pb-14"
        style={{ zoom: liveZoom }}
      >
        <ul
          role="tree"
          aria-label={label}
          aria-describedby={canEdit ? instructionsId : undefined}
          // `min-w-full` with `w-max` and `justify-center` is what keeps the root
          // in the middle: the tree centres itself while it is narrower than the
          // frame, and scrolls from its left edge once it is wider. `mx-auto`
          // alone would put the overflow out of reach on the left.
          className={cn(
            'flex w-max min-w-full',
            orientation === 'vertical'
              ? 'flex-row items-start justify-center gap-6'
              : 'flex-col items-start justify-center gap-4',
          )}
        >
          {visibleRoots.map((root, index) => (
            <OrgBranch
              key={root.node.id}
              tree={root}
              level={1}
              position={index + 1}
              size={visibleRoots.length}
              onKeyDown={onKeyDown}
            />
          ))}
        </ul>
      </div>
    </div>
  );

  const canvasWithMenu = (
    <ContextMenu>
      <ContextMenuTrigger asChild>{tree}</ContextMenuTrigger>
      <ContextMenuContent>
        {menuNode && menuRow ? (
          <>
            <ContextMenuLabel>{menuNode.name}</ContextMenuLabel>
            <ContextMenuSeparator />

            {/* On every card, including the leaves: "show me only this person
                and the line above them" is the question people ask most often
                about somebody with no reports at all. */}
            <ContextMenuItem
              disabled={activeFocus === menuNode.id}
              onSelect={() => {
                setFocus(menuNode.id);
              }}
            >
              <Crosshair aria-hidden />
              Show only this chain
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                setFocus(menuNode.id);
                expandSubtree(menuNode.id);
              }}
            >
              <ListTree aria-hidden />
              Show their whole chart
            </ContextMenuItem>
            {activeFocus === null ? null : (
              <ContextMenuItem
                onSelect={() => {
                  setFocus(null);
                }}
              >
                <Undo2 aria-hidden />
                Show whole org
              </ContextMenuItem>
            )}

            {menuRow.hasChildren ? (
              <ContextMenuItem
                onSelect={() => {
                  toggle(menuNode.id);
                }}
              >
                {menuRow.expanded ? <ChevronRight aria-hidden /> : <ChevronDown aria-hidden />}
                {menuRow.expanded ? 'Hide reports' : 'Show reports'}
              </ContextMenuItem>
            ) : null}

            {menuRow.parentId === undefined ? null : (
              <ContextMenuItem
                onSelect={() => {
                  focusRow(menuRow.parentId);
                }}
              >
                <CornerUpLeft aria-hidden />
                Go to manager
              </ContextMenuItem>
            )}

            {readOnly ? (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem disabled>
                  <Lock aria-hidden />
                  Reporting lines are read-only
                </ContextMenuItem>
              </>
            ) : null}

            {canEdit ? (
              // The keyboard path for the drag. Same operation, same validity
              // rules, reachable without a pointer, and computed only now
              // that a menu is actually open, rather than for every card on
              // every render.
              <>
                <ContextMenuSeparator />
                <ContextMenuSub>
                  <ContextMenuSubTrigger disabled={menuNode.locked === true}>
                    <UserRoundCog aria-hidden />
                    Report to
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="max-h-72 overflow-y-auto">
                    {managerOptions(menuNode).map((manager) => (
                      <ContextMenuItem
                        key={manager.id}
                        onSelect={() => {
                          reassign(menuNode.id, manager.id);
                        }}
                      >
                        {manager.name}
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>
              </>
            ) : null}

            {nodeMenuItems ? (
              <>
                <ContextMenuSeparator />
                {nodeMenuItems(menuNode)}
              </>
            ) : null}
          </>
        ) : (
          <>
            <ContextMenuLabel>{label}</ContextMenuLabel>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={collapsedIds.size === 0}
              onSelect={() => {
                setCollapsed([]);
              }}
            >
              <Maximize2 aria-hidden />
              Expand all
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                setCollapsed(nodes.map((entry) => entry.id));
              }}
            >
              <Minimize2 aria-hidden />
              Collapse all
            </ContextMenuItem>
            <ContextMenuItem
              disabled={liveZoom === 1}
              onSelect={() => {
                setZoom(1);
              }}
            >
              <Frame aria-hidden />
              Reset zoom
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );

  return (
    <OrgContext.Provider value={context}>
      <ChartFrame
        label={label}
        // The CSV of an org chart is its headcount by manager, which is the
        // number people are usually right-clicking to get at.
        rows={nodes.map((node) => ({
          label: node.name,
          value: directReports.get(node.id) ?? 0,
        }))}
        {...(menuItems ? { menuItems } : {})}
        className={cn('w-full', className)}
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {searchable ? (
            <Combobox
              size="sm"
              className="w-64"
              label="Find someone"
              placeholder="Search people"
              searchPlaceholder="Name or title"
              emptyMessage="Nobody by that name."
              clearable
              value={activeFocus}
              onChange={(value) => {
                setFocus(typeof value === 'string' ? value : null);
              }}
              options={nodes.map((node) => ({
                value: node.id,
                label: node.name,
                ...(node.title === undefined ? {} : { description: node.title }),
              }))}
            />
          ) : null}

          <Button
            size="sm"
            variant="ghost"
            startIcon={<Maximize2 />}
            disabled={collapsedIds.size === 0}
            onClick={() => {
              setCollapsed([]);
            }}
          >
            Expand all
          </Button>
          <Button
            size="sm"
            variant="ghost"
            startIcon={<Minimize2 />}
            disabled={rows.every((row) => !row.hasChildren)}
            onClick={() => {
              setCollapsed(nodes.map((node) => node.id));
            }}
          >
            Collapse all
          </Button>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              aria-label="Zoom out"
              disabled={liveZoom <= minZoom}
              startIcon={<ZoomOut />}
              onClick={() => {
                zoomStep(-0.1);
              }}
            />
            {/* The level in words as well as in the buttons' state. A canvas
                that can be zoomed but never says how far is one people reset
                out of superstition. */}
            <output
              ref={readout}
              aria-live="polite"
              className="w-11 text-center text-xs tabular-nums text-fg-muted"
            >
              {Math.round(activeZoom * 100)}%
            </output>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Zoom in"
              disabled={liveZoom >= maxZoom}
              startIcon={<ZoomIn />}
              onClick={() => {
                zoomStep(0.1);
              }}
            />
            <Button size="sm" variant="ghost" startIcon={<Frame />} onClick={fitToFrame}>
              Fit
            </Button>
          </div>

          <p aria-live="polite" className="ms-1 text-xs text-fg-muted">
            {rows.length} of {nodes.length} shown
          </p>
        </div>

        {activeFocus !== null && focusedTree ? (
          // The way back out. A focused branch with no visible path to the top
          // is a chart people get lost in and reload to escape.
          <Breadcrumb aria-label="Focused branch" className="mb-2">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <button
                    type="button"
                    onClick={() => {
                      setFocus(null);
                    }}
                  >
                    Whole org
                  </button>
                </BreadcrumbLink>
              </BreadcrumbItem>
              {trail.map((ancestor) =>
                ancestor ? (
                  // A separator is itself an `<li>`, so it is a sibling of the
                  // steps rather than a child of one. Nesting it produced an
                  // `<li>` inside an `<li>`, which is invalid and which React
                  // warns will break hydration.
                  <Fragment key={ancestor.id}>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbLink asChild>
                        <button
                          type="button"
                          onClick={() => {
                            setFocus(ancestor.id);
                          }}
                        >
                          {ancestor.name}
                        </button>
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                  </Fragment>
                ) : null,
              )}
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{focusedTree.node.name}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        ) : null}

        {unreachable.length > 0 ? (
          // Said out loud. A tree that silently omits people is a tree that
          // understates the company, and the fix is a data fix.
          <p
            role="status"
            className="mb-2 rounded-md border border-warning bg-warning-subtle px-3 py-2 text-xs text-fg"
          >
            {unreachable.length} not shown: {unreachable.map((node) => node.name).join(', ')} report
            into a circular management chain.
          </p>
        ) : null}

        {canEdit ? (
          <p id={instructionsId} className="sr-only">
            Drag a person onto a manager to change who they report to. Without a pointer, open a
            person&apos;s context menu and use &ldquo;Report to&rdquo;.
          </p>
        ) : null}

        {canEdit ? (
          <DndContext
            sensors={sensors}
            // Pointer-within rather than closest-centre: the targets are cards
            // of different sizes, and "the card I am over" is what a person
            // dropping onto a manager means.
            collisionDetection={pointerWithin}
            accessibility={{ announcements }}
            onDragStart={({ active }: DragStartEvent) => {
              const id = String(active.id);
              setDraggingId(id);
              onDraggingChange?.(nodeById(id));
            }}
            onDragCancel={() => {
              setDraggingId(null);
              onDraggingChange?.(null);
            }}
            onDragEnd={({ active, over }: DragEndEvent) => {
              setDraggingId(null);
              onDraggingChange?.(null);
              if (over) reassign(String(active.id), String(over.id));
            }}
          >
            {canvasWithMenu}
            <DragOverlay dropAnimation={null}>
              {draggingNode ? (
                <div className="pointer-events-none w-52 rounded-md border border-accent bg-surface px-3 py-2 shadow-md">
                  <OrgCardBody node={draggingNode} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : (
          canvasWithMenu
        )}

        <table className="sr-only">
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Title</th>
              <th scope="col">Reports to</th>
              <th scope="col">Direct reports</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((node) => (
              <tr key={node.id}>
                <th scope="row">{node.name}</th>
                <td>{node.title ?? '—'}</td>
                <td>{nodeIndex.get(node.parentId ?? '')?.name ?? '—'}</td>
                <td>{directReports.get(node.id) ?? 0}</td>
                <td>{node.status ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ChartFrame>
    </OrgContext.Provider>
  );
}

/**
 * The card contents. Shared with the drag overlay so the two cannot drift.
 *
 * No headcount here: the disclosure badge under the card already carries it,
 * and a number printed twice is a number someone will eventually read as two
 * different facts.
 */
function OrgCardBody({ node }: { node: OrgNode }): JSX.Element {
  return (
    <div className="flex items-start gap-2.5">
      <Avatar
        size="sm"
        name={node.name}
        {...(node.avatarUrl === undefined ? {} : { src: node.avatarUrl })}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{node.name}</p>
        {node.title === undefined ? null : (
          <p className="truncate text-xs text-fg-muted">{node.title}</p>
        )}
        {node.meta === undefined ? null : (
          <p className="truncate text-2xs text-fg-subtle">{node.meta}</p>
        )}
        {node.status === undefined ? null : (
          <Badge size="sm" tone={node.statusTone ?? 'neutral'} className="mt-1">
            {node.status}
          </Badge>
        )}
      </div>
    </div>
  );
}

/**
 * One person and everything under them.
 *
 * Memoised, and the context value it reads is memoised too, so zooming or
 * panning re-renders the frame around the tree and nothing inside it. Before
 * that, one zoom step re-rendered all 24 cards, which at 9-30ms a step and a
 * wheel firing 50-100 times a second is a main thread that never comes back.
 */
const OrgBranch = memo(function OrgBranch({
  tree,
  level,
  position,
  size,
  onKeyDown,
}: {
  tree: TreeNode;
  level: number;
  position: number;
  size: number;
  onKeyDown: (event: KeyboardEvent<HTMLLIElement>, row: VisibleRow) => void;
}): JSX.Element | null {
  const org = useOrg();
  const { node } = tree;
  const row = org.rowsById.get(node.id);

  const draggable = useDraggable({
    id: node.id,
    disabled: !org.reassignable || node.locked === true,
  });
  const droppable = useDroppable({ id: node.id, disabled: !org.reassignable });

  if (!row) return null;

  const first = position === 1;
  const last = position === size;
  const only = size === 1;
  const selected = org.selectedId === node.id;
  const dragging = org.draggingId === node.id;
  const targeted = droppable.isOver && org.draggingId !== null && org.draggingId !== node.id;
  // A manager drawn only because the focused person reports through them.
  const onSpine = org.spine.has(node.id);
  const valid = org.isValidTarget(node.id);
  const info: OrgNodeInfo = { reports: tree.children.length, total: tree.total, depth: level };

  const description = [
    node.name,
    node.title,
    node.status,
    onSpine ? 'in the reporting chain above' : undefined,
    tree.children.length === 0
      ? 'no direct reports'
      : `${String(tree.children.length)} direct reports, ${String(tree.total)} in total`,
  ]
    .filter(Boolean)
    .join(', ');

  const card = (
    <div
      data-org-node={node.id}
      // Drag *and* drop hang off the card rather than the `<li>`: a treeitem
      // contains its own subtree, so a pointer press on a report would bubble
      // into their manager's activator and lift the wrong person.
      ref={(element) => {
        droppable.setNodeRef(element);
        draggable.setNodeRef(element);
        if (element) org.cardBoxes.set(node.id, element);
        else org.cardBoxes.delete(node.id);
      }}
      {...draggable.listeners}
      className={cn(
        'relative w-52 rounded-md border border-border border-s-3 bg-surface px-3 py-2 text-start',
        'transition-[box-shadow,background-color,opacity] duration-(--animate-duration-fast)',
        // Only on arrival. A card that was already on screen and merely moved
        // must not replay its entrance. That is what a re-parented branch
        // flashing looks like.
        org.entering.has(node.id) && 'motion-safe:animate-pop-in',
        edgeTone[node.tone ?? 'accent'],
        // Context, not content: the chain above a focused person is there to
        // say how you got here, and it should not compete with the branch you
        // came to look at.
        onSpine && 'bg-surface-sunken/60 border-dashed',
        org.select && 'group-hover/node:bg-surface-hover',
        selected && 'bg-accent-subtle ring-2 ring-border-focus',
        org.reassignable && node.locked !== true && 'cursor-grab touch-none',
        dragging && 'opacity-40',
        // Only the valid targets light up. A drop zone that accepts a move it
        // will then refuse is worse than no highlight at all.
        targeted && valid && 'ring-2 ring-success bg-success-subtle',
        targeted && !valid && 'ring-2 ring-danger',
      )}
      // A short stagger down the tree. Every card appearing on the same frame
      // reads as a flash; 25ms apart reads as the branch unfolding.
      style={
        org.entering.has(node.id)
          ? { animationDelay: `min(calc(${String(level + position)} * 25ms), 200ms)` }
          : undefined
      }
    >
      {org.renderNode ? org.renderNode(node, info) : <OrgCardBody node={node} />}

      {row.hasChildren && !onSpine ? (
        // Not a nested `<button>`: a control inside a treeitem competes with it
        // for focus and for the Enter key. The keyboard path is Left and Right,
        // which is the tree pattern people already have; this is the pointer
        // shortcut for the same thing.
        <span
          aria-hidden
          role="presentation"
          title={row.expanded ? 'Hide reports' : 'Show reports'}
          onPointerDown={(event) => {
            // Stops the card's own drag sensor claiming the gesture.
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            org.toggle(node.id);
          }}
          className={cn(
            // `z-20`: the children's `<ul>` comes after this in the DOM, so at equal
            // stacking it paints over the part of the hit area that reaches down
            // into the gap, which is most of the area just added.
            'absolute -bottom-3 start-1/2 z-20 flex -translate-x-1/2 cursor-pointer items-center gap-1',
            'rounded-full border border-border bg-surface px-2 py-0.5 text-2xs font-medium text-fg-muted',
            'transition-colors duration-(--animate-duration-fast) hover:bg-surface-hover hover:text-fg',
            // The chip is 38x19 at its natural size, which is a target people
            // miss, and missing it reads as "only the arrow is clickable"
            // rather than "I missed". An invisible `::after` grows the hit area
            // to roughly 60x40, and to the 44px floor on a coarse pointer,
            // without the chip itself growing into the card above it.
            //
            // It grows mostly *downward*, into the gap before the children:
            // expanding upward would take clicks away from the bottom of the
            // card, which is where the drag and the selection live.
            'after:absolute after:-inset-x-3 after:-top-1.5 after:-bottom-4 after:content-[""]',
            'touch:after:-inset-x-4 touch:after:-top-2 touch:after:-bottom-6',
          )}
        >
          {row.expanded ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
          {tree.total}
        </span>
      ) : null}
    </div>
  );

  const item = (
    <li
      ref={(element) => {
        if (element) org.cards.set(node.id, element);
        else org.cards.delete(node.id);
      }}
      role="treeitem"
      // Named explicitly: a treeitem's name is otherwise computed from its
      // contents, and its contents are the whole subtree below it.
      aria-label={description}
      aria-level={level}
      aria-posinset={position}
      aria-setsize={size}
      {...(row.hasChildren ? { 'aria-expanded': row.expanded } : {})}
      {...(org.select ? { 'aria-selected': selected } : {})}
      tabIndex={org.tabStop === node.id ? 0 : -1}
      onKeyDown={(event) => {
        onKeyDown(event, row);
      }}
      onFocus={() => {
        org.setActiveId(node.id);
      }}
      onClick={
        org.select
          ? (event) => {
              event.stopPropagation();
              org.select?.(node);
            }
          : undefined
      }
      onMouseEnter={(event) => org.events.onNodeMouseEnter?.(node, event)}
      onMouseLeave={(event) => org.events.onNodeMouseLeave?.(node, event)}
      onMouseDown={(event) => org.events.onNodeMouseDown?.(node, event)}
      onContextMenu={(event) => org.events.onNodeContextMenu?.(node, event)}
      onDoubleClick={(event) => {
        // "Show me their whole chart": focus this person and open everything
        // beneath them. One gesture, and the menu items behind it are still
        // there for anyone who cannot double-click reliably.
        org.setFocus(node.id);
        org.expandSubtree(node.id);
        org.events.onNodeDoubleClick?.(node, event);
      }}
      className={cn(
        'group/node relative flex outline-none',
        'focus-visible:[&>*]:outline-2 focus-visible:[&>*]:outline-offset-2 focus-visible:[&>*]:outline-border-focus',
        org.select && 'cursor-pointer',
        org.orientation === 'vertical'
          ? // Symmetric padding on every child, including the outer two. Trimming
            // the outside edges would make each `<li>` asymmetric, and a card
            // centred in an asymmetric box drifts a few pixels off its own
            // connector, which compounds, one level at a time, down the tree.
            'flex-col items-center px-2 pt-4'
          : 'flex-row items-center py-2 ps-4',
      )}
    >
      {/* Connectors. Each child draws its own half of the line that joins it to
          its siblings: first child from the middle outward, last child from
          the outside to the middle, which is what makes the join land in the
          right place without measuring anything. */}
      {level > 1 && !only ? (
        <span
          aria-hidden
          className={cn(
            'absolute bg-border',
            org.orientation === 'vertical'
              ? cn('top-0 h-px', first ? 'start-1/2 end-0' : last ? 'start-0 end-1/2' : 'inset-x-0')
              : cn(
                  'start-0 w-px',
                  first ? 'top-1/2 bottom-0' : last ? 'top-0 bottom-1/2' : 'inset-y-0',
                ),
          )}
        />
      ) : null}
      {level > 1 ? (
        <span
          aria-hidden
          className={cn(
            'absolute bg-border',
            org.orientation === 'vertical'
              ? 'top-0 h-4 w-px start-1/2'
              : 'start-0 h-px w-4 top-1/2',
          )}
        />
      ) : null}

      {card}

      {row.expanded ? (
        <ul
          role="group"
          // Shrink-to-fit tracks, so a manager is centred over the box its
          // subtree occupies.
          //
          // Equal-width tracks would instead centre it over the midpoint of its
          // first and last child: geometrically tidier, and it multiplies up
          // the tree: every sibling column becomes as wide as the widest
          // sibling *subtree*, which took this 24-person chart from 3,300px to
          // 8,500px and forced the whole thing down to 40% zoom before anything
          // fitted. A card offset by a fraction of its own width is a much
          // cheaper problem than a chart nobody can read.
          className={cn(
            'relative flex',
            org.orientation === 'vertical'
              ? 'flex-row items-start justify-center pt-4'
              : 'flex-col items-start justify-center ps-4',
          )}
        >
          {/* The manager's own stub, reaching down (or across) to the line the
              children draw. */}
          <span
            aria-hidden
            className={cn(
              'absolute bg-border',
              org.orientation === 'vertical'
                ? 'top-0 h-4 w-px start-1/2'
                : 'start-0 h-px w-4 top-1/2',
            )}
          />
          {tree.children.map((child, index) => (
            <OrgBranch
              key={child.node.id}
              tree={child}
              level={level + 1}
              position={index + 1}
              size={tree.children.length}
              onKeyDown={onKeyDown}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );

  return item;
});
