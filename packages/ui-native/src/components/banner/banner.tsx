import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Info,
  Megaphone,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react-native';
import { Children, isValidElement, useState, type ReactElement, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { Button } from '../button/button.tsx';
import { Icon, type IconProps, type LucideIcon } from '../icon/icon.tsx';

/**
 * A message about the whole app or account, full width at the top of the
 * page, as the web's. Only one shows at a time. On a phone it wraps: the
 * glyph and the message, then the actions on their own line under the
 * message, then the close button.
 */

export type BannerTone = 'info' | 'success' | 'warning' | 'danger' | 'accent' | 'neutral';

const wash = {
  info: 'bg-info-subtle',
  success: 'bg-success-subtle',
  warning: 'bg-warning-subtle',
  danger: 'bg-danger-subtle',
  accent: 'bg-accent-subtle',
  neutral: 'bg-surface-sunken',
} as const satisfies Record<BannerTone, string>;

/** Solid fills whose white text holds 4.5:1 in both themes, as a solid Badge's do. */
const solidFill = {
  info: 'bg-info-fg',
  success: 'bg-success-solid',
  warning: 'bg-warning-fg',
  danger: 'bg-danger-solid',
  accent: 'bg-accent-solid',
  neutral: 'bg-invert',
} as const satisfies Record<BannerTone, string>;

const glyphTone = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  accent: 'accent',
  neutral: 'muted',
} as const satisfies Record<BannerTone, NonNullable<IconProps['tone']>>;

const glyph: Record<BannerTone, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
  accent: Sparkles,
  neutral: Megaphone,
};

const WEB = Platform.OS === 'web';

export type BannerProps = {
  tone?: BannerTone;
  /**
   * `soft` by default. `solid` for something that blocks work. `inverted` for
   * the app's own news, a maintenance window, in the dark of a toast.
   */
  variant?: 'soft' | 'solid' | 'inverted';
  /** The lead, in bold, before the message: "Payroll closes tomorrow at 17:00." */
  title?: string;
  /** The message. */
  children?: string;
  /** Replaces the tone's glyph. */
  icon?: LucideIcon;
  /** Under the message: a link-style button, a small one, or a badge. */
  actions?: ReactNode;
  /** Shows a close button. The banner does not hide itself; the caller does. */
  onDismiss?: () => void;
  dismissLabel?: string;
  /** Rounded, for a banner inside content rather than across the top of a screen. */
  rounded?: boolean;
  className?: string | undefined;
};

export function Banner({
  tone = 'info',
  variant = 'soft',
  title,
  children,
  icon,
  actions,
  onDismiss,
  dismissLabel = 'Dismiss',
  rounded = false,
  className,
}: BannerProps): React.JSX.Element {
  const filled = variant !== 'soft';
  const ink = filled ? 'on-invert' : glyphTone[tone];
  const text = variant === 'inverted' ? 'text-fg-on-invert' : filled ? 'text-white' : 'text-fg';
  const urgent = tone === 'danger' || tone === 'warning';
  return (
    <View
      {...(WEB ? { role: urgent ? ('alert' as const) : ('status' as const) } : {})}
      className={cn(
        'flex-row flex-wrap items-start gap-3 px-4 py-3',
        variant === 'inverted' ? 'bg-invert' : variant === 'solid' ? solidFill[tone] : wash[tone],
        rounded && 'rounded-[18px]',
        className,
      )}
    >
      <View className="pt-px">
        <Icon
          icon={icon ?? glyph[tone]}
          size={18}
          tone={ink}
          {...(variant === 'solid' ? { className: 'text-white' } : {})}
        />
      </View>
      <CssText className={cn('min-w-0 flex-1 text-subhead leading-[1.45]', text)}>
        {title ? <CssText className="font-semibold">{`${title} `}</CssText> : null}
        {children}
      </CssText>
      {onDismiss ? (
        <View className="-mx-2 -my-1.5">
          <Button
            variant="ghost"
            size="xs"
            accessibilityLabel={dismissLabel}
            startIcon={
              <Icon
                icon={X}
                size={16}
                tone={filled ? 'on-invert' : 'muted'}
                {...(variant === 'solid' ? { className: 'text-white' } : {})}
              />
            }
            onPress={onDismiss}
          />
        </View>
      ) : null}
      {actions ? (
        <View className="w-full flex-row items-center gap-2 pl-[30px]">{actions}</View>
      ) : null}
    </View>
  );
}

export type BannerStackProps = {
  /** `Banner`s, the most severe first. One shows; the rest page behind it. */
  children: ReactNode;
  previousLabel?: string;
  nextLabel?: string;
  className?: string | undefined;
};

/**
 * Several banners as one: the most severe shows, and "1 of 3" pages through
 * the rest, so the top of the screen never fills with messages.
 */
export function BannerStack({
  children,
  previousLabel = 'Previous message',
  nextLabel = 'Next message',
  className,
}: BannerStackProps): React.JSX.Element | null {
  const banners = Children.toArray(children).filter(isValidElement) as ReactElement<BannerProps>[];
  const [index, setIndex] = useState(0);
  const at = Math.min(index, banners.length - 1);
  const current = banners[at];
  if (!current) return null;
  const pager =
    banners.length > 1 ? (
      <View className="flex-row items-center">
        <Button
          variant="ghost"
          size="xs"
          accessibilityLabel={previousLabel}
          disabled={at === 0}
          startIcon={<Icon icon={ChevronLeft} size={14} tone="muted" />}
          onPress={() => {
            setIndex(at - 1);
          }}
        />
        <CssText className="text-[12px] font-semibold leading-none text-fg-muted tabular-nums">
          {`${String(at + 1)} of ${String(banners.length)}`}
        </CssText>
        <Button
          variant="ghost"
          size="xs"
          accessibilityLabel={nextLabel}
          disabled={at === banners.length - 1}
          startIcon={<Icon icon={ChevronRight} size={14} tone="muted" />}
          onPress={() => {
            setIndex(at + 1);
          }}
        />
      </View>
    ) : null;
  return (
    <Banner
      {...current.props}
      actions={
        <>
          {current.props.actions}
          {pager}
        </>
      }
      {...(className ? { className: cn(current.props.className, className) } : {})}
    />
  );
}
