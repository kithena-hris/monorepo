import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, type LayoutChangeEvent } from 'react-native';
import { Text as CssText, View } from 'react-native-css/components';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { cn } from '../../lib/cn.ts';
import { useFocusRing } from '../../lib/focus-ring.ts';

const WEB = Platform.OS === 'web';
/** The thumb, 28pt under a thumb; the track 6pt; a vertical slider 180 long. */
const THUMB = 28;
const LENGTH = 180;

/** A percentage as React Native's style types want it. */
function percentOf(n: number): `${number}%` {
  'worklet';
  return `${String(n)}%` as `${number}%`;
}

export type SliderProps = {
  /** One value, or two for a range. */
  value: readonly number[];
  onValueChange: (value: number[]) => void;
  /** When a drag ends or a key changes it: where to save. */
  onValueCommit?: (value: number[]) => void;
  /** Required: each thumb is named from it. */
  label: string;
  /** Names each thumb of a range: `['Minimum', 'Maximum']`. */
  thumbLabels?: readonly string[];
  min?: number;
  max?: number;
  step?: number;
  /**
   * A dark bubble over each thumb with its value. A function formats it, and
   * the string it returns is also what a screen reader hears.
   */
  tip?: boolean | ((value: number) => string);
  /** A dot at every step. For a few discrete steps only. */
  showTicks?: boolean;
  /** Under the track, first step to last. */
  labels?: readonly ReactNode[];
  /** Above the track, at the end: the live value, printed. */
  valueDisplay?: ReactNode;
  orientation?: 'horizontal' | 'vertical';
  disabled?: boolean;
  className?: string | undefined;
};

/**
 * A rough value where the range matters more than the number. Pair it with a
 * NumberField when the exact value matters. A touch anywhere on the track
 * takes the nearest thumb there; each thumb is adjustable on its own, by
 * arrows from a keyboard and by swiping up and down with a screen reader.
 */
export function Slider({
  value,
  onValueChange,
  onValueCommit,
  label,
  thumbLabels,
  min = 0,
  max = 100,
  step = 1,
  tip = false,
  showTicks = false,
  labels,
  valueDisplay,
  orientation = 'horizontal',
  disabled = false,
  className,
}: SliderProps): React.JSX.Element {
  const vertical = orientation === 'vertical';
  const [length, setLength] = useState(vertical ? LENGTH : 0);

  /*
   * The drag runs on the UI thread: the thumbs and the fill read `values`, a
   * shared value the gesture writes, so they follow the finger without a
   * render. The owner hears of a change only when the snapped value moves.
   */
  const values = useSharedValue<number[]>([...value]);
  const dragging = useSharedValue(false);
  const active = useSharedValue(0);
  useEffect(() => {
    if (!dragging.value) values.value = [...value];
  }, [value, values, dragging]);
  const handlers = useRef({ onValueChange, onValueCommit });
  handlers.current = { onValueChange, onValueCommit };
  const change = useCallback((next: number[]) => {
    handlers.current.onValueChange(next);
  }, []);
  const commit = useCallback((next: number[]) => {
    handlers.current.onValueCommit?.(next);
  }, []);

  const span = max - min;
  const format = (v: number): string => (typeof tip === 'function' ? tip(v) : String(v));

  /** Moves thumb `i` to `v`, snapped, keeping a range's thumbs in order. */
  const move = (current: readonly number[], i: number, v: number): number[] => {
    'worklet';
    const stepped = Math.round((v - min) / step) * step + min;
    const snapped = Math.min(max, Math.max(min, Number(stepped.toFixed(10))));
    const next = [...current];
    const lo = i > 0 ? (next[i - 1] ?? min) : min;
    const hi = i < next.length - 1 ? (next[i + 1] ?? max) : max;
    next[i] = Math.min(hi, Math.max(lo, snapped));
    return next;
  };
  const at = (x: number, y: number): number => {
    'worklet';
    const along = vertical ? length - y : x;
    return min + (Math.min(length, Math.max(0, along)) / Math.max(1, length)) * span;
  };
  const drag = (next: number[]): void => {
    'worklet';
    if (next.some((v, i) => v !== values.value[i])) {
      values.value = next;
      scheduleOnRN(change, next);
    }
  };

  const pan = Gesture.Pan()
    .enabled(!disabled && length > 0)
    .minDistance(0)
    .onBegin((e) => {
      dragging.value = true;
      const v = at(e.x, e.y);
      const now = values.value;
      // The nearest thumb; on a tie, the one that can move that way.
      let best = 0;
      for (let i = 0; i < now.length; i += 1) {
        const d = Math.abs((now[i] ?? 0) - v);
        const b = Math.abs((now[best] ?? 0) - v);
        if (d < b || (d === b && v > (now[i] ?? 0))) best = i;
      }
      active.value = best;
      drag(move(now, best, v));
    })
    .onUpdate((e) => {
      drag(move(values.value, active.value, at(e.x, e.y)));
    })
    .onFinalize(() => {
      dragging.value = false;
      scheduleOnRN(commit, values.value);
    });

  const fill = useAnimatedStyle(() => {
    const now = values.value;
    const p = (v: number): number => (span === 0 ? 0 : ((v - min) / span) * 100);
    const lo = now.length > 1 ? p(now[0] ?? min) : 0;
    const hi = p(now[now.length - 1] ?? min);
    return vertical
      ? {
          position: 'absolute',
          left: 11,
          width: 6,
          bottom: percentOf(lo),
          height: percentOf(hi - lo),
        }
      : {
          position: 'absolute',
          top: 11,
          height: 6,
          left: percentOf(lo),
          width: percentOf(hi - lo),
        };
  });
  const pct = (v: number): number => (span === 0 ? 0 : ((v - min) / span) * 100);
  const lo = value.length > 1 ? pct(value[0] ?? min) : 0;
  const hi = pct(value[value.length - 1] ?? min);
  const steps = showTicks ? Math.round(span / step) : 0;

  return (
    <View
      className={cn(
        !vertical && 'self-stretch',
        tip !== false && !vertical && 'pt-[30px]',
        className,
      )}
    >
      {valueDisplay ? <View className="mb-2 flex-row justify-end">{valueDisplay}</View> : null}
      <GestureDetector gesture={pan}>
        <View
          onLayout={(e: LayoutChangeEvent) => {
            if (!vertical) setLength(e.nativeEvent.layout.width);
          }}
          // The track's own 28pt plus 8 either side: 44 to a thumb.
          hitSlop={vertical ? { left: 8, right: 8 } : { top: 8, bottom: 8 }}
          className={cn('relative', disabled && 'opacity-45')}
          style={vertical ? { width: THUMB, height: LENGTH } : { height: THUMB }}
        >
          <View
            className={cn(
              'absolute rounded-full bg-surface-active',
              vertical ? 'top-0 bottom-0 left-[11px] w-1.5' : 'top-[11px] right-0 left-0 h-1.5',
            )}
          />
          {/* The motion on a bare Animated.View, the classes inside it (RMB-001). */}
          <Animated.View style={fill}>
            <View
              className={cn('size-full rounded-full', disabled ? 'bg-fg-subtle' : 'bg-accent')}
            />
          </Animated.View>
          {Array.from({ length: steps > 0 ? steps + 1 : 0 }, (_, i) => {
            const p = (i / steps) * 100;
            const lit = p >= lo && p <= hi;
            return (
              <View
                key={i}
                aria-hidden
                className={cn(
                  'absolute size-1 rounded-full',
                  lit ? 'bg-white/70' : 'bg-fg-subtle',
                  vertical ? 'left-3' : 'top-3',
                )}
                style={
                  vertical
                    ? { bottom: percentOf(p), marginBottom: -2 }
                    : { left: percentOf(p), marginLeft: -2 }
                }
              />
            );
          })}
          {value.map((v, i) => (
            <Thumb
              key={i}
              index={i}
              values={values}
              min={min}
              max={max}
              value={v}
              vertical={vertical}
              disabled={disabled}
              label={
                thumbLabels?.[i] ??
                (value.length > 1 ? `${label}, ${i === 0 ? 'minimum' : 'maximum'}` : label)
              }
              text={format(v)}
              tip={tip !== false}
              onStep={(direction, big) => {
                const next = move(value, i, v + direction * step * (big ? 10 : 1));
                onValueChange(next);
                onValueCommit?.(next);
              }}
              onEdge={(edge) => {
                const next = move(value, i, edge === 'start' ? min : max);
                onValueChange(next);
                onValueCommit?.(next);
              }}
            />
          ))}
        </View>
      </GestureDetector>
      {labels ? (
        <View aria-hidden className="mt-2.5 flex-row justify-between">
          {labels.map((l, i) => (
            <CssText key={i} className="text-[12px] font-medium text-fg-subtle">
              {l}
            </CssText>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const KEYS: Record<string, [1 | -1, boolean] | 'start' | 'end'> = {
  ArrowRight: [1, false],
  ArrowUp: [1, false],
  ArrowLeft: [-1, false],
  ArrowDown: [-1, false],
  PageUp: [1, true],
  PageDown: [-1, true],
  Home: 'start',
  End: 'end',
};

function Thumb({
  index,
  values,
  value,
  vertical,
  disabled,
  label,
  min,
  max,
  text,
  tip,
  onStep,
  onEdge,
}: {
  index: number;
  /** Every thumb's value, written by the drag on the UI thread. */
  values: SharedValue<number[]>;
  value: number;
  vertical: boolean;
  disabled: boolean;
  label: string;
  min: number;
  max: number;
  text: string;
  tip: boolean;
  onStep: (direction: 1 | -1, big: boolean) => void;
  onEdge: (edge: 'start' | 'end') => void;
}): React.JSX.Element {
  const ring = useFocusRing();
  const place = useAnimatedStyle(() => {
    const v = values.value[index] ?? min;
    const p = percentOf(max === min ? 0 : ((v - min) / (max - min)) * 100);
    return vertical
      ? { position: 'absolute', left: 0, bottom: p, marginBottom: -THUMB / 2 }
      : { position: 'absolute', top: 0, left: p, marginLeft: -THUMB / 2 };
  });
  return (
    // The motion on a bare Animated.View, the classes inside it (RMB-001).
    <Animated.View style={place}>
      <View
        role="slider"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={text}
        aria-orientation={vertical ? 'vertical' : 'horizontal'}
        aria-disabled={disabled || undefined}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min, max, now: value, text }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          if (disabled) return;
          onStep(e.nativeEvent.actionName === 'increment' ? 1 : -1, false);
        }}
        {...(WEB
          ? {
              tabIndex: disabled ? -1 : 0,
              onKeyDown: (event: { key: string; preventDefault: () => void }) => {
                const action = KEYS[event.key];
                if (action === undefined || disabled) return;
                event.preventDefault();
                if (action === 'start' || action === 'end') onEdge(action);
                else onStep(action[0], action[1]);
              },
            }
          : {})}
        onFocus={ring.onFocus}
        onBlur={ring.onBlur}
        className="size-7 items-center justify-center rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.3),0_0_0_0.5px_rgba(0,0,0,0.12)] outline-none"
      >
        {ring.focused ? (
          <View
            style={{ pointerEvents: 'none' }}
            className="absolute -inset-[5px] rounded-full border-[3px] border-border-focus"
          />
        ) : null}
        {tip ? (
          <View
            aria-hidden
            style={{ pointerEvents: 'none' }}
            className={cn(
              'absolute rounded-[8px] bg-invert px-2 py-1',
              // The thumb centres it across; the inset puts it beside or above.
              vertical ? 'left-9' : 'bottom-9',
            )}
          >
            <CssText numberOfLines={1} className="text-[12px] font-semibold text-fg-on-invert">
              {text}
            </CssText>
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}
