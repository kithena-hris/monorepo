import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Calendar, Ellipsis, House, Plus, Search, User, Users, Wallet } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native-css/components';

import { ReachMark } from '../../brand/reach-logo.tsx';
import { designDocs, designNote } from '../../docs/design.ts';
import { PEOPLE } from '../../docs/people.ts';
import { Avatar } from '../avatar/avatar.tsx';
import { Button } from '../button/button.tsx';
import { Skeleton } from '../feedback/feedback.tsx';
import { Icon } from '../icon/icon.tsx';
import { Input } from '../input/input.tsx';
import { Text } from '../text/text.tsx';
import {
  AppBar,
  LargeTitle,
  NavigationRail,
  SelectionBar,
  TabBar,
  type NavItem,
} from './app-bar.tsx';

const meta = {
  title: 'Components/App bars',
  component: AppBar,
  parameters: designDocs('app-bars'),
} satisfies Meta<typeof AppBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The top of a screen, framed as the design frames it. */
function Screen({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <View className={`overflow-hidden rounded-[20px] border border-border ${className ?? ''}`}>
      {children}
    </View>
  );
}

const add = (
  <Button
    size="xs"
    variant="secondary"
    startIcon={<Icon icon={Plus} />}
    accessibilityLabel="Add a person"
  />
);

export const LargeTitleStory: Story = {
  name: 'Large title',
  render: () => (
    <Screen>
      <AppBar trailing={add} />
      <LargeTitle>People</LargeTitle>
    </Screen>
  ),
};

export const CompactWithBack: Story = {
  name: 'Compact, with back',
  render: () => (
    <Screen>
      <AppBar
        scrolled
        title="Priya Shah"
        back={{ label: 'People', onPress: () => undefined }}
        trailing={
          <Button
            size="xs"
            variant="ghost"
            startIcon={<Icon icon={Ellipsis} />}
            accessibilityLabel="More"
          />
        }
        className="border-b-0"
      />
    </Screen>
  ),
};

export const WithSearch: Story = {
  name: 'With search',
  render: () => (
    <Screen className="pt-3">
      <LargeTitle className="pb-1.5">People</LargeTitle>
      <View className="px-4 pt-1.5 pb-3.5">
        <Input
          size="sm"
          accessibilityLabel="Search people"
          placeholder="Search 312 people"
          startAdornment={<Icon icon={Search} size={18} tone="muted" />}
        />
      </View>
    </Screen>
  ),
};

export const SelectionMode: Story = {
  name: 'Selection mode',
  render: function SelectionStory() {
    const [selected, setSelected] = useState(3);
    return (
      <Screen>
        <SelectionBar
          label={`${String(selected)} selected`}
          onCancel={() => {
            setSelected(0);
          }}
          onSelectAll={() => {
            setSelected(PEOPLE.length);
          }}
        />
      </Screen>
    );
  },
};

export const GlassOnScroll: Story = {
  name: 'Glass on scroll',
  parameters: designNote('app-bars', 'Glass on scroll'),
  render: () => (
    // The list starts under the bar, as it is once scrolled: the bar is glass.
    <Screen className="h-[200px]">
      <ScrollView contentContainerClassName="gap-2 px-6 pt-[30px] pb-4">
        {PEOPLE.slice(0, 4).map((person) => (
          <Pressable
            key={person.name}
            accessibilityRole="button"
            accessibilityLabel={person.name}
            className="h-12 flex-row items-center gap-3 border-b border-border px-2"
          >
            <Avatar name={person.name} size={32} decorative />
            <Text weight="semibold">{person.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View className="absolute inset-x-0 top-0">
        <AppBar scrolled title="People" />
      </View>
    </Screen>
  ),
};

const SECTIONS: NavItem[] = [
  { key: 'home', label: 'Home', icon: House },
  { key: 'people', label: 'People', icon: Users },
  { key: 'time-off', label: 'Time off', icon: Calendar },
  { key: 'pay', label: 'Pay', icon: Wallet },
  { key: 'me', label: 'Me', icon: User },
];

/** Where a tab bar floats: over the bottom of the page. */
function Dock({ children }: { children: ReactNode }): React.JSX.Element {
  return <View className="rounded-[20px] bg-surface-sunken px-2 py-5">{children}</View>;
}

export const TabBarStory: Story = {
  name: 'Tab bar',
  render: function TabBarDemo() {
    const [section, setSection] = useState('people');
    return (
      <Dock>
        <TabBar items={SECTIONS} value={section} onValueChange={setSection} />
      </Dock>
    );
  },
};

export const TabBarWithBadges: Story = {
  name: 'Tab bar with badges',
  render: function BadgesDemo() {
    const [section, setSection] = useState('home');
    return (
      <Dock>
        <TabBar
          items={SECTIONS.map((item) =>
            item.key === 'time-off'
              ? { ...item, badge: 3 }
              : item.key === 'pay'
                ? { ...item, badge: 1 }
                : item,
          )}
          value={section}
          onValueChange={setSection}
        />
      </Dock>
    );
  },
};

export const OnATablet: Story = {
  name: 'On a tablet: the rail',
  render: function RailDemo() {
    const [section, setSection] = useState('people');
    return (
      <Screen className="h-[300px] flex-row">
        <NavigationRail
          header={<ReachMark size={28} tile />}
          items={[
            { key: 'home', label: 'Home', icon: House },
            { key: 'people', label: 'People', icon: Users },
            { key: 'leave', label: 'Leave', icon: Calendar },
            { key: 'pay', label: 'Pay', icon: Wallet },
          ]}
          value={section}
          onValueChange={setSection}
        />
        <View className="flex-1 gap-2 p-4">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-[60px] rounded-[12px]" />
        </View>
      </Screen>
    );
  },
};
