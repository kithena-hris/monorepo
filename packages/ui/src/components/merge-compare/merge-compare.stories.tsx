import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Avatar } from '../avatar/avatar';
import { MergeCompare } from './merge-compare';

function Source({ name, from }: { readonly name: string; readonly from: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar name={name} size="lg" />
      <div className="min-w-0">
        <p className="truncate font-bold">{name}</p>
        <p className="truncate text-sm text-fg-muted">{from}</p>
      </div>
    </div>
  );
}

const meta = {
  title: 'Components/Merge compare',
  component: MergeCompare,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Two records side by side. Pick the value to keep for each field that differs; identical values are greyed out with an equals sign and nothing to choose.',
      },
    },
  },
  args: {
    sources: [
      <Source key="a" name="Yuki Sato" from="From sign-up" />,
      <Source key="b" name="Yuki Satō" from="From import" />,
    ],
    sourceNames: ['Yuki Sato (sign-up)', 'Yuki Satō (import)'],
    rows: [
      { id: 'name', label: 'Legal name', values: ['Yuki Sato', 'Yuki Satō'] },
      { id: 'email', label: 'Work email', values: ['yuki@acme.com', 'yuki@acme.com'], same: true },
      { id: 'start', label: 'Start date', values: ['—', '1 Oct 2026'] },
    ],
    picks: { name: 1, start: 1 },
  },
} satisfies Meta<typeof MergeCompare>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => {
    const [picks, setPicks] = useState<Record<string, 0 | 1>>({ name: 1, start: 1 });
    return (
      <MergeCompare
        {...args}
        picks={picks}
        onPick={(id, side) => {
          setPicks((p) => ({ ...p, [id]: side }));
        }}
        className="max-w-3xl"
      />
    );
  },
};
