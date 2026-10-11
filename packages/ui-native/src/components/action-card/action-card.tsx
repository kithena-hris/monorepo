import { Sparkles } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { Icon, type LucideIcon } from '../icon/icon.tsx';

/**
 * Something to act on, with its button on the card: a task, an approval, a
 * request. Most are finished without opening anything; the card itself opens
 * the detail when there is more to read.
 *
 * The leading is an `Avatar` for a person, or `icon` in a tile for a thing.
 * Under the title, one line of context and, where the assistant worked something
 * out, a `hint` beside a sparkles mark. The foot holds what is due on the
 * left and the actions on the right.
 */

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

const TILE: Record<Tone, string> = {
  neutral: 'bg-surface-sunken',
  accent: 'bg-accent-subtle',
  success: 'bg-success-subtle',
  warning: 'bg-warning-subtle',
  danger: 'bg-danger-subtle',
  info: 'bg-info-subtle',
};

const GLYPH: Record<Tone, 'muted' | 'accent' | 'success' | 'warning' | 'danger' | 'info'> = {
  neutral: 'muted',
  accent: 'accent',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
};

export type ActionCardProps = {
  title: ReactNode;
  /** An `Avatar`, for a person. */
  leading?: ReactNode;
  /** A thing rather than a person: the glyph in a 40pt tile. */
  icon?: LucideIcon;
  /** The tile's wash: `danger` for something refused, `warning` for something late. */
  tone?: Tone;
  /** Small text at the end of the title line: how long ago. */
  meta?: string;
  /** One line of context under the title. */
  description?: ReactNode;
  /** What the assistant worked out about it, beside a sparkles mark, in the accent. */
  hint?: ReactNode;
  /** The left of the foot: a `Badge` saying when it is due. */
  due?: ReactNode;
  /** The right of the foot: one to three `Button`s, the main one last. */
  actions?: ReactNode;
  /** Opens the detail. The actions stay their own targets. */
  onPress?: () => void;
  accessibilityLabel?: string;
  className?: string | undefined;
};

export function ActionCard({
  title,
  leading,
  icon,
  tone = 'neutral',
  meta,
  description,
  hint,
  due,
  actions,
  onPress,
  accessibilityLabel,
  className,
}: ActionCardProps): React.JSX.Element {
  const head = (
    <View className="flex-row gap-3 px-4 pt-3.5">
      {icon ? (
        <View
          aria-hidden
          className={cn('size-10 items-center justify-center rounded-[12px]', TILE[tone])}
        >
          <Icon icon={icon} size={18} tone={GLYPH[tone]} />
        </View>
      ) : (
        leading
      )}
      <View className="min-w-0 flex-1 gap-1">
        <View className="flex-row items-baseline gap-2">
          <CssText className="min-w-0 flex-1 text-callout font-semibold leading-[1.3] text-fg">
            {title}
          </CssText>
          {meta ? (
            <CssText className="text-[12px] font-medium leading-none text-fg-subtle">
              {meta}
            </CssText>
          ) : null}
        </View>
        {description ? (
          typeof description === 'string' ? (
            <CssText className="text-[14px] leading-[1.45] text-fg-muted">{description}</CssText>
          ) : (
            description
          )
        ) : null}
        {hint ? (
          <View className="flex-row items-start gap-1.5">
            <View className="pt-0.5">
              <Icon icon={Sparkles} size={13} tone="accent" />
            </View>
            <CssText className="min-w-0 flex-1 text-[13px] font-medium leading-[1.4] text-accent-fg">
              {hint}
            </CssText>
          </View>
        ) : null}
      </View>
    </View>
  );
  const foot =
    due || actions ? (
      <View className="flex-row items-center gap-2 pb-3.5 pl-[68px] pr-4 pt-3">
        <View className="min-w-0 flex-1 flex-row">{due}</View>
        {actions ? <View className="flex-row items-center gap-2">{actions}</View> : null}
      </View>
    ) : (
      <View className="h-3.5" />
    );
  const surface = cn('overflow-hidden rounded-m-card bg-surface shadow-sm', className);
  if (!onPress) {
    return (
      <View className={surface}>
        {head}
        {foot}
      </View>
    );
  }
  return (
    <View className={surface}>
      <Pressable
        accessibilityRole="button"
        {...(accessibilityLabel ? { accessibilityLabel } : {})}
        onPress={onPress}
      >
        {head}
      </Pressable>
      {foot}
    </View>
  );
}
