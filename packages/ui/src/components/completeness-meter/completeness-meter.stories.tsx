import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../button/button';
import { CompletenessMeter } from './completeness-meter';

const meta = {
  title: 'Components/Completeness meter',
  component: CompletenessMeter,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'How complete a record is, what’s missing and when it’s due. The segments show the parts at a glance and say their state in words. The ring is green only when it is done, accent most of the way, and a warning below that.',
      },
    },
  },
  args: { value: 82, title: '3 details missing', description: 'Due before 1 Oct' },
} satisfies Meta<typeof CompletenessMeter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: {
    segments: [
      { label: 'Personal', state: 'done' },
      { label: 'Identification', state: 'done' },
      { label: 'Emergency contacts', state: 'todo' },
      { label: 'Employment', state: 'done' },
      { label: 'Bank details', state: 'todo' },
      { label: 'Public profile', state: 'todo' },
      { label: 'Diversity', state: 'skipped' },
    ],
  },
  render: (args) => <CompletenessMeter {...args} className="max-w-md" />,
};

export const WithAnAction: Story = {
  name: 'With an action',
  args: {
    value: 64,
    title: '5 details missing',
    action: (
      <Button size="sm" variant="primary">
        Continue
      </Button>
    ),
  },
  render: (args) => <CompletenessMeter {...args} className="max-w-md" />,
};

export const Complete: Story = {
  render: () => (
    <CompletenessMeter
      value={100}
      description="Everything required is filled in"
      className="max-w-md"
    />
  ),
};
