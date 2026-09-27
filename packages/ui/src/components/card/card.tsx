import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentPropsWithoutRef, JSX } from 'react';

import { cn } from '../../lib/cn';

const card = cva('rounded-lg bg-surface text-fg', {
  variants: {
    variant: {
      /** Default. A line, not a shadow, the calmer option in a dense screen. */
      outlined: 'border border-border',
      /** Lifted off the canvas. Reserve for content that floats over context. */
      elevated: 'border border-border shadow-md',
      /** Recessed. For a panel inside a panel, where another border adds noise. */
      sunken: 'bg-surface-sunken',
    },
    padded: { true: 'p-5', false: '' },
    /**
     * `attention`: this card holds something that is wanted and missing. Its
     * one-pixel edge takes the warning border colour, which is the reminder;
     * the card's own words (usually a `Badge tone="attention"`) are the
     * signal, because an edge is colour and colour alone says nothing to a
     * screen reader or to one reader in twelve. Deliberately not a thick
     * stripe down one side: that is the stock callout, and it shouts where
     * this only has to be findable.
     */
    tone: {
      default: '',
      attention: 'border-warning-border',
    },
    /**
     * The whole card is a target. Only set this when the card really is a
     * button or a link. `asChild` it onto an `<a>`, or put a stretched link
     * inside. A div that lifts on hover and does nothing is a lie.
     */
    interactive: {
      true: [
        'cursor-pointer',
        'transition-[box-shadow,border-color,transform] duration-(--animate-duration-fast) ease-standard',
        'hover:border-border-strong hover:shadow-md',
        'active:scale-[0.995]',
        'focus-within:border-border-focus focus-within:shadow-md',
        // The lift is decoration; under reduced motion the border and shadow
        // still change, so the affordance survives without the movement.
        'motion-reduce:active:scale-100',
      ],
      false: '',
    },
  },
  defaultVariants: { variant: 'outlined', padded: false, interactive: false, tone: 'default' },
});

export interface CardProps extends ComponentPropsWithoutRef<'div'>, VariantProps<typeof card> {}

export function Card({
  className,
  variant,
  padded,
  interactive,
  tone,
  ...props
}: CardProps): JSX.Element {
  return <div className={cn(card({ variant, padded, interactive, tone }), className)} {...props} />;
}

export function CardHeader({ className, ...props }: ComponentPropsWithoutRef<'div'>): JSX.Element {
  return (
    <div
      className={cn('flex items-start justify-between gap-4 px-5 pt-5 pb-4', className)}
      {...props}
    />
  );
}

/**
 * The card's heading. An `h3` by default; `level` sets it to fit the page's
 * outline, since a card directly under a page title is a second-level heading
 * and a skipped level is a broken outline to a screen reader.
 */
export function CardTitle({
  className,
  level = 3,
  ...props
}: ComponentPropsWithoutRef<'h3'> & { readonly level?: 2 | 3 | 4 }): JSX.Element {
  const Heading = `h${String(level)}` as 'h2' | 'h3' | 'h4';
  return (
    <Heading className={cn('text-md leading-none font-semibold text-fg', className)} {...props} />
  );
}

export function CardDescription({
  className,
  ...props
}: ComponentPropsWithoutRef<'p'>): JSX.Element {
  return <p className={cn('mt-1.5 text-sm text-fg-muted', className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentPropsWithoutRef<'div'>): JSX.Element {
  return <div className={cn('px-5 pb-5', className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentPropsWithoutRef<'div'>): JSX.Element {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-2 border-t border-border bg-surface-sunken/50 px-5 py-3.5',
        'rounded-b-lg',
        className,
      )}
      {...props}
    />
  );
}
