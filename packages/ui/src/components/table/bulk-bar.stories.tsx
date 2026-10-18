import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from '../button/button';
import { BulkBar } from './bulk-bar';

const meta = {
  title: 'Components/Bulk bar',
  component: BulkBar,
  parameters: {
    docs: {
      description: {
        component: [
          'The bar a selection summons: the count, the actions, and Clear. `DataTable` draws it itself; a table that is not a `DataTable` puts one directly under itself.',
          '',
          'It sits in flow under the table and sticks to the bottom of the viewport, so it never covers the row somebody is about to act on. Inverted, opaque, and drawn for none when nothing is selected.',
        ].join('\n'),
      },
    },
  },
  args: { count: 3, onClear: () => undefined, children: null },
} satisfies Meta<typeof BulkBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UnderATable: Story = {
  render: function UnderATable() {
    const [count, setCount] = useState(3);
    return (
      <div className="flex flex-col gap-3">
        <ul className="divide-y divide-border rounded-lg border border-border">
          {['Ada Lovelace', 'Grace Hopper', 'Katherine Johnson', 'Mary Jackson'].map((name) => (
            <li key={name} className="px-4 py-3 text-sm">
              {name}
            </li>
          ))}
        </ul>
        <BulkBar
          count={count}
          onClear={() => {
            setCount(0);
          }}
        >
          <Button size="sm" variant="secondary">
            Remind
          </Button>
          <Button size="sm" variant="secondary">
            Extend deadline
          </Button>
        </BulkBar>
      </div>
    );
  },
};
