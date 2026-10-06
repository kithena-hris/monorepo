import * as DialogPrimitive from '@rn-primitives/dialog';
import { cva } from 'class-variance-authority';
import { Plus, X } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { styled } from 'react-native-css';
import { Pressable, Text as CssText, View } from 'react-native-css/components';
import Animated from 'react-native-reanimated';

import { useLayoutTransition, usePress } from '../../lib/animate.ts';
import { cn } from '../../lib/cn.ts';
import { useOverlayContainer } from '../../lib/overlay-host.tsx';
import { flatStyle, InertOutside, usePresence } from '../../lib/overlay.tsx';
import { usePlatform } from '../../provider.tsx';
import { BackGuard } from '../dialog/dialog.tsx';
import { Icon, type IconProps, type LucideIcon } from '../icon/icon.tsx';

/*
 * The mobile design's floating button: 40, 56 or 96 across, the icon 18, 24
 * or 36, a label 16 (14 on the small one) padded 18 before and 22 after, and
 * the third shadow. A circle by default; a rounded square takes 30% of its
 * side as the radius.
 */
const fab = cva('flex-row items-center shadow-lg', {
  variants: {
    variant: {
      primary: 'bg-accent-solid',
      tinted: 'bg-accent-subtle',
      surface: 'bg-surface-raised',
      invert: 'bg-invert',
    },
    size: { sm: 'h-10 gap-2.5', md: 'h-14 gap-2.5', lg: 'h-24 gap-2.5' },
    shape: { circle: 'rounded-full', rounded: '' },
    extended: { true: '', false: 'justify-center' },
    pressed: { true: '', false: '' },
  },
  compoundVariants: [
    { extended: false, size: 'sm', class: 'w-10' },
    { extended: false, size: 'md', class: 'w-14' },
    { extended: false, size: 'lg', class: 'w-24' },
    { extended: true, size: 'sm', class: 'pl-3 pr-4' },
    { extended: true, size: ['md', 'lg'], class: 'pl-[18px] pr-[22px]' },
    { shape: 'rounded', size: 'sm', class: 'rounded-[12px]' },
    { shape: 'rounded', size: 'md', class: 'rounded-[17px]' },
    { shape: 'rounded', size: 'lg', class: 'rounded-[29px]' },
    { pressed: true, variant: 'primary', class: 'bg-accent-active' },
    { pressed: true, variant: 'tinted', class: 'bg-accent-subtle-hover' },
    { pressed: true, variant: 'surface', class: 'bg-surface-hover' },
    { pressed: true, variant: 'invert', class: 'opacity-90' },
  ],
});

type Variant = 'primary' | 'tinted' | 'surface' | 'invert';
type Size = 'sm' | 'md' | 'lg';

const ink = {
  primary: ['text-fg-on-accent', 'on-accent'],
  tinted: ['text-accent-fg', 'accent'],
  surface: ['text-accent-fg', 'accent'],
  invert: ['text-fg-on-invert', 'on-invert'],
} as const satisfies Record<Variant, readonly [string, NonNullable<IconProps['tone']>]>;

const ICON = { sm: 18, md: 24, lg: 36 } as const;
const SIDE = { sm: 40, md: 56, lg: 96 } as const;
const TAP = 44;

export type FloatingButtonProps = {
  /** Leave it out for the icon alone; it is then the button's name. */
  label?: string;
  /** Defaults to a plus. */
  icon?: LucideIcon;
  /** Required when there is no label. */
  accessibilityLabel?: string;
  onPress?: () => void;
  /** `primary` by default. Never a danger colour: nothing destructive floats. */
  variant?: Variant;
  size?: Size;
  /**
   * A circle on iOS, as the design draws it; a rounded square on Android,
   * Material's floating action button. Set it to have one shape everywhere.
   */
  shape?: 'circle' | 'rounded';
  /**
   * Folds the label away, leaving the icon: while the page scrolls down.
   * `useCollapseOnScroll` gives the value. The name stays the label.
   */
  collapsed?: boolean;
  /** Read by a screen reader with the button, such as "expanded". */
  accessibilityState?: { expanded?: boolean };
  className?: string | undefined;
};

/**
 * The one most important action on a screen, floating above the content and
 * the tab bar. One per screen, never destructive. The parent pins it; it
 * draws only the button.
 */
export function FloatingButton({
  label,
  icon = Plus,
  accessibilityLabel,
  onPress,
  variant = 'primary',
  size = 'md',
  shape: chosen,
  collapsed = false,
  accessibilityState,
  className,
}: FloatingButtonProps): React.JSX.Element {
  const press = usePress();
  const layout = useLayoutTransition();
  const platform = usePlatform();
  const shape = chosen ?? (platform === 'android' ? 'rounded' : 'circle');
  const extended = Boolean(label) && !collapsed;
  const [text, tone] = ink[variant];
  const slop = Math.max(0, (TAP - SIDE[size]) / 2);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      {...(accessibilityState ? { accessibilityState } : {})}
      hitSlop={slop}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      className={cn(shape === 'circle' && 'rounded-full', className)}
    >
      {/* The scale and the width change on bare Animated.Views, the classes inside (RMB-001). */}
      <Animated.View style={press.style}>
        <Animated.View {...(layout ? { layout } : {})}>
          <View className={fab({ variant, size, shape, extended, pressed: press.pressed })}>
            <Icon icon={icon} size={ICON[size]} tone={tone} />
            {extended ? (
              <CssText
                numberOfLines={1}
                className={cn(
                  'font-semibold leading-none',
                  size === 'sm' ? 'text-[14px]' : 'text-[16px]',
                  text,
                )}
              >
                {label}
              </CssText>
            ) : null}
          </View>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

/** How far the page must travel one way before the label changes, so a jitter does nothing. */
const SCROLL_SLACK = 8;

/**
 * The extended button's label folds while the page scrolls down and returns
 * as soon as it scrolls up. Pass `onScroll` to the scroll view (with a
 * `scrollEventThrottle` of 16) and `collapsed` to the button.
 */
export function useCollapseOnScroll(): {
  collapsed: boolean;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
} {
  const [collapsed, setCollapsed] = useState(false);
  const last = useRef(0);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = Math.max(0, event.nativeEvent.contentOffset.y);
    const delta = y - last.current;
    if (Math.abs(delta) < SCROLL_SLACK) return;
    last.current = y;
    setCollapsed(delta > 0 && y > 0);
  }, []);
  return { collapsed, onScroll };
}

const Overlay = styled(flatStyle(DialogPrimitive.Overlay));
const Content = styled(flatStyle(DialogPrimitive.Content));
const Title = styled(flatStyle(DialogPrimitive.Title));

export type SpeedDialAction = {
  label: string;
  icon: LucideIcon;
  onPress: () => void;
};

export type SpeedDialProps = {
  /** Three at most, nearest the button first in reading order from the top. */
  actions: readonly SpeedDialAction[];
  /** The closed button's name, and the open menu's: "Create". */
  accessibilityLabel: string;
  closeLabel?: string;
  icon?: LucideIcon;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Where the button is pinned in its parent, in points from the bottom-right
   * corner. The open menu draws in the overlay host at the same place, so the
   * host must cover the same region as the parent: the screen, as the root
   * host does.
   */
  placement?: { right: number; bottom: number };
  /** Draw the open menu in a named `OverlayHost` instead of the root one. */
  portalHost?: string;
};

/**
 * A floating button that opens up to three related actions above it, over a
 * scrim. Tapping the scrim, the close button, Escape or the back button
 * closes it; choosing an action closes it and runs the action.
 */
export function SpeedDial({
  actions,
  accessibilityLabel,
  closeLabel = 'Close',
  icon = Plus,
  open: controlled,
  defaultOpen = false,
  onOpenChange,
  placement = { right: 16, bottom: 16 },
  portalHost,
}: SpeedDialProps): React.JSX.Element {
  const [own, setOwn] = useState(defaultOpen);
  const open = controlled ?? own;
  const setOpen = (next: boolean): void => {
    setOwn(next);
    onOpenChange?.(next);
  };
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      {/* While open, the menu's close button takes this one's place. */}
      <View
        className={cn('absolute', open && 'opacity-0')}
        style={placement}
        {...(open ? { importantForAccessibility: 'no-hide-descendants' as const } : {})}
      >
        <FloatingButton
          icon={icon}
          accessibilityLabel={accessibilityLabel}
          accessibilityState={{ expanded: open }}
          onPress={() => {
            setOpen(true);
          }}
        />
      </View>
      <SpeedDialMenu
        actions={actions}
        title={accessibilityLabel}
        closeLabel={closeLabel}
        placement={placement}
        portalHost={portalHost}
      />
    </DialogPrimitive.Root>
  );
}

const HIDDEN = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  opacity: 0,
} as const;

function SpeedDialMenu({
  actions,
  title,
  closeLabel,
  placement,
  portalHost,
}: {
  actions: readonly SpeedDialAction[];
  title: string;
  closeLabel: string;
  placement: { right: number; bottom: number };
  portalHost: string | undefined;
}): React.JSX.Element | null {
  const { open, onOpenChange } = DialogPrimitive.useRootContext();
  const presence = usePresence(open, 'top');
  const container = useOverlayContainer(portalHost);
  if (!presence.mounted) return null;
  const close = (): void => {
    onOpenChange(false);
  };
  return (
    <DialogPrimitive.Portal
      forceMount
      {...(portalHost ? { hostName: portalHost } : {})}
      container={container}
    >
      <View pointerEvents="box-none" className="absolute inset-0">
        <Animated.View
          style={[
            { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
            presence.scrimStyle,
          ]}
        >
          <Overlay forceMount onPress={close} className="absolute inset-0 bg-overlay" />
        </Animated.View>
        <View pointerEvents="box-none" className="absolute" style={placement}>
          <Content
            forceMount
            onAccessibilityEscape={close}
            className="items-end gap-3 outline-none"
          >
            <Title style={HIDDEN}>{title}</Title>
            <Animated.View style={presence.style}>
              <View className="items-end gap-3">
                {actions.map((action) => (
                  <Pressable
                    key={action.label}
                    accessibilityRole="button"
                    accessibilityLabel={action.label}
                    onPress={() => {
                      close();
                      action.onPress();
                    }}
                    className="flex-row items-center gap-3"
                  >
                    <View className="rounded-[10px] bg-surface-raised px-3 py-2 shadow-md">
                      <CssText className="text-[14px] font-semibold leading-none text-fg">
                        {action.label}
                      </CssText>
                    </View>
                    <View className="size-10 items-center justify-center rounded-full bg-surface-raised shadow-lg">
                      <Icon icon={action.icon} size={18} tone="accent" />
                    </View>
                  </Pressable>
                ))}
              </View>
            </Animated.View>
            <FloatingButton icon={X} accessibilityLabel={closeLabel} onPress={close} />
          </Content>
        </View>
        <BackGuard onBack={close} />
        <InertOutside />
      </View>
    </DialogPrimitive.Portal>
  );
}
