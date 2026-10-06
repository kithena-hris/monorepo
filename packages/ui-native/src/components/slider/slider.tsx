import { useRef, useState, type ReactNode } from 'react';
import { Platform, type LayoutChangeEvent } from 'react-native';
import { Text as CssText, View } from 'react-native-css/components';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { cn } from '../../lib/cn.ts';
import { useFocusRing } from '../../lib/focus-ring.ts';

const WEB = Platform.OS === 'web';
/** The thumb, 28pt under a thumb; the track 6pt; a vertical slider 180 long. */
const THUMB = 28;
const LENGTH = 180;

/** A percentage as React Native's style types want it. */
function percentOf(n: number): `${number}%` {
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
  orientation = 'horizontal',
  disabled = false,
  className,
}: SliderProps): React.JSX.Element {
  const vertical = orientation === 'vertical';
  const [length, setLength] = useState(vertical ? LENGTH : 0);
  const active = useRef(0);
  const latest = useRef<number[]>([...value]);
  latest.current = [...value];

  const span = max - min;
  const snap = (v: number): number => {
    const stepped = Math.round((v - min) / step) * step + min;
    return Math.min(max, Math.max(min, Number(stepped.toFixed(10))));
  };
  const pct = (v: number): number => (span === 0 ? 0 : ((v - min) / span) * 100);
  const format = (v: number): string =>
    typeof tip === 'function' ? tip(v) : String(v);

  /** Moves thumb `i` to `v`, keeping a range's thumbs in order. */
  const move = (i: number, v: number): number[] => {
    const next = [...latest.current];
    const lo = i > 0 ? (next[i - 1] ?? min) : min;
    const hi = i < next.length - 1 ? (next[i + 1] ?? max) : max;
    next[i] = Math.min(hi, Math.max(lo, snap(v)));
    return next;
  };
  const at = (x: number, y: number): number => {
    const along = vertical ? length - y : x;
    return min + (Math.min(length, Math.max(0, along)) / Math.max(1, length)) * span;
  };

  const pan = Gesture.Pan()
    .enabled(!disabled && length > 0)
    .minDistance(0)
    .runOnJS(true)
    .onBegin((e) => {
      const v = at(e.x, e.y);
      // The nearest thumb; on a tie, the one that can move that way.
      let best = 0;
      latest.current.forEach((t, i) => {
        const d = Math.abs(t - v);
        const b = Math.abs((latest.current[best] ?? 0) - v);
        if (d < b || (d === b && v > t)) best = i;
      });
      active.current = best;
      onValueChange(move(best, v));
    })
    .onUpdate((e) => {
      onValueChange(move(active.current, at(e.x, e.y)));
    })
    .onFinalize(() => {
      onValueCommit?.(latest.current);
    });

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
          <View
            className={cn(
              'absolute rounded-full',
              disabled ? 'bg-fg-subtle' : 'bg-accent',
              vertical ? 'left-[11px] w-1.5' : 'top-[11px] h-1.5',
            )}
            style={
              vertical
                ? { bottom: percentOf(lo), height: percentOf(hi - lo) }
                : { left: percentOf(lo), width: percentOf(hi - lo) }
            }
          />
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
              value={v}
              percent={pct(v)}
              vertical={vertical}
              disabled={disabled}
              label={thumbLabels?.[i] ?? (value.length > 1 ? `${label}, ${i === 0 ? 'minimum' : 'maximum'}` : label)}
              min={min}
              max={max}
              text={format(v)}
              tip={tip !== false}
              onStep={(direction, big) => {
                const next = move(i, v + direction * step * (big ? 10 : 1));
                onValueChange(next);
                onValueCommit?.(next);
              }}
              onEdge={(edge) => {
                const next = move(i, edge === 'start' ? min : max);
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
  value,
  percent,
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
  value: number;
  percent: number;
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
  return (
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
      className="absolute size-7 items-center justify-center rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.3),0_0_0_0.5px_rgba(0,0,0,0.12)] outline-none"
      style={
        vertical
          ? { bottom: percentOf(percent), marginBottom: -THUMB / 2, left: 0 }
          : { left: percentOf(percent), marginLeft: -THUMB / 2, top: 0 }
      }
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
  );
}
