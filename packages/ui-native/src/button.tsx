import { cva, type VariantProps } from 'class-variance-authority';
import { Pressable } from 'react-native';
import { styled } from 'react-native-css';
import { ActivityIndicator, Text as CssText } from 'react-native-css/components';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

/** The visual box. Animated so the press scale runs on the UI thread. */
const Box = styled(Animated.View);

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
      <Box className={buttonVariants({ variant, size, disabled, className })} style={animated}>
        {loading ? (
          <ActivityIndicator size="small" className={label} />
        ) : null}
        <CssText className={label}>{children}</CssText>
      </Box>
    </Pressable>
  );
}
