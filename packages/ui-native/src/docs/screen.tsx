import { House, Plus, User, Users, Wallet } from 'lucide-react-native';
import { useId, useState, type ReactNode } from 'react';
import { View } from 'react-native-css/components';

import { TabBar, type TabBarItem } from '../components/app-bar/app-bar.tsx';
import { Avatar } from '../components/avatar/avatar.tsx';
import { Button } from '../components/button/button.tsx';
import { Icon } from '../components/icon/icon.tsx';
import { List, ListItem } from '../components/list-item/list-item.tsx';
import { Text } from '../components/text/text.tsx';
import { cn } from '../lib/cn.ts';
import { OverlayHost } from '../lib/overlay-host.tsx';
import { PEOPLE } from './people.ts';

/*
 * The design's phone screen for the layout stories: one screen of an app,
 * framed, with its bars composed from the library. The device's own status
 * bar is the Storybook's chrome around every story, so a screen starts at its
 * top bar.
 */

/**
 * One screen: the page's canvas, rounded and framed, with an overlay host of
 * its own so a modal page opened in it covers the screen and not the canvas.
 */
export function Screen({
  height = 560,
  className,
  children,
}: {
  height?: number;
  className?: string | undefined;
  /** The screen's content. A function receives the host's name, for a dialog's `portalHost`. */
  children: ReactNode | ((host: string) => ReactNode);
}): React.JSX.Element {
  const host = useId();
  return (
    <View
      className={cn('overflow-hidden rounded-[28px] border border-border bg-canvas', className)}
      style={{ height }}
    >
      {typeof children === 'function' ? children(host) : children}
      {/* Last, so what opens in it draws over the screen's own bars. */}
      <OverlayHost name={host} />
    </View>
  );
}

/** The screen's content under its bars: the margin, and room for the tab bar under it. */
export function ScreenBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  return <View className={cn('gap-3 px-4 pb-[90px]', className)}>{children}</View>;
}

const SECTIONS: readonly TabBarItem[] = [
  { key: 'home', label: 'Home', icon: House },
  { key: 'people', label: 'People', icon: Users },
  { key: 'pay', label: 'Pay', icon: Wallet },
  { key: 'me', label: 'Me', icon: User },
];

/** The floating tab bar over the bottom of a screen, a real one. */
export function ScreenTabBar({ initial = 'people' }: { initial?: string }): React.JSX.Element {
  const [section, setSection] = useState(initial);
  return (
    <View className="absolute inset-x-2.5 bottom-3">
      <TabBar items={SECTIONS} value={section} onValueChange={setSection} />
    </View>
  );
}

/** The top bar's one action: add. */
export function AddButton({ label = 'Add a person' }: { label?: string }): React.JSX.Element {
  return (
    <Button
      size="xs"
      variant="secondary"
      startIcon={<Icon icon={Plus} />}
      accessibilityLabel={label}
    />
  );
}

/** The design's list of people: a row each, pressable, a chevron at the end. */
export function PeopleList({
  count = 5,
  onOpen,
  chevron = true,
}: {
  count?: number;
  onOpen?: (name: string) => void;
  chevron?: boolean;
}): React.JSX.Element {
  return (
    <List>
      {PEOPLE.slice(0, count).map((person) => (
        <ListItem
          key={person.name}
          leading={<Avatar name={person.name} size={36} decorative />}
          description={person.role}
          chevron={chevron}
          onPress={() => {
            onOpen?.(person.name);
          }}
        >
          {person.name}
        </ListItem>
      ))}
    </List>
  );
}

/** A caption on a layout story: what the screen shows. */
export function ScreenNote({ children }: { children: string }): React.JSX.Element {
  return (
    <Text variant="subhead" tone="muted" className="leading-[1.5]">
      {children}
    </Text>
  );
}
