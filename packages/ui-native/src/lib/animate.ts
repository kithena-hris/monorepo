import { useEffect, useMemo, useState } from 'react';
import {
  cancelAnimation,
  Easing,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useReducedMotion } from '../provider.tsx';
import { motionPresets, type MotionPresets, type Transition } from './motion.ts';

/** The presets for the reduce-motion setting in force where this is called. */
export function useMotion(): MotionPresets {
  const reduced = useReducedMotion();
  return useMemo(() => motionPresets(reduced), [reduced]);
}

/**
 * A preset's transition as a Reanimated animation towards `to`.
 *
 * The easing is built before the worklet runs: `Easing.bezier` returns a
 * factory Reanimated serialises, not a function a worklet can call.
 */
export function animateTo(
  to: number,
  transition: Transition,
  /** A worklet, called when the animation ends or is interrupted. */
  done?: (finished?: boolean) => void,
): number {
  if (transition.type === 'spring') {
    const { mass, stiffness, damping } = transition;
    return withSpring(to, { mass, stiffness, damping }, done);
  }
  return withTiming(
    to,
    { duration: transition.duration, easing: Easing.bezier(...transition.easing) },
    done,
  );
}

/** A layout change on the move spring, or none under reduced motion. Pass to `layout`. */
export function useLayoutTransition(): LinearTransition | undefined {
  const { layout } = useMotion();
  return layout
    ? LinearTransition.springify()
        .mass(layout.mass)
        .stiffness(layout.stiffness)
        .damping(layout.damping)
    : undefined;
}

export type Press = {
  /** For the bare `Animated.View` the scale goes on (RMB-001: never on a styled view). */
  style: ReturnType<typeof useAnimatedStyle>;
  /**
   * True while a finger is down: show the pressed colour. Under reduced motion
   * (`press.tint`) the colour is the whole of the press; otherwise it rides
   * along with the scale, as the web's `active:` fill does.
   */
  pressed: boolean;
  onPressIn: () => void;
  onPressOut: () => void;
};

/** The press: scale to 0.97 and back, or under reduced motion, a colour change alone. */
export function usePress(): Press {
  const { press } = useMotion();
  const scale: SharedValue<number> = useSharedValue(1);
  const [down, setDown] = useState(false);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return {
    style,
    pressed: down,
    onPressIn: () => {
      setDown(true);
      scale.value = animateTo(press.scale, press.transition);
    },
    onPressOut: () => {
      setDown(false);
      scale.value = animateTo(1, press.transition);
    },
  };
}

/** How long one breath of a live marker takes, each way. */
const PULSE_MS = 800;

/**
 * A breath for something live: a pulsing dot, the step being waited on. It is
 * decoration, so it stops under reduced motion and when `active` is false.
 * For a bare `Animated.View` (RMB-001).
 */
export function usePulse(active: boolean): ReturnType<typeof useAnimatedStyle> {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (!active || reduced) return undefined;
    opacity.value = withRepeat(
      withTiming(0.35, { duration: PULSE_MS, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => {
      cancelAnimation(opacity);
      opacity.value = 1;
    };
  }, [opacity, active, reduced]);
  return useAnimatedStyle(() => ({ opacity: opacity.value }));
}
