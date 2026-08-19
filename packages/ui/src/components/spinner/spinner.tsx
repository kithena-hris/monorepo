import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentPropsWithoutRef, JSX } from 'react';

import { cn } from '../../lib/cn';

const spinner = cva('animate-spin text-current motion-reduce:animate-none', {
  variants: {
    size: {
      xs: 'size-3',
      sm: 'size-4',
      md: 'size-5',
      lg: 'size-8',
    },
  },
  defaultVariants: { size: 'md' },
});

export interface SpinnerProps
  extends Omit<ComponentPropsWithoutRef<'span'>, 'children'>, VariantProps<typeof spinner> {
  /**
   * Screen-reader text. A spinner with no label is a silent pause for anyone
   * not looking at the screen.
   */
  label?: string;
}

/** Indeterminate progress. For known-duration work, show real progress instead. */
export function Spinner({
  className,
  size,
  label = 'Loading',
  ...props
}: SpinnerProps): JSX.Element {
  return (
    <span role="status" className={cn('inline-flex', className)} {...props}>
      <svg
        className={spinner({ size })}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}
