import { useEffect, useRef, type ReactNode } from 'react';
import { Text as CssText, View } from 'react-native-css/components';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { animateTo, useMotion } from '../../lib/animate.ts';
import { cn } from '../../lib/cn.ts';
import { Button } from '../button/button.tsx';

/**
 * How a long form is laid out on a phone: titled sections in one column, a
 * hairline under each rather than a card around it (they are chapters of one
 * form, not separate things), and a save bar that rises in with the first
 * change.
 */
export function FormSections({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  return <View className={cn('gap-[18px]', className)}>{children}</View>;
}

export type FormSectionProps = {
  title: string;
  /** One line on who sees this, or why it is asked. */
  description?: string;
  children?: ReactNode;
  /** The last section has no rule under it. */
  last?: boolean;
  className?: string | undefined;
};

export function FormSection({
  title,
  description,
  children,
  last = false,
  className,
}: FormSectionProps): React.JSX.Element {
  return (
    <View
      role="group"
      aria-label={title}
      className={cn('gap-2.5', !last && 'border-b border-border pb-[18px]', className)}
    >
      <View>
        <CssText accessibilityRole="header" className="text-[16px] leading-[1.4] font-bold text-fg">
          {title}
        </CssText>
        {description ? (
          <CssText className="text-subhead leading-[1.4] text-fg-muted">{description}</CssText>
        ) : null}
      </View>
      <View className="gap-3">{children}</View>
    </View>
  );
}

export type FormSaveBarProps = {
  /** Shown once there is something to save. Render it always; it comes and goes. */
  open: boolean;
  onSave: () => void;
  onDiscard: () => void;
  /** Holds both buttons, and Save shows it is busy. */
  saving?: boolean;
  message?: string;
  saveLabel?: string;
  discardLabel?: string;
  className?: string | undefined;
};

/**
 * The bar that rises in with the first change and leaves with the save: the
 * only Save a long form offers, at the bottom, in reach of a thumb wherever
 * the change was made. Asking before the screen is left is the screen's job.
 */
export function FormSaveBar({
  open,
  onSave,
  onDiscard,
  saving = false,
  message = 'Unsaved changes',
  saveLabel = 'Save',
  discardLabel = 'Discard',
  className,
}: FormSaveBarProps): React.JSX.Element | null {
  const { fadeRise } = useMotion();
  // Open as it mounts, it is simply there; it rises in when it opens later.
  const shown = useRef(open);
  const opacity = useSharedValue(open ? fadeRise.to.opacity : fadeRise.from.opacity);
  const y = useSharedValue(open ? fadeRise.to.translateY : fadeRise.from.translateY);
  useEffect(() => {
    if (!open) {
      shown.current = false;
      return;
    }
    if (shown.current) return;
    shown.current = true;
    opacity.value = fadeRise.from.opacity;
    y.value = fadeRise.from.translateY;
    opacity.value = animateTo(fadeRise.to.opacity, fadeRise.transition);
    y.value = animateTo(fadeRise.to.translateY, fadeRise.transition);
  }, [open, fadeRise, opacity, y]);
  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: y.value }],
  }));
  if (!open) return null;
  return (
    // The motion on a bare Animated.View, the classes inside it (RMB-001).
    <Animated.View style={style}>
      <View
        className={cn(
          'flex-row items-center gap-2 rounded-full bg-invert py-2 pr-2 pl-[18px] shadow-lg',
          className,
        )}
      >
        <CssText
          role="status"
          accessibilityLiveRegion="polite"
          numberOfLines={1}
          className="min-w-0 flex-1 text-[14px] font-semibold text-fg-on-invert"
        >
          {message}
        </CssText>
        <Button size="xs" variant="on-invert" disabled={saving} onPress={onDiscard}>
          {discardLabel}
        </Button>
        <Button size="xs" variant="primary" loading={saving} onPress={onSave}>
          {saveLabel}
        </Button>
      </View>
    </Animated.View>
  );
}
