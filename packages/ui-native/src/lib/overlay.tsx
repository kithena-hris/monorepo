import { PortalHost } from '@rn-primitives/portal';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { View } from 'react-native-css/components';
import {
  useAnimatedStyle,
  useSharedValue,
  type AnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { ViewStyle } from 'react-native';

import { animateTo, useMotion } from './animate.ts';
import type { Pose, Side } from './motion.ts';

/*
 * Where overlays draw.
 *
 * On a device a portal is `@rn-primitives/portal`: a host renders whatever was
 * sent to its name. On the web the primitives are Radix, which portals into a
 * DOM element, `document.body` unless told otherwise; body is outside the view
 * `ReachProvider` puts the `dark` class on, so a menu opened in dark mode would
 * be light. Each host therefore registers its element by name, and an overlay
 * asks for the element of the host it was sent to.
 */
const ROOT = '__reach_root__';
const elements = new Map<string, HTMLElement>();
const listeners = new Set<() => void>();

function register(name: string, element: HTMLElement | null): void {
  if (element) elements.set(name, element);
  else elements.delete(name);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export type OverlayHostProps = {
  /**
   * Overlays sent to this name (`portalHost`) draw here, over this host's
   * parent. Leave it unset for the root host, which `ReachProvider` already
   * renders: an app needs a named one only to keep an overlay inside a region.
   */
  name?: string;
};

/** Where overlays draw: over the whole of its parent, which must be positioned. */
export function OverlayHost({ name }: OverlayHostProps): React.JSX.Element {
  if (Platform.OS !== 'web') return <PortalHost {...(name ? { name } : {})} />;
  return (
    <View
      pointerEvents="box-none"
      className="absolute inset-0"
      ref={(node: unknown) => {
        register(name ?? ROOT, node as HTMLElement | null);
      }}
    />
  );
}

/**
 * The DOM element a Radix portal should render into, for the host `name`.
 * `undefined` on a device, where `hostName` does the same job.
 */
export function useOverlayContainer(name?: string): HTMLElement | undefined {
  const key = name ?? ROOT;
  return useSyncExternalStore(
    subscribe,
    () => elements.get(key),
    () => undefined,
  );
}

type Presence = {
  /** Draw the overlay: true while open, and while it animates closed. */
  mounted: boolean;
  /** The surface's motion, for a bare `Animated.View` (RMB-001). */
  style: AnimatedStyle<ViewStyle>;
  /** The scrim's fade, on the same clock as the surface. */
  scrimStyle: AnimatedStyle<ViewStyle>;
};

/**
 * An overlay that animates out before it unmounts: the popover motion in from
 * `side`, and back out at the exit speed, from the shared presets. Under
 * reduced motion both are a cross-fade.
 *
 * The primitives unmount the moment they close, so an overlay renders its
 * portal with `forceMount` while `mounted` is true and this decides when that
 * ends.
 */
export function usePresence(open: boolean, side: Side = 'bottom'): Presence {
  const { popoverIn, popoverOut } = useMotion();
  const [mounted, setMounted] = useState(open);
  const opacity = useSharedValue(0);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);

  useEffect(() => {
    const values: [SharedValue<number>, keyof Pose][] = [
      [opacity, 'opacity'],
      [translateX, 'translateX'],
      [translateY, 'translateY'],
      [scale, 'scale'],
    ];
    if (open) {
      setMounted(true);
      const motion = popoverIn(side);
      for (const [value, key] of values) {
        value.value = motion.from[key];
        value.value = animateTo(motion.to[key], motion.transition);
      }
      return;
    }
    const motion = popoverOut(side);
    for (const [value, key] of values) {
      value.value = animateTo(
        motion.to[key],
        motion.transition,
        key === 'opacity'
          ? (finished) => {
              'worklet';
              if (finished) scheduleOnRN(setMounted, false);
            }
          : undefined,
      );
    }
    // The shared values are stable; the presets change only with reduced motion.
  }, [open, side, popoverIn, popoverOut, opacity, translateX, translateY, scale]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return { mounted, style, scrimStyle };
}
