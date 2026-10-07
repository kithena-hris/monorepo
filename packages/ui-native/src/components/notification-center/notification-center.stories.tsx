import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Bell, Calendar, TriangleAlert, Wallet } from 'lucide-react-native';
import { useState } from 'react';

import { designDocs } from '../../docs/design.ts';
import { Avatar } from '../avatar/avatar.tsx';
import { Card } from '../card/card.tsx';
import { EmptyState } from '../feedback/feedback.tsx';
import {
  NotificationCenter,
  NotificationGroup,
  NotificationItem,
  NotificationList,
} from './notification-center.tsx';

const meta = {
  title: 'Components/Notification centre',
  component: NotificationItem,
  parameters: designDocs('notification-center'),
  args: { title: 'Amara requested 5 days off', time: '12m' },
} satisfies Meta<typeof NotificationItem>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = (): void => undefined;

export const Playground: Story = {
  render: function PlaygroundStory() {
    const [unread, setUnread] = useState(true);
    return (
      <NotificationCenter
        onMarkAllRead={() => {
          setUnread(false);
        }}
      >
        <NotificationList>
          <NotificationItem
            avatar={<Avatar name="Amara Okafor" size={36} decorative />}
            title="Amara requested 5 days off"
            description="14–18 Oct · Vacation"
            time="12m"
            unread={unread}
            onPress={noop}
          />
          <NotificationItem
            icon={Wallet}
            tone="success"
            title="Your September payslip is ready"
            description="Net €4,280.00"
            time="1h"
            unread={unread}
            onPress={noop}
          />
          <NotificationItem
            avatar={<Avatar name="Jonas Weber" size={36} decorative />}
            title="Jonas mentioned you"
            description="“Priya, can you review this?”"
            time="Yesterday"
            onPress={noop}
          />
          <NotificationItem
            icon={TriangleAlert}
            tone="warning"
            title="Your passport expires in 30 days"
            description="Upload a new one"
            time="Mon"
            onPress={noop}
            last
          />
        </NotificationList>
      </NotificationCenter>
    );
  },
};

export const GroupedByDay: Story = {
  name: 'Grouped by day',
  render: () => (
    <>
      <NotificationGroup label="Today">
        <NotificationItem
          avatar={<Avatar name="Amara Okafor" size={36} decorative />}
          title="Amara requested 5 days off"
          description="14–18 Oct"
          time="12m"
          unread
          onPress={noop}
          last
        />
      </NotificationGroup>
      <NotificationGroup label="Earlier">
        <NotificationItem
          avatar={<Avatar name="Nora Becker" size={36} decorative />}
          title="Nora shared a policy"
          description="Parental leave 2027"
          time="Mon"
          onPress={noop}
        />
        <NotificationItem
          icon={Calendar}
          tone="info"
          title="Public holiday on 3 Oct"
          description="Day of German Unity"
          time="Sun"
          onPress={noop}
          last
        />
      </NotificationGroup>
    </>
  ),
};

export const WithInlineActions: Story = {
  name: 'With inline actions',
  render: () => (
    <NotificationList>
      <NotificationItem
        avatar={<Avatar name="Amara Okafor" size={36} decorative />}
        title="Amara requested 5 days off"
        description="14–18 Oct · 9.5 days left after"
        time="12m"
        unread
        actions={[
          { label: 'Decline', onPress: noop },
          { label: 'Approve', onPress: noop, variant: 'primary' },
        ]}
        last
      />
    </NotificationList>
  ),
};

export const AllCaughtUp: Story = {
  name: 'All caught up',
  render: () => (
    <Card>
      <EmptyState
        icon={Bell}
        title="You’re all caught up"
        description="New requests and updates will show up here."
        className="py-3"
      />
    </Card>
  ),
};
