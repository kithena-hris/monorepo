import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { ImportSummary } from './import-summary';

const meta = {
  title: 'Components/Import summary',
  component: ImportSummary,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'How a dry run sorted the rows. Each tile is a toggle for its bucket, so selecting one filters the rows underneath it, and pressing it again shows them all.',
      },
    },
  },
  args: {
    tiles: [
      { id: 'create', label: 'Create', count: 298, tone: 'success' },
      { id: 'update', label: 'Update', count: 71, tone: 'info' },
      { id: 'unchanged', label: 'Unchanged', count: 31, tone: 'neutral' },
      { id: 'blocked', label: 'Blocked', count: 9, tone: 'danger' },
    ],
  },
} satisfies Meta<typeof ImportSummary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => {
    const [selected, setSelected] = useState<string | null>('blocked');
    return <ImportSummary {...args} selected={selected} onSelect={setSelected} />;
  },
};
