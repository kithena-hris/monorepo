import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { MessageSquare, PanelTop, Sparkles, SquareDashed, Wrench } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native-css/components';

import { designDocs, designNote } from '../../docs/design.ts';
import { Avatar } from '../avatar/avatar.tsx';
import { Badge } from '../badge/badge.tsx';
import { Button } from '../button/button.tsx';
import { Card } from '../card/card.tsx';
import { Skeleton } from '../feedback/feedback.tsx';
import { Icon } from '../icon/icon.tsx';
import { Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { Banner, BannerStack } from './banner.tsx';

const meta = {
  title: 'Components/Banner',
  component: Banner,
  parameters: designDocs('banner'),
  args: { tone: 'warning', title: 'Payroll closes tomorrow at 17:00.' },
} satisfies Meta<typeof Banner>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = (): void => undefined;

/** A link-style action in a banner: underlined, 14, in the banner's ink. */
function BannerLink({ children }: { children: string }): React.JSX.Element {
  return (
    <Button variant="link" size="xs" onPress={noop}>
      {children}
    </Button>
  );
}

/** A phone's home screen with the banner across its top, the design's frame. */
function OnAScreen({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <View className="overflow-hidden rounded-[28px] border border-border bg-canvas">
      {children}
      <View className="h-11 flex-row items-center justify-end px-3">
        <Avatar name="Priya Shah" size={32} decorative />
      </View>
      <Text variant="large" className="px-4 pb-2.5">
        Home
      </Text>
      <View className="gap-2.5 px-4 pb-5">
        <Card className="gap-1.5">
          <Text variant="subhead" tone="muted" weight="medium">
            Vacation left
          </Text>
          <Text className="text-[30px] font-bold leading-[1.05] tabular-nums">
            14.5
            <Text tone="muted" className="text-[15px]">
              {' days'}
            </Text>
          </Text>
        </Card>
        <Skeleton className="h-[70px] w-full rounded-[18px]" />
      </View>
    </View>
  );
}

export const Playground: Story = {
  render: function PlaygroundStory() {
    const [shown, setShown] = useState(true);
    return (
      <OnAScreen>
        {shown ? (
          <Banner
            tone="warning"
            title="Payroll closes tomorrow at 17:00."
            actions={<BannerLink>Review</BannerLink>}
            onDismiss={() => {
              setShown(false);
            }}
          >
            Submit expenses before then.
          </Banner>
        ) : null}
      </OnAScreen>
    );
  },
};

export const Tones: Story = {
  render: () => (
    <Stack gap={2}>
      <Banner rounded tone="info" title="Heads up.">
        Your manager changes on 1 Nov.
      </Banner>
      <Banner rounded tone="success" title="All payslips sent.">
        312 people were paid.
      </Banner>
      <Banner rounded tone="warning" title="2 contracts expire soon.">
        Renew them before 12 Oct.
      </Banner>
      <Banner rounded tone="danger" title="Payroll failed for 3 people.">
        Their bank details are missing.
      </Banner>
      <Banner rounded tone="accent" title="New:">
        You can now export the org chart.
      </Banner>
      <Banner rounded tone="neutral" title="Scheduled maintenance.">
        Sunday 02:00–04:00 CET.
      </Banner>
    </Stack>
  ),
};

export const CriticalSolid: Story = {
  name: 'Critical, solid',
  render: () => (
    <Banner
      rounded
      tone="danger"
      emphasis="solid"
      title="Payroll failed for 3 people."
      actions={
        <Button size="xs" variant="invert">
          Fix now
        </Button>
      }
    >
      They won’t be paid until you fix it.
    </Banner>
  ),
};

export const WithActions: Story = {
  name: 'With actions',
  render: () => (
    <Banner
      rounded
      tone="warning"
      title="Your trial ends in 5 days."
      onDismiss={noop}
      actions={
        <>
          <Button size="xs" variant="primary">
            Add payment
          </Button>
          <Button size="xs" variant="ghost">
            Later
          </Button>
        </>
      }
    >
      Add a payment method to keep your data.
    </Banner>
  ),
};

export const MaintenanceCountdown: Story = {
  name: 'Maintenance countdown',
  render: () => (
    <Banner
      rounded
      emphasis="invert"
      icon={Wrench}
      title="Reach is read-only in 14 min."
      actions={
        <Button size="xs" variant="on-invert">
          Details
        </Button>
      }
    >
      Maintenance from 02:00 to 04:00 CET.
    </Banner>
  ),
};

export const Announcement: Story = {
  render: () => (
    <Banner
      rounded
      tone="accent"
      icon={Sparkles}
      title="Org chart export is here."
      onDismiss={noop}
      actions={
        <>
          <Badge tone="accent" variant="solid" size="sm">
            New
          </Badge>
          <BannerLink>Try it</BannerLink>
        </>
      }
    >
      Download any chart as a PDF or PNG.
    </Banner>
  ),
};

export const WhenThereAreSeveral: Story = {
  name: 'When there are several',
  render: () => (
    <Stack gap={2} className="gap-2.5">
      <BannerStack>
        <Banner rounded tone="warning" title="2 contracts expire soon." onDismiss={noop}>
          Renew them before 12 Oct.
        </Banner>
        <Banner rounded tone="info" title="Heads up.">
          Your manager changes on 1 Nov.
        </Banner>
        <Banner rounded tone="neutral" title="Scheduled maintenance.">
          Sunday 02:00–04:00 CET.
        </Banner>
      </BannerStack>
      <Text variant="subhead" tone="muted" className="leading-[1.5]">
        Only one banner at a time. The most severe comes first, and the rest page behind it.
      </Text>
    </Stack>
  ),
};

const KINDS = [
  ['Banner', 'Whole app or account. Stays until it’s fixed or dismissed.', PanelTop],
  ['Alert', 'One section of a page. Sits next to what it’s about.', SquareDashed],
  ['Toast', 'Confirms something you just did. Goes away on its own.', MessageSquare],
] as const;

export const BannerAlertOrToast: Story = {
  name: 'Banner, alert or toast?',
  render: () => (
    <Stack gap={2} className="gap-2.5">
      {KINDS.map(([title, description, icon]) => (
        <Card key={title} className="gap-2 p-3.5">
          <Icon icon={icon} tone="accent" />
          <Text weight="semibold" className="leading-[1.4]">
            {title}
          </Text>
          <Text variant="subhead" tone="muted" className="leading-[1.5]">
            {description}
          </Text>
        </Card>
      ))}
    </Stack>
  ),
};

export const OnThePage: Story = {
  name: 'On the page',
  parameters: designNote('banner', 'On the page'),
  render: () => (
    <OnAScreen>
      <Banner
        tone="info"
        title="Your manager changes on 1 Nov."
        onDismiss={noop}
        actions={<BannerLink>See who</BannerLink>}
      />
    </OnAScreen>
  ),
};
