'use client';

import { ChevronRight } from 'lucide-react';
import { useId, useRef, useState, type JSX, type KeyboardEvent, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Checkbox } from '../checkbox/checkbox';
import { Skeleton } from '../feedback/feedback';
import { Spinner } from '../spinner/spinner';
import {
  checkState,
  isBranch,
  toggleCheck,
  treeKey,
  visibleNodes,
  type TreeNode,
} from './tree-model';

/**
 * Nested items: folders, departments, cost centres.
 *
 * The WAI-ARIA tree pattern, keyboard and all. One tab stop for the whole tree
 * (a roving `tabIndex`), the arrow keys move and open and close, Home and End
 * jump, `*` opens every sibling, and typing a letter moves to the next item
 * starting with it. The logic lives in `tree-model.ts` as plain functions, so
 * it is tested as data rather than through a DOM.
 *
 * ### Branches load when they open
 *
 * A node with `hasChildren` and no `children` is a branch not fetched yet. It
 * opens like any other, which is the caller's cue to fetch; list its id in
 * `loading` meanwhile and the tree shows a spinner and placeholder rows.
 *
 * ### Checks are derived upwards
 *
 * With `checkable`, only leaves hold a check. A branch is ticked when all of
 * its leaves are and shows a dash when some are, and ticking it sets every leaf
 * under it. The treeitem carries `aria-checked`, so the box inside it is
 * decoration and not a second tab stop.
 */

export interface TreeViewNode extends TreeNode {
  children?: readonly TreeViewNode[];
  /** A glyph before the label: a folder, a building, a person. */
  icon?: ReactNode;
  /** Quiet text at the row's end, typically a count. */
  meta?: ReactNode;
}

export interface TreeViewProps {
  items: readonly TreeViewNode[];
  /** Names the tree for assistive tech. */
  label: string;

  expanded?: readonly string[];
  defaultExpanded?: readonly string[];
  /** Also the cue to load a branch opened for the first time. */
  onExpandedChange?: (expanded: readonly string[]) => void;

  /** The one selected item. Enter, Space or a click selects. */
  selected?: string | null;
  defaultSelected?: string | null;
  onSelectedChange?: (id: string) => void;

  /** A box on every row; Space ticks instead of selecting. */
  checkable?: boolean;
  /** Ids of the ticked leaves. */
  checked?: readonly string[];
  defaultChecked?: readonly string[];
  onCheckedChange?: (checked: readonly string[]) => void;

  /** Branches whose children are being fetched. */
  loading?: readonly string[];
  className?: string;
}

export function TreeView({
  items,
  label,
  expanded,
  defaultExpanded,
  onExpandedChange,
  selected,
  defaultSelected = null,
  onSelectedChange,
  checkable = false,
  checked,
  defaultChecked,
  onCheckedChange,
  loading = [],
  className,
}: TreeViewProps): JSX.Element {
  const base = useId();
  const [ownOpen, setOwnOpen] = useState<readonly string[]>(defaultExpanded ?? []);
  const [ownSelected, setOwnSelected] = useState<string | null>(defaultSelected);
  const [ownChecked, setOwnChecked] = useState<readonly string[]>(defaultChecked ?? []);

  const open = new Set(expanded ?? ownOpen);
  const picked = selected === undefined ? ownSelected : selected;
  const ticks = new Set(checked ?? ownChecked);
  const busy = new Set(loading);

  const visible = visibleNodes(items, open);
  // Focus starts on the selection, else the first item, and follows the keys.
  const [focusId, setFocusId] = useState<string | null>(null);
  const focus =
    visible.find((entry) => entry.node.id === focusId)?.node.id ??
    visible.find((entry) => entry.node.id === picked)?.node.id ??
    visible[0]?.node.id;

  const nodesRef = useRef(new Map<string, HTMLLIElement>());
  const idFor = (id: string): string => `${base}-${id}`;

  const setOpen = (next: ReadonlySet<string>): void => {
    const list = [...next];
    if (expanded === undefined) setOwnOpen(list);
    onExpandedChange?.(list);
  };
  const select = (id: string): void => {
    if (selected === undefined) setOwnSelected(id);
    onSelectedChange?.(id);
  };
  const tick = (node: TreeNode): void => {
    const list = [...toggleCheck(node, ticks)];
    if (checked === undefined) setOwnChecked(list);
    onCheckedChange?.(list);
  };
  const moveFocus = (id: string): void => {
    setFocusId(id);
    nodesRef.current.get(id)?.focus();
  };
  const toggleOpen = (id: string): void => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, node: TreeViewNode): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (checkable && event.key === ' ') tick(node);
      else select(node.id);
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const move = treeKey(event.key, items, open, node.id);
    if (!move) return;
    event.preventDefault();
    // The model hands back the very set it was given when nothing opened.
    if (move.expanded !== open) setOpen(move.expanded);
    moveFocus(move.focus);
  };

  const renderLevel = (nodes: readonly TreeViewNode[], level: number): ReactNode =>
    nodes.map((node, index) => {
      const branch = isBranch(node);
      const isOpen = branch && open.has(node.id);
      const isBusy = busy.has(node.id);
      const isSelected = picked === node.id;
      const state = checkable ? checkState(node, ticks) : undefined;

      return (
        <li
          key={node.id}
          ref={(element) => {
            if (element) nodesRef.current.set(node.id, element);
            else nodesRef.current.delete(node.id);
          }}
          role="treeitem"
          aria-labelledby={idFor(node.id)}
          aria-level={level}
          aria-setsize={nodes.length}
          aria-posinset={index + 1}
          aria-expanded={branch ? isOpen : undefined}
          aria-busy={isBusy || undefined}
          aria-selected={checkable ? undefined : isSelected}
          aria-checked={
            state === undefined ? undefined : state === 'indeterminate' ? 'mixed' : state
          }
          tabIndex={node.id === focus ? 0 : -1}
          onKeyDown={(event) => {
            // Handled once, by the item that has focus, not by every ancestor
            // the event bubbles through.
            if (event.target !== event.currentTarget) return;
            onKeyDown(event, node);
          }}
          onFocus={(event) => {
            if (event.target === event.currentTarget) setFocusId(node.id);
          }}
          className={cn(
            'outline-none',
            '[&:focus-visible>[data-row]]:outline-2 [&:focus-visible>[data-row]]:-outline-offset-2 [&:focus-visible>[data-row]]:outline-border-focus',
          )}
        >
          <div
            data-row
            onClick={() => {
              moveFocus(node.id);
              if (checkable) tick(node);
              else select(node.id);
            }}
            className={cn(
              'relative flex min-h-8.5 cursor-pointer items-center gap-2 rounded-sm pe-2.5 text-sm font-medium text-fg select-none',
              'transition-colors duration-(--animate-duration-fast) hover:bg-surface-sunken',
              'touch:min-h-12 touch:text-base',
              isSelected &&
                !checkable &&
                'bg-accent-subtle font-semibold text-accent-fg hover:bg-accent-subtle',
            )}
            style={{ paddingInlineStart: `${String(0.5 + (level - 1) * 1.25)}rem` }}
          >
            {/* Indent guides, one per ancestor, so a deep row can be traced
                back up to its parent by eye. */}
            {Array.from({ length: level - 1 }, (_, depth) => (
              <span
                key={depth}
                aria-hidden
                className="absolute inset-y-0 w-px bg-border"
                style={{ insetInlineStart: `${String(1 + depth * 1.25)}rem` }}
              />
            ))}

            <span
              aria-hidden
              className="relative grid size-4 shrink-0 place-items-center text-fg-subtle tap-target"
              onClick={(event) => {
                if (!branch) return;
                // The chevron opens and closes; the rest of the row selects.
                event.stopPropagation();
                moveFocus(node.id);
                toggleOpen(node.id);
              }}
            >
              {isBusy ? (
                <Spinner size="xs" label={`Loading ${node.label}`} />
              ) : branch ? (
                <ChevronRight
                  className={cn(
                    'size-4 transition-transform duration-(--animate-duration-fast)',
                    isOpen && 'rotate-90',
                  )}
                />
              ) : null}
            </span>

            {state === undefined ? null : (
              <Checkbox
                aria-hidden
                tabIndex={-1}
                checked={state}
                onClick={(event) => {
                  event.stopPropagation();
                  moveFocus(node.id);
                  tick(node);
                }}
              />
            )}

            {node.icon ? (
              <span
                aria-hidden
                className={cn(
                  'grid shrink-0 place-items-center [&_svg]:size-4',
                  branch ? 'text-accent-fg' : 'text-fg-muted',
                )}
              >
                {node.icon}
              </span>
            ) : null}

            <span id={idFor(node.id)} className="min-w-0 flex-1 truncate">
              {node.label}
            </span>

            {node.meta === undefined ? null : (
              <span className="shrink-0 text-xs font-medium text-fg-subtle tabular-nums">
                {node.meta}
              </span>
            )}
          </div>

          {isOpen && node.children && node.children.length > 0 ? (
            <ul role="group">{renderLevel(node.children, level + 1)}</ul>
          ) : null}

          {isOpen && isBusy ? (
            <div
              aria-hidden
              className="flex flex-col gap-2 py-1.5"
              style={{ paddingInlineStart: `${String(2.5 + level * 1.25)}rem` }}
            >
              <Skeleton className="h-2.5 w-1/2" />
              <Skeleton className="h-2.5 w-1/3" />
            </div>
          ) : null}
        </li>
      );
    });

  return (
    <ul
      role="tree"
      aria-label={label}
      aria-multiselectable={checkable || undefined}
      className={cn('rounded-lg bg-surface p-2 shadow-sm', className)}
    >
      {renderLevel(items, 1)}
    </ul>
  );
}
