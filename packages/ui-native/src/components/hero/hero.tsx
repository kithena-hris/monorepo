import type { ReactNode } from 'react';
import { Pressable, Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { usePress } from '../../lib/animate.ts';
import { Icon, type LucideIcon } from '../icon/icon.tsx';

/**
 * The top of a page about one thing: its picture large and centred, its name,
 * a line under it, a few badges, and a row of `QuickAction`s. On a wash of
 * the accent that runs to the screen's edges, so the page opens on who or
 * what it is before any detail.
 */
export type HeroProps = {
  /** An `Avatar` at 96, or an image. */
  media: ReactNode;
  title: string;
  subtitle?: string;
  /** `Badge`s, centred under the subtitle. */
  badges?: ReactNode;
  /** `QuickAction`s, four at most. */
  actions?: ReactNode;
  className?: string | undefined;
};

export function Hero({
  media,
  title,
  subtitle,
  badges,
  actions,
  className,
}: HeroProps): React.JSX.Element {
  return (
    <View
      className={cn(
        '-mx-4 -mt-1 items-center gap-3 bg-accent-subtle/70 px-5 pb-[22px] pt-1.5',
        className,
      )}
    >
      {media}
      <View className="items-center gap-1">
        <CssText
          accessibilityRole="header"
          className="text-center text-[28px] font-bold leading-[1.15] tracking-[-0.02em] text-fg"
        >
          {title}
        </CssText>
        {subtitle ? (
          <CssText className="text-center text-callout leading-[1.35] text-fg-muted">
            {subtitle}
          </CssText>
        ) : null}
      </View>
      {badges ? (
        <View className="flex-row flex-wrap justify-center gap-1.5">{badges}</View>
      ) : null}
      {actions ? <View className="mt-1 flex-row justify-center gap-3">{actions}</View> : null}
    </View>
  );
}

export type QuickActionProps = {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  /** The one action the page is for, filled in the accent. */
  primary?: boolean;
  disabled?: boolean;
};

/** A round button with its word under it, as a contact card's Message and Call. */
export function QuickAction({
  icon,
  label,
  onPress,
  primary = false,
  disabled = false,
}: QuickActionProps): React.JSX.Element {
  const { pressed, onPressIn, onPressOut } = usePress();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      className={cn('w-[62px] items-center gap-1.5', disabled && 'opacity-50')}
    >
      <View
        className={cn(
          'size-[52px] items-center justify-center rounded-full shadow-sm',
          primary ? 'bg-accent-solid' : pressed ? 'bg-surface-active' : 'bg-surface',
        )}
      >
        <Icon icon={icon} size={21} tone={primary ? 'on-accent' : 'default'} />
      </View>
      <CssText numberOfLines={1} className="text-[12px] font-medium leading-none text-fg-muted">
        {label}
      </CssText>
    </Pressable>
  );
}
