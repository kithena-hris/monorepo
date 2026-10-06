import { useEffect, useState, type ComponentType } from 'react';
import { Platform, StyleSheet, type StyleProp } from 'react-native';
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

  // Clamped: a spring in, or an exit easing that dips, would pass through 0 and 1.
  const style = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, opacity.value)),
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, opacity.value)),
  }));
  return { mounted, style, scrimStyle };
}

/**
 * A primitive whose `style` reaches a Radix `Slot` on the web, given one style
 * object instead of the array `styled` builds. `Slot` merges styles by object
 * spread, so an array arrives at the DOM as `{0: …, 1: …}` and React throws
 * setting an indexed property on `CSSStyleDeclaration`. On a device the array
 * is fine and this passes it through.
 */
export function flatStyle<P extends { style?: unknown }>(
  Component: ComponentType<P>,
): ComponentType<P> {
  if (Platform.OS !== 'web') return Component;
  function Flat(props: P): React.JSX.Element {
    return <Component {...props} style={StyleSheet.flatten(props.style as StyleProp<ViewStyle>)} />;
  }
  Flat.displayName = `Flat(${Component.displayName ?? Component.name})`;
  return Flat;
}

type InertElement = { inert: boolean };
type DomDocument = { querySelectorAll(selectors: string): ArrayLike<InertElement> };

/**
 * On the web, what a modal hides is made inert as well. Radix marks everything
 * outside an open modal `aria-hidden` and traps focus itself, which leaves the
 * page behind it focusable but unannounced: axe's `aria-hidden-focus`, and a
 * switch user's dead end. `inert` is what a browser does for a native
 * `<dialog>`. The inertness goes when it unmounts.
 *
 * Render it inside the portal, after the primitive's content: effects run in
 * tree order, so it sees the page once Radix has hidden it.
 */
export function InertOutside(): null {
  useEffect(() => {
    const doc = (globalThis as { document?: DomDocument }).document;
    if (Platform.OS !== 'web' || !doc) return undefined;
    const hidden = Array.from(doc.querySelectorAll('[data-aria-hidden="true"]')).filter(
      (element) => !element.inert,
    );
    for (const element of hidden) element.inert = true;
    return () => {
      for (const element of hidden) element.inert = false;
    };
  }, []);
  return null;
}

type FramedNode = { parentElement: { style: { outline: string } } | null };

/**
 * A ref for a primitive's content on the web, where Radix wraps it in a bare
 * element of its own that takes focus when the overlay holds nothing
 * focusable (a "Saving…" dialog). That element has no radius and the overlay's
 * full width, so the browser's ring is drawn around a box that is not there.
 * It is not a control, so it gets no ring; the content itself is unchanged.
 */
export function quietFrame(node: unknown): void {
  if (Platform.OS !== 'web' || !node) return;
  const parent = (node as FramedNode).parentElement;
  if (parent) parent.style.outline = 'none';
}
