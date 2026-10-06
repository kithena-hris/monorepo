import { Platform } from 'react-native';
import { useCssElement } from 'react-native-css';
import { Pressable, Text as CssText, View } from 'react-native-css/components';
import Animated from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { usePress } from '../../lib/animate.ts';
import { cn } from '../../lib/cn.ts';
import { useFocusRing } from '../../lib/focus-ring.ts';

const WEB = Platform.OS === 'web';
const mapping = { className: { target: 'style', nativeStyleMapping: { color: 'color' } } } as const;

/** The two symbols the design draws: a star, and a heart for a lighter scale. */
export const ratingSymbols = {
  star: 'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z',
  heart: 'M12 20.5s-8-4.9-8-11A4.5 4.5 0 0 1 12 6.6a4.5 4.5 0 0 1 8 2.9c0 6.1-8 11-8 11z',
} as const;

const toneClass = {
  warning: 'text-warning',
  accent: 'text-accent',
  success: 'text-success',
  danger: 'text-danger',
} as const;

function Glyph({ d, size, className }: { d: string; size: number; className: string }) {
  return useCssElement(
    Svg,
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      className,
      children: <Path d={d} fill="currentColor" />,
    },
    mapping,
  );
}

/** One symbol, lit to `fill` (0 to 1) from the start edge: an empty one is the strong fill, not an outline. */
function Symbol({
  fill,
  size,
  d,
  tone,
}: {
  fill: number;
  size: number;
  d: string;
  tone: keyof typeof toneClass;
}): React.JSX.Element {
  return (
    <View style={{ width: size, height: size }} aria-hidden>
      <Glyph d={d} size={size} className="text-surface-active" />
      {fill > 0 ? (
        // A clipped overlay rather than a half glyph: an average of 4.3 is not a half.
        <View
          className="absolute top-0 bottom-0 left-0 overflow-hidden"
          style={{ width: size * Math.min(1, fill) }}
        >
          <Glyph d={d} size={size} className={toneClass[tone]} />
        </View>
      ) : null}
    </View>
  );
}

export type RatingProps = {
  /** Whole numbers when writing; any fraction when `readOnly`. 0 is not rated. */
  value: number;
  onChange?: (value: number) => void;
  /** Required: "Delivery", not "Rating". */
  label: string;
  max?: number;
  /**
   * A word for each value, read instead of the number and shown beside the
   * stars with `showValue`: "3 of 5" means nothing until it means "Meets".
   */
  valueLabels?: readonly string[];
  /** The symbol's side in points. 36 under a thumb; 22 beside an average. */
  size?: number;
  /** The word (or number) for the value, beside the symbols. */
  showValue?: boolean;
  /** Picking the current value again clears it. */
  clearable?: boolean;
  /** Display only: one image with a text alternative, fractions drawn, no target. */
  readOnly?: boolean;
  disabled?: boolean;
  symbol?: keyof typeof ratingSymbols;
  tone?: keyof typeof toneClass;
  className?: string | undefined;
};

/**
 * A whole number from 1 to 5, as a row of stars. It is a radio group: one
 * stop for a keyboard, arrows to change it, and each star read as "4 of 5"
 * or its word. A displayed average is a different thing, `readOnly`: one
 * image, "4.3 out of 5", never a control, because nobody can tap 4.3.
 */
export function Rating({
  value,
  onChange,
  label,
  max = 5,
  valueLabels,
  size = 36,
  showValue = false,
  clearable = true,
  readOnly = false,
  disabled = false,
  symbol = 'star',
  tone = 'warning',
  className,
}: RatingProps): React.JSX.Element {
  const ring = useFocusRing();
  const d = ratingSymbols[symbol];
  // Small symbols spread out so each still has a 44pt slice of the row.
  const gap = size >= 36 ? 4 : size >= 24 ? 8 : 16;
  const describe = (rating: number): string =>
    valueLabels?.[rating - 1] ?? `${String(rating)} of ${String(max)}`;

  if (readOnly) {
    const rounded = Math.round(value * 10) / 10;
    return (
      <View
        role="img"
        aria-label={`${label}: ${String(rounded)} out of ${String(max)}`}
        accessible
        accessibilityLabel={`${label}: ${String(rounded)} out of ${String(max)}`}
        className={cn('flex-row items-center', className)}
        style={{ gap: size >= 24 ? 4 : 2 }}
      >
        {Array.from({ length: max }, (_, i) => (
          <Symbol key={i} fill={Math.max(0, value - i)} size={size} d={d} tone={tone} />
        ))}
      </View>
    );
  }

  const interactive = !disabled && onChange !== undefined;
  const set = (next: number): void => {
    if (interactive) onChange(Math.max(0, Math.min(max, next)));
  };
  const keys = (key: string): number | undefined =>
    ({
      ArrowRight: value + 1,
      ArrowUp: value + 1,
      ArrowLeft: value - 1,
      ArrowDown: value - 1,
      Home: clearable ? 0 : 1,
      End: max,
      '0': clearable ? 0 : undefined,
    })[key];

  return (
    <View className={cn('flex-row items-center', disabled && 'opacity-50', className)}>
      <View
        role="radiogroup"
        aria-label={label}
        aria-disabled={disabled || undefined}
        accessibilityLabel={label}
        // One stop for the group, as the radio pattern has it: arrows inside.
        {...(WEB
          ? {
              tabIndex: disabled ? -1 : 0,
              onKeyDown: (event: { key: string; preventDefault: () => void }) => {
                const next = keys(event.key);
                if (next === undefined) return;
                event.preventDefault();
                set(next);
              },
            }
          : {})}
        onFocus={ring.onFocus}
        onBlur={ring.onBlur}
        className="flex-row rounded-[8px] outline-none"
        style={{ gap }}
      >
        {Array.from({ length: max }, (_, i) => {
          const rating = i + 1;
          const lit = rating <= value;
          return (
            <RatingStar
              key={rating}
              label={describe(rating)}
              checked={value === rating}
              lit={lit}
              focused={ring.focused && rating === Math.max(1, value)}
              disabled={!interactive}
              size={size}
              gap={gap}
              d={d}
              tone={tone}
              onPress={() => {
                set(clearable && value === rating ? 0 : rating);
              }}
            />
          );
        })}
      </View>
      {showValue ? (
        <CssText
          aria-live="polite"
          accessibilityLiveRegion="polite"
          className="ml-2 text-subhead font-semibold text-fg"
        >
          {value === 0 ? 'Not rated' : describe(value)}
        </CssText>
      ) : null}
    </View>
  );
}

function RatingStar({
  label,
  checked,
  lit,
  focused,
  disabled,
  size,
  gap,
  d,
  tone,
  onPress,
}: {
  label: string;
  checked: boolean;
  lit: boolean;
  focused: boolean;
  disabled: boolean;
  size: number;
  gap: number;
  d: string;
  tone: keyof typeof toneClass;
  onPress: () => void;
}): React.JSX.Element {
  const press = usePress();
  const slop = Math.max(0, (44 - size) / 2);
  return (
    <Pressable
      role="radio"
      aria-checked={checked}
      aria-label={label}
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      {...(WEB ? { tabIndex: -1 as const } : {})}
      hitSlop={{ top: slop, bottom: slop, left: gap / 2, right: gap / 2 }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onPress={onPress}
      className="rounded-[8px]"
    >
      <Animated.View style={press.style}>
        <Symbol fill={lit ? 1 : 0} size={size} d={d} tone={tone} />
      </Animated.View>
      {focused ? (
        <View
          style={{ pointerEvents: 'none' }}
          className="absolute -inset-[5px] rounded-[13px] border-[3px] border-border-focus"
        />
      ) : null}
    </Pressable>
  );
}
