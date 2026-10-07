import { Children, useState, type ReactNode } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';

/**
 * Layout primitives: spacing is a token rather than a number someone typed,
 * so components never set their own margins. The web's API, at a phone's
 * width: `Split` and `Container` behave as the web does below its first
 * breakpoint, which is where a phone always is.
 */

/** Spacing steps, in the 4pt rhythm the whole system is on. */
export type Gap = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12;

const gapClass: Record<Gap, string> = {
  0: 'gap-0',
  1: 'gap-1',
  2: 'gap-2',
  3: 'gap-3',
  4: 'gap-4',
  5: 'gap-5',
  6: 'gap-6',
  8: 'gap-8',
  10: 'gap-10',
  12: 'gap-12',
};

const alignClass = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
  baseline: 'items-baseline',
} as const;

const justifyClass = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
  around: 'justify-around',
} as const;

export type StackProps = {
  children?: ReactNode;
  gap?: Gap;
  align?: keyof typeof alignClass;
  justify?: keyof typeof justifyClass;
  className?: string | undefined;
};

/** Children in a column, `gap` apart. */
export function Stack({
  children,
  gap = 3,
  align = 'stretch',
  justify,
  className,
}: StackProps): React.JSX.Element {
  return (
    <View
      className={cn(
        'flex-col',
        gapClass[gap],
        alignClass[align],
        justify && justifyClass[justify],
        className,
      )}
    >
      {children}
    </View>
  );
}

export type InlineProps = StackProps & {
  /** Wraps to the next line when the row is full. On by default. */
  wrap?: boolean;
};

/** Children in a row, `gap` apart, wrapping when the row is full. */
export function Inline({
  children,
  gap = 2,
  align = 'center',
  justify,
  wrap = true,
  className,
}: InlineProps): React.JSX.Element {
  return (
    <View
      className={cn(
        'flex-row',
        wrap && 'flex-wrap',
        gapClass[gap],
        alignClass[align],
        justify && justifyClass[justify],
        className,
      )}
    >
      {children}
    </View>
  );
}

export type SplitProps = {
  children?: ReactNode;
  /** The secondary column: on a phone it stacks below the main one, or above it with `side="start"`. */
  aside: ReactNode;
  side?: 'start' | 'end';
  gap?: Gap;
  className?: string | undefined;
};

/** Main content and an aside. A phone is narrower than any rail, so they stack. */
export function Split({
  children,
  aside,
  side = 'end',
  gap = 6,
  className,
}: SplitProps): React.JSX.Element {
  return (
    <View className={cn('flex-col', gapClass[gap], className)}>
      {side === 'start' ? aside : null}
      {children}
      {side === 'end' ? aside : null}
    </View>
  );
}

export type AutoGridProps = {
  children?: ReactNode;
  /** The narrowest a column may get, in points. Columns are as many as fit. */
  minItemWidth?: number;
  gap?: Gap;
  className?: string | undefined;
};

/**
 * As many equal columns as fit at `minItemWidth`, asked of the space the grid
 * was given rather than of the screen: the same grid has three columns in a
 * full-width card and one in a narrow one.
 */
export function AutoGrid({
  children,
  minItemWidth = 160,
  gap = 4,
  className,
}: AutoGridProps): React.JSX.Element {
  const [width, setWidth] = useState(0);
  const space = gap * 4;
  const columns =
    width > 0
      ? Math.max(1, Math.floor((width + space) / (Math.min(minItemWidth, width) + space)))
      : 1;
  // Floored to a hundredth: a cell a rounding error too wide wraps the last column.
  const cell =
    width > 0 ? Math.floor(((width - space * (columns - 1)) / columns) * 100) / 100 : undefined;
  return (
    <View
      onLayout={(event: LayoutChangeEvent) => {
        setWidth(event.nativeEvent.layout.width);
      }}
      className={cn('flex-row flex-wrap', gapClass[gap], className)}
    >
      {Children.map(children, (child) => (
        <View style={cell === undefined ? { width: '100%' } : { width: cell }}>{child}</View>
      ))}
    </View>
  );
}

const containerWidth = { sm: 672, md: 896, lg: 1152, xl: 1280, full: undefined } as const;

export type ContainerProps = {
  children?: ReactNode;
  /** The web's widths. A phone is narrower than all of them, so this matters on a tablet. */
  size?: keyof typeof containerWidth;
  /** The screen margin, 16 on a phone. */
  gutter?: boolean;
  className?: string | undefined;
};

/** Centred content at a readable width, with the screen margin. */
export function Container({
  children,
  size = 'lg',
  gutter = true,
  className,
}: ContainerProps): React.JSX.Element {
  const max = containerWidth[size];
  return (
    <View
      className={cn('w-full self-center', gutter && 'px-m-margin', className)}
      style={max === undefined ? undefined : { maxWidth: max }}
    >
      {children}
    </View>
  );
}
