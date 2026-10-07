import { useEffect } from 'react';
import { View } from 'react-native';
import { useCssElement } from 'react-native-css';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { cn } from '../../lib/cn.ts';
import { iconVariants } from '../icon/icon.tsx';

/** The web spinner's sizes, in points. A number is taken as it is. */
const SIZES = { xs: 12, sm: 16, md: 20, lg: 32, xl: 48 } as const;

/**
 * One turn, as long as the web's `animate-spin`. Not a motion token: a spinner
 * keeps turning under reduced motion, because the turning is what it means.
 */
const TURN_MS = 1000;

const mapping = { className: { target: 'style', nativeStyleMapping: { color: 'color' } } } as const;

export type SpinnerProps = {
  size?: keyof typeof SIZES | number;
  /** The colour, as an icon's. Accent by default; pass the label's tone inside a control. */
  tone?: NonNullable<Parameters<typeof iconVariants>[0]>['tone'];
  /**
   * Screen-reader text. A spinner with no label is a silent pause for anyone
   * not looking at the screen.
   */
  label?: string;
  /**
   * Hidden from assistive technology, for a spinner inside a control that
   * already reports itself busy.
   */
  decorative?: boolean;
  className?: string | undefined;
};

/** Indeterminate progress, for a short wait on one thing. For whole areas, use skeletons. */
export function Spinner({
  size = 'md',
  tone = 'accent',
  label = 'Loading',
  decorative = false,
  className,
}: SpinnerProps): React.JSX.Element {
  const side = typeof size === 'number' ? size : SIZES[size];
  const turn = useSharedValue(0);
  useEffect(() => {
    turn.value = withRepeat(
      withTiming(360, { duration: TURN_MS, easing: Easing.linear }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(turn);
    };
  }, [turn]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${String(turn.value)}deg` }] }));

  const drawing = useCssElement(
    Svg,
    {
      width: side,
      height: side,
      viewBox: '0 0 24 24',
      fill: 'none',
      className: cn(iconVariants({ tone }), className),
      children: [
        <Circle
          key="track"
          cx={12}
          cy={12}
          r={9}
          stroke="currentColor"
          strokeWidth={3}
          opacity={0.22}
        />,
        <Path
          key="arc"
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
        />,
      ],
    },
    mapping,
  );

  return (
    <View
      {...(decorative
        ? {
            accessible: false,
            importantForAccessibility: 'no-hide-descendants' as const,
            'aria-hidden': true,
          }
        : {
            accessible: true,
            accessibilityRole: 'progressbar' as const,
            accessibilityLabel: label,
            role: 'status' as const,
          })}
      style={{ width: side, height: side }}
    >
      {/* The turn on a bare Animated.View, the classes on what it holds (RMB-001). */}
      <Animated.View style={spin}>{drawing}</Animated.View>
    </View>
  );
}
