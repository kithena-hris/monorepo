import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from 'lucide-react-native';
import { Fragment, useState, type ReactNode } from 'react';
import { Platform, type AccessibilityActionEvent } from 'react-native';
import { Pressable, Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { useAnnouncer } from '../../lib/reorder.tsx';
import { CheckboxBox, type CheckedState } from '../checkbox/checkbox.tsx';
import { Skeleton } from '../feedback/feedback.tsx';
import { Icon } from '../icon/icon.tsx';
import { Spinner } from '../spinner/spinner.tsx';

/**
 * Nested items (folders, departments, cost centres), as the web's
 * `TreeView`. A branch opens with its chevron or the arrow keys, and loads its
 * children when it first opens. With `checkable`, checking a branch checks
 * everything under it and a partly checked branch shows a dash. With
 * `onMove`, long-press an item to pick it up and tap a branch to move it in:
 * the branches it can go into are outlined while it is held.
 */

export type TreeNode = {
  id: string;
  label: string;
  /** Loaded children. An empty array is a branch that turned out to be empty. */
  children?: readonly TreeNode[];
  /** A branch whose children are not loaded yet: opening it is the cue to fetch them. */
  hasChildren?: boolean;
};

export type TreeViewNode = TreeNode & {
  children?: readonly TreeViewNode[];
  /** A glyph before the label: an `Icon`. A folder or a page when left out. */
  icon?: ReactNode;
  /** Quiet text at the row's end, typically a count. */
  meta?: ReactNode;
};

export type TreeViewProps = {
  items: readonly TreeViewNode[];
  /** The tree's accessible name. */
  label: string;
  expanded?: readonly string[];
  defaultExpanded?: readonly string[];
  /** Also the cue to load a branch opened for the first time. */
  onExpandedChange?: (expanded: readonly string[]) => void;
  /** Branches whose children are on their way: a spinner, then skeleton rows. */
  loading?: readonly string[];
  /** The one selected item. Without `onSelectedChange`, a tap on a branch opens it. */
  selected?: string | null;
  defaultSelected?: string | null;
  onSelectedChange?: (id: string) => void;
  /** A checkbox on every row; checking a branch checks everything under it. */
  checkable?: boolean;
  /** The checked leaves. A branch's box follows them. */
  checked?: readonly string[];
  defaultChecked?: readonly string[];
  onCheckedChange?: (checked: readonly string[]) => void;
  /** Long-press picks an item up; tapping a branch moves it in. */
  onMove?: (id: string, into: string) => void;
  /** Held as the tree renders: for a walkthrough. */
  defaultHeld?: string;
  /** The row the keyboard is on. */
  defaultFocused?: string;
  className?: string | undefined;
};

const WEB = Platform.OS === 'web';

/** A tap on a part of a row, through the responder system: not focusable, not a second control. */
function tap(run: () => void): {
  onStartShouldSetResponder: () => boolean;
  onResponderTerminationRequest: () => boolean;
  onResponderRelease: () => void;
} {
  return {
    onStartShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderRelease: run,
  };
}

const isBranch = (n: TreeNode): boolean => n.children !== undefined || n.hasChildren === true;

/** Every leaf under a node, or the node itself when it is one. */
function leaves(n: TreeNode): string[] {
  return n.children && n.children.length > 0 ? n.children.flatMap(leaves) : [n.id];
}

/** A branch's box: on when all its leaves are, a dash when some are. */
export function treeChecked(n: TreeNode, checked: readonly string[]): CheckedState {
  const all = leaves(n);
  const on = all.filter((id) => checked.includes(id)).length;
  return on === 0 ? false : on === all.length ? true : 'indeterminate';
}

export function TreeView({
  items: nodes,
  label,
  expanded: expandedProp,
  defaultExpanded = [],
  onExpandedChange,
  loading = [],
  selected: selectedProp,
  defaultSelected = null,
  onSelectedChange,
  checkable = false,
  checked: checkedProp,
  defaultChecked = [],
  onCheckedChange,
  onMove,
  defaultHeld,
  defaultFocused,
  className,
}: TreeViewProps): React.JSX.Element {
  const [own, setOwn] = useState(defaultExpanded);
  const expanded = expandedProp ?? own;
  const setExpanded = (next: readonly string[]): void => {
    setOwn(next);
    onExpandedChange?.(next);
  };
  const [ownSelected, setOwnSelected] = useState(defaultSelected);
  const selected = selectedProp === undefined ? ownSelected : selectedProp;
  const select = (id: string): void => {
    setOwnSelected(id);
    onSelectedChange?.(id);
  };
  const [ownChecked, setOwnChecked] = useState(defaultChecked);
  const checked = checkedProp ?? ownChecked;
  const [held, setHeld] = useState<string | null>(defaultHeld ?? null);
  const [focused, setFocused] = useState<string | null>(defaultFocused ?? null);
  const { announce, region } = useAnnouncer();

  // The rows on screen, in order, for the keyboard.
  const visible: { node: TreeViewNode; depth: number; parent: TreeViewNode | null }[] = [];
  const walk = (
    list: readonly TreeViewNode[],
    depth: number,
    parent: TreeViewNode | null,
  ): void => {
    for (const node of list) {
      visible.push({ node, depth, parent });
      if (expanded.includes(node.id) && node.children) walk(node.children, depth + 1, node);
    }
  };
  walk(nodes, 0, null);
  const labelOf = (id: string): string => visible.find((v) => v.node.id === id)?.node.label ?? id;

  const toggle = (n: TreeNode): void => {
    const open = expanded.includes(n.id);
    setExpanded(open ? expanded.filter((id) => id !== n.id) : [...expanded, n.id]);
  };

  const check = (n: TreeNode): void => {
    const all = leaves(n);
    const on = treeChecked(n, checked) === true;
    const next = on ? checked.filter((id) => !all.includes(id)) : [...new Set([...checked, ...all])];
    setOwnChecked(next);
    onCheckedChange?.(next);
  };

  const press = (n: TreeNode): void => {
    if (held) {
      const home = visible.find((v) => v.node.id === held)?.parent?.id;
      if (isBranch(n) && n.id !== held && n.id !== home) {
        onMove?.(held, n.id);
        announce(`${labelOf(held)} moved into ${n.label}.`);
        setHeld(null);
      }
      return;
    }
    setFocused(n.id);
    if (isBranch(n) && !onSelectedChange) toggle(n);
    else select(n.id);
  };

  const onKeyDown = (e: { key: string; preventDefault: () => void }): void => {
    const at = visible.findIndex((v) => v.node.id === focused);
    const here = visible[at];
    const go = (i: number): void => {
      const to = visible[Math.max(0, Math.min(visible.length - 1, i))];
      if (to) setFocused(to.node.id);
    };
    const keys: Record<string, () => void> = {
      ArrowDown: () => {
        go(at + 1);
      },
      ArrowUp: () => {
        go(at - 1);
      },
      Home: () => {
        go(0);
      },
      End: () => {
        go(visible.length - 1);
      },
      ArrowRight: () => {
        if (!here || !isBranch(here.node)) return;
        if (!expanded.includes(here.node.id)) toggle(here.node);
        else go(at + 1);
      },
      ArrowLeft: () => {
        if (!here) return;
        if (isBranch(here.node) && expanded.includes(here.node.id)) toggle(here.node);
        else if (here.parent) setFocused(here.parent.id);
      },
      '*': () => {
        if (!here) return;
        const siblings = (here.parent?.children ?? nodes).filter(isBranch).map((n) => n.id);
        setExpanded([...new Set([...expanded, ...siblings])]);
      },
      Enter: () => {
        if (here) press(here.node);
      },
      ' ': () => {
        if (here && checkable) check(here.node);
      },
    };
    const run = keys[e.key];
    if (run) {
      e.preventDefault();
      if (focused === null) go(0);
      else run();
    }
  };

  const row = (n: TreeViewNode, depth: number, index: number, setsize: number): ReactNode => {
    const branch = isBranch(n);
    const open = expanded.includes(n.id);
    const isLoading = loading.includes(n.id);
    const isSelected = selected === n.id;
    // Its own folder is not somewhere to move it.
    const home = held === null ? null : (visible.find((v) => v.node.id === held)?.parent?.id ?? null);
    const target = held !== null && branch && n.id !== held && n.id !== home;
    const state = checkable ? treeChecked(n, checked) : false;
    return (
      <Fragment key={n.id}>
        <Pressable
          nativeID={`tree-${n.id}`}
          accessibilityLabel={`${n.label}${typeof n.meta === 'string' || typeof n.meta === 'number' ? `, ${String(n.meta)}` : ''}`}
          {...(WEB
            ? ({
                role: 'treeitem',
                'aria-level': depth + 1,
                'aria-posinset': index + 1,
                'aria-setsize': setsize,
                ...(branch ? { 'aria-expanded': open } : {}),
                'aria-selected': isSelected,
                ...(checkable
                  ? { 'aria-checked': state === 'indeterminate' ? 'mixed' : state }
                  : {}),
              } as object)
            : {
                accessibilityState: {
                  expanded: branch ? open : undefined,
                  selected: isSelected,
                  ...(checkable ? { checked: state === 'indeterminate' ? 'mixed' : state } : {}),
                },
                accessibilityActions: [
                  ...(branch ? [{ name: 'expand', label: open ? 'Close' : 'Open' }] : []),
                  ...(checkable ? [{ name: 'check', label: state === true ? 'Uncheck' : 'Check' }] : []),
                  ...(onMove && !branch ? [{ name: 'move', label: 'Move' }] : []),
                ],
                onAccessibilityAction: (e: AccessibilityActionEvent) => {
                  if (e.nativeEvent.actionName === 'expand') toggle(n);
                  if (e.nativeEvent.actionName === 'check') check(n);
                  if (e.nativeEvent.actionName === 'move') setHeld(n.id);
                },
              })}
          onPress={() => {
            press(n);
          }}
          {...(onMove && !branch
            ? {
                onLongPress: () => {
                  setHeld(n.id);
                  announce(`${n.label} picked up. Tap a folder to move it in.`);
                },
              }
            : {})}
          style={{ paddingLeft: 8 + depth * 20 }}
          className={cn(
            'min-h-12 flex-row items-center gap-2 rounded-[10px] pr-2.5',
            isSelected && 'bg-accent-subtle',
            target && 'border-2 border-accent bg-accent-subtle',
            focused === n.id && WEB && 'border-2 border-border-focus',
            held === n.id && 'opacity-70',
          )}
        >
          {Array.from({ length: depth }, (_, k) => (
            <View
              key={k}
              aria-hidden
              className="absolute inset-y-0 w-px bg-border"
              style={{ left: 16 + k * 20 }}
            />
          ))}
          {/* A touch target of its own, not a control: the row's actions say the same. */}
          <View
            aria-hidden
            {...(branch ? tap(() => {
              toggle(n);
            }) : {})}
            hitSlop={12}
            className="w-4 items-center"
          >
            {branch ? (
              isLoading ? (
                <Spinner size={12} decorative />
              ) : (
                <Icon icon={open ? ChevronDown : ChevronRight} size={15} tone="subtle" />
              )
            ) : null}
          </View>
          {checkable ? (
            <View
              aria-hidden
              hitSlop={10}
              {...tap(() => {
                check(n);
              })}
            >
              <CheckboxBox checked={state} />
            </View>
          ) : null}
          {n.icon ?? (
            <Icon
              icon={branch ? (open ? FolderOpen : Folder) : FileText}
              size={16}
              tone={branch ? 'accent' : 'muted'}
            />
          )}
          <CssText
            numberOfLines={1}
            className={cn(
              'min-w-0 flex-1 text-callout leading-[1.2]',
              isSelected ? 'font-semibold text-accent-fg' : 'font-medium text-fg',
            )}
          >
            {n.label}
          </CssText>
          {typeof n.meta === 'string' || typeof n.meta === 'number' ? (
            <CssText className="text-[12px] leading-none font-medium text-fg-subtle">
              {n.meta}
            </CssText>
          ) : (
            n.meta
          )}
        </Pressable>
        {open && n.children ? (
          <View {...(WEB ? ({ role: 'group' } as object) : {})}>
            {n.children.map((c, i, all) => row(c, depth + 1, i, all.length))}
          </View>
        ) : null}
        {open && isLoading ? (
          <View
            className="gap-2 py-1.5"
            style={{ paddingLeft: 40 + (depth + 1) * 20 }}
          >
            <Skeleton className="h-2.5 w-1/2" />
            <Skeleton className="h-2.5 w-[35%]" />
          </View>
        ) : null}
      </Fragment>
    );
  };

  return (
    <View className={cn('rounded-m-card bg-surface p-2 shadow-sm', className)}>
      <View
        {...(WEB
          ? ({
              role: 'tree',
              'aria-label': label,
              tabIndex: 0,
              ...(focused ? { 'aria-activedescendant': `tree-${focused}` } : {}),
              onKeyDown,
            } as object)
          : {})}
        className="outline-none"
      >
        {nodes.map((n, i) => row(n, 0, i, nodes.length))}
      </View>
      {region}
    </View>
  );
}
