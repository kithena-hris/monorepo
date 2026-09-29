import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from '../button/button';
import { ChangeDiff } from './change-diff';

const meta = {
  title: 'Components/Change diff',
  component: ChangeDiff,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Before and after for an approval or an audit entry. The old value is struck through and the new one is tinted; both are also `<del>` and `<ins>` with a spoken "was" and "now". Under a finger each row stacks, because a phone has room for one value per line.',
      },
    },
  },
  args: {
    items: [
      { label: 'IBAN', before: 'ES91 •••• 1332', after: 'ES76 •••• 4410', mono: true },
      { label: 'Account holder', before: 'Lucía Fernández', after: 'Lucía Fernández Ruiz' },
      { label: 'Effective', before: '—', after: 'Next payroll, 30 Sep' },
    ],
  },
} satisfies Meta<typeof ChangeDiff>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => <ChangeDiff {...args} className="max-w-2xl" />,
};

/**
 * Proposed changes, each kept or dropped before any is applied. Something
 * new has no before; a note says why a row must be ticked on purpose, or why
 * it cannot be applied as it is.
 */
export const Review: Story = {
  render: () => {
    const [kept, setKept] = useState<Partial<Record<string, boolean>>>({
      a: true,
      b: false,
      c: true,
    });
    return (
      <ChangeDiff
        className="max-w-3xl"
        onSelectedChange={(id, selected) => {
          setKept((k) => ({ ...k, [id]: selected }));
        }}
        items={[
          {
            id: 'a',
            label: 'Rename a section',
            before: 'Bank',
            after: 'Payment',
            selected: kept['a'] === true,
          },
          {
            id: 'b',
            label: 'Add a field',
            after: 'Account number · required · seen by the owner and accounts',
            selected: kept['b'] === true,
            note: 'Financial data: tick it on purpose to include it.',
            tone: 'warning',
            actions: (
              <Button size="sm" variant="ghost">
                Edit
              </Button>
            ),
          },
          {
            id: 'c',
            label: 'Add a field',
            after: 'Shoe size · optional',
            selected: kept['c'] === true,
            note: 'A field called Shoe size already exists.',
            tone: 'danger',
          },
        ]}
      />
    );
  },
};
