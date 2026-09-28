import type { Meta, StoryObj } from '@storybook/react-vite';
import { Bot, Building2, Users } from 'lucide-react';

import { Avatar, AvatarGroup } from './avatar';

const meta = {
  title: 'Components/Avatar',
  component: Avatar,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'A person’s photo or initials. Initials get a stable colour worked out from the name.',
          '',
          'The fallback is **initials, not a silhouette**. In a directory of nine hundred people, nine hundred identical silhouettes carry no information: initials and a colour at least narrow the set.',
          '',
          '### Details that matter',
          '',
          '- `name` is required and doubles as the image `alt`. Pass the display name, never an employee id.',
          '- The colour is a hash of the name, so the same person is the same colour on every screen with nothing stored. It is decoration; the initials and the name beside them carry who it is.',
          '- The fallback waits 120ms when a `src` is present, so a cached photo does not flash initials first.',
          '- Initials handle mononyms and multi-part names: first glyph plus last glyph, capped at two.',
          '- `status` adds a presence dot. It is colour only, so pass `statusLabel` too.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    name: {
      description: 'Display name. Used for the `alt` text, the initials and the colour.',
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
        'Overrides the derived initials, for a team, a bot or a system actor rather than a person. An icon works.',
      control: false,
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    size: {
      description:
        '20, 24, 32, 40, 48, 64 and 80px. xs and sm for rows, md for lists, lg for cards, xl and 2xl for profile headers, 3xl for the one person a page is about.',
      control: 'inline-radio',
      options: ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'],
      table: {
        type: { summary: "'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl'" },
        defaultValue: { summary: 'md' },
        category: 'Appearance',
      },
    },
    tone: {
      description:
        '`auto` tints from a hash of `name`. Pin a tone, or `neutral` for a system actor. Decoration only.',
      control: 'inline-radio',
      options: ['auto', 'neutral', 'accent', 'info', 'success', 'warning', 'danger'],
      table: {
        type: {
          summary: "'auto' | 'neutral' | 'accent' | 'info' | 'success' | 'warning' | 'danger'",
        },
        defaultValue: { summary: 'auto' },
        category: 'Appearance',
      },
    },
    status: {
      description: 'A presence dot. Colour only, so pair it with `statusLabel`.',
      control: 'inline-radio',
      options: [undefined, 'success', 'warning', 'danger', 'info', 'neutral'],
      table: {
        type: { summary: "'success' | 'warning' | 'danger' | 'info' | 'neutral'" },
        category: 'Appearance',
      },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: { name: 'Priya Shah', size: 'xl', status: 'success', statusLabel: 'Online' },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Sizes: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Initials are 36% of the diameter, so the two-glyph fallback stays legible at `xs`.',
      },
    },
  },
  render: (args) => (
    <div className="flex flex-wrap items-end gap-3.5">
      {(['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'] as const).map((size) => (
        <Avatar key={size} name={args.name} size={size} />
      ))}
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
    <ul className="flex w-72 flex-col gap-2.5">
      {['Priya Shah', 'Mei', 'Jean-Luc Picard', 'María José García López', '李 明'].map((name) => (
        <li key={name} className="flex items-center gap-2.5 text-[0.875rem]">
          <Avatar name={name} size="lg" />
          {name}
        </li>
      ))}
    </ul>
  ),
};

export const TintedByName: Story = {
  name: 'Tinted by name',
  parameters: {
    docs: {
      description: {
        story:
          'The wash comes from a hash of the name, so the same person is the same colour on every screen, with nothing stored. Pass `tone` to pin one.',
      },
    },
  },
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      {[
        'Priya Shah',
        'Jonas Weber',
        'Amara Okafor',
        'Omar Haddad',
        'Yuki Tanaka',
        'Lucía Romero',
        'Mateus Silva',
      ].map((name) => (
        <Avatar key={name} size="lg" name={name} />
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
          'Nobody yet gets a neutral silhouette. For a company, a bot or a team, pass an icon as `fallback`; `shape="rounded"` for anything that is not a face.',
      },
    },
  },
  render: () => (
    <div className="flex items-center gap-3">
      <Avatar size="lg" name="" />
      <Avatar size="lg" name="Northwind" shape="rounded" tone="neutral" fallback={<Building2 />} />
      <Avatar size="lg" name="Assistant" tone="neutral" fallback={<Bot />} />
      <Avatar size="lg" name="Platform team" tone="neutral" fallback={<Users />} />
    </div>
  ),
};

export const Group: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'An approval chain, stacked. `max` caps what is rendered; `total` is the real count, so "+4" means four more people exist, not four more elements were passed. Give the group the avatars’ `size` so the counter matches them.',
      },
    },
  },
  render: () => (
    <div className="flex flex-col gap-3.5">
      <AvatarGroup>
        <Avatar name="Priya Shah" />
        <Avatar name="Jonas Weber" />
        <Avatar name="Amara Okafor" />
      </AvatarGroup>
      <AvatarGroup max={4} total={7}>
        <Avatar name="Priya Shah" />
        <Avatar name="Jonas Weber" />
        <Avatar name="Amara Okafor" />
        <Avatar name="Omar Haddad" />
      </AvatarGroup>
      <div className="flex items-center gap-2">
        <AvatarGroup max={3} total={5} size="sm">
          <Avatar size="sm" name="Priya Shah" />
          <Avatar size="sm" name="Jonas Weber" />
          <Avatar size="sm" name="Amara Okafor" />
        </AvatarGroup>
        <p className="text-sm text-fg-muted">Priya, Jonas and 2 others</p>
      </div>
    </div>
  ),
};
