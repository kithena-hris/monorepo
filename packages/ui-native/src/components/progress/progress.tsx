import { useEffect, useState } from 'react';
import { Platform, type LayoutChangeEvent } from 'react-native';
import { useCssElement } from 'react-native-css';
import { Text as CssText, View } from 'react-native-css/components';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { animateTo } from '../../lib/animate.ts';
import { cn } from '../../lib/cn.ts';
import { durations, easings, type Timing } from '../../lib/motion.ts';
import { useReducedMotion } from '../../provider.tsx';

/**
 * How far along something is, as the web's: an 8pt bar on a phone, the label
 * 15 above it with the value on the right, or a ring with the percentage in
 * it. Indeterminate only when it really cannot be told. An indeterminate bar
 * keeps moving under reduced motion, as a spinner does: it is the meaning.
 */

export type ProgressTone = 'accent' | 'success' | 'warning' | 'danger';

const fill = {
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
} as const satisfies Record<ProgressTone, string>;

const stroke = {
  accent: 'text-accent',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
} as const satisfies Record<ProgressTone, string>;

/** One pass of the indeterminate bar, and one turn of the ring. Meaning, not decoration. */
const SWEEP_MS = 1300;
const TURN_MS = 1000;
/** A value settling: a change in place. */
const SETTLE: Timing = { type: 'timing', duration: durations.normal, easing: easings.standard };

const WEB = Platform.OS === 'web';

function percent(value: number, max: number): number {
  return Math.min(100, Math.max(0, (value / max) * 100));
}

/** What a screen reader is told: a progress bar, its name, and where it stands. */
function a11y(label: string, value: number | null, max: number, valueLabel?: string) {
  const now = value === null ? undefined : Math.round(percent(value, max));
  return {
    accessible: true,
    accessibilityRole: 'progressbar' as const,
    accessibilityLabel: label,
    ...(now === undefined
      ? {}
      : {
          accessibilityValue: {
            min: 0,
            max: 100,
            now,
            ...(valueLabel ? { text: valueLabel } : {}),
          },
        }),
    ...(WEB
      ? {
          role: 'progressbar' as const,
          'aria-label': label,
          ...(now === undefined
            ? {}
            : { 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': now }),
          ...(valueLabel ? { 'aria-valuetext': valueLabel } : {}),
        }
      : {}),
  };
}

export type ProgressProps = {
  /** `null` for indeterminate: it has started and nobody can say how far it is. */
  value: number | null;
  max?: number;
  /** What is in progress: always read, and printed above the bar with `showValue`. */
  label: string;
  /**
   * Prints the label above the bar and the reading beside it, as the web's.
   * Off by default: a bar in a row whose own text names it still has its name read.
   */
  showValue?: boolean;
  /** The right-hand reading: "7 of 11 tasks", "About 2 min left". Defaults to the percentage. */
  valueLabel?: string;
  /** Keeps the label off the screen even with `showValue`. Unprinted is the default. */
  hideLabel?: boolean;
  tone?: ProgressTone;
  /** The bar's thickness: 8 by default, 6 in a dense row. */
  thickness?: 6 | 8;
  className?: string | undefined;
};

export function Progress({
  value,
  max = 100,
  label,
  valueLabel,
  showValue = false,
  hideLabel = false,
  tone = 'accent',
  thickness = 8,
  className,
}: ProgressProps): React.JSX.Element {
  const indeterminate = value === null;
  const printed = showValue && !hideLabel;
  const reduced = useReducedMotion();
  const [track, setTrack] = useState(0);
  const width = useSharedValue(indeterminate ? 0 : percent(value, max));
  const sweep = useSharedValue(0);

  useEffect(() => {
    if (value === null) return;
    const to = percent(value, max);
    width.value = reduced ? to : animateTo(to, SETTLE);
  }, [value, max, reduced, width]);

  useEffect(() => {
    if (!indeterminate) return undefined;
    sweep.value = 0;
    sweep.value = withRepeat(
      withTiming(1, { duration: SWEEP_MS, easing: Easing.bezier(...easings.standard) }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(sweep);
    };
  }, [indeterminate, sweep]);

  const bar = useAnimatedStyle(() => ({ width: (track * width.value) / 100 }));
  // 40% of the track, from just off its start to just past its end.
  const band = useAnimatedStyle(() => ({
    width: track * 0.4,
    transform: [{ translateX: -track * 0.4 + sweep.value * track * 1.4 }],
  }));

  const reading =
    valueLabel ?? (indeterminate ? '' : `${String(Math.round(percent(value, max)))}%`);
  const meter = (
    <View
      {...(printed ? {} : a11y(label, value, max, valueLabel))}
      onLayout={(e: LayoutChangeEvent) => {
        setTrack(e.nativeEvent.layout.width);
      }}
      className={cn(
        'overflow-hidden rounded-full bg-surface-active',
        thickness === 6 ? 'h-1.5' : 'h-2',
      )}
    >
      {/* The motion on bare Animated.Views, the colour on a view inside (RMB-001). */}
      <Animated.View
        style={[{ position: 'absolute', top: 0, bottom: 0, left: 0 }, indeterminate ? band : bar]}
      >
        <View className={cn('flex-1 rounded-full', fill[tone])} />
      </Animated.View>
    </View>
  );

  if (!printed) return <View className={cn('w-full', className)}>{meter}</View>;
  return (
    <View {...a11y(label, value, max, valueLabel)} className={cn('w-full gap-2', className)}>
      <View className="flex-row justify-between gap-3">
        <CssText className="flex-1 text-subhead font-medium leading-[1.3] text-fg">{label}</CssText>
        {reading ? (
          <CssText className="text-subhead font-medium leading-[1.3] text-fg-muted tabular-nums">
            {reading}
          </CssText>
        ) : null}
      </View>
      {meter}
    </View>
  );
}

const mapping = { className: { target: 'style', nativeStyleMapping: { color: 'color' } } } as const;

/** One circle of the ring, drawn in its class's colour. */
function Ring({
  size,
  r,
  weight,
  dash,
  className,
}: {
  size: number;
  r: number;
  weight: number;
  dash?: string;
  className: string;
}): React.JSX.Element {
  return useCssElement(
    Svg,
    {
      width: size,
      height: size,
      viewBox: `0 0 ${String(size)} ${String(size)}`,
      className,
      children: (
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={weight}
          {...(dash ? { strokeLinecap: 'round' as const, strokeDasharray: dash } : {})}
        />
      ),
    },
    mapping,
  );
}

export type CircularProgressProps = {
  value: number | null;
  max?: number;
  label: string;
  /** Across, in points. 56 by default. */
  size?: number;
  tone?: ProgressTone;
  /** Prints the rounded percentage in the middle, as the web's. */
  showValue?: boolean;
  className?: string | undefined;
};

/** A ring with the percentage in it, or a turning arc when it cannot be told. */
export function CircularProgress({
  value,
  max = 100,
  label,
  size = 56,
  tone = 'accent',
  showValue = false,
  className,
}: CircularProgressProps): React.JSX.Element {
  const indeterminate = value === null;
  const weight = Math.max(3, Math.round(size / 9));
  const r = (size - weight) / 2;
  const c = 2 * Math.PI * r;
  const share = indeterminate ? 0.28 : percent(value, max) / 100;
  const turn = useSharedValue(0);

  useEffect(() => {
    if (!indeterminate) return undefined;
    turn.value = withRepeat(
      withTiming(360, { duration: TURN_MS, easing: Easing.linear }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(turn);
    };
  }, [indeterminate, turn]);
  const spin = useAnimatedStyle(() => ({
    transform: [{ rotate: `${String(turn.value - 90)}deg` }],
  }));

  return (
    <View
      {...a11y(label, value, max)}
      className={cn('items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <View aria-hidden className="absolute inset-0">
        <Ring size={size} r={r} weight={weight} className="text-surface-active" />
      </View>
      <Animated.View
        aria-hidden
        style={[{ position: 'absolute', top: 0, left: 0, width: size, height: size }, spin]}
      >
        <Ring
          size={size}
          r={r}
          weight={weight}
          dash={`${(c * share).toFixed(1)} ${c.toFixed(1)}`}
          className={stroke[tone]}
        />
      </Animated.View>
      {indeterminate || !showValue ? null : (
        <CssText
          aria-hidden
          className="font-bold leading-none text-fg tabular-nums"
          style={{ fontSize: Math.round(size * 0.25) }}
        >
          {`${String(Math.round(percent(value, max)))}%`}
        </CssText>
      )}
    </View>
  );
}
