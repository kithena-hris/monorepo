import type { Meta, StoryObj } from '@storybook/react-vite';

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
