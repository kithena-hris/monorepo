import type { Meta, StoryObj } from '@storybook/react-vite';
import { Bell, Calendar, TriangleAlert, Wallet } from 'lucide-react';

import { Avatar } from '../avatar/avatar';
import { Button } from '../button/button';
import { EmptyState } from '../feedback/feedback';
import {
  NotificationCenter,
  NotificationGroup,
  NotificationItem,
  NotificationPanel,
} from './notification-center';

const meta: Meta = {
  title: 'Components/Notification centre',
  component: NotificationPanel,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'Everything that needs your attention, in one list. Unread items are tinted, and an item you can act on has its buttons inline.',
          '',
          '`NotificationPanel` is the list and renders anywhere, as these stories show it. `NotificationCenter` opens it from the bell: in a popover at a desk, and as a full-screen sheet under a finger. The choice follows the pointer, not the window width.',
          '',
          'Unread is a tint, a dot and the word "Unread" for a screen reader. With `href` the whole item is the link, and its inline actions sit above it.',
        ].join('\n'),
      },
    },
  },
};

export default meta;
type Story = StoryObj;

const markAllRead = (
  <Button variant="link" size="sm">
    Mark all read
  </Button>
);

export const Playground: Story = {
  render: () => (
    <NotificationPanel action={markAllRead}>
      <NotificationGroup>
        <NotificationItem
          unread
          avatar={<Avatar name="Amara Okafor" size="lg" />}
          title="Amara requested 5 days off"
          description="14–18 Oct · Vacation"
          time="12m"
          href="#request"
        />
        <NotificationItem
          unread
          icon={<Wallet />}
          tone="success"
          title="Your September payslip is ready"
          description="Net €4,280.00"
          time="1h"
          href="#payslip"
        />
        <NotificationItem
          avatar={<Avatar name="Jonas Weber" size="lg" />}
          title="Jonas mentioned you"
          description="“Priya, can you review this?”"
          time="Yesterday"
          href="#mention"
        />
        <NotificationItem
          icon={<TriangleAlert />}
          tone="warning"
          title="Your passport expires in 30 days"
          description="Upload a new one"
          time="Mon"
          href="#passport"
        />
      </NotificationGroup>
    </NotificationPanel>
  ),
};

export const GroupedByDay: Story = {
  render: () => (
    <NotificationPanel action={markAllRead}>
      <NotificationGroup label="Today">
        <NotificationItem
          unread
          avatar={<Avatar name="Amara Okafor" size="lg" />}
          title="Amara requested 5 days off"
          description="14–18 Oct"
          time="12m"
        />
      </NotificationGroup>
      <NotificationGroup label="Earlier">
        <NotificationItem
          avatar={<Avatar name="Nora Becker" size="lg" />}
          title="Nora shared a policy"
          description="Parental leave 2027"
          time="Mon"
        />
        <NotificationItem
          icon={<Calendar />}
          tone="info"
          title="Public holiday on 3 Oct"
          description="Day of German Unity"
          time="Sun"
        />
      </NotificationGroup>
    </NotificationPanel>
  ),
};

/** Approve or decline without leaving the list. */
export const WithInlineActions: Story = {
  render: () => (
    <NotificationPanel action={markAllRead}>
      <NotificationGroup>
        <NotificationItem
          unread
          avatar={<Avatar name="Amara Okafor" size="lg" />}
          title="Amara requested 5 days off"
          description="14–18 Oct · 9.5 days left after"
          time="12m"
          actions={
            <>
              <Button size="sm">Decline</Button>
              <Button size="sm" variant="primary">
                Approve
              </Button>
            </>
          }
        />
      </NotificationGroup>
    </NotificationPanel>
  ),
};

/** `note`: why an item stands out, in words and the warning tone, under what it is. */
export const WithANote: Story = {
  render: () => (
    <NotificationPanel title="Inbox">
      <NotificationGroup>
        <NotificationItem
          avatar={<Avatar name="Amara Okafor" size="lg" />}
          title="Amara Okafor"
          description="Salary change · asked by Ravi"
          note="A 38% raise"
          time="2h"
          href="#change"
        />
        <NotificationItem
          avatar={<Avatar name="Ravi Patel" size="lg" />}
          title="Ravi Patel"
          description="National ID to check"
          time="5h"
          href="#check"
        />
      </NotificationGroup>
    </NotificationPanel>
  ),
};

export const AllCaughtUp: Story = {
  render: () => (
    <NotificationPanel>
      <EmptyState
        icon={<Bell />}
        title="You’re all caught up"
        description="New requests and updates will show up here."
        className="border-0 py-10"
      />
    </NotificationPanel>
  ),
};

/** Opened from the bell: a popover at a desk, a full-screen sheet under a finger. */
export const FromTheBell: Story = {
  render: () => (
    <NotificationCenter
      action={markAllRead}
      trigger={
        <Button
          variant="ghost"
          startIcon={<Bell aria-hidden />}
          aria-label="Notifications, 2 unread"
        />
      }
    >
      <NotificationGroup label="Today">
        <NotificationItem
          unread
          avatar={<Avatar name="Amara Okafor" size="lg" />}
          title="Amara requested 5 days off"
          description="14–18 Oct · Vacation"
          time="12m"
          href="#request"
        />
        <NotificationItem
          unread
          icon={<Wallet />}
          tone="success"
          title="Your September payslip is ready"
          description="Net €4,280.00"
          time="1h"
          href="#payslip"
        />
      </NotificationGroup>
    </NotificationCenter>
  ),
};
