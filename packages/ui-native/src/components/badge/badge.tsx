import { cva, type VariantProps } from 'class-variance-authority';
import { Lock, Sparkles, TriangleAlert, X } from 'lucide-react-native';
import { Pressable, Text as CssText, View } from 'react-native-css/components';
import Animated from 'react-native-reanimated';

import { usePulse } from '../../lib/animate.ts';
import { cn } from '../../lib/cn.ts';
import { Icon, type IconProps, type LucideIcon } from '../icon/icon.tsx';

type Tone =
  | 'neutral'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'sensitive'
  | 'attention'
  | 'assistant';

/*
 * The web badge's tones and variants, at the mobile design's heights: 22, 26
 * and 30, padded 40% of the height, the label 12 at the smallest and 13 above.
 */
const badge = cva('flex-row items-center gap-1.5 self-start rounded-full', {
  variants: {
    tone: {
      neutral: '',
      accent: '',
      success: '',
      warning: '',
      danger: '',
      info: '',
      sensitive: 'bg-surface border border-border-strong',
      attention: 'bg-warning-subtle border border-dashed border-warning-border',
      assistant: '',
    },
    variant: {
      soft: '',
      solid: '',
      outline: 'bg-transparent border border-border-strong',
    },
    size: {
      /** A count pinned to a control: an 18pt circle that widens with the digits. */
      xs: 'h-[18px] min-w-[18px] justify-center px-[5px]',
      sm: 'h-[22px] px-[9px]',
      md: 'h-[26px] px-2.5',
      lg: 'h-[30px] px-3',
    },
  },
  compoundVariants: [
    { variant: 'soft', tone: 'neutral', class: 'bg-surface-sunken' },
    { variant: 'soft', tone: ['accent', 'assistant'], class: 'bg-accent-subtle' },
    { variant: 'soft', tone: 'success', class: 'bg-success-subtle' },
    { variant: 'soft', tone: 'warning', class: 'bg-warning-subtle' },
    { variant: 'soft', tone: 'danger', class: 'bg-danger-subtle' },
    { variant: 'soft', tone: 'info', class: 'bg-info-subtle' },
    // Solid fills pair each colour with a text colour that holds 4.5:1 in both
    // themes, as the web's do: warning and info have no fill dark enough for
    // white, so their text colour becomes the fill.
    { variant: 'solid', tone: 'neutral', class: 'bg-invert' },
    { variant: 'solid', tone: ['accent', 'assistant'], class: 'bg-accent-solid' },
    { variant: 'solid', tone: 'success', class: 'bg-success-solid' },
    { variant: 'solid', tone: 'warning', class: 'bg-warning-fg' },
    { variant: 'solid', tone: 'danger', class: 'bg-danger-solid' },
    { variant: 'solid', tone: 'info', class: 'bg-info-fg' },
  ],
  defaultVariants: { tone: 'neutral', variant: 'soft', size: 'md' },
});

/** The text and icon colour, and the same colour as a fill for the remove button's wash. */
const ink = {
  soft: {
    neutral: ['text-fg-muted', 'bg-fg-muted', 'muted'],
    accent: ['text-accent-fg', 'bg-accent-fg', 'accent'],
    assistant: ['text-accent-fg', 'bg-accent-fg', 'accent'],
    success: ['text-success-fg', 'bg-success-fg', 'success'],
    warning: ['text-warning-fg', 'bg-warning-fg', 'warning'],
    danger: ['text-danger-fg', 'bg-danger-fg', 'danger'],
    info: ['text-info-fg', 'bg-info-fg', 'info'],
    sensitive: ['text-fg', 'bg-fg', 'default'],
    attention: ['text-warning-fg', 'bg-warning-fg', 'warning'],
  },
  solid: {
    neutral: ['text-fg-on-invert', 'bg-fg-on-invert', 'on-invert'],
    accent: ['text-fg-on-accent', 'bg-fg-on-accent', 'on-accent'],
    assistant: ['text-fg-on-accent', 'bg-fg-on-accent', 'on-accent'],
    success: ['text-fg-on-solid', 'bg-fg-on-solid', 'on-accent'],
    warning: ['text-surface', 'bg-surface', 'on-invert'],
    danger: ['text-fg-on-solid', 'bg-fg-on-solid', 'on-accent'],
    info: ['text-surface', 'bg-surface', 'on-invert'],
    sensitive: ['text-fg', 'bg-fg', 'default'],
    attention: ['text-warning-fg', 'bg-warning-fg', 'warning'],
  },
} as const satisfies Record<
  'soft' | 'solid',
  Record<Tone, readonly [string, string, NonNullable<IconProps['tone']>]>
>;

/** The dot: the bright status colour on a wash, the text colour on a fill. */
const dotTone = {
  neutral: 'bg-fg-subtle',
  accent: 'bg-accent',
  assistant: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  sensitive: 'bg-fg',
  attention: 'bg-warning',
} as const satisfies Record<Tone, string>;

/** Tones that carry their own glyph, so the meaning never rests on colour. */
const glyph: Partial<Record<Tone, LucideIcon>> = {
  sensitive: Lock,
  attention: TriangleAlert,
  assistant: Sparkles,
};

function Dot({ className, pulse }: { className: string; pulse: boolean }): React.JSX.Element {
  const style = usePulse(pulse);
  return (
    <Animated.View style={style}>
      <View className={cn('size-1.5 rounded-full', className)} />
    </Animated.View>
  );
}

export type BadgeProps = VariantProps<typeof badge> & {
  children: string;
  /** A leading dot in the status colour, for a state: Active, On leave. */
  dot?: boolean;
  /** The dot breathes, for something live. Still under reduced motion. */
  pulse?: boolean;
  /** A leading icon. `sensitive`, `attention` and `assistant` bring their own. */
  icon?: LucideIcon;
  /** Shows a remove button: the badge becomes a chip someone can take away. */
  onRemove?: () => void;
  /** Read for the remove button. Defaults to "Remove" and the label. */
  removeLabel?: string;
  className?: string | undefined;
};

/** A short status or count. Tone carries meaning, so use it the same way everywhere. */
export function Badge({
  children,
  tone = 'neutral',
  variant = 'soft',
  size = 'md',
  dot = false,
  pulse = false,
  icon,
  onRemove,
  removeLabel,
  className,
}: BadgeProps): React.JSX.Element {
  const t = tone ?? 'neutral';
  const v = variant ?? 'soft';
  const [text, wash, iconTone] =
    v === 'outline' ? (['text-fg-muted', 'bg-fg-muted', 'muted'] as const) : ink[v][t];
  const leading = icon ?? glyph[t];
  return (
    <View className={cn(badge({ tone: t, variant: v, size }), className)}>
      {dot ? <Dot className={v === 'solid' ? wash : dotTone[t]} pulse={pulse} /> : null}
      {leading ? <Icon icon={leading} size={13} tone={iconTone} /> : null}
      <CssText
        numberOfLines={1}
        className={cn(
          size === 'xs' ? 'text-[11px] font-bold tabular-nums' : 'font-semibold',
          size === 'sm' ? 'text-caption' : size !== 'xs' && 'text-footnote',
          text,
        )}
      >
        {children}
      </CssText>
      {onRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={removeLabel ?? `Remove ${children}`}
          hitSlop={14}
          onPress={onRemove}
          className="-mr-1 size-4 items-center justify-center"
        >
          <View className={cn('absolute inset-0 rounded-full opacity-[0.14]', wash)} />
          <Icon icon={X} size={11} tone={iconTone} />
        </Pressable>
      ) : null}
    </View>
  );
}
