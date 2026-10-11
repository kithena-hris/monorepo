import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Mail, MessageCircle, Network, Phone } from 'lucide-react-native';

import { designDocs } from '../../docs/design.ts';
import { Avatar } from '../avatar/avatar.tsx';
import { Badge } from '../badge/badge.tsx';
import { Hero, QuickAction } from './hero.tsx';

const noop = (): void => undefined;

const meta = {
  title: 'Components/Hero',
  component: Hero,
  parameters: designDocs('hero'),
  args: {
    media: <Avatar name="Adam Novak" size={96} status="success" decorative />,
    title: 'Adam Novak',
    subtitle: 'Backend engineer · Madrid',
  },
} satisfies Meta<typeof Hero>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const WithQuickActions: Story = {
  name: 'With quick actions',
  render: (args) => (
    <Hero
      {...args}
      badges={
        <>
          <Badge size="sm" tone="success" dot>
            Active
          </Badge>
          <Badge size="sm" tone="warning">
            2 missing
          </Badge>
        </>
      }
      actions={
        <>
          <QuickAction icon={MessageCircle} label="Message" onPress={noop} />
          <QuickAction icon={Phone} label="Call" onPress={noop} />
          <QuickAction icon={Mail} label="Email" onPress={noop} />
          <QuickAction icon={Network} label="Org chart" onPress={noop} />
        </>
      }
    />
  ),
};
