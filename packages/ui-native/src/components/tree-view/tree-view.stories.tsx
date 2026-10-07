import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useState } from 'react';
import { View } from 'react-native-css/components';

import { designDocs, designNote } from '../../docs/design.ts';
import { KeyHints } from '../../docs/notes.tsx';
import { TreeView, type TreeViewNode, type TreeViewProps } from './tree-view.tsx';

const DOCS: TreeViewNode[] = [
  {
    id: 'policies',
    label: 'Policies',
    meta: 4,
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
  { id: 'contracts', label: 'Contracts', meta: 312, hasChildren: true },
  {
    id: 'onboarding',
    label: 'Onboarding',
    children: [{ id: 'welcome', label: 'Welcome pack.pdf' }],
  },
  { id: 'handbook', label: 'Handbook.pdf' },
];

const meta = {
  title: 'Components/TreeView',
  component: TreeView,
  parameters: designDocs('tree-view'),
  args: { items: DOCS, label: 'Documents' },
} satisfies Meta<typeof TreeView>;

export default meta;
type Story = StoryObj<typeof meta>;

function Live(props: TreeViewProps): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>(props.selected ?? null);
  return <TreeView {...props} selected={selected} onSelectedChange={setSelected} />;
}

export const Playground: Story = {
  render: (args) => <Live {...args} defaultExpanded={['policies', 'expenses']} selected="leave" />,
};

const TEAMS: TreeViewNode[] = [
  {
    id: 'engineering',
    label: 'Engineering',
    children: [
      { id: 'platform', label: 'Platform' },
      { id: 'mobile', label: 'Mobile' },
      { id: 'payroll', label: 'Payroll' },
    ],
  },
  {
    id: 'design',
    label: 'Design',
    children: [
      { id: 'product-design', label: 'Product design' },
      { id: 'brand', label: 'Brand' },
    ],
  },
  {
    id: 'sales',
    label: 'Sales',
    children: [
      { id: 'emea', label: 'EMEA' },
      { id: 'americas', label: 'Americas' },
    ],
  },
];

export const WithCheckboxes: Story = {
  name: 'With checkboxes',
  parameters: designNote('tree-view', 'With checkboxes'),
  render: function ChecksStory() {
    const [checked, setChecked] = useState<readonly string[]>([
      'platform',
      'payroll',
      'product-design',
      'brand',
    ]);
    return (
      <TreeView
        label="Teams"
        items={TEAMS}
        checkable
        checked={checked}
        onCheckedChange={setChecked}
        defaultExpanded={['engineering']}
      />
    );
  },
};

export const LoadingABranch: Story = {
  name: 'Loading a branch',
  render: () => (
    <TreeView
      label="Documents"
      items={[
        { id: 'contracts', label: 'Contracts', meta: 312, hasChildren: true },
        {
          id: 'policies',
          label: 'Policies',
          children: [{ id: 'leave', label: 'Leave policy.pdf' }],
        },
      ]}
      defaultExpanded={['contracts']}
      loading={['contracts']}
    />
  ),
};

export const DragToMove: Story = {
  name: 'Drag to move',
  parameters: designNote('tree-view', 'Drag to move'),
  render: function MoveStory() {
    const [nodes, setNodes] = useState<TreeViewNode[]>([
      {
        id: 'policies',
        label: 'Policies',
        children: [
          { id: 'leave', label: 'Leave policy.pdf' },
          { id: 'conduct', label: 'Code of conduct.pdf' },
        ],
      },
      { id: 'archive', label: 'Archive', children: [{ id: 'old', label: 'Old handbook.pdf' }] },
      {
        id: 'onboarding',
        label: 'Onboarding',
        children: [{ id: 'welcome', label: 'Welcome pack.pdf' }],
      },
    ]);
    return (
      <TreeView
        label="Documents"
        items={nodes}
        defaultExpanded={['policies']}
        defaultHeld="leave"
        onMove={(id, into) => {
          const item = nodes.flatMap((n) => n.children ?? []).find((c) => c.id === id);
          if (!item) return;
          setNodes(
            nodes.map((n) => ({
              ...n,
              children: [
                ...(n.children ?? []).filter((c) => c.id !== id),
                ...(n.id === into ? [item] : []),
              ],
            })),
          );
        }}
      />
    );
  },
};

export const FromTheKeyboard: Story = {
  name: 'From the keyboard',
  render: () => (
    <View className="gap-2.5">
      <TreeView
        label="Documents"
        items={[
          {
            id: 'policies',
            label: 'Policies',
            children: [
              { id: 'leave', label: 'Leave policy.pdf' },
              { id: 'conduct', label: 'Code of conduct.pdf' },
            ],
          },
          { id: 'contracts', label: 'Contracts', hasChildren: true },
        ]}
        defaultExpanded={['policies']}
        defaultFocused="leave"
      />
      <KeyHints
        hints={[
          [['up', 'down'], 'move'],
          [['right'], 'open'],
          [['left'], 'close or go up'],
          [['*'], 'open siblings'],
        ]}
      />
    </View>
  ),
};
