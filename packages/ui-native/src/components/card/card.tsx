import { cva, type VariantProps } from 'class-variance-authority';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { Text } from '../text/text.tsx';

/**
 * The web card at the phone's card radius (22). On a phone a card is padded
 * 16 by default; a list inside one passes `padded={false}` and pads its rows.
 */
const card = cva('rounded-m-card bg-surface', {
  variants: {
    variant: {
      /** Default: the surface on the grey canvas with a hairline shadow, a ring in dark. */
      raised: 'shadow-sm',
      /** A line and no fill, for grouping on a surface that is already white. */
      outline: 'bg-transparent border border-border-strong',
      /** A grey fill and no edge, for a panel inside a panel. */
      fill: 'bg-surface-sunken',
      /** Lifted off the canvas, for content that floats over context. */
      elevated: 'bg-surface-raised shadow-lg',
    },
    padded: { true: 'p-4 gap-1.5', false: '' },
    /** Something wanted and missing: the warning edge. The card's own words carry the meaning. */
    tone: { default: '', attention: 'border border-warning-border' },
    pressed: { true: 'shadow-md', false: '' },
  },
  defaultVariants: { variant: 'raised', padded: true, tone: 'default', pressed: false },
});

export type CardProps = Omit<VariantProps<typeof card>, 'pressed'> & {
  children?: ReactNode;
  /**
   * Makes the whole card one target. Only when the card really is a button or
   * a link: a card that lifts under a finger and does nothing is a lie.
   */
  onPress?: () => void;
  /** Read for an interactive card; defaults to what it contains. */
  accessibilityLabel?: string;
  className?: string | undefined;
};

/** A surface that groups related content. Don't nest cards inside cards. */
export function Card({
  children,
  variant,
  padded,
  tone,
  onPress,
  accessibilityLabel,
  className,
}: CardProps): React.JSX.Element {
  const [pressed, setPressed] = useState(false);
  if (!onPress) {
    return <View className={cn(card({ variant, padded, tone }), className)}>{children}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      {...(accessibilityLabel ? { accessibilityLabel } : {})}
      onPress={onPress}
      onPressIn={() => {
        setPressed(true);
      }}
      onPressOut={() => {
        setPressed(false);
      }}
      className={cn(card({ variant, padded, tone, pressed }), className)}
    >
      {children}
    </Pressable>
  );
}

/** The card's heading: Title 3, the design's card title. */
export function CardTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <Text variant="title3" weight="bold" className={className}>
      {children}
    </Text>
  );
}

/** A line under the title, in the secondary ink. */
export function CardDescription({
  children,
  className,
}: {
  children: ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <Text variant="subhead" tone="muted" className={className}>
      {children}
    </Text>
  );
}

/*
 * The web's layout parts. A phone card is padded by default, so these carry
 * no padding of their own; on the web they pad an unpadded card.
 */

/** The title and its line on the start side, an action or a status on the end. */
export function CardHeader({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <View className={cn('flex-row items-start justify-between gap-4', className)}>{children}</View>
  );
}

/** The card's body. */
export function CardContent({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  return <View className={cn(className)}>{children}</View>;
}

/** The actions, at the end, under a rule. */
export function CardFooter({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <View
      className={cn(
        'mt-2 flex-row items-center justify-end gap-2 border-t border-border pt-3',
        className,
      )}
    >
      {children}
    </View>
  );
}
