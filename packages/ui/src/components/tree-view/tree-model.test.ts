import { describe, expect, it } from 'vitest';

import { checkState, toggleCheck, treeKey, visibleNodes, type TreeNode } from './tree-model';

const docs: TreeNode[] = [
  {
    id: 'policies',
    label: 'Policies',
    children: [
      { id: 'leave', label: 'Leave policy.pdf' },
      { id: 'conduct', label: 'Code of conduct.pdf' },
      {
        id: 'expenses',
        label: 'Expenses',
        children: [
          { id: 'travel', label: 'Travel.pdf' },
          { id: 'equipment', label: 'Equipment.pdf' },
        ],
      },
    ],
  },
  { id: 'contracts', label: 'Contracts', hasChildren: true },
  { id: 'onboarding', label: 'Onboarding', children: [{ id: 'welcome', label: 'Welcome.pdf' }] },
  { id: 'handbook', label: 'Handbook.pdf' },
];

const open = (...ids: string[]): ReadonlySet<string> => new Set(ids);
const ids = (expanded: ReadonlySet<string>): string[] =>
  visibleNodes(docs, expanded).map((entry) => entry.node.id);

describe('visibleNodes', () => {
  it('shows only the roots when nothing is open', () => {
    expect(ids(open())).toEqual(['policies', 'contracts', 'onboarding', 'handbook']);
  });

  it('shows the children of open branches, depth first', () => {
    expect(ids(open('policies', 'expenses'))).toEqual([
      'policies',
      'leave',
      'conduct',
      'expenses',
      'travel',
      'equipment',
      'contracts',
      'onboarding',
      'handbook',
    ]);
  });

  it('hides the children of an open branch under a closed one', () => {
    expect(ids(open('expenses'))).toEqual(['policies', 'contracts', 'onboarding', 'handbook']);
  });

  it('reports level, parent and position for aria', () => {
    const travel = visibleNodes(docs, open('policies', 'expenses')).find(
      (entry) => entry.node.id === 'travel',
    );
    expect(travel).toMatchObject({ level: 3, parentId: 'expenses', posinset: 1, setsize: 2 });
  });
});

describe('treeKey', () => {
  it('moves down and up through visible nodes, stopping at the ends', () => {
    expect(treeKey('ArrowDown', docs, open(), 'policies')?.focus).toBe('contracts');
    expect(treeKey('ArrowDown', docs, open('policies'), 'policies')?.focus).toBe('leave');
    expect(treeKey('ArrowUp', docs, open(), 'policies')?.focus).toBe('policies');
    expect(treeKey('ArrowDown', docs, open(), 'handbook')?.focus).toBe('handbook');
  });

  it('jumps to the first and last visible node', () => {
    expect(treeKey('Home', docs, open(), 'handbook')?.focus).toBe('policies');
    expect(treeKey('End', docs, open('onboarding'), 'policies')?.focus).toBe('handbook');
  });

  it('opens a closed branch on ArrowRight without moving', () => {
    const move = treeKey('ArrowRight', docs, open(), 'policies');
    expect(move?.focus).toBe('policies');
    expect([...(move?.expanded ?? [])]).toEqual(['policies']);
  });

  it('steps into the first child of an open branch on ArrowRight', () => {
    expect(treeKey('ArrowRight', docs, open('policies'), 'policies')?.focus).toBe('leave');
  });

  it('opens an unloaded branch, so the caller can fetch it', () => {
    const move = treeKey('ArrowRight', docs, open(), 'contracts');
    expect(move?.expanded.has('contracts')).toBe(true);
    // Nothing is loaded yet, so a second ArrowRight has nowhere to go.
    expect(treeKey('ArrowRight', docs, open('contracts'), 'contracts')?.focus).toBe('contracts');
  });

  it('does nothing to a leaf on ArrowRight', () => {
    const move = treeKey('ArrowRight', docs, open(), 'handbook');
    expect(move?.focus).toBe('handbook');
    expect(move?.expanded.size).toBe(0);
  });

  it('closes an open branch on ArrowLeft, then goes to the parent', () => {
    const closed = treeKey('ArrowLeft', docs, open('policies', 'expenses'), 'expenses');
    expect(closed?.focus).toBe('expenses');
    expect(closed?.expanded.has('expenses')).toBe(false);
    expect(closed?.expanded.has('policies')).toBe(true);
    expect(treeKey('ArrowLeft', docs, open('policies'), 'expenses')?.focus).toBe('policies');
    expect(treeKey('ArrowLeft', docs, open('policies'), 'leave')?.focus).toBe('policies');
    expect(treeKey('ArrowLeft', docs, open(), 'policies')?.focus).toBe('policies');
  });

  it('opens every sibling branch on *', () => {
    const move = treeKey('*', docs, open(), 'handbook');
    expect([...(move?.expanded ?? [])].toSorted()).toEqual(['contracts', 'onboarding', 'policies']);
  });

  it('moves to the next label starting with a typed character, wrapping', () => {
    expect(treeKey('o', docs, open(), 'policies')?.focus).toBe('onboarding');
    expect(treeKey('P', docs, open(), 'handbook')?.focus).toBe('policies');
    expect(treeKey('z', docs, open(), 'contracts')?.focus).toBe('contracts');
  });

  it('leaves keys it does not own alone', () => {
    expect(treeKey('Tab', docs, open(), 'policies')).toBeNull();
    expect(treeKey(' ', docs, open(), 'policies')).toBeNull();
    expect(treeKey('ArrowDown', docs, open(), 'missing')).toBeNull();
  });
});

describe('checks', () => {
  const policies = docs[0] as TreeNode;

  it('derives a branch from its leaves', () => {
    expect(checkState(policies, new Set())).toBe(false);
    expect(checkState(policies, new Set(['leave']))).toBe('indeterminate');
    expect(checkState(policies, new Set(['leave', 'conduct', 'travel', 'equipment']))).toBe(true);
  });

  it('ticks every leaf under a branch, and clears them when all are ticked', () => {
    const all = toggleCheck(policies, new Set(['leave']));
    expect([...all].toSorted()).toEqual(['conduct', 'equipment', 'leave', 'travel']);
    expect(toggleCheck(policies, all).size).toBe(0);
  });

  it('keeps checks outside the toggled branch', () => {
    expect(toggleCheck(policies, new Set(['handbook'])).has('handbook')).toBe(true);
  });
});
