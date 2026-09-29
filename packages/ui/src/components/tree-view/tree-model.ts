/**
 * The tree's logic, kept apart from React so it can be tested as data.
 *
 * Everything the keyboard does in a WAI-ARIA tree is a function of three
 * things: the nodes, which of them are open, and which one has focus. So that
 * is the whole input here, and the output is the next focus and the next set of
 * open nodes. The component only renders and forwards keys.
 */

export interface TreeNode {
  id: string;
  label: string;
  /** Loaded children. An empty array is a branch that turned out to be empty. */
  children?: readonly TreeNode[];
  /**
   * A branch whose children are not loaded yet. It shows a chevron, and
   * opening it is the caller's cue to fetch them.
   */
  hasChildren?: boolean;
}

export interface VisibleNode<T extends TreeNode = TreeNode> {
  node: T;
  /** 1-based, as `aria-level` wants it. */
  level: number;
  parentId: string | null;
  /** Position among its siblings, 1-based, and how many siblings there are. */
  posinset: number;
  setsize: number;
}

export const isBranch = (node: TreeNode): boolean =>
  node.children !== undefined || node.hasChildren === true;

/** The nodes a person can currently see, in reading order. */
export function visibleNodes<T extends TreeNode>(
  nodes: readonly T[],
  expanded: ReadonlySet<string>,
  level = 1,
  parentId: string | null = null,
): VisibleNode<T>[] {
  return nodes.flatMap((node, index) => {
    const self: VisibleNode<T> = {
      node,
      level,
      parentId,
      posinset: index + 1,
      setsize: nodes.length,
    };
    const open = expanded.has(node.id) && node.children !== undefined;
    return open
      ? [self, ...visibleNodes(node.children as readonly T[], expanded, level + 1, node.id)]
      : [self];
  });
}

export interface TreeMove {
  focus: string;
  expanded: ReadonlySet<string>;
}

/**
 * What a key does, per the APG tree pattern.
 *
 * Returns `null` for a key the tree does not handle, so the component knows to
 * let it through (Tab, for one, must leave the tree). Enter and Space are not
 * here: they select or check, which is the component's business.
 */
export function treeKey(
  key: string,
  nodes: readonly TreeNode[],
  expanded: ReadonlySet<string>,
  focusId: string,
): TreeMove | null {
  const visible = visibleNodes(nodes, expanded);
  const at = visible.findIndex((entry) => entry.node.id === focusId);
  const current = visible[at];
  if (!current) return null;
  const stay = (focus: string, next = expanded): TreeMove => ({ focus, expanded: next });

  switch (key) {
    case 'ArrowDown':
      return stay(visible[at + 1]?.node.id ?? focusId);
    case 'ArrowUp':
      return stay(visible[at - 1]?.node.id ?? focusId);
    case 'Home':
      return stay(visible[0]?.node.id ?? focusId);
    case 'End':
      return stay(visible[visible.length - 1]?.node.id ?? focusId);
    case 'ArrowRight': {
      // Closed branch: open it. Open branch: step into its first child. Leaf:
      // nothing, and the focus stays put rather than wandering.
      if (!isBranch(current.node)) return stay(focusId);
      if (!expanded.has(focusId)) return stay(focusId, new Set([...expanded, focusId]));
      const child = visible[at + 1];
      return stay(child?.parentId === focusId ? child.node.id : focusId);
    }
    case 'ArrowLeft': {
      // Open branch: close it. Anything else: go up to the parent.
      if (isBranch(current.node) && expanded.has(focusId)) {
        const next = new Set(expanded);
        next.delete(focusId);
        return stay(focusId, next);
      }
      return stay(current.parentId ?? focusId);
    }
    case '*': {
      // Opens every branch among the focused node's siblings, and only those.
      const siblings = visible
        .filter((entry) => entry.parentId === current.parentId && isBranch(entry.node))
        .map((entry) => entry.node.id);
      return stay(focusId, new Set([...expanded, ...siblings]));
    }
    default: {
      // Type-ahead: a printable character moves to the next visible node whose
      // label starts with it, wrapping round, the way a file list does.
      if (key.length !== 1 || key === ' ') return null;
      const lower = key.toLowerCase();
      const order = [...visible.slice(at + 1), ...visible.slice(0, at + 1)];
      const hit = order.find((entry) => entry.node.label.toLowerCase().startsWith(lower));
      return stay(hit?.node.id ?? focusId);
    }
  }
}

export type CheckState = boolean | 'indeterminate';

/** Every id at or under a node that holds a check of its own: the leaves. */
function leavesOf(node: TreeNode): string[] {
  return node.children && node.children.length > 0 ? node.children.flatMap(leavesOf) : [node.id];
}

/**
 * A branch's box is derived, never stored: ticked when every leaf under it is,
 * a dash when some are, empty when none are. Storing it would let the parent
 * and its children disagree.
 */
export function checkState(node: TreeNode, checked: ReadonlySet<string>): CheckState {
  const leaves = leavesOf(node);
  const on = leaves.filter((id) => checked.has(id)).length;
  return on === 0 ? false : on === leaves.length ? true : 'indeterminate';
}

/**
 * Toggling a node sets every leaf under it. A dash toggles to ticked, since
 * "finish what was started" is the likelier intent than "throw it away".
 */
export function toggleCheck(node: TreeNode, checked: ReadonlySet<string>): ReadonlySet<string> {
  const leaves = leavesOf(node);
  const next = new Set(checked);
  if (checkState(node, checked) === true) for (const id of leaves) next.delete(id);
  else for (const id of leaves) next.add(id);
  return next;
}
