import { cva, type VariantProps } from 'class-variance-authority';
import { Pressable } from 'react-native';
import { ActivityIndicator, Text as CssText, View } from 'react-native-css/components';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

export const buttonVariants = cva('flex-row items-center justify-center gap-2 rounded-full', {
  variants: {
    variant: {
      primary: 'bg-accent-solid',
      secondary: 'bg-surface-sunken',
      tinted: 'bg-accent-subtle',
      ghost: 'bg-transparent',
      danger: 'bg-danger-solid',
    },
    size: {
      md: 'h-m-btn px-5',
      sm: 'h-m-btn-sm px-3.5',
    },
    disabled: { true: 'opacity-40', false: '' },
  },
  defaultVariants: { variant: 'primary', size: 'md', disabled: false },
});

const labelVariants = cva('', {
  variants: {
    variant: {
      primary: 'text-fg-on-accent',
      secondary: 'text-fg',
      tinted: 'text-accent-fg',
      ghost: 'text-accent-fg',
      danger: 'text-fg-on-accent',
    },
    size: {
      md: 'text-headline',
      sm: 'text-subhead font-semibold',
    },
  },
  defaultVariants: { variant: 'primary', size: 'md' },
});

export type ButtonProps = Omit<VariantProps<typeof buttonVariants>, 'disabled'> & {
  children: string;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** Overrides the label read to assistive technology. Defaults to the text. */
  accessibilityLabel?: string;
  className?: string;
};

const PRESSED_SCALE = 0.97;
const PRESS_MS = 120;

export function Button({
  children,
  variant,
  size,
  onPress,
  disabled = false,
  loading = false,
  accessibilityLabel,
  className,
}: ButtonProps): React.JSX.Element {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const inert = disabled || loading;
  const label = labelVariants({ variant, size });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? children}
      accessibilityState={{ disabled: inert, busy: loading }}
      disabled={inert}
      onPress={onPress}
      onPressIn={() => {
        scale.value = withTiming(PRESSED_SCALE, { duration: PRESS_MS });
      }}
      onPressOut={() => {
        scale.value = withTiming(1, { duration: PRESS_MS });
      }}
    >
      {/*
        The scale lives on a bare Animated.View and the classes on a View inside
        it. Handing react-native-css an animated style (`styled(Animated.View)`)
        makes it read shared values during render, which Reanimated warns about.
      */}
      <Animated.View style={animated}>
        <View className={buttonVariants({ variant, size, disabled, className })}>
          {/* Decorative: the button already reports `busy`. */}
          {loading ? <ActivityIndicator size="small" className={label} aria-hidden /> : null}
          <CssText className={label}>{children}</CssText>
        </View>
      </Animated.View>
    </Pressable>
  );
}
