import type { Meta, StoryObj } from '@storybook/react-vite';

import { EffectiveValue } from './effective-value';

const meta = {
  title: 'Components/Effective-dated value',
  component: EffectiveValue,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A value with its next change and its approval state, so nobody has to open the history to know what’s coming. The current value comes first; the scheduled one and "waiting for approval" are words with an icon, never colour alone.',
      },
    },
  },
  args: { value: 'Marco Ruiz' },
} satisfies Meta<typeof EffectiveValue>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CurrentOnly: Story = {};

export const WithAScheduledChange: Story = {
  name: 'With a scheduled change',
  args: { next: { value: 'Priya Shah', from: '1 Nov' } },
};

export const WaitingForApproval: Story = {
  args: { value: '€92,000', next: { value: '€96,000', from: '1 Jan 2027' }, pending: true },
};
