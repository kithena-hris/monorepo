import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentPropsWithoutRef, JSX } from 'react';

import { cn } from '../../lib/cn';

const card = cva('rounded-lg bg-surface text-fg touch:rounded-[1.375rem]', {
  variants: {
    variant: {
      /**
       * Default. The surface on the grey canvas with a hairline shadow — in
       * the dark theme, a hairline ring. The calm option in a dense screen.
       */
      raised: 'shadow-sm',
      /** A line and no fill, for grouping on a surface that is already white. */
      outline: 'bg-transparent shadow-[inset_0_0_0_1px_var(--reach-color-border-strong)]',
      /**
       * The name this system used before `raised`. It was the default and
       * callers still pass it, so it keeps the default's look.
       */
      outlined: 'shadow-sm',
      /** A grey fill and no edge. For a panel inside a panel, where another edge adds noise. */
      fill: 'bg-surface-sunken',
      /** The earlier name for `fill`. */
      sunken: 'bg-surface-sunken',
      /** Lifted off the canvas. Reserve for content that floats over context. */
      elevated: 'bg-surface-raised shadow-lg',
    },
    padded: { true: 'p-5 touch:p-4', false: '' },
    /**
     * The whole card is a target. Only set this when the card really is a
     * button or a link. `asChild` it onto an `<a>`, or put a stretched link
     * inside. A div that lifts on hover and does nothing is a lie.
     */
    interactive: {
      true: [
        'cursor-pointer',
        'transition-[box-shadow,transform] duration-(--animate-duration-fast) ease-standard',
        'hover:shadow-md',
        'active:scale-[0.995]',
        'focus-within:shadow-md',
        // The lift is decoration; under reduced motion the border and shadow
        // still change, so the affordance survives without the movement.
        'motion-reduce:active:scale-100',
      ],
      false: '',
    },
  },
  defaultVariants: { variant: 'raised', padded: false, interactive: false },
});

export interface CardProps extends ComponentPropsWithoutRef<'div'>, VariantProps<typeof card> {}

export function Card({
  className,
  variant,
  padded,
  interactive,
  ...props
}: CardProps): JSX.Element {
  return <div className={cn(card({ variant, padded, interactive }), className)} {...props} />;
}

export function CardHeader({ className, ...props }: ComponentPropsWithoutRef<'div'>): JSX.Element {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 px-5 pt-5 pb-4 touch:px-4 touch:pt-4 touch:pb-3',
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentPropsWithoutRef<'h3'>): JSX.Element {
  return (
    <h3
      className={cn('text-md leading-tight font-semibold tracking-tight text-fg', className)}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: ComponentPropsWithoutRef<'p'>): JSX.Element {
  return <p className={cn('mt-1 text-sm text-fg-muted', className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentPropsWithoutRef<'div'>): JSX.Element {
  return <div className={cn('px-5 pb-5 touch:px-4 touch:pb-4', className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentPropsWithoutRef<'div'>): JSX.Element {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-2 border-t border-border px-5 py-3.5',
        'rounded-b-[inherit] touch:px-4 touch:py-3',
        className,
      )}
      {...props}
    />
  );
}
