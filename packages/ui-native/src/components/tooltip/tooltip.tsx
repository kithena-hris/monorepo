import * as PopoverPrimitive from '@rn-primitives/popover';
import * as TooltipPrimitive from '@rn-primitives/tooltip';
import { useState, type ReactElement, type ReactNode } from 'react';
import { styled } from 'react-native-css';
import { View } from 'react-native-css/components';
import Animated from 'react-native-reanimated';

import { cn } from '../../lib/cn.ts';
import {
  FloatingRoot,
  LongPressTrigger,
  useEdgeInsets,
  useTriggerHandle,
  WEB,
  type FloatingState,
} from '../../lib/floating.tsx';
import type { Side } from '../../lib/motion.ts';
import { useOverlayContainer } from '../../lib/overlay-host.tsx';
import { flatStyle, usePresence } from '../../lib/overlay.tsx';
import { Text } from '../text/text.tsx';

/**
 * A short name for a control, never an explanation. Phones have no hover:
 * prefer a visible label, and give an icon-only control a tooltip that a long
 * press opens, saying exactly what its `accessibilityLabel` says. On the web
 * it opens on hover and on keyboard focus.
 *
 * If it needs a sentence, it is a popover or text on the page.
 */
export type TooltipProps = FloatingState & {
  /** The name: two or three words. */
  content: string;
  /** A keyboard shortcut on a second line, for a hardware keyboard. */
  shortcut?: ReactNode;
  side?: Side;
  /** Milliseconds of hover before it opens, on the web. */
  delayDuration?: number;
  onOpenChange?: (open: boolean) => void;
  /** Draw in the `OverlayHost` of this name instead of the root one. */
  portalHost?: string;
  /** The one control it names; it must accept `onLongPress` and a `ref`. */
  children: ReactElement;
};

const WebContent = styled(flatStyle(TooltipPrimitive.Content));
const NativeContent = styled(flatStyle(PopoverPrimitive.Content));
const NativeOverlay = styled(flatStyle(PopoverPrimitive.Overlay));

/*
 * Two primitives, one per platform. On the web, Radix's tooltip: hover, focus,
 * the delay and `role="tooltip"`. On a device there is no hover and the
 * tooltip primitive opens on a press, which is the control's own job, so the
 * tooltip is drawn by the popover primitive (the one that exposes where its
 * trigger is) and opened by a long press on the control.
 */
export function Tooltip(props: TooltipProps): React.JSX.Element {
  return WEB ? <WebTooltip {...props} /> : <NativeTooltip {...props} />;
}

function WebTooltip({
  content,
  shortcut,
  side = 'top',
  delayDuration = 400,
  open,
  defaultOpen,
  onOpenChange,
  portalHost,
  children,
}: TooltipProps): React.JSX.Element {
  // The primitive does not share its state, but reports every change.
  const [shown, setShown] = useState(false);
  return (
    <TooltipPrimitive.Root
      delayDuration={delayDuration}
      onOpenChange={(next) => {
        setShown(next);
        onOpenChange?.(next);
      }}
    >
      <FloatingRoot open={open} defaultOpen={defaultOpen} useRoot={() => ({ open: shown })}>
        <WebTrigger>{children}</WebTrigger>
        <WebBubble open={shown} side={side} shortcut={shortcut} portalHost={portalHost}>
          {content}
        </WebBubble>
      </FloatingRoot>
    </TooltipPrimitive.Root>
  );
}

function WebTrigger({ children }: { children: ReactElement }): React.JSX.Element {
  const handle = useTriggerHandle();
  return (
    <TooltipPrimitive.Trigger ref={handle as never} asChild>
      {children}
    </TooltipPrimitive.Trigger>
  );
}

function WebBubble({
  open,
  side,
  shortcut,
  portalHost,
  children,
}: {
  open: boolean;
  side: Side;
  shortcut: ReactNode;
  portalHost: string | undefined;
  children: string;
}): React.JSX.Element | null {
  const presence = usePresence(open, side);
  const container = useOverlayContainer(portalHost);
  const edge = useEdgeInsets();
  if (!presence.mounted) return null;
  return (
    <TooltipPrimitive.Portal forceMount container={container}>
      <WebContent
        forceMount
        side={side}
        align="center"
        sideOffset={8}
        {...edge}
        className="outline-none"
      >
        <Bubble presence={presence} side={side} shortcut={shortcut}>
          {children}
        </Bubble>
      </WebContent>
    </TooltipPrimitive.Portal>
  );
}

function NativeTooltip({
  content,
  shortcut,
  side = 'top',
  open,
  defaultOpen,
  onOpenChange,
  portalHost,
  children,
}: TooltipProps): React.JSX.Element {
  return (
    <PopoverPrimitive.Root {...(onOpenChange ? { onOpenChange } : {})}>
      <FloatingRoot open={open} defaultOpen={defaultOpen} useRoot={PopoverPrimitive.useRootContext}>
        <LongPressTrigger>{children}</LongPressTrigger>
        <NativeBubble side={side} shortcut={shortcut} portalHost={portalHost}>
          {content}
        </NativeBubble>
      </FloatingRoot>
    </PopoverPrimitive.Root>
  );
}

function NativeBubble({
  side,
  shortcut,
  portalHost,
  children,
}: {
  side: Side;
  shortcut: ReactNode;
  portalHost: string | undefined;
  children: string;
}): React.JSX.Element | null {
  const { open, onOpenChange } = PopoverPrimitive.useRootContext();
  const presence = usePresence(open, side);
  const edge = useEdgeInsets();
  if (!presence.mounted) return null;
  return (
    <PopoverPrimitive.Portal forceMount {...(portalHost ? { hostName: portalHost } : {})}>
      <View pointerEvents="box-none" className="absolute inset-0">
        {/* Any press closes it. */}
        <NativeOverlay
          forceMount
          onPress={() => {
            onOpenChange(false);
          }}
          className="absolute inset-0"
        />
        {/* The primitive places above or below; a tooltip set beside goes above. */}
        <NativeContent
          forceMount
          side={side === 'bottom' ? 'bottom' : 'top'}
          align="center"
          sideOffset={8}
          {...edge}
        >
          <Bubble presence={presence} side={side} shortcut={shortcut}>
            {children}
          </Bubble>
        </NativeContent>
      </View>
    </PopoverPrimitive.Portal>
  );
}

const ARROW = 10;

/** The tail's place on the bubble's edge facing the trigger. */
const arrowAt: Record<Side, string> = {
  top: 'bottom-[-4px] left-1/2 -ml-[5px]',
  bottom: 'top-[-4px] left-1/2 -ml-[5px]',
  left: 'right-[-4px] top-1/2 -mt-[5px]',
  right: 'left-[-4px] top-1/2 -mt-[5px]',
};

/** The inverted bubble and its tail, moving as every overlay does. */
function Bubble({
  presence,
  side,
  shortcut,
  children,
}: {
  presence: ReturnType<typeof usePresence>;
  side: Side;
  shortcut: ReactNode;
  children: string;
}): React.JSX.Element {
  return (
    // The motion on a bare Animated.View, the classes inside it (RMB-001).
    <Animated.View style={presence.style}>
      <View className="max-w-[240px] gap-0.5 rounded-[8px] bg-invert px-2.5 py-1.5 shadow-md">
        <Text className="text-[13px] leading-[1.35] font-medium text-fg-on-invert">{children}</Text>
        {shortcut ? <View className="flex-row gap-1 opacity-75">{shortcut}</View> : null}
        {/* The tail is the bubble, drawn on: decorative. */}
        <View
          aria-hidden
          className={cn('absolute rotate-45 rounded-[2px] bg-invert', arrowAt[side])}
          style={{ width: ARROW, height: ARROW }}
        />
      </View>
    </Animated.View>
  );
}
