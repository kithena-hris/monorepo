import type { Meta, StoryObj } from '@storybook/react-vite';
import { Building2, FileText, Folder } from 'lucide-react';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { Kbd } from '../kbd/kbd';
import { TreeView, type TreeViewNode } from './tree-view';

const folder = <Folder />;
const file = <FileText />;

const documents: TreeViewNode[] = [
  {
    id: 'policies',
    label: 'Policies',
    icon: folder,
    meta: 4,
    children: [
      { id: 'leave', label: 'Leave policy.pdf', icon: file },
      { id: 'conduct', label: 'Code of conduct.pdf', icon: file },
      {
        id: 'expenses',
        label: 'Expenses',
        icon: folder,
        children: [
          { id: 'travel', label: 'Travel.pdf', icon: file },
          { id: 'equipment', label: 'Equipment.pdf', icon: file },
        ],
      },
    ],
  },
  { id: 'contracts', label: 'Contracts', icon: folder, meta: 312, hasChildren: true },
  {
    id: 'onboarding',
    label: 'Onboarding',
    icon: folder,
    children: [{ id: 'welcome', label: 'Welcome pack.pdf', icon: file }],
  },
  { id: 'handbook', label: 'Handbook.pdf', icon: file },
];

const meta = {
  title: 'Components/TreeView',
  component: TreeView,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Nested items such as folders, departments or cost centres, as a WAI-ARIA tree.',
          '',
          'One tab stop for the whole tree. ↑ and ↓ move, → opens a branch and then steps into it, ← closes it and then goes up to the parent, Home and End jump, `*` opens every sibling, and typing a letter moves to the next item starting with it. Enter or Space selects.',
          '',
          'A node with `hasChildren` and no `children` is a branch not loaded yet. Opening it calls `onExpandedChange`, which is the cue to fetch; list its id in `loading` meanwhile.',
        ].join('\n'),
      },
    },
  },
  args: {
    items: documents,
    label: 'Documents',
    defaultExpanded: ['policies', 'expenses'],
    defaultSelected: 'leave',
    onSelectedChange: fn(),
    onExpandedChange: fn(),
  },
} satisfies Meta<typeof TreeView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => <TreeView {...args} className="max-w-sm" />,
};

const departments: TreeViewNode[] = [
  {
    id: 'engineering',
    label: 'Engineering',
    icon: <Building2 />,
    children: [
      { id: 'platform', label: 'Platform' },
      { id: 'mobile', label: 'Mobile' },
      { id: 'payroll', label: 'Payroll' },
    ],
  },
  {
    id: 'design',
    label: 'Design',
    icon: <Building2 />,
    children: [
      { id: 'product-design', label: 'Product design' },
      { id: 'research', label: 'Research' },
    ],
  },
  {
    id: 'sales',
    label: 'Sales',
    icon: <Building2 />,
    children: [
      { id: 'emea', label: 'EMEA' },
      { id: 'americas', label: 'Americas' },
    ],
  },
];

export const WithCheckboxes: Story = {
  name: 'With checkboxes',
  parameters: {
    docs: {
      description: {
        story:
          'Checking a parent checks all its children. If only some children are checked, the parent shows a dash. Only the leaves are stored: a parent is always worked out from them, so the two can never disagree.',
      },
    },
  },
  render: function CheckboxesStory() {
    const [checked, setChecked] = useState<readonly string[]>([
      'platform',
      'payroll',
      'product-design',
      'research',
    ]);
    return (
      <div className="max-w-sm space-y-3">
        <TreeView
          label="Departments"
          items={departments}
          checkable
          defaultExpanded={['engineering']}
          checked={checked}
          onCheckedChange={setChecked}
        />
        <p aria-live="polite" className="px-1 text-sm text-fg-muted">
          {checked.length} teams chosen
        </p>
      </div>
    );
  },
};

export const LoadingABranch: Story = {
  name: 'Loading a branch',
  parameters: {
    docs: {
      description: {
        story:
          'Open **Contracts**. The branch shows a spinner and two placeholder rows for as long as its id is in `loading`, then the children the caller fetched.',
      },
    },
  },
  render: function LoadingStory() {
    const [items, setItems] = useState<TreeViewNode[]>([
      { id: 'contracts', label: 'Contracts', icon: folder, meta: 312, hasChildren: true },
      {
        id: 'policies',
        label: 'Policies',
        icon: folder,
        children: [{ id: 'leave', label: 'Leave policy.pdf', icon: file }],
      },
    ]);
    const [loading, setLoading] = useState<readonly string[]>([]);

    return (
      <TreeView
        label="Documents"
        items={items}
        loading={loading}
        className="max-w-sm"
        onExpandedChange={(open) => {
          const contracts = items[0];
          if (!open.includes('contracts') || contracts?.children !== undefined) return;
          setLoading(['contracts']);
          // A stand-in for the fetch.
          setTimeout(() => {
            setItems((current) =>
              current.map((node) =>
                node.id === 'contracts'
                  ? {
                      ...node,
                      children: ['Permanent', 'Fixed term', 'Contractors'].map((label) => ({
                        id: label,
                        label,
                        icon: folder,
                        hasChildren: true,
                      })),
                    }
                  : node,
              ),
            );
            setLoading([]);
          }, 1200);
        }}
      />
    );
  },
};

export const FromTheKeyboard: Story = {
  name: 'From the keyboard',
  render: (args) => (
    <div className="max-w-sm space-y-3">
      <TreeView {...args} />
      <ul className="flex flex-wrap gap-x-4 gap-y-2 px-1 text-xs text-fg-muted">
        <li>
          <Kbd>↑</Kbd> <Kbd>↓</Kbd> move
        </li>
        <li>
          <Kbd>→</Kbd> open
        </li>
        <li>
          <Kbd>←</Kbd> close or go up
        </li>
        <li>
          <Kbd>*</Kbd> open siblings
        </li>
        <li>
          <Kbd>A</Kbd>–<Kbd>Z</Kbd> jump by name
        </li>
      </ul>
    </div>
  ),
};
