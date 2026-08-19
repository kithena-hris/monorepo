import type { Meta, StoryObj } from '@storybook/react-vite';

import { Spinner } from './spinner';

const meta = {
  title: 'Components/Spinner',
  component: Spinner,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Indeterminate progress. For work of known duration, show real progress instead, a spinner that runs for eight seconds is indistinguishable from a hang.',
          '',
          'It carries a `role="status"` and a visually hidden label. A spinner with no label is a silent pause for anyone not looking at the screen. Say what is happening: "Submitting the request", not "Loading".',
          '',
          'Prefer a `Skeleton` where the shape of the result is known, it reserves the space and avoids the layout shift a spinner guarantees. And prefer a determinate `Progress` wherever the total is genuinely known: a bar that can finish is worth more than a ring that cannot.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    size: {
      description: 'xs and sm sit inside controls; md and lg stand alone.',
      control: 'inline-radio',
      options: ['xs', 'sm', 'md', 'lg'],
      table: {
        type: { summary: "'xs' | 'sm' | 'md' | 'lg'" },
        defaultValue: { summary: 'md' },
        category: 'Appearance',
      },
    },
    label: {
      description: 'Screen-reader text. Name the work, not the widget.',
      control: 'text',
      table: {
        type: { summary: 'string' },
        defaultValue: { summary: 'Loading' },
        category: 'Accessibility',
      },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: { size: 'md', label: 'Loading the directory' },
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-6">
      <Spinner {...args} size="xs" />
      <Spinner {...args} size="sm" />
      <Spinner {...args} size="md" />
      <Spinner {...args} size="lg" />
    </div>
  ),
};

export const OnTones: Story = {
  name: 'Inheriting colour',
  parameters: {
    docs: {
      description: {
        story:
          'The track and the arc both use `currentColor`, so the spinner takes the colour of whatever it sits inside: including a filled button, where a fixed colour would disappear.',
      },
    },
  },
  render: () => (
    <div className="flex items-center gap-6">
      <span className="text-fg-muted">
        <Spinner label="Loading" />
      </span>
      <span className="text-accent">
        <Spinner label="Loading" />
      </span>
      <span className="grid size-12 place-items-center rounded-md bg-accent text-fg-on-accent">
        <Spinner label="Loading" />
      </span>
    </div>
  ),
};
