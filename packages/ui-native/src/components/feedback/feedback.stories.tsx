import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Inbox, SearchX, UserPlus } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native-css/components';

import { designDocs } from '../../docs/design.ts';
import { Button } from '../button/button.tsx';
import { Card } from '../card/card.tsx';
import { Stack } from '../layout/layout.tsx';
import { Alert, EmptyState, Skeleton } from './feedback.tsx';

const meta = {
  title: 'Components/Feedback',
  component: Alert,
  parameters: designDocs('feedback'),
  args: {
    tone: 'info',
    title: 'Payroll closes tomorrow at 17:00',
    children: 'Submit expenses before then to get paid this month.',
  },
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const AlertTones: Story = {
  name: 'Alert tones',
  render: () => (
    <Stack gap={2}>
      <Alert tone="info" title="Heads up" />
      <Alert tone="success" title="All payslips sent" />
      <Alert tone="warning" title="2 contracts expire soon" />
      <Alert tone="danger" title="Payroll failed for 3 people" />
      <Alert tone="accent" title="New: Org chart export" />
      <Alert tone="neutral" title="Scheduled maintenance Sunday" />
    </Stack>
  ),
};

export const AlertVariations: Story = {
  name: 'Alert variations',
  render: function Variations() {
    const [soft, setSoft] = useState(true);
    return (
      <Stack gap={2}>
        {soft ? (
          <Alert
            tone="warning"
            variant="soft"
            title="Soft"
            onDismiss={() => {
              setSoft(false);
            }}
          >
            Default, inside content.
          </Alert>
        ) : null}
        <Alert tone="warning" variant="outline" title="Outline">
          On busy backgrounds.
        </Alert>
        <Alert tone="danger" variant="solid" title="Solid">
          Blocking problems only.
        </Alert>
        <Alert
          tone="info"
          variant="banner"
          title="Banner · full width, top of the page"
          actions={
            <Button size="xs" variant="secondary">
              Review
            </Button>
          }
        />
      </Stack>
    );
  },
};

export const Skeletons: Story = {
  render: () => (
    <Card className="gap-3" accessibilityLabel="Loading">
      <View className="flex-row items-center gap-3">
        <Skeleton className="size-11 rounded-full" />
        <View className="gap-2">
          <Skeleton className="h-3 w-[140px]" />
          <Skeleton className="h-2.5 w-[90px]" />
        </View>
      </View>
      <Skeleton className="h-2.5 w-full" />
      <Skeleton className="h-2.5 w-[92%]" />
      <Skeleton className="h-2.5 w-[60%]" />
    </Card>
  ),
};

export const EmptyStates: Story = {
  name: 'Empty states',
  render: () => (
    <Stack gap={3}>
      <Card>
        <EmptyState
          icon={Inbox}
          title="Nothing to approve"
          description="New requests will show up here."
          className="py-1.5"
        />
      </Card>
      <Card>
        <EmptyState
          icon={SearchX}
          title="No matches for “Priyaa”"
          description="Check the spelling or search by email."
          action={
            <Button size="sm" variant="secondary">
              Clear search
            </Button>
          }
          className="py-1.5"
        />
      </Card>
      <Card>
        <EmptyState
          icon={UserPlus}
          tone="accent"
          title="Invite your team"
          description="Add people to start tracking time off."
          action={
            <Button size="sm" variant="primary">
              Invite
            </Button>
          }
          className="py-1.5"
        />
      </Card>
    </Stack>
  ),
};
