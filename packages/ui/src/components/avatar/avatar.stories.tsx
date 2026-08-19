import type { Meta, StoryObj } from '@storybook/react-vite';

import { Avatar, AvatarGroup } from './avatar';

const meta = {
  title: 'Components/Avatar',
  component: Avatar,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'A person.',
          '',
          'The fallback is **initials, not a silhouette**. In a directory of nine hundred people, nine hundred identical silhouettes carry no information: initials at least narrow the set.',
          '',
          '### Details that matter',
          '',
          '- `name` is required and doubles as the image `alt`. Pass the display name, never an employee id.',
          '- The fallback waits 120ms when a `src` is present, so a cached photo does not flash initials first.',
          '- Initials handle mononyms and multi-part names: first glyph plus last glyph, capped at two.',
          '- Sizes match the control scale, so an avatar sits cleanly inside a table row or a button-height toolbar.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    name: {
      description: 'Display name. Used for the `alt` text and to derive initials.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Content' },
    },
    src: {
      description: 'Photo URL. When it fails or is absent, the initials fallback renders.',
      control: 'text',
      table: { type: { summary: 'string | undefined' }, category: 'Content' },
    },
    fallback: {
      description:
        'Overrides the derived initials, for a team or a system actor rather than a person.',
      control: false,
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    size: {
      description: 'xs and sm for rows, md for lists, lg for cards, xl for profile headers.',
      control: 'inline-radio',
      options: ['xs', 'sm', 'md', 'lg', 'xl'],
      table: {
        type: { summary: "'xs' | 'sm' | 'md' | 'lg' | 'xl'" },
        defaultValue: { summary: 'md' },
        category: 'Appearance',
      },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: { name: 'Ada Lovelace', size: 'md' },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Sizes: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Initials scale with the circle, so the two-glyph fallback stays legible at `xs`.',
      },
    },
  },
  render: (args) => (
    <div className="flex items-end gap-3">
      <Avatar {...args} size="xs" />
      <Avatar {...args} size="sm" />
      <Avatar {...args} size="md" />
      <Avatar {...args} size="lg" />
      <Avatar {...args} size="xl" />
    </div>
  ),
};

export const NameHandling: Story = {
  name: 'Name handling',
  parameters: {
    docs: {
      description: {
        story:
          'Mononyms are not an edge case to be styled around, and a four-part name must not produce four initials. First glyph plus last glyph, always.',
      },
    },
  },
  render: () => (
    <div className="flex items-center gap-6">
      {['Prince', 'Ada Lovelace', 'Ada Byron King Lovelace', '陳 美玲'].map((name) => (
        <div key={name} className="flex flex-col items-center gap-2">
          <Avatar size="lg" name={name} />
          <p className="text-2xs text-fg-muted">{name}</p>
        </div>
      ))}
    </div>
  ),
};

export const WithACustomFallback: Story = {
  name: 'Custom fallback',
  parameters: {
    docs: {
      description: {
        story:
          'For non-people: a team, an integration, or the system actor that emitted an automated correction event.',
      },
    },
  },
  render: () => (
    <div className="flex items-center gap-3">
      <Avatar size="lg" name="Payroll service" fallback="SYS" />
      <Avatar size="lg" name="Platform team" fallback="PT" />
    </div>
  ),
};

export const Group: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'An approval chain, stacked. `max` caps what is rendered; `total` is the real count, so "+4" means four more people exist, not four more elements were passed.',
      },
    },
  },
  render: () => (
    <div className="space-y-6">
      <AvatarGroup max={3} total={7}>
        <Avatar name="Ada Lovelace" />
        <Avatar name="Grace Hopper" />
        <Avatar name="Katherine Johnson" />
        <Avatar name="Radia Perlman" />
      </AvatarGroup>
      <AvatarGroup max={4}>
        <Avatar size="sm" name="Ada Lovelace" />
        <Avatar size="sm" name="Grace Hopper" />
      </AvatarGroup>
    </div>
  ),
};
