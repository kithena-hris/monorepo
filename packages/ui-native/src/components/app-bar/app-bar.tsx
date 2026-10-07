import { ArrowLeft, ChevronLeft, type LucideIcon } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Pressable, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { usePlatform } from '../../provider.tsx';
import { Badge } from '../badge/badge.tsx';
import { Icon } from '../icon/icon.tsx';
import { Text } from '../text/text.tsx';

/*
 * The bars above and below a phone's content: the app bar with its large
 * title, the selection bar that replaces it, the floating tab bar for the
 * top-level sections, and the rail a tablet uses instead.
 *
 * One look, the design's, with Android's own conventions where they are
 * clear: a back arrow without a label, and a compact title set at the start
 * rather than centred. `ReachProvider`'s `platform` decides, never the OS
 * directly, so the Storybook shows both.
 */

/** The hairline glass a bar turns to once content scrolls under it. */
const glass = 'border-b border-glass-line bg-glass backdrop-blur-xl';

export type AppBarBack = {
  /** Where back goes: the previous screen's title, "People". */
  label: string;
  onPress: () => void;
};

export type AppBarProps = {
  /**
   * The screen's title in the bar. With a `LargeTitle` under the bar, leave
   * it out until the large one scrolls away (`scrolled`), as iOS does.
   */
  title?: string;
  back?: AppBarBack;
  /** Controls at the start, when there is no back. */
  leading?: ReactNode;
  /** Controls at the end: one or two icon buttons. */
  trailing?: ReactNode;
  /** Content is under the bar: it turns to glass with a hairline. */
  scrolled?: boolean;
  className?: string | undefined;
};

/** The bar at the top of a screen: back, the title, and a control or two. */
export function AppBar({
  title,
  back,
  leading,
  trailing,
  scrolled = false,
  className,
}: AppBarProps): React.JSX.Element {
  const android = usePlatform() === 'android';
  const backButton = back ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Back to ${back.label}`}
      onPress={back.onPress}
      className="min-h-m-tap flex-row items-center gap-0.5 pr-1"
    >
      <Icon icon={android ? ArrowLeft : ChevronLeft} size={android ? 24 : 22} tone="accent" />
      {android ? null : (
        <Text tone="accent" numberOfLines={1}>
          {back.label}
        </Text>
      )}
    </Pressable>
  ) : (
    leading
  );
  const heading = title ? (
    <Text
      accessibilityRole="header"
      weight="semibold"
      numberOfLines={1}
      className={cn(android ? 'flex-1' : 'text-center')}
    >
      {title}
    </Text>
  ) : null;
  return (
    <View
      className={cn(
        // 44 under a large title, as the design's navigation bar; 48 with its own.
        title ? 'h-12' : 'h-m-navbar',
        'flex-row items-center gap-2 px-3',
        scrolled ? glass : 'border-b border-transparent',
        className,
      )}
    >
      {android ? (
        <>
          {backButton}
          {heading ?? <View className="flex-1" />}
          {trailing ? <View className="flex-row items-center gap-1">{trailing}</View> : null}
        </>
      ) : (
        // Back and the controls share the width either side, so the title is
        // centred on the screen, not between them.
        <>
          <View className="min-w-0 flex-1 flex-row items-center">{backButton}</View>
          {heading}
          <View className="min-w-0 flex-1 flex-row items-center justify-end gap-1">{trailing}</View>
        </>
      )}
    </View>
  );
}

/** The large title at the top of a screen's content, which scrolls away under the bar. */
export function LargeTitle({
  children,
  className,
}: {
  children: string;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <Text accessibilityRole="header" variant="large" className={cn('px-4 pb-3.5', className)}>
      {children}
    </Text>
  );
}

/**
 * Whether content has scrolled under the bar, for `AppBar`'s `scrolled` and
 * for showing the compact title once the large one has gone.
 */
export function useAppBarScroll(threshold = 1): {
  scrolled: boolean;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
} {
  const [scrolled, setScrolled] = useState(false);
  return {
    scrolled,
    onScroll: (event) => {
      const next = event.nativeEvent.contentOffset.y >= threshold;
      if (next !== scrolled) setScrolled(next);
    },
  };
}

export type SelectionBarProps = {
  /** "3 selected". */
  label: string;
  onCancel: () => void;
  onSelectAll?: () => void;
  cancelLabel?: string;
  selectAllLabel?: string;
  className?: string | undefined;
};

/** What the app bar becomes while rows are being selected. */
export function SelectionBar({
  label,
  onCancel,
  onSelectAll,
  cancelLabel = 'Cancel',
  selectAllLabel = 'All',
  className,
}: SelectionBarProps): React.JSX.Element {
  return (
    <View className={cn('h-[52px] flex-row items-center gap-2 bg-accent-subtle px-3', className)}>
      <View className="flex-1 flex-row">
        <Pressable
          accessibilityRole="button"
          onPress={onCancel}
          className="min-h-m-tap justify-center"
        >
          <Text tone="accent">{cancelLabel}</Text>
        </Pressable>
      </View>
      {/* The count is read out as it changes. */}
      <View accessibilityLiveRegion="polite" {...({ 'aria-live': 'polite' } as object)}>
        <Text accessibilityRole="header" weight="semibold">
          {label}
        </Text>
      </View>
      <View className="flex-1 flex-row justify-end">
        {onSelectAll ? (
          <Pressable
            accessibilityRole="button"
            onPress={onSelectAll}
            className="min-h-m-tap justify-center"
          >
            <Text tone="accent" weight="semibold">
              {selectAllLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export type TabBarItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  /** A count on the icon: what is waiting there. */
  badge?: number;
};

export type TabBarProps = {
  items: readonly TabBarItem[];
  value: string;
  onValueChange: (key: string) => void;
  /** Names the bar for a screen reader. */
  label?: string;
  className?: string | undefined;
};

function count(n: number): string {
  return n > 99 ? '99+' : String(n);
}

/**
 * The top-level sections, at the bottom where the thumb is: a floating
 * glass pill, three to five items. On Android the selection is a pill behind
 * the icon only, as Material's navigation bar draws it.
 */
export function TabBar({
  items,
  value,
  onValueChange,
  label = 'Sections',
  className,
}: TabBarProps): React.JSX.Element {
  const android = usePlatform() === 'android';
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      className={cn(
        'h-m-tabbar flex-row items-center rounded-full border border-glass-line bg-glass px-1.5 shadow-md backdrop-blur-xl',
        className,
      )}
    >
      {items.map((item) => {
        const on = item.key === value;
        const tone = on ? 'accent' : 'muted';
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            aria-selected={on}
            accessibilityLabel={item.badge ? `${item.label}, ${count(item.badge)} new` : item.label}
            onPress={() => {
              onValueChange(item.key);
            }}
            className={cn(
              'h-[52px] flex-1 items-center justify-center gap-[3px] rounded-full',
              on && !android && 'bg-accent-subtle',
            )}
          >
            <View
              className={cn(
                'items-center justify-center',
                android && 'h-7 w-14 rounded-full',
                android && on && 'bg-accent-subtle',
              )}
            >
              <Icon icon={item.icon} size={20} tone={tone} />
              {item.badge ? (
                <View className="absolute -top-1 left-1/2 ml-1">
                  <Badge
                    size="xs"
                    tone="danger"
                    variant="solid"
                    className="border-2 border-surface"
                  >
                    {count(item.badge)}
                  </Badge>
                </View>
              ) : null}
            </View>
            <Text tone={tone} weight="semibold" className="text-[10px] leading-none">
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export type NavigationRailProps = TabBarProps & {
  /** At the top: the product's mark. */
  header?: ReactNode;
};

/** The tab bar's place on a tablet: a rail down the side. */
export function NavigationRail({
  items,
  value,
  onValueChange,
  label = 'Sections',
  header,
  className,
}: NavigationRailProps): React.JSX.Element {
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      className={cn('w-[72px] items-center gap-2 bg-surface py-3', className)}
    >
      {header}
      {items.map((item) => {
        const on = item.key === value;
        const tone = on ? 'accent' : 'muted';
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            aria-selected={on}
            accessibilityLabel={item.label}
            onPress={() => {
              onValueChange(item.key);
            }}
            className="min-h-m-tap items-center gap-1"
          >
            <View
              className={cn(
                'h-8 w-[52px] items-center justify-center rounded-full',
                on && 'bg-accent-subtle',
              )}
            >
              <Icon icon={item.icon} size={20} tone={tone} />
            </View>
            <Text tone={tone} weight="semibold" className="text-[10px] leading-none">
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
