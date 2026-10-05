import { useMemo, useState } from 'react';
import {
  Easing,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
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
export function animateTo(to: number, transition: Transition): number {
  if (transition.type === 'spring') {
    const { mass, stiffness, damping } = transition;
    return withSpring(to, { mass, stiffness, damping });
  }
  return withTiming(to, {
    duration: transition.duration,
    easing: Easing.bezier(...transition.easing),
  });
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
  /** True while a finger is down and motion is reduced: show the pressed colour instead. */
  tinted: boolean;
  onPressIn: () => void;
  onPressOut: () => void;
};

/** The press: scale to 0.97 and back, or under reduced motion, a colour change. */
export function usePress(): Press {
  const { press } = useMotion();
  const scale: SharedValue<number> = useSharedValue(1);
  const [down, setDown] = useState(false);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return {
    style,
    tinted: press.tint && down,
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
