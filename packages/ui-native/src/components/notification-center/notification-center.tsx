import type { ReactNode } from 'react';
import { Pressable, Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { Button } from '../button/button.tsx';
import { Icon, type IconProps, type LucideIcon } from '../icon/icon.tsx';

/**
 * Everything that needs attention, in one list, as the web's notification
 * centre on a phone's page: a heading with "Mark all read", rows grouped by
 * day, unread rows tinted with a dot, and an item someone can act on carrying
 * its buttons inline so it never needs opening first.
 */

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

const disc = {
  neutral: ['bg-surface-sunken', 'muted'],
  accent: ['bg-accent-subtle', 'accent'],
  success: ['bg-success-subtle', 'success'],
  warning: ['bg-warning-subtle', 'warning'],
  danger: ['bg-danger-subtle', 'danger'],
  info: ['bg-info-subtle', 'info'],
} as const satisfies Record<Tone, readonly [string, NonNullable<IconProps['tone']>]>;

export type NotificationCenterProps = {
  /** `NotificationGroup`s, or `NotificationItem`s in a `NotificationList`. */
  children: ReactNode;
  title?: string;
  /** Shows "Mark all read" beside the heading. */
  onMarkAllRead?: () => void;
  markAllReadLabel?: string;
  className?: string | undefined;
};

export function NotificationCenter({
  children,
  title = 'Notifications',
  onMarkAllRead,
  markAllReadLabel = 'Mark all read',
  className,
}: NotificationCenterProps): React.JSX.Element {
  return (
    <View className={cn('gap-2.5', className)}>
      <View className="flex-row items-center justify-between">
        <CssText role="heading" className="text-[22px] font-bold leading-[1.4] text-fg">
          {title}
        </CssText>
        {onMarkAllRead ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={{ top: 15, bottom: 15, left: 8, right: 8 }}
            onPress={onMarkAllRead}
          >
            <CssText className="text-[13px] font-medium leading-none text-accent-fg">
              {markAllReadLabel}
            </CssText>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** The rounded group the rows sit in. */
export function NotificationList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <View
      role="list"
      className={cn('overflow-hidden rounded-m-card bg-surface shadow-sm', className)}
    >
      {children}
    </View>
  );
}

/** A day's notifications under its heading: "Today", "Earlier". */
export function NotificationGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <View>
      <CssText
        role="heading"
        className="px-1 pb-1.5 pt-3.5 text-[12px] font-semibold leading-none text-fg-subtle"
      >
        {label}
      </CssText>
      <NotificationList>{children}</NotificationList>
    </View>
  );
}

export type NotificationAction = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
};

export type NotificationItemProps = {
  /** What happened, in a sentence: "Amara requested 5 days off". */
  title: string;
  /** The detail: dates, an amount, a quote. */
  description?: string;
  /** When: "12m", "Yesterday", "Mon". */
  time: string;
  /** A person: an `Avatar` at 36. Otherwise give `icon`. */
  avatar?: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  unread?: boolean;
  /** Buttons to act on it in place: Decline, Approve. */
  actions?: readonly NotificationAction[];
  /** Opens what it is about. */
  onPress?: () => void;
  /** No line under it: set on the last row. */
  last?: boolean;
  className?: string | undefined;
};

export function NotificationItem({
  title,
  description,
  time,
  avatar,
  icon,
  tone = 'neutral',
  unread = false,
  actions,
  onPress,
  last = false,
  className,
}: NotificationItemProps): React.JSX.Element {
  const [wash, glyph] = disc[tone];
  const leading =
    avatar ??
    (icon ? (
      <View className={cn('size-9 items-center justify-center rounded-full', wash)}>
        <Icon icon={icon} size={17} tone={glyph} />
      </View>
    ) : null);
  const acting = actions !== undefined && actions.length > 0;
  const read = `${unread ? 'Unread. ' : ''}${title}${description ? `. ${description}` : ''}. ${time}`;

  const body = (
    <>
      {/* The unread tint: the accent wash at a little over half. */}
      {unread ? <View className="absolute inset-0 bg-accent-subtle opacity-55" /> : null}
      {leading}
      <View className={cn('min-w-0 flex-1', acting ? 'gap-1' : 'gap-0.5')}>
        <View className="flex-row items-start justify-between gap-2">
          <CssText
            numberOfLines={acting ? 2 : 1}
            className={cn(
              'flex-1 text-[16px] leading-[1.3] text-fg',
              unread ? 'font-semibold' : 'font-medium',
            )}
          >
            {title}
          </CssText>
          {acting ? (
            <CssText className="text-[12px] leading-none text-fg-subtle">{time}</CssText>
          ) : null}
        </View>
        {description ? (
          <CssText
            numberOfLines={1}
            className={cn('leading-[1.3] text-fg-muted', acting ? 'text-[13px]' : 'text-[14px]')}
          >
            {description}
          </CssText>
        ) : null}
        {acting ? (
          <View className="mt-1.5 flex-row gap-2">
            {actions.map((action) => (
              <Button
                key={action.label}
                size="xs"
                variant={action.variant ?? 'secondary'}
                onPress={action.onPress}
              >
                {action.label}
              </Button>
            ))}
          </View>
        ) : null}
      </View>
      {acting ? null : (
        <View className="items-end gap-2">
          <CssText className="text-[12px] leading-none text-fg-subtle">{time}</CssText>
          {unread ? <View className="size-2 rounded-full bg-accent" /> : null}
        </View>
      )}
    </>
  );

  const frame = cn(
    'flex-row gap-3 px-4',
    acting ? 'items-start py-3.5' : 'min-h-[66px] items-center py-2',
    !last && 'border-b border-border',
    className,
  );

  // A row with buttons in it is not itself a button: one target inside another
  // is a trap for a finger and for a screen reader alike.
  if (onPress && !acting) {
    return (
      <View role="listitem">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={read}
          onPress={onPress}
          className={frame}
        >
          {body}
        </Pressable>
      </View>
    );
  }
  return (
    <View role="listitem" className={frame}>
      {body}
    </View>
  );
}
