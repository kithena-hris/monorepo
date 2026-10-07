import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { Text as CssText, View } from 'react-native-css/components';
import Animated from 'react-native-reanimated';

import { usePulse } from '../../lib/animate.ts';
import { cn } from '../../lib/cn.ts';
import { Icon, type IconProps, type LucideIcon } from '../icon/icon.tsx';

/**
 * Events in order, as the web's: history, approvals, and changes that take
 * effect on a set date. A 12pt dot or a 28pt disc with a glyph, a 2pt line to
 * the next, the title 16 and the time 12 beside it, a note under it at 15.
 */

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

/** The dot, the disc behind a glyph, the ring of a hollow step, and the glyph's colour. */
const tones = {
  neutral: ['bg-fg-subtle', 'bg-surface-sunken', 'border-fg-subtle', 'muted'],
  accent: ['bg-accent', 'bg-accent-subtle', 'border-accent', 'accent'],
  success: ['bg-success', 'bg-success-subtle', 'border-success', 'success'],
  warning: ['bg-warning', 'bg-warning-subtle', 'border-warning', 'warning'],
  danger: ['bg-danger', 'bg-danger-subtle', 'border-danger', 'danger'],
  info: ['bg-info', 'bg-info-subtle', 'border-info', 'info'],
} as const satisfies Record<
  Tone,
  readonly [string, string, string, NonNullable<IconProps['tone']>]
>;

const WEB = Platform.OS === 'web';

export type TimelineProps = {
  /** `TimelineItem`s, oldest first. The last one ends the line. */
  children: ReactNode;
  /** Names the list for a screen reader: "Approval". */
  accessibilityLabel?: string;
  className?: string | undefined;
};

export function Timeline({
  children,
  accessibilityLabel,
  className,
}: TimelineProps): React.JSX.Element {
  const items = Children.toArray(children).filter(
    isValidElement,
  ) as ReactElement<TimelineItemProps>[];
  return (
    <View
      role="list"
      {...(accessibilityLabel ? { 'aria-label': accessibilityLabel } : {})}
      className={cn('flex-col', className)}
    >
      {items.map((item, i) =>
        cloneElement(item, { last: item.props.last ?? i === items.length - 1 }),
      )}
    </View>
  );
}

export type TimelineItemProps = {
  title: ReactNode;
  /** When it happened or was recorded: "1 Apr 2026", "09:12", "Now". */
  timestamp?: string;
  /** When it takes effect, if that differs from when it was recorded. */
  effectiveFrom?: string;
  /** The dot's colour. Carries no meaning on its own; the title does. */
  tone?: Tone;
  /** A glyph in a 28pt disc of the tone's wash, for a chain of different kinds of step. */
  icon?: LucideIcon;
  /**
   * Against now. `current` breathes, so the step being waited on is the one
   * the eye lands on. `upcoming` is hollow and its title muted: it has not
   * happened, and may not.
   */
  status?: 'past' | 'current' | 'upcoming';
  /** Replaces the dot entirely: an avatar, say. */
  marker?: ReactNode;
  /** Set by `Timeline`; stops the line. */
  last?: boolean;
  /** A note under the title. Text is drawn muted; anything else as given. */
  children?: ReactNode;
  className?: string | undefined;
};

export function TimelineItem({
  title,
  timestamp,
  effectiveFrom,
  tone = 'neutral',
  icon,
  status = 'past',
  marker,
  last = false,
  children,
  className,
}: TimelineItemProps): React.JSX.Element {
  const [dot, disc, ring, glyph] = tones[tone];
  const upcoming = status === 'upcoming';
  const pulse = usePulse(status === 'current');
  const mark =
    marker ??
    (icon ? (
      <View className={cn('size-7 items-center justify-center rounded-full', disc)}>
        <Icon icon={icon} size={14} tone={glyph} />
      </View>
    ) : (
      <View
        className={cn(
          'mt-[5px] size-3 rounded-full',
          upcoming ? cn('border-2 bg-surface', ring) : dot,
        )}
      />
    ));
  return (
    <View
      role="listitem"
      {...(status === 'current' && WEB ? { 'aria-current': 'step' as const } : {})}
      className={cn('flex-row gap-3.5', className)}
    >
      <View aria-hidden className="items-center">
        <Animated.View style={pulse}>{mark}</Animated.View>
        {last ? null : <View className="my-1 min-h-4 w-0.5 flex-1 bg-border-strong" />}
      </View>
      <View className={cn('min-w-0 flex-1', !last && 'pb-[18px]')}>
        <View className="flex-row items-baseline justify-between gap-3">
          <CssText
            className={cn(
              'flex-1 text-[16px] font-semibold leading-[1.35]',
              upcoming ? 'text-fg-muted' : 'text-fg',
            )}
          >
            {title}
          </CssText>
          {timestamp ? (
            <CssText className="text-[12px] leading-none text-fg-subtle">{timestamp}</CssText>
          ) : null}
        </View>
        {effectiveFrom ? (
          <CssText className="mt-0.5 text-[13px] leading-[1.4] text-fg-muted">
            Effective {effectiveFrom}
          </CssText>
        ) : null}
        {typeof children === 'string' ? (
          <CssText className="mt-0.5 text-subhead leading-[1.5] text-fg-muted">{children}</CssText>
        ) : children ? (
          <View className="mt-0.5">{children}</View>
        ) : null}
      </View>
    </View>
  );
}
