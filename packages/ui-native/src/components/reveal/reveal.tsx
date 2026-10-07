import { useEffect, useState, type ReactNode } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { View } from 'react-native-css/components';
import Animated, { useAnimatedStyle, useSharedValue, withDelay } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { animateTo, useMotion } from '../../lib/animate.ts';
import { cn } from '../../lib/cn.ts';
import { durations, easings, RISE, stagger, type Timing } from '../../lib/motion.ts';
import { useReducedMotion } from '../../provider.tsx';

/**
 * Content that comes and goes without the layout jumping, as the web's: the
 * height eases open while the content fades and rises half a rem into place,
 * and the reverse on the way out, at the exit speed. Under reduced motion the
 * height changes at once and only the fade remains.
 *
 * What it reveals is still read when it is open and gone when it is closed,
 * so a screen reader never lands on something invisible.
 */

const CLOSE: Timing = { type: 'timing', duration: durations.fast, easing: easings.exit };

export type RevealProps = {
  open: boolean;
  children: ReactNode;
  /** Where the content rises from: below (`bottom`, the default), above, or nowhere. */
  from?: 'top' | 'bottom' | 'none';
  /** Drop the content once closed, rather than keep it measured and hidden. */
  unmountOnExit?: boolean;
  className?: string | undefined;
};

export function Reveal({
  open,
  children,
  from = 'bottom',
  unmountOnExit = true,
  className,
}: RevealProps): React.JSX.Element | null {
  const { fadeRise } = useMotion();
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(open);
  const [measured, setMeasured] = useState(0);
  const height = useSharedValue(open ? -1 : 0);
  const opacity = useSharedValue(open ? 1 : 0);
  const rise = from === 'none' ? 0 : from === 'top' ? -RISE : RISE;
  const y = useSharedValue(0);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  useEffect(() => {
    if (!mounted || measured === 0) return;
    if (open) {
      // The first measure of content shown from the start lands where it is.
      if (height.value === -1) {
        height.value = measured;
        return;
      }
      height.value = reduced ? measured : animateTo(measured, fadeRise.transition);
      y.value = reduced ? 0 : rise;
      y.value = animateTo(0, fadeRise.transition);
      opacity.value = animateTo(1, fadeRise.transition);
      return;
    }
    height.value = reduced ? 0 : animateTo(0, CLOSE);
    y.value = reduced ? 0 : animateTo(rise, CLOSE);
    opacity.value = animateTo(0, CLOSE, (finished) => {
      'worklet';
      if (finished && unmountOnExit) scheduleOnRN(setMounted, false);
    });
  }, [open, mounted, measured, reduced, rise, unmountOnExit, fadeRise, height, opacity, y]);

  const clip = useAnimatedStyle(() =>
    height.value < 0 ? { overflow: 'hidden' } : { height: height.value, overflow: 'hidden' },
  );
  const content = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: y.value }],
  }));

  if (!mounted) return null;
  return (
    // The motion on bare Animated.Views, the classes on the view inside (RMB-001).
    <Animated.View style={clip} {...(open ? {} : { 'aria-hidden': true })}>
      <Animated.View style={content}>
        <View
          className={cn(className)}
          onLayout={(e: LayoutChangeEvent) => {
            setMeasured(e.nativeEvent.layout.height);
          }}
        >
          {children}
        </View>
      </Animated.View>
    </Animated.View>
  );
}

/**
 * How long the `index`th of a staggered group waits: a step per neighbour,
 * never more than the ceiling, the web's `staggerStyle`.
 */
export function staggerDelay(index: number): number {
  return Math.min(index * stagger.step, stagger.max);
}

/** One of a group arriving in sequence: a fade and a rise, `staggerDelay(index)` late. */
export function Stagger({
  index,
  children,
  className,
}: {
  index: number;
  children: ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  const { fadeRise } = useMotion();
  const opacity = useSharedValue(fadeRise.from.opacity);
  const y = useSharedValue(fadeRise.from.translateY);
  useEffect(() => {
    const delay = staggerDelay(index);
    opacity.value = withDelay(delay, animateTo(1, fadeRise.transition));
    y.value = withDelay(delay, animateTo(0, fadeRise.transition));
  }, [index, fadeRise, opacity, y]);
  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: y.value }],
  }));
  return (
    <Animated.View style={style}>
      <View className={cn(className)}>{children}</View>
    </Animated.View>
  );
}
