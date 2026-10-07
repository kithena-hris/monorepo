import * as PopoverPrimitive from '@rn-primitives/popover';
import { type ReactNode } from 'react';
import { styled } from 'react-native-css';
import { View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import {
  FloatingRoot,
  FloatingSurface,
  useEdgeInsets,
  useTriggerHandle,
  WEB,
  type FloatingState,
} from '../../lib/floating.tsx';
import { useOverlayContainer } from '../../lib/overlay-host.tsx';
import { flatStyle, labelledFrame, usePresence } from '../../lib/overlay.tsx';

/**
 * A small piece of interactive UI anchored to its trigger: a filter, a column
 * chooser, a date. It is not modal: a press anywhere else closes it and the
 * page stays usable. Something that must be resolved before going on is a
 * `Dialog`; a label is a `Tooltip`.
 *
 * Controlled (`open`, `onOpenChange`) or not (`defaultOpen`), as Radix's.
 */
export type PopoverProps = FloatingState & {
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
};

export function Popover({
  open,
  defaultOpen,
  onOpenChange,
  children,
}: PopoverProps): React.JSX.Element {
  return (
    <PopoverPrimitive.Root {...(onOpenChange ? { onOpenChange } : {})}>
      <FloatingRoot open={open} defaultOpen={defaultOpen} useRoot={PopoverPrimitive.useRootContext}>
        {children}
      </FloatingRoot>
    </PopoverPrimitive.Root>
  );
}

const Trigger = PopoverPrimitive.Trigger;
const Content = styled(flatStyle(PopoverPrimitive.Content));
const Overlay = styled(flatStyle(PopoverPrimitive.Overlay));

/** The control that opens it; pass one child with `asChild`. */
export function PopoverTrigger({
  children,
  asChild = true,
}: {
  children?: ReactNode;
  asChild?: boolean;
}): React.JSX.Element {
  const handle = useTriggerHandle();
  return (
    <Trigger ref={handle as never} asChild={asChild}>
      {children}
    </Trigger>
  );
}

/**
 * Anchors the popover to a control without making the control open it: a tour
 * step pointing at a button that keeps doing its own job. A trigger that
 * nobody can press or reach lies over the control, so the primitive measures
 * and positions against it.
 */
export function PopoverAnchor({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  const handle = useTriggerHandle();
  return (
    <View className={cn('relative', className)}>
      {children}
      <Trigger ref={handle as never} asChild>
        <View
          pointerEvents="none"
          aria-hidden
          focusable={false}
          tabIndex={-1}
          className="absolute inset-0"
        />
      </Trigger>
    </View>
  );
}

export const PopoverClose = PopoverPrimitive.Close;

export type PopoverContentProps = {
  children?: ReactNode;
  className?: string | undefined;
  /**
   * The side of the trigger it opens on, when there is room: above or below.
   * A phone is too narrow for a popover beside its trigger.
   */
  side?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
  /** The gap to the trigger, in points. */
  sideOffset?: number;
  /** Draw in the `OverlayHost` of this name instead of the root one. */
  portalHost?: string;
  /** Names it for a screen reader when nothing inside is its title. */
  label?: string;
};

export function PopoverContent({
  children,
  className,
  side = 'bottom',
  align = 'start',
  sideOffset = 6,
  portalHost,
  label,
}: PopoverContentProps): React.JSX.Element | null {
  const { open, onOpenChange } = PopoverPrimitive.useRootContext();
  const presence = usePresence(open, side);
  const container = useOverlayContainer(portalHost);
  const edge = useEdgeInsets();
  if (!presence.mounted) return null;
  const surface = (
    <Content
      forceMount
      ref={labelledFrame(label)}
      side={side}
      align={align}
      sideOffset={sideOffset}
      {...edge}
      // Focus goes to the popover, not its first field: on a phone a field
      // focused on open raises the keyboard over what was just opened.
      onOpenAutoFocus={(event: Event) => {
        // Radix's DOM event, on the web only; React Native's types have no DOM.
        const dom = event as unknown as {
          preventDefault: () => void;
          currentTarget: { focus?: () => void } | null;
        };
        dom.preventDefault();
        dom.currentTarget?.focus?.();
      }}
      {...(label ? { accessibilityLabel: label } : {})}
      className="outline-none"
    >
      <FloatingSurface presence={presence} className={cn('p-4', className)}>
        {children}
      </FloatingSurface>
    </Content>
  );
  return (
    <PopoverPrimitive.Portal
      forceMount
      {...(portalHost ? { hostName: portalHost } : {})}
      {...(WEB ? { container } : {})}
    >
      {/* Radix's portal takes one child. On a device a press outside closes it. */}
      {WEB ? (
        surface
      ) : (
        <View pointerEvents="box-none" className="absolute inset-0">
          <Overlay
            forceMount
            onPress={() => {
              onOpenChange(false);
            }}
            className="absolute inset-0"
          />
          {surface}
        </View>
      )}
    </PopoverPrimitive.Portal>
  );
}
