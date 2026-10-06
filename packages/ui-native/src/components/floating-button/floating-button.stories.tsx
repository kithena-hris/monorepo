import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import {
  ArrowRight,
  Calendar,
  House,
  Plus,
  Receipt,
  Sparkles,
  Trash2,
  User,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, View } from 'react-native-css/components';

import { designDocs, designNote } from '../../docs/design.ts';
import { Stage } from '../../docs/stage.tsx';
import { Button } from '../button/button.tsx';
import { Card } from '../card/card.tsx';
import { Icon } from '../icon/icon.tsx';
import { Inline, Stack } from '../layout/layout.tsx';
import { List, ListItem } from '../list-item/list-item.tsx';
import { Text } from '../text/text.tsx';
import { TabBar, type TabBarItem } from '../app-bar/app-bar.tsx';
import { FloatingButton, SpeedDial, useCollapseOnScroll } from './floating-button.tsx';

const meta = {
  title: 'Components/Floating button',
  component: FloatingButton,
  parameters: designDocs('floating-button'),
  args: { accessibilityLabel: 'New request' },
} satisfies Meta<typeof FloatingButton>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = (): void => undefined;

/** A caption under an example, the design's note. */
function Caption({ children }: { children: string }): React.JSX.Element {
  return (
    <Text variant="subhead" tone="muted" className="leading-[1.5]">
      {children}
    </Text>
  );
}

export const Playground: Story = {
  render: (args) => (
    <Inline>
      <FloatingButton {...args} />
    </Inline>
  ),
};

export const Sizes: Story = {
  render: () => (
    <Inline gap={6} align="end">
      {(
        [
          ['sm', 'Small · 40'],
          ['md', 'Regular · 56'],
          ['lg', 'Large · 96'],
        ] as const
      ).map(([size, caption]) => (
        <Stack key={size} gap={2} align="center">
          <FloatingButton size={size} accessibilityLabel="New request" />
          <Caption>{caption}</Caption>
        </Stack>
      ))}
    </Inline>
  ),
};

export const Extended: Story = {
  render: () => (
    <Stack gap={3} align="start">
      <FloatingButton label="New request" />
      <FloatingButton label="Ask Reach" icon={Sparkles} variant="invert" />
    </Stack>
  ),
};

export const Colours: Story = {
  render: () => (
    <Inline gap={3} className="gap-3.5">
      <FloatingButton accessibilityLabel="New request" />
      <FloatingButton variant="tinted" accessibilityLabel="New request" />
      <FloatingButton variant="surface" accessibilityLabel="New request" />
      <FloatingButton variant="invert" accessibilityLabel="New request" />
    </Inline>
  ),
};

export const Shapes: Story = {
  render: () => (
    <Inline gap={6}>
      <Stack gap={2} align="center">
        <FloatingButton shape="circle" accessibilityLabel="New request" />
        <Caption>Circle · default</Caption>
      </Stack>
      <Stack gap={2} align="center">
        <FloatingButton shape="rounded" accessibilityLabel="New request" />
        <Caption>Rounded square</Caption>
      </Stack>
    </Inline>
  ),
};

export const ShrinksAsYouScroll: Story = {
  name: 'Shrinks as you scroll',
  parameters: designNote('floating-button', 'Shrinks as you scroll'),
  render: () => (
    <Inline gap={4} className="gap-[18px]">
      <Stack gap={2} align="center">
        <FloatingButton label="New request" />
        <Caption>At rest</Caption>
      </Stack>
      <Icon icon={ArrowRight} tone="subtle" />
      <Stack gap={2} align="center">
        <FloatingButton label="New request" collapsed />
        <Caption>Scrolling down</Caption>
      </Stack>
    </Inline>
  ),
};

export const SpeedDialStory: Story = {
  name: 'Speed dial',
  parameters: designNote('floating-button', 'Speed dial'),
  render: () => (
    <Stage height={440}>
      {(host) => (
        <SpeedDial
          defaultOpen
          portalHost={host}
          placement={{ right: 20, bottom: 20 }}
          accessibilityLabel="Create"
          actions={[
            { label: 'Time off', icon: Calendar, onPress: noop },
            { label: 'Expense', icon: Receipt, onPress: noop },
            { label: 'Invite person', icon: UserPlus, onPress: noop },
          ]}
        />
      )}
    </Stage>
  ),
};

const REQUESTS = ['Vacation · 14–18 Oct', 'Sick · 2 Sep', 'Vacation · 5–9 Aug'];
const TABS: TabBarItem[] = [
  { key: 'home', label: 'Home', icon: House },
  { key: 'people', label: 'People', icon: Users },
  { key: 'pay', label: 'Pay', icon: Wallet },
  { key: 'me', label: 'Me', icon: User },
];

/** The app's tab bar, floating at the bottom of the screen. */
function Tabs(): React.JSX.Element {
  const [section, setSection] = useState('home');
  return (
    <View className="absolute inset-x-2 bottom-2">
      <TabBar items={TABS} value={section} onValueChange={setSection} />
    </View>
  );
}

export const InContext: Story = {
  name: 'In context',
  render: function InContextStory() {
    const { collapsed, onScroll } = useCollapseOnScroll();
    return (
      <View className="h-[560px] overflow-hidden rounded-[28px] border border-border bg-canvas">
        <ScrollView onScroll={onScroll} scrollEventThrottle={16}>
          <View className="h-11 flex-row items-center justify-end px-3">
            <Button
              variant="secondary"
              size="xs"
              startIcon={<Icon icon={Plus} />}
              accessibilityLabel="Add"
            />
          </View>
          <Text variant="large" className="px-4 pb-2.5">
            Time off
          </Text>
          <View className="gap-3 px-4 pb-[90px]">
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
            <List>
              {REQUESTS.map((request) => (
                <ListItem
                  key={request}
                  leading={<Icon icon={Calendar} size={18} tone="muted" />}
                  description="Approved"
                  className="min-h-14"
                >
                  {request}
                </ListItem>
              ))}
            </List>
          </View>
        </ScrollView>
        <Tabs />
        <View className="absolute bottom-[88px] right-4">
          <FloatingButton label="New request" collapsed={collapsed} />
        </View>
      </View>
    );
  },
};

export const Dont: Story = {
  name: 'Don’t',
  render: () => (
    <View className="flex-row gap-2.5">
      <Card className="flex-1 gap-2 p-3.5">
        <Inline gap={2}>
          <FloatingButton size="sm" accessibilityLabel="New request" />
          <FloatingButton size="sm" icon={Sparkles} accessibilityLabel="Ask Reach" />
        </Inline>
        <Text weight="semibold" className="text-[14px]">
          Two floating buttons
        </Text>
        <Text tone="danger" weight="semibold" className="text-[12px] leading-none">
          Pick one
        </Text>
      </Card>
      <Card className="flex-1 gap-2 p-3.5">
        {/* Deliberately not a FloatingButton: it has no danger colour, and this is why. */}
        <View className="size-10 items-center justify-center rounded-full bg-danger-solid shadow-lg">
          <Icon icon={Trash2} size={18} tone="on-accent" label="Delete" />
        </View>
        <Text weight="semibold" className="text-[14px]">
          Destructive action
        </Text>
        <Text tone="danger" weight="semibold" className="text-[12px] leading-none">
          Never float delete
        </Text>
      </Card>
    </View>
  ),
};
