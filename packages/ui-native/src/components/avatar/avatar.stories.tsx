import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Bot, Building2, Users } from 'lucide-react-native';
import { View } from 'react-native-css/components';

import { designDocs } from '../../docs/design.ts';
import { PEOPLE } from '../../docs/people.ts';
import { Inline, Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { Avatar, AvatarGroup, initialsOf } from './avatar.tsx';

const meta = {
  title: 'Components/Avatar',
  component: Avatar,
  parameters: designDocs('avatar'),
  args: { name: 'Priya Shah', size: 56, status: 'success', statusLabel: 'Online' },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

const SIZES = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'] as const;
const POINTS = [20, 24, 32, 40, 48, 64, 80];

export const Sizes: Story = {
  render: () => (
    <Inline gap={3} align="end" className="gap-x-3.5">
      {SIZES.map((size, i) => (
        <Stack key={size} gap={2} align="center" className="gap-1.5">
          <Avatar name="Priya Shah" size={size} />
          <Text variant="caption" tone="muted" mono>
            {String(POINTS[i])}
          </Text>
        </Stack>
      ))}
    </Inline>
  ),
};

const NAMES = ['Priya Shah', 'Mei', 'Jean-Luc Picard', 'María José García López', '李 明'];

export const NameHandling: Story = {
  name: 'Name handling',
  parameters: {
    docs: {
      description: {
        story:
          'The first word’s initial and the last’s, whatever the script. A single name gives one letter, and a hyphenated given name counts as one word.',
      },
    },
  },
  render: () => (
    <Stack className="gap-2.5">
      {NAMES.map((name) => (
        <Inline key={name} wrap={false} className="gap-2.5">
          <Avatar name={name} decorative />
          <Text variant="subhead" className="flex-1">
            {name}
          </Text>
          <Text variant="caption" tone="subtle" mono>
            {initialsOf(name)}
          </Text>
        </Inline>
      ))}
    </Stack>
  ),
};

export const CustomFallback: Story = {
  name: 'Custom fallback',
  parameters: {
    docs: {
      description: {
        story:
          'No name: the silhouette. A company takes `shape="rounded"` and an icon, a bot or a team an icon of its own.',
      },
    },
  },
  render: () => (
    <Inline gap={3}>
      <Avatar name="" />
      <Avatar name="Northwind" icon={Building2} shape="rounded" />
      <Avatar name="Assistant" icon={Bot} />
      <Avatar name="Design team" icon={Users} />
    </Inline>
  ),
};

export const Group: Story = {
  render: () => (
    <Stack gap={3} className="gap-3.5">
      <AvatarGroup>
        {PEOPLE.slice(0, 3).map((p) => (
          <Avatar key={p.name} name={p.name} />
        ))}
      </AvatarGroup>
      <AvatarGroup max={4}>
        {PEOPLE.map((p) => (
          <Avatar key={p.name} name={p.name} />
        ))}
      </AvatarGroup>
      <Inline gap={2} wrap={false}>
        <AvatarGroup size="sm" max={3}>
          {PEOPLE.slice(0, 5).map((p) => (
            <Avatar key={p.name} name={p.name} />
          ))}
        </AvatarGroup>
        <View className="flex-1">
          <Text variant="subhead" tone="muted">
            Priya, Jonas and 2 others
          </Text>
        </View>
      </Inline>
    </Stack>
  ),
};
