import * as TabsPrimitive from '@rn-primitives/tabs';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Platform, type LayoutChangeEvent } from 'react-native';
import { styled } from 'react-native-css';
import { ScrollView, View } from 'react-native-css/components';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { animateTo, useMotion } from '../../lib/animate.ts';
import { cn } from '../../lib/cn.ts';
import { flatStyle } from '../../lib/overlay.tsx';
import { Icon, type LucideIcon } from '../icon/icon.tsx';
import { Text } from '../text/text.tsx';

/**
 * Views of the same thing, one at a time: a person's overview, time off and
 * documents. Not steps (that is a `Stepper`) and not places in the app (that
 * is the tab bar).
 *
 * `line` underlines the selected tab and is the default. `pill` fills it, for
 * a second row of views inside a line-tabbed area or a filter strip under a
 * title: two rows of line tabs read as one broken row.
 *
 * With a hardware keyboard the arrow keys move between tabs. Automatic
 * activation opens a tab as focus reaches it; `activationMode="manual"`
 * waits for Enter or Space, for tabs whose views load slowly.
 */
export type TabsProps = {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  activationMode?: 'automatic' | 'manual';
  children?: ReactNode;
  className?: string | undefined;
};

const Root = styled(flatStyle(TabsPrimitive.Root));
const List = styled(flatStyle(TabsPrimitive.List));
const Trigger = styled(flatStyle(TabsPrimitive.Trigger));
const Content = styled(flatStyle(TabsPrimitive.Content));

const WEB = Platform.OS === 'web';

export function Tabs({
  value,
  defaultValue = '',
  onValueChange,
  activationMode = 'automatic',
  children,
  className,
}: TabsProps): React.JSX.Element {
  const [own, setOwn] = useState(defaultValue);
  const current = value ?? own;
  return (
    <Root
      value={current}
      onValueChange={(next: string) => {
        setOwn(next);
        onValueChange?.(next);
      }}
      activationMode={activationMode}
      className={cn('gap-3', className)}
    >
      {children}
    </Root>
  );
}

type Slot = { x: number; width: number };
type ListLook = {
  variant: 'line' | 'pill';
  scroll: boolean;
  /** A tab reports where it sits, so the line can slide to it. */
  place?: (value: string, slot: Slot) => void;
};
const Look = createContext<ListLook>({ variant: 'line', scroll: false });

/** The underline's inset from its tab's edges. */
const LINE_INSET = 12;

/**
 * The line under the selected tab, sliding from tab to tab on the move
 * spring as the web's indicator does. It lands where it is the first time,
 * and jumps under reduced motion. Values on the UI thread; a tab reports its
 * place only when its layout changes.
 */
function useLine(): {
  place: (value: string, slot: Slot) => void;
  line: React.JSX.Element | null;
} {
  const { value } = TabsPrimitive.useRootContext();
  const { layout } = useMotion();
  const [slots, setSlots] = useState<Partial<Record<string, Slot>>>({});
  const x = useSharedValue(0);
  const width = useSharedValue(0);
  const placed = useRef(false);
  const slot = slots[value];
  useEffect(() => {
    if (!slot) return;
    const toX = slot.x + LINE_INSET;
    const toWidth = Math.max(0, slot.width - 2 * LINE_INSET);
    if (!placed.current || !layout) {
      x.value = toX;
      width.value = toWidth;
      placed.current = true;
      return;
    }
    x.value = animateTo(toX, layout);
    width.value = animateTo(toWidth, layout);
  }, [slot, layout, x, width]);
  const style = useAnimatedStyle(() => ({
    width: width.value,
    transform: [{ translateX: x.value }],
  }));
  const place = useCallback((key: string, next: Slot) => {
    setSlots((prev) => {
      const old = prev[key];
      return old && old.x === next.x && old.width === next.width ? prev : { ...prev, [key]: next };
    });
  }, []);
  return {
    place,
    line: slot ? (
      // The slide on a bare Animated.View, the colour on a view inside it (RMB-001).
      <Animated.View
        pointerEvents="none"
        aria-hidden
        style={[{ position: 'absolute', bottom: -1, left: 0, height: 3 }, style]}
      >
        <View className="flex-1 rounded-t-[3px] bg-accent" />
      </Animated.View>
    ) : null,
  };
}

export type TabsListProps = {
  variant?: 'line' | 'pill';
  /**
   * Scroll sideways instead of sharing the width: for more tabs, or longer
   * labels, than fit. Line tabs share the width by default; pills always
   * keep their own.
   */
  scroll?: boolean;
  /** Names the set for a screen reader when nothing on screen does. */
  accessibilityLabel?: string;
  children?: ReactNode;
  className?: string | undefined;
};

export function TabsList({
  variant = 'line',
  scroll = variant === 'pill',
  accessibilityLabel,
  children,
  className,
}: TabsListProps): React.JSX.Element {
  const { place, line } = useLine();
  const list = (
    <List
      {...(accessibilityLabel ? { accessibilityLabel } : {})}
      className={cn(
        'flex-row',
        variant === 'line' ? 'border-b border-border' : 'gap-1.5',
        variant === 'line' && scroll && 'self-start',
        !scroll && className,
      )}
    >
      {children}
      {variant === 'line' ? line : null}
    </List>
  );
  return (
    <Look.Provider value={{ variant, scroll, place }}>
      {scroll ? (
        // The row bleeds to the screen's edges as it scrolls, its first tab
        // still lined up with the content.
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className={cn('-mx-m-margin grow-0', className)}
          contentContainerClassName={cn(
            'px-m-margin',
            variant === 'line' && 'min-w-full border-b border-border',
          )}
        >
          {list}
        </ScrollView>
      ) : (
        list
      )}
    </Look.Provider>
  );
}

export type TabsTriggerProps = {
  value: string;
  children: string;
  icon?: LucideIcon;
  /** A count beside the label: how many are waiting in that view. */
  count?: number;
  disabled?: boolean;
};

/**
 * Radix points a tab's `aria-controls` at its panel, and tabs are often a view
 * switch over content drawn elsewhere, with no `TabsContent` at all. A
 * reference to an element that does not exist is invalid ARIA, so it is
 * dropped while there is no panel, as the web library does.
 */
function useNoOrphanControls(): (node: unknown) => void {
  const node = useRef<{
    getAttribute: (name: string) => string | null;
    removeAttribute: (name: string) => void;
    ownerDocument: { getElementById: (id: string) => unknown };
  } | null>(null);
  useEffect(() => {
    const element = node.current;
    if (!WEB || !element) return;
    const panel = element.getAttribute('aria-controls');
    if (panel && !element.ownerDocument.getElementById(panel)) {
      element.removeAttribute('aria-controls');
    }
  });
  return (element) => {
    node.current = element as typeof node.current;
  };
}

export function TabsTrigger({
  value,
  children,
  icon,
  count,
  disabled = false,
}: TabsTriggerProps): React.JSX.Element {
  const { variant, scroll, place } = useContext(Look);
  const { value: selected } = TabsPrimitive.useRootContext();
  const on = selected === value;
  const ref = useNoOrphanControls();
  const pill = variant === 'pill';
  const tone = disabled ? 'disabled' : on ? (pill ? 'on-invert' : 'default') : 'muted';
  return (
    <Trigger
      ref={ref}
      value={value}
      disabled={disabled}
      onLayout={(event: LayoutChangeEvent) => {
        const { x, width } = event.nativeEvent.layout;
        place?.(value, { x, width });
      }}
      className={cn(
        'flex-row items-center gap-2',
        'focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-border-focus',
        pill
          ? cn('h-9 rounded-full px-3.5', on ? 'bg-invert' : 'bg-surface-sunken')
          : cn('h-12 rounded-[8px] px-3', !scroll && 'flex-1 justify-center'),
      )}
    >
      {icon ? <Icon icon={icon} size={16} tone={tone} /> : null}
      <Text variant="subhead" weight="semibold" tone={tone} numberOfLines={1}>
        {children}
      </Text>
      {count === undefined ? null : (
        <View
          className={cn(
            'h-5 min-w-5 items-center justify-center rounded-full px-1.5',
            on ? 'bg-accent' : 'bg-surface-active',
          )}
        >
          <Text
            tone={on ? 'on-accent' : 'muted'}
            weight="bold"
            tabular
            className="text-[11px] leading-5"
          >
            {String(count)}
          </Text>
        </View>
      )}
    </Trigger>
  );
}

/** One view, shown while its tab is selected. */
export function TabsContent({
  value,
  children,
  className,
}: {
  value: string;
  children?: ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <Content value={value} className={cn(className)}>
      {children}
    </Content>
  );
}
