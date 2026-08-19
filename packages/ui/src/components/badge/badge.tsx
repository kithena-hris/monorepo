import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentPropsWithoutRef, JSX } from 'react';

import { cn } from '../../lib/cn';

const badge = cva(
  'inline-flex items-center gap-1 rounded-full border font-medium whitespace-nowrap [&_svg]:size-3',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-surface-sunken text-fg-muted',
        accent: 'border-transparent bg-accent-subtle text-accent-fg',
        success: 'border-success-border bg-success-subtle text-success-fg',
        warning: 'border-warning-border bg-warning-subtle text-warning-fg',
        danger: 'border-danger-border bg-danger-subtle text-danger-fg',
        info: 'border-info-border bg-info-subtle text-info-fg',
      },
      size: {
        sm: 'h-5 px-2 text-2xs',
        md: 'h-6 px-2.5 text-xs',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
);

export interface BadgeProps extends ComponentPropsWithoutRef<'span'>, VariantProps<typeof badge> {
  /**
   * Renders a filled dot in the tone colour. Use it when the badge sits in a
   * dense table where the wash alone is easy to miss.
   */
  dot?: boolean;
}

/**
 * Status marker.
 *
 * The tone is never the only signal, the label carries the meaning, because
 * roughly one in twelve men cannot separate the success and danger washes.
 */
export function Badge({
  className,
  tone,
  size,
  dot = false,
  children,
  ...props
}: BadgeProps): JSX.Element {
  return (
    <span className={cn(badge({ tone, size }), className)} {...props}>
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
