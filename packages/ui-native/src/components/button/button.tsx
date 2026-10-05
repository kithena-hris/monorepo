import { cva, type VariantProps } from 'class-variance-authority';
import { cloneElement, isValidElement, type ReactElement } from 'react';
import { Linking } from 'react-native';
import { Pressable, Text as CssText, View } from 'react-native-css/components';
import Animated from 'react-native-reanimated';

import { usePress } from '../../lib/animate.ts';
import { cn } from '../../lib/cn.ts';
import type { IconProps } from '../icon/icon.tsx';
import { Spinner } from '../spinner/spinner.tsx';

/*
 * Sizes from the mobile design: 52 is the default under a finger, 36 the
 * compact one. `xs` (32) and `lg` (56) exist for icon-only buttons in a bar and
 * for the one pinned action at the foot of a screen. Padding is 42% of the
 * height, the label 17 above 36 and 15 at it, the icon 3 larger than the label.
 */
const button = cva('flex-row items-center justify-center gap-2 rounded-control', {
  variants: {
    variant: {
      primary: 'bg-accent-solid',
      secondary: 'bg-surface-sunken',
      tinted: 'bg-accent-subtle',
      outline: 'bg-transparent border-[1.5px] border-border-strong',
      ghost: 'bg-transparent',
      danger: 'bg-danger-solid',
      'danger-soft': 'bg-danger-subtle',
      invert: 'bg-invert',
      link: 'bg-transparent',
    },
    size: {
      xs: 'h-8 px-[13px]',
      sm: 'h-m-btn-sm px-[15px]',
      md: 'h-m-btn px-[22px]',
      lg: 'h-14 px-6',
    },
    iconOnly: { true: 'px-0', false: '' },
    fullWidth: { true: '', false: '' },
    disabled: { true: '', false: '' },
    pressed: { true: '', false: '' },
  },
  compoundVariants: [
    { iconOnly: true, size: 'xs', class: 'w-8' },
    { iconOnly: true, size: 'sm', class: 'w-m-btn-sm' },
    { iconOnly: true, size: 'md', class: 'w-m-btn' },
    { iconOnly: true, size: 'lg', class: 'w-14' },
    { variant: 'link', class: 'h-auto px-0' },
    // A disabled button keeps its shape and loses its colour, except the ones
    // that never had a fill to lose.
    {
      disabled: true,
      variant: ['primary', 'secondary', 'tinted', 'danger', 'danger-soft', 'invert'],
      class: 'bg-surface-sunken',
    },
    // The pressed colour: the web's `active:` fill. Under reduced motion it is
    // the whole of the press; otherwise it rides along with the scale.
    { pressed: true, variant: 'primary', class: 'bg-accent-active' },
    { pressed: true, variant: 'secondary', class: 'bg-surface-active' },
    { pressed: true, variant: 'tinted', class: 'bg-accent-subtle-hover' },
    { pressed: true, variant: ['outline', 'ghost'], class: 'bg-surface-hover' },
    { pressed: true, variant: 'danger', class: 'bg-danger-hover' },
    { pressed: true, variant: 'danger-soft', class: 'bg-danger-border' },
    { pressed: true, variant: 'invert', class: 'opacity-90' },
  ],
  defaultVariants: {
    variant: 'secondary',
    size: 'md',
    iconOnly: false,
    fullWidth: false,
    disabled: false,
    pressed: false,
  },
});

const tone = {
  primary: 'on-accent',
  secondary: 'default',
  tinted: 'accent',
  outline: 'default',
  ghost: 'default',
  danger: 'on-accent',
  'danger-soft': 'danger',
  invert: 'on-invert',
  link: 'accent',
} as const satisfies Record<string, NonNullable<IconProps['tone']>>;

const label = cva('font-semibold', {
  variants: {
    tone: {
      'on-accent': 'text-fg-on-accent',
      default: 'text-fg',
      accent: 'text-accent-fg',
      danger: 'text-danger-fg',
      'on-invert': 'text-fg-on-invert',
      disabled: 'text-fg-disabled',
    },
    size: { xs: 'text-subhead', sm: 'text-subhead', md: 'text-body', lg: 'text-body' },
    link: { true: 'underline', false: '' },
  },
});

const ICON = { xs: 18, sm: 18, md: 20, lg: 20 } as const;
const SIDE = { xs: 32, sm: 36, md: 52, lg: 56 } as const;
const TAP = 44;

export type ButtonVariants = Omit<VariantProps<typeof button>, 'iconOnly' | 'disabled' | 'pressed'>;

export type ButtonProps = ButtonVariants & {
  /** The label: a verb that says exactly what happens. Leave it out for an icon-only button. */
  children?: string;
  onPress?: () => void;
  /** Opens this address instead of acting: the button becomes a link to a screen reader too. */
  href?: string;
  disabled?: boolean;
  /** Keeps the width and the label; the spinner takes the icon's place. */
  loading?: boolean;
  /** Screen-reader text for the spinner. */
  loadingLabel?: string;
  /** An `<Icon>`. The button sizes and colours it. */
  startIcon?: ReactElement<IconProps>;
  endIcon?: ReactElement<IconProps>;
  /** Required for an icon-only button; otherwise the label is read. */
  accessibilityLabel?: string;
  /** Placement in the layout around it (`flex-1` in a row of two). The look is the variant's. */
  className?: string | undefined;
};

function sized(
  icon: ReactElement<IconProps> | undefined,
  size: number,
  iconTone: IconProps['tone'],
) {
  if (!isValidElement(icon)) return null;
  return cloneElement(icon, { size: icon.props.size ?? size, tone: icon.props.tone ?? iconTone });
}

/**
 * One primary per view. Labels are verbs that say exactly what happens.
 *
 * Every button is at least 44 points to a finger: an icon-only button drawn at
 * 32 or 36 grows its touch area with `hitSlop` rather than its drawing.
 */
export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  onPress,
  href,
  disabled = false,
  loading = false,
  loadingLabel = 'Loading',
  startIcon,
  endIcon,
  accessibilityLabel,
  className,
}: ButtonProps): React.JSX.Element {
  const press = usePress();
  const v = variant ?? 'secondary';
  const s = size ?? 'md';
  const inert = disabled || loading;
  const iconOnly = !children;
  const fg = disabled && !loading ? 'disabled' : tone[v];
  const slop = iconOnly ? Math.max(0, (TAP - SIDE[s]) / 2) : 0;

  return (
    <Pressable
      accessibilityRole={href ? 'link' : 'button'}
      accessibilityLabel={accessibilityLabel ?? children}
      accessibilityState={{ disabled: inert, busy: loading }}
      aria-busy={loading || undefined}
      {...(loading ? { accessibilityHint: loadingLabel } : {})}
      disabled={inert}
      hitSlop={slop}
      onPress={
        href
          ? () => {
              void Linking.openURL(href);
            }
          : onPress
      }
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      className={cn(fullWidth && 'self-stretch', 'rounded-control', className)}
    >
      {/* The scale on a bare Animated.View, the classes on a View inside it (RMB-001). */}
      <Animated.View style={press.style}>
        <View
          className={cn(
            button({
              variant: v,
              size: s,
              iconOnly,
              fullWidth,
              disabled: disabled && !loading,
              pressed: press.pressed,
            }),
          )}
        >
          {loading ? (
            <Spinner size={ICON[s] - 2} tone={tone[v]} decorative />
          ) : (
            sized(startIcon, ICON[s], fg)
          )}
          {children ? (
            <CssText numberOfLines={1} className={label({ tone: fg, size: s, link: v === 'link' })}>
              {children}
            </CssText>
          ) : null}
          {sized(endIcon, ICON[s], fg)}
        </View>
      </Animated.View>
    </Pressable>
  );
}
