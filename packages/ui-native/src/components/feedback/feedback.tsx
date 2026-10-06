import { cva, type VariantProps } from 'class-variance-authority';
import { Bell, CircleAlert, CircleCheck, Info, Sparkles, TriangleAlert, X } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
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
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { cn } from '../../lib/cn.ts';
import { useReducedMotion } from '../../provider.tsx';
import { Button } from '../button/button.tsx';
import { Icon, type IconProps, type LucideIcon } from '../icon/icon.tsx';

const WEB = Platform.OS === 'web';

/* -------------------------------------------------------------------------- */
/* Alert                                                                       */
/* -------------------------------------------------------------------------- */

/*
 * The web alert at the phone's sizes: 18 corners, padded 14 × 16, a 20pt
 * glyph, the title 16 and the message 15.
 */
const alert = cva('flex-row items-start gap-3 px-4 py-3.5', {
  variants: {
    tone: { info: '', success: '', warning: '', danger: '', accent: '', neutral: '' },
    /**
     * `soft` sits among content. `outline` keeps the surface and marks the
     * edge, for a busy background. `solid` is for a blocking problem only.
     * `banner` runs edge to edge at the top of a page.
     */
    variant: {
      soft: 'rounded-[18px]',
      outline: 'rounded-[18px] border border-border-strong bg-surface',
      solid: 'rounded-[18px]',
      banner: 'rounded-none',
    },
  },
  compoundVariants: [
    { variant: ['soft', 'banner'], tone: 'info', class: 'bg-info-subtle' },
    { variant: ['soft', 'banner'], tone: 'success', class: 'bg-success-subtle' },
    { variant: ['soft', 'banner'], tone: 'warning', class: 'bg-warning-subtle' },
    { variant: ['soft', 'banner'], tone: 'danger', class: 'bg-danger-subtle' },
    { variant: ['soft', 'banner'], tone: 'accent', class: 'bg-accent-subtle' },
    { variant: ['soft', 'banner'], tone: 'neutral', class: 'bg-surface-sunken' },
    // A solid `Badge`'s fills: each holds 4.5:1 with its text in both themes.
    { variant: 'solid', tone: 'info', class: 'bg-info-fg' },
    { variant: 'solid', tone: 'success', class: 'bg-success-solid' },
    { variant: 'solid', tone: 'warning', class: 'bg-warning-fg' },
    { variant: 'solid', tone: 'danger', class: 'bg-danger-solid' },
    { variant: 'solid', tone: 'accent', class: 'bg-accent-solid' },
    { variant: 'solid', tone: 'neutral', class: 'bg-invert' },
  ],
  defaultVariants: { tone: 'info', variant: 'soft' },
});

export type AlertTone = NonNullable<VariantProps<typeof alert>['tone']>;
type Tone = NonNullable<IconProps['tone']>;

const glyph: Record<AlertTone, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
  accent: Sparkles,
  neutral: Bell,
};

/** The glyph carries the tone; the words stay at full contrast. */
const glyphTone: Record<AlertTone, Tone> = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  accent: 'accent',
  neutral: 'muted',
};

/** On a solid fill, everything takes the fill's text colour. */
const solidInk: Record<AlertTone, [string, Tone]> = {
  info: ['text-surface', 'on-invert'],
  success: ['text-fg-on-solid', 'on-accent'],
  warning: ['text-surface', 'on-invert'],
  danger: ['text-fg-on-solid', 'on-accent'],
  accent: ['text-fg-on-accent', 'on-accent'],
  neutral: ['text-fg-on-invert', 'on-invert'],
};

export type AlertProps = VariantProps<typeof alert> & {
  title?: ReactNode;
  /** The message. */
  children?: ReactNode;
  /** Leave out the glyph when the layout around already says the tone. */
  hideIcon?: boolean;
  /** Replaces the tone's glyph when the message has a better one, still in the tone's colour. */
  icon?: LucideIcon;
  /** A trailing action, beside the message. */
  action?: ReactNode;
  /** Actions under the message, for the "what now" of a failure: small secondary buttons. */
  actions?: ReactNode;
  /** Shows a close button. The alert does not hide itself; the caller does. */
  onDismiss?: () => void;
  dismissLabel?: string;
  className?: string | undefined;
};

/**
 * A message about the content around it. `danger` and `warning` are
 * announced at once; the quieter tones wait for a pause.
 */
export function Alert({
  tone,
  variant,
  title,
  children,
  hideIcon = false,
  icon,
  action,
  actions,
  onDismiss,
  dismissLabel = 'Dismiss',
  className,
}: AlertProps): React.JSX.Element {
  const t = tone ?? 'info';
  const solid = variant === 'solid';
  const urgent = t === 'danger' || t === 'warning';
  const [text, ink] = solid ? solidInk[t] : ['text-fg', glyphTone[t]];
  const message = solid ? text : 'text-fg-muted';

  return (
    <View
      {...(WEB ? { role: urgent ? ('alert' as const) : ('status' as const) } : urgent ? { role: 'alert' as const } : {})}
      aria-live={urgent ? 'assertive' : 'polite'}
      className={cn(alert({ tone: t, variant }), className)}
    >
      {hideIcon ? null : (
        <View className="pt-px">
          <Icon icon={icon ?? glyph[t]} tone={ink} />
        </View>
      )}
      <View className="min-w-0 flex-1 gap-1">
        {title ? (
          <CssText className={cn('text-callout font-semibold leading-[1.35]', text)}>{title}</CssText>
        ) : null}
        {children ? (
          typeof children === 'string' ? (
            <CssText className={cn('text-subhead leading-[1.5]', message)}>{children}</CssText>
          ) : (
            children
          )
        ) : null}
        {actions ? <View className="mt-1.5 flex-row flex-wrap gap-2">{actions}</View> : null}
      </View>
      {action ? <View className="self-center">{action}</View> : null}
      {onDismiss ? (
        <View className="-my-1.5 -mr-2">
          <Button
            variant="ghost"
            size="xs"
            onPress={onDismiss}
            accessibilityLabel={dismissLabel}
            startIcon={<Icon icon={X} size={16} tone={solid ? ink : 'muted'} />}
          />
        </View>
      ) : null}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Skeleton                                                                    */
/* -------------------------------------------------------------------------- */

/** One sweep of the shimmer, the web's `animate-shimmer`. Decoration: still under reduced motion. */
const SHIMMER_MS = 1600;

const sweepMapping = {
  className: { target: 'style', nativeStyleMapping: { color: 'color' } },
} as const;

function Sweep({ width }: { width: number }): React.JSX.Element {
  const x = useSharedValue(-width);
  useEffect(() => {
    x.value = -width;
    x.value = withRepeat(withTiming(width, { duration: SHIMMER_MS, easing: Easing.linear }), -1, false);
    return () => {
      cancelAnimation(x);
    };
  }, [x, width]);
  const move = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  // The highlight, a band of `surface-hover` fading in and out, drawn in `currentColor`.
  const band = useCssElement(
    Svg,
    {
      width,
      height: '100%',
      preserveAspectRatio: 'none',
      className: 'text-surface-hover',
      children: [
        <Defs key="defs">
          <LinearGradient id="reach-shimmer" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="currentColor" stopOpacity={0} />
            <Stop offset="0.5" stopColor="currentColor" stopOpacity={1} />
            <Stop offset="1" stopColor="currentColor" stopOpacity={0} />
          </LinearGradient>
        </Defs>,
        <Rect key="band" width="100%" height="100%" fill="url(#reach-shimmer)" />,
      ],
    },
    sweepMapping,
  );
  return (
    <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, left: 0 }, move]}>
      {band}
    </Animated.View>
  );
}

export type SkeletonProps = {
  /** Size and shape: `h-3 w-[140px]`, `size-11 rounded-full`. */
  className?: string | undefined;
};

/**
 * A placeholder shaped like the content it stands for, so nothing jumps when
 * the data lands. Hidden from a screen reader: say "Loading" once, on the
 * region, not on every bar.
 */
export function Skeleton({ className }: SkeletonProps): React.JSX.Element {
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  return (
    <View
      aria-hidden
      {...(WEB ? {} : { accessible: false, importantForAccessibility: 'no-hide-descendants' as const })}
      onLayout={(e: LayoutChangeEvent) => {
        setWidth(Math.round(e.nativeEvent.layout.width));
      }}
      className={cn('h-3 overflow-hidden rounded-md bg-surface-sunken', className)}
    >
      {!reduced && width > 0 ? <Sweep width={width} /> : null}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* EmptyState                                                                  */
/* -------------------------------------------------------------------------- */

export type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** The next step: one button, or two. */
  action?: ReactNode;
  /** `accent` for an invitation ("Invite your team") rather than a report that nothing is here. */
  tone?: 'neutral' | 'accent';
  className?: string | undefined;
};

/** Nothing to show. Name the reason and offer the next step. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  tone = 'neutral',
  className,
}: EmptyStateProps): React.JSX.Element {
  return (
    <View className={cn('items-center gap-2.5 px-4 py-7', className)}>
      {icon ? (
        <View
          className={cn(
            'size-14 items-center justify-center rounded-full',
            tone === 'accent' ? 'bg-accent-subtle' : 'bg-surface-sunken',
          )}
        >
          <Icon icon={icon} size={26} tone={tone === 'accent' ? 'accent' : 'muted'} />
        </View>
      ) : null}
      <CssText className="text-center text-headline font-semibold text-fg">{title}</CssText>
      {description ? (
        <CssText className="max-w-80 text-center text-subhead leading-[1.5] text-fg-muted">
          {description}
        </CssText>
      ) : null}
      {action ? <View className="mt-1.5 flex-row flex-wrap justify-center gap-2">{action}</View> : null}
    </View>
  );
}
