import * as HoverCardPrimitive from '@rn-primitives/hover-card';
import * as PopoverPrimitive from '@rn-primitives/popover';
import { type ReactElement, type ReactNode } from 'react';
import { styled } from 'react-native-css';
import { Pressable, View } from 'react-native-css/components';
import Animated from 'react-native-reanimated';

import { cn } from '../../lib/cn.ts';
import {
  FloatingRoot,
  floatingSurface,
  LongPressTrigger,
  useTriggerHandle,
  WEB,
  type FloatingState,
} from '../../lib/floating.tsx';
import { menuRowClass, MenuRowContent, menuSurface } from '../../lib/menu.tsx';
import { useOverlayContainer } from '../../lib/overlay-host.tsx';
import { flatStyle, labelledFrame, usePresence } from '../../lib/overlay.tsx';
import type { LucideIcon } from '../icon/icon.tsx';

/**
 * A peek at a person or a record from its name, without leaving the page. On
 * the web it opens after 400 ms of hover, or on keyboard focus, and stays while
 * the pointer is over it. On a phone a long press opens it, with the
 * person's actions under the card, as the system's own previews do; a press
 * still follows the link.
 *
 * Nothing in it may be the only way to reach something: it is a shortcut to
 * the profile, not the profile.
 */
export type HoverCardProps = FloatingState & {
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
};

const OPEN_DELAY = 400;
const CLOSE_DELAY = 150;

export function HoverCard({
  open,
  defaultOpen,
  onOpenChange,
  children,
}: HoverCardProps): React.JSX.Element {
  const change = onOpenChange ? { onOpenChange } : {};
  if (WEB) {
    return (
      <HoverCardPrimitive.Root openDelay={OPEN_DELAY} closeDelay={CLOSE_DELAY} {...change}>
        <FloatingRoot
          open={open}
          defaultOpen={defaultOpen}
          useRoot={HoverCardPrimitive.useRootContext}
        >
          {children}
        </FloatingRoot>
      </HoverCardPrimitive.Root>
    );
  }
  // On a device it is drawn by the popover primitive, which knows where its
  // trigger is; the hover card primitive would open on a press.
  return (
    <PopoverPrimitive.Root {...change}>
      <FloatingRoot open={open} defaultOpen={defaultOpen} useRoot={PopoverPrimitive.useRootContext}>
        {children}
      </FloatingRoot>
    </PopoverPrimitive.Root>
  );
}

/** The name or link it previews. It must accept `onLongPress` and a `ref`. */
export function HoverCardTrigger({ children }: { children: ReactElement }): React.JSX.Element {
  const handle = useTriggerHandle();
  if (!WEB) return <LongPressTrigger>{children}</LongPressTrigger>;
  return (
    <HoverCardPrimitive.Trigger ref={handle as never} asChild>
      {children}
    </HoverCardPrimitive.Trigger>
  );
}

const WebContent = styled(flatStyle(HoverCardPrimitive.Content));
const NativeContent = styled(flatStyle(PopoverPrimitive.Content));
const NativeOverlay = styled(flatStyle(PopoverPrimitive.Overlay));

export type HoverCardContentProps = {
  children?: ReactNode;
  className?: string | undefined;
  /** `HoverCardAction`s: on a phone, what a long press offers under the card. */
  actions?: ReactNode;
  /** Names it for a screen reader: the person's or the record's name. */
  label?: string;
  /** Draw in the `OverlayHost` of this name instead of the root one. */
  portalHost?: string;
};

function useOpen(): { open: boolean; onOpenChange: (open: boolean) => void } {
  // Each platform's root is a different primitive; both say whether it is open.
  return WEB ? HoverCardPrimitive.useRootContext() : PopoverPrimitive.useRootContext();
}

export function HoverCardContent({
  children,
  className,
  actions,
  label,
  portalHost,
}: HoverCardContentProps): React.JSX.Element | null {
  const { open, onOpenChange } = useOpen();
  const presence = usePresence(open, 'bottom');
  const container = useOverlayContainer(portalHost);
  if (!presence.mounted) return null;
  const body = (
    // The motion on a bare Animated.View, the classes inside it (RMB-001).
    <Animated.View style={presence.style}>
      <View className="w-[300px] gap-2">
        <View className={cn(floatingSurface, 'gap-3 p-4', className)}>{children}</View>
        {actions ? <View className={menuSurface}>{actions}</View> : null}
      </View>
    </Animated.View>
  );
  if (WEB) {
    return (
      <HoverCardPrimitive.Portal forceMount container={container}>
        <WebContent
          forceMount
          ref={labelledFrame(label)}
          side="bottom"
          align="start"
          sideOffset={8}
          className="outline-none"
        >
          {body}
        </WebContent>
      </HoverCardPrimitive.Portal>
    );
  }
  return (
    <PopoverPrimitive.Portal forceMount {...(portalHost ? { hostName: portalHost } : {})}>
      <View pointerEvents="box-none" className="absolute inset-0">
        <NativeOverlay
          forceMount
          onPress={() => {
            onOpenChange(false);
          }}
          className="absolute inset-0"
        />
        <NativeContent
          forceMount
          side="bottom"
          align="start"
          sideOffset={8}
          {...(label ? { accessibilityLabel: label } : {})}
        >
          {body}
        </NativeContent>
      </View>
    </PopoverPrimitive.Portal>
  );
}

export type HoverCardActionProps = {
  icon?: LucideIcon;
  onPress?: () => void;
  destructive?: boolean;
  children: string;
};

/** One action under the card. It runs, then the card closes. */
export function HoverCardAction({
  icon,
  onPress,
  destructive = false,
  children,
}: HoverCardActionProps): React.JSX.Element {
  const { onOpenChange } = useOpen();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        onPress?.();
        onOpenChange(false);
      }}
      className={menuRowClass()}
    >
      <MenuRowContent icon={icon} destructive={destructive}>
        {children}
      </MenuRowContent>
    </Pressable>
  );
}
