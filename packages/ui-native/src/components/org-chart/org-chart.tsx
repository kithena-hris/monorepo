import { ChevronDown, ChevronRight, UserPlus } from 'lucide-react-native';
import { useRef, useState, type ReactNode } from 'react';
import { Platform, type LayoutChangeEvent } from 'react-native';
import { Pressable, Text as CssText, View } from 'react-native-css/components';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { cn } from '../../lib/cn.ts';
import { Avatar } from '../avatar/avatar.tsx';
import { Badge, type BadgeProps } from '../badge/badge.tsx';
import { Icon } from '../icon/icon.tsx';

const WEB = Platform.OS === 'web';

export type OrgStatusTone = NonNullable<BadgeProps['tone']>;

export interface OrgNode {
  id: string;
  name: string;
  /** Job title: the second line. */
  title?: string;
  /** The manager. Absent, or an id not present, makes a root. */
  parentId?: string;
  avatarUrl?: string;
  /** A short state worth a badge: "On leave", "Wide span". */
  status?: string;
  statusTone?: OrgStatusTone;
  /** An open role rather than a person: drawn as one, and said as one. */
  vacant?: boolean;
  /**
   * How many people sit under this one when the branch is not loaded:
   * a department collapsed on a big org.
   */
  reportCount?: number;
  /** Blocks this person being moved, and anyone being moved under them. */
  locked?: boolean;
}

export type OrgViewerRole = 'viewer' | 'manager' | 'hr-admin';

/** A reassignment the caller applies; the chart never changes its input. */
export interface OrgMove {
  nodeId: string;
  fromParentId: string | undefined;
  toParentId: string;
}

export interface OrgNodeInfo {
  /** Direct reports. */
  reports: number;
  /** Everyone below, at any depth. */
  total: number;
  depth: number;
}

export interface OrgChartProps {
  nodes: readonly OrgNode[];
  /** Names the tree for a screen reader. */
  label: string;
  /** Ids whose reports are hidden. Uncontrolled when omitted. */
  collapsed?: readonly string[];
  defaultCollapsed?: readonly string[];
  onCollapsedChange?: (collapsed: readonly string[]) => void;
  /** A tap on a person: open their profile, or drive a panel beside the tree. */
  onSelect?: (node: OrgNode) => void;
  selectedId?: string;
  /**
   * A search for a person: whoever matches is marked, their managers up to the
   * top stay lit as the chain, and everyone else dims.
   */
  query?: string;
  /** People drawn as part of a problem: a loop someone tried to create. */
  flaggedIds?: readonly string[];
  /** Who is looking. Moving people appears only for `hr-admin` with `reassignable`. */
  viewerRole?: OrgViewerRole;
  /**
   * Long-press a person and drag them onto their new manager. A loop is refused
   * here; the write path refuses it again, because this is presentation.
   */
  reassignable?: boolean;
  onReassign?: (move: OrgMove) => void;
  /** The screen-reader path to the same thing: the screen offers a picker. */
  onRequestReassign?: (node: OrgNode) => void;
  /** Replaces a row's two lines of text. The counts are handed over. */
  renderNode?: (node: OrgNode, info: OrgNodeInfo) => ReactNode;
  className?: string | undefined;
}

interface TreeNode {
  node: OrgNode;
  children: TreeNode[];
  total: number;
}

function build(nodes: readonly OrgNode[]): TreeNode[] {
  const ids = new Set(nodes.map((n) => n.id));
  const byParent = new Map<string | undefined, OrgNode[]>();
  for (const node of nodes) {
    const parent =
      node.parentId !== undefined && ids.has(node.parentId) ? node.parentId : undefined;
    byParent.set(parent, [...(byParent.get(parent) ?? []), node]);
  }
  const seen = new Set<string>();
  const grow = (node: OrgNode): TreeNode => {
    seen.add(node.id);
    const children = (byParent.get(node.id) ?? []).filter((c) => !seen.has(c.id)).map(grow);
    const total = children.reduce((sum, c) => sum + 1 + c.total, 0) || (node.reportCount ?? 0);
    return { node, children, total };
  };
  return (byParent.get(undefined) ?? []).map(grow);
}

/** Whether `candidate` is `node` or anywhere under it: a move there makes a loop. */
function isUnder(nodes: readonly OrgNode[], candidate: string, node: string): boolean {
  const parent = new Map(nodes.map((n) => [n.id, n.parentId]));
  let at: string | undefined = candidate;
  for (let guard = 0; at !== undefined && guard < nodes.length + 1; guard += 1) {
    if (at === node) return true;
    at = parent.get(at);
  }
  return false;
}

/**
 * Who reports to whom, as a phone shows it: a tree you expand and collapse,
 * each person a row. A tap opens them; a search marks the match and keeps the
 * chain of managers lit; an HR admin long-presses a person and drops them on
 * a new manager. Opening a branch keeps the row you tapped where it was: the
 * rows under it grow downwards, nothing above it moves.
 */
export function OrgChart({
  nodes,
  label,
  collapsed: controlledCollapsed,
  defaultCollapsed = [],
  onCollapsedChange,
  onSelect,
  selectedId,
  query,
  flaggedIds = [],
  viewerRole = 'viewer',
  reassignable = false,
  onReassign,
  onRequestReassign,
  renderNode,
  className,
}: OrgChartProps): React.JSX.Element {
  const [ownCollapsed, setOwnCollapsed] = useState<readonly string[]>(defaultCollapsed);
  const collapsed = controlledCollapsed ?? ownCollapsed;
  const toggle = (id: string): void => {
    const next = collapsed.includes(id) ? collapsed.filter((c) => c !== id) : [...collapsed, id];
    if (controlledCollapsed === undefined) setOwnCollapsed(next);
    onCollapsedChange?.(next);
  };
  const reassign = reassignable && viewerRole === 'hr-admin' ? onReassign : undefined;
  const canMove = reassign !== undefined;
  const [drag, setDrag] = useState<{ id: string; over: string | undefined } | null>(null);
  const rows = useRef(new Map<string, { y: number; height: number }>());

  const needle = query?.trim().toLowerCase() ?? '';
  const matches = new Set(
    needle
      ? nodes
          .filter((n) => `${n.name} ${n.title ?? ''}`.toLowerCase().includes(needle))
          .map((n) => n.id)
      : [],
  );
  const parentOf = new Map(nodes.map((n) => [n.id, n.parentId]));
  const chain = new Set<string>();
  for (const id of matches) {
    let at: string | undefined = id;
    while (at !== undefined && !chain.has(at)) {
      chain.add(at);
      at = parentOf.get(at);
    }
  }

  const rowAt = (y: number): string | undefined => {
    for (const [id, box] of rows.current) if (y >= box.y && y < box.y + box.height) return id;
    return undefined;
  };
  const valid = (id: string, target: string | undefined): target is string =>
    target !== undefined &&
    target !== parentOf.get(id) &&
    !isUnder(nodes, target, id) &&
    !(nodes.find((n) => n.id === target)?.locked ?? false) &&
    !(nodes.find((n) => n.id === target)?.vacant ?? false);

  const items: ReactNode[] = [];
  const walk = (tree: TreeNode, depth: number): void => {
    const { node, children } = tree;
    const open = !collapsed.includes(node.id);
    const reports = children.length || (node.reportCount ?? 0);
    const info: OrgNodeInfo = { reports: children.length, total: tree.total, depth };
    const selected = selectedId === node.id;
    const matched = matches.has(node.id) || flaggedIds.includes(node.id);
    const dim = needle !== '' && !chain.has(node.id);
    const dragging = drag?.id === node.id;
    const target = drag !== null && drag.over === node.id && valid(drag.id, node.id);
    const name = node.vacant ? 'Open role' : node.name;
    const title = node.title ?? '';
    const said = `${name}${title ? `, ${title}` : ''}${
      reports > 0 ? `, ${String(reports)} report${reports > 1 ? 's' : ''}` : ''
    }${node.status ? `, ${node.status}` : ''}${matched ? ', match' : ''}`;
    const movable = canMove && !node.locked && !node.vacant && depth > 0;

    const row = (
      <Pressable
        accessibilityLabel={said}
        {...(WEB
          ? {
              role: 'treeitem' as const,
              'aria-level': depth + 1,
              ...(selected ? { 'aria-selected': true } : {}),
              ...(children.length > 0 ? { 'aria-expanded': open } : {}),
            }
          : {
              accessibilityRole: 'button' as const,
              accessibilityState: {
                selected,
                ...(children.length > 0 ? { expanded: open } : {}),
              },
            })}
        accessibilityActions={[
          ...(children.length > 0
            ? [{ name: open ? 'collapse' : 'expand', label: open ? 'Collapse' : 'Expand' }]
            : []),
          ...(movable && onRequestReassign ? [{ name: 'reassign', label: 'Report to…' }] : []),
        ]}
        onAccessibilityAction={(event) => {
          const action = event.nativeEvent.actionName;
          if (action === 'expand' || action === 'collapse') toggle(node.id);
          if (action === 'reassign') onRequestReassign?.(node);
        }}
        onPress={() => {
          if (onSelect) onSelect(node);
          else if (children.length > 0) toggle(node.id);
        }}
        onLayout={(e: LayoutChangeEvent) => {
          rows.current.set(node.id, {
            y: e.nativeEvent.layout.y,
            height: e.nativeEvent.layout.height,
          });
        }}
        className={cn(
          'min-h-[60px] flex-row items-center gap-2.5 border-b border-border py-2 pr-3.5',
          selected
            ? 'bg-accent-subtle'
            : matched
              ? 'bg-warning-subtle'
              : target
                ? 'bg-accent-subtle'
                : 'bg-transparent',
          target && 'border-2 border-accent',
          dragging && 'opacity-50',
        )}
        style={{ paddingLeft: 12 + depth * 20 }}
      >
        {depth > 0 ? <View className="-ml-1 h-0.5 w-2.5 bg-border-strong" /> : null}
        {node.vacant ? (
          <View className="size-9 items-center justify-center rounded-full border border-dashed border-border-strong bg-surface-sunken">
            <Icon icon={UserPlus} size={17} tone="subtle" />
          </View>
        ) : (
          <Avatar
            decorative
            name={node.name}
            size={36}
            // Out of the search's chain: the picture greys and the name goes
            // quiet, but every word stays at text contrast.
            {...(dim ? { tone: 'neutral' as const } : {})}
            {...(node.avatarUrl ? { src: node.avatarUrl } : {})}
          />
        )}
        <View className="min-w-0 flex-1">
          {renderNode ? (
            renderNode(node, info)
          ) : (
            <>
              <CssText
                numberOfLines={1}
                className={cn(
                  'text-subhead leading-[1.3] font-semibold',
                  dim ? 'text-fg-muted' : 'text-fg',
                )}
              >
                {name}
              </CssText>
              <CssText numberOfLines={1} className="text-footnote leading-[1.3] text-fg-muted">
                {`${title}${reports > 0 ? ` · ${String(reports)} report${reports > 1 ? 's' : ''}` : ''}`}
              </CssText>
            </>
          )}
        </View>
        {node.status ? (
          <Badge size="sm" tone={node.statusTone ?? 'neutral'}>
            {node.status}
          </Badge>
        ) : null}
        {reports > 0 ? (
          <Pressable
            accessible={false}
            hitSlop={12}
            onPress={() => {
              toggle(node.id);
            }}
          >
            <Icon
              icon={open && children.length > 0 ? ChevronDown : ChevronRight}
              size={18}
              tone="subtle"
            />
          </Pressable>
        ) : null}
      </Pressable>
    );

    if (movable) {
      const lift = Gesture.Pan()
        .runOnJS(true)
        .activateAfterLongPress(350)
        .onStart(() => {
          setDrag({ id: node.id, over: undefined });
        })
        .onUpdate((e) => {
          const box = rows.current.get(node.id);
          setDrag({ id: node.id, over: rowAt((box?.y ?? 0) + e.y) });
        })
        .onEnd((e) => {
          const box = rows.current.get(node.id);
          const over = rowAt((box?.y ?? 0) + e.y);
          if (valid(node.id, over)) {
            reassign({ nodeId: node.id, fromParentId: node.parentId, toParentId: over });
          }
        })
        .onFinalize(() => {
          setDrag(null);
        });
      items.push(
        <GestureDetector key={node.id} gesture={lift}>
          {row}
        </GestureDetector>,
      );
    } else {
      items.push(<View key={node.id}>{row}</View>);
    }
    if (open) for (const child of children) walk(child, depth + 1);
  };
  for (const root of build(nodes)) walk(root, 0);

  return (
    <View
      {...(WEB ? { role: 'tree', 'aria-label': label } : { accessibilityLabel: label })}
      className={cn('overflow-hidden rounded-m-card bg-surface shadow-sm', className)}
    >
      {items}
    </View>
  );
}
