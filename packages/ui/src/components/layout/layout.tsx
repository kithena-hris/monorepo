import type { ComponentPropsWithoutRef, ElementType, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * Layout primitives.
 *
 * These exist so that spacing is a token rather than a number someone typed,
 * and so the common responsive behaviours are one prop instead of four
 * breakpoint classes copied between screens.
 *
 * The rule they encode: *ask the container, not the window*. `AutoGrid` wraps
 * when the column it was dropped into gets narrow, whether that is a phone, a
 * sidebar on a desktop, or a split view on an iPad, three situations a
 * `md:grid-cols-3` cannot tell apart.
 */

/** Spacing steps, in the 4px rhythm the whole system is on. */
export type Gap = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12;

/*
 * Tailwind scans source text for complete class names. `gap-${n}` compiles to
 * nothing, so every value the API accepts is written out.
 */
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

export interface StackProps extends ComponentPropsWithoutRef<'div'> {
  gap?: Gap;
  align?: keyof typeof alignClass;
  justify?: keyof typeof justifyClass;
  /** Render as something other than a div. `as="section"`, `as="ul"`. */
  as?: ElementType;
}

/** Vertical flow. The default arrangement for anything read top to bottom. */
export function Stack({
  className,
  gap = 4,
  align = 'stretch',
  justify = 'start',
  as: Comp = 'div',
  ...props
}: StackProps): JSX.Element {
  return (
    <Comp
      className={cn(
        'flex min-w-0 flex-col',
        gapClass[gap],
        alignClass[align],
        justifyClass[justify],
        className,
      )}
      {...props}
    />
  );
}

export interface InlineProps extends StackProps {
  /**
   * Wrap onto the next line instead of overflowing. On by default: a row of
   * filter chips that cannot wrap is a row that clips on a phone.
   */
  wrap?: boolean;
  /**
   * Stack vertically below the `sm` breakpoint. The honest default for a
   * header's action group, where three side-by-side buttons at 375px each end
   * up too narrow to read.
   */
  collapseBelow?: 'none' | 'xs' | 'sm' | 'md';
}

const collapseClass = {
  none: '',
  xs: 'max-xs:flex-col max-xs:items-stretch',
  sm: 'max-sm:flex-col max-sm:items-stretch',
  md: 'max-md:flex-col max-md:items-stretch',
} as const;

/** Horizontal flow. */
export function Inline({
  className,
  gap = 2,
  align = 'center',
  justify = 'start',
  wrap = true,
  collapseBelow = 'none',
  as: Comp = 'div',
  ...props
}: InlineProps): JSX.Element {
  return (
    <Comp
      className={cn(
        'flex min-w-0',
        wrap && 'flex-wrap',
        gapClass[gap],
        alignClass[align],
        justifyClass[justify],
        collapseClass[collapseBelow],
        className,
      )}
      {...props}
    />
  );
}

export interface AutoGridProps extends ComponentPropsWithoutRef<'div'> {
  /**
   * The narrowest a column may get before the grid drops one. Expressed in CSS
   * units, and wrapped in `min(…, 100%)` so a 20rem minimum does not overflow
   * a 16rem container, the classic auto-fit horizontal-scroll bug.
   */
  minItemWidth?: string;
  gap?: Gap;
}

/**
 * A grid with no breakpoints in it.
 *
 * `repeat(auto-fit, minmax(min(<w>, 100%), 1fr))` reflows on the *container's*
 * width, so the same component gives four cards on a desktop, two on an iPad,
 * one on an iPhone and two in a 4K sidebar without anyone enumerating those
 * cases.
 */
export function AutoGrid({
  className,
  minItemWidth = '16rem',
  gap = 4,
  style,
  ...props
}: AutoGridProps): JSX.Element {
  return (
    <div
      className={cn('grid', gapClass[gap], className)}
      style={{
        gridTemplateColumns: `repeat(auto-fit, minmax(min(${minItemWidth}, 100%), 1fr))`,
        ...style,
      }}
      {...props}
    />
  );
}

const containerSize = {
  sm: 'max-w-2xl',
  md: 'max-w-4xl',
  lg: 'max-w-6xl',
  xl: 'max-w-7xl',
  full: 'max-w-none',
} as const;

export interface ContainerProps extends ComponentPropsWithoutRef<'div'> {
  size?: keyof typeof containerSize;
  /**
   * Pad the sides, including the notch insets on a landscape iPhone where the
   * safe area is horizontal rather than vertical.
   */
  gutter?: boolean;
}

/** Centred measure with responsive gutters. */
export function Container({
  className,
  size = 'lg',
  gutter = true,
  ...props
}: ContainerProps): JSX.Element {
  return (
    <div
      className={cn(
        'mx-auto w-full',
        containerSize[size],
        gutter &&
          'px-4 ps-[max(1rem,var(--spacing-safe-left))] pe-[max(1rem,var(--spacing-safe-right))] sm:px-6 lg:px-8',
        className,
      )}
      {...props}
    />
  );
}

export interface SplitProps extends ComponentPropsWithoutRef<'div'> {
  /** The fixed-width side. */
  aside: ReactNode;
  /** Which side the aside sits on at wide sizes. */
  side?: 'start' | 'end';
  /** Below this width the two panes stack, aside last. */
  stackBelow?: 'md' | 'lg' | 'xl';
  gap?: Gap;
}

const splitClass = {
  md: 'md:grid-cols-[minmax(0,1fr)_20rem]',
  lg: 'lg:grid-cols-[minmax(0,1fr)_22rem]',
  xl: 'xl:grid-cols-[minmax(0,1fr)_24rem]',
} as const;

const splitStartClass = {
  md: 'md:grid-cols-[20rem_minmax(0,1fr)]',
  lg: 'lg:grid-cols-[22rem_minmax(0,1fr)]',
  xl: 'xl:grid-cols-[24rem_minmax(0,1fr)]',
} as const;

/**
 * Main content plus a detail rail that becomes a stacked block on narrow
 * screens. `minmax(0, 1fr)` and not `1fr`: a grid track's default minimum is
 * `auto`, so one wide table inside it stops the whole pane from ever shrinking.
 */
export function Split({
  className,
  aside,
  side = 'end',
  stackBelow = 'lg',
  gap = 6,
  children,
  ...props
}: SplitProps): JSX.Element {
  return (
    <div
      className={cn(
        'grid grid-cols-1',
        gapClass[gap],
        side === 'end' ? splitClass[stackBelow] : splitStartClass[stackBelow],
        className,
      )}
      {...props}
    >
      {side === 'start' ? <div className="min-w-0">{aside}</div> : null}
      <div className="min-w-0">{children}</div>
      {side === 'end' ? <div className="min-w-0">{aside}</div> : null}
    </div>
  );
}
