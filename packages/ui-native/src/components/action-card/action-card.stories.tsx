import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Phone, TriangleAlert, X } from 'lucide-react-native';
import { View } from 'react-native-css/components';

import { designDocs } from '../../docs/design.ts';
import { Avatar } from '../avatar/avatar.tsx';
import { Badge } from '../badge/badge.tsx';
import { Button } from '../button/button.tsx';
import { Icon } from '../icon/icon.tsx';
import { ActionCard } from './action-card.tsx';

const meta = {
  title: 'Components/ActionCard',
  component: ActionCard,
  parameters: designDocs('action-card'),
  args: {
    title: 'Correct your National ID',
    description: 'The check letter doesn’t match the number',
    icon: TriangleAlert,
    tone: 'danger',
    meta: '2d',
  },
} satisfies Meta<typeof ActionCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <ActionCard
      {...args}
      due={
        <Badge size="sm" tone="warning">
          Due tomorrow
        </Badge>
      }
      actions={
        <Button size="sm" variant="primary">
          Fix
        </Button>
      }
    />
  ),
};

export const Tasks: Story = {
  name: 'Tasks',
  render: () => (
    <View className="gap-3">
      <ActionCard
        icon={Phone}
        title="Add an emergency contact"
        description="“We need one before the offsite.” · Ada"
        meta="2d"
        due={<Badge size="sm">Due 8 Oct</Badge>}
        actions={<Button size="sm">Add</Button>}
      />
      <ActionCard
        leading={<Avatar name="Omar Haddad" size={40} decorative />}
        title="Omar · 2–3 Nov"
        description="Vacation · 2 days"
        hint="No clash. Omar has 14 days left."
        actions={
          <>
            <Button
              size="sm"
              accessibilityLabel="Decline"
              startIcon={<Icon icon={X} size={16} />}
            />
            <Button size="sm" variant="primary">
              Approve
            </Button>
          </>
        }
      />
    </View>
  ),
};
