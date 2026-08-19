'use client';

import * as ProgressPrimitive from '@radix-ui/react-progress';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentPropsWithoutRef, JSX } from 'react';

import { cn } from '../../lib/cn';

/**
 * Determinate and indeterminate progress.
 *
 * The choice between them is a data question, not a design one: show a
 * percentage only when the total is genuinely known. A bar that creeps to 90%
 * and stops is worse than a sweep, because it makes a promise the system
 * cannot keep, and a bulk import of "some number of rows Workday will tell us
 * about eventually" is exactly that case.
 */

const track = cva('relative w-full overflow-hidden rounded-full bg-surface-sunken', {
  variants: {
    size: {
      sm: 'h-1',
      md: 'h-2',
      lg: 'h-3',
    },
  },
  defaultVariants: { size: 'md' },
});

const fill = cva('h-full w-full flex-1 rounded-full transition-transform', {
  variants: {
    tone: {
      accent: 'bg-accent',
      success: 'bg-success',
      warning: 'bg-warning',
      danger: 'bg-danger',
    },
  },
  defaultVariants: { tone: 'accent' },
});

export interface ProgressProps
  extends
    Omit<ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>, 'value'>,
    VariantProps<typeof track>,
    VariantProps<typeof fill> {
  /** `null` means the total is unknown, which renders the indeterminate sweep. */
  value?: number | null;
  max?: number;
  /** Required. A bar with no name is a rectangle to a screen reader. */
  label: string;
  /** Prints the percentage beside the label. */
  showValue?: boolean;
}

export function Progress({
  className,
  value = null,
  max = 100,
  size,
  tone,
  label,
  showValue = false,
  ...props
}: ProgressProps): JSX.Element {
  const indeterminate = value === null;
  const raw = indeterminate ? 0 : (value / max) * 100;
  const percent = indeterminate ? 0 : Math.min(100, Math.max(0, raw));

  return (
    <div className="w-full">
      {showValue ? (
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <span className="text-sm text-fg-muted">{label}</span>
          <span className="text-sm font-medium tabular-nums text-fg">
            {/* The *unclamped* figure: 106% of an entitlement is the fact worth
                printing, even though the bar itself stops at full. */}
            {indeterminate ? '—' : `${String(Math.round(raw))}%`}
          </span>
        </div>
      ) : null}
      <ProgressPrimitive.Root
        // Radix omits `aria-valuenow` when the value is null, which is exactly
        // how a screen reader is told "busy, length unknown". It is also clamped
        // to `max` here: an over-budget value is real data, but a `valuenow`
        // above `valuemax` is invalid ARIA, and Radix rightly warns about it.
        value={indeterminate ? null : Math.min(value, max)}
        max={max}
        aria-valuetext={indeterminate ? undefined : `${String(Math.round(raw))}%`}
        aria-label={showValue ? undefined : label}
        aria-labelledby={undefined}
        className={cn(track({ size }), className)}
        {...props}
      >
        {indeterminate ? (
          <div className={cn(fill({ tone }), 'animate-indeterminate origin-left')} />
        ) : (
          <ProgressPrimitive.Indicator
            className={cn(fill({ tone }), 'duration-(--animate-duration-slow) ease-standard')}
            style={{ transform: `translateX(-${String(100 - percent)}%)` }}
          />
        )}
      </ProgressPrimitive.Root>
    </div>
  );
}

export interface CircularProgressProps extends ComponentPropsWithoutRef<'div'> {
  value?: number | null;
  max?: number;
  label: string;
  /** Diameter in pixels. The stroke scales with it. */
  size?: number;
  tone?: 'accent' | 'success' | 'warning' | 'danger';
  /** Prints the rounded percentage in the middle. */
  showValue?: boolean;
}

const strokeTone = {
  accent: 'stroke-accent',
  success: 'stroke-success',
  warning: 'stroke-warning',
  danger: 'stroke-danger',
} as const;

/**
 * The same value in a ring, for a dashboard tile where a full-width bar would
 * dominate. Drawn with `stroke-dasharray` rather than a conic gradient so the
 * cap is round and the track is visible underneath.
 */
export function CircularProgress({
  className,
  value = null,
  max = 100,
  label,
  size = 48,
  tone = 'accent',
  showValue = true,
  ...props
}: CircularProgressProps): JSX.Element {
  const indeterminate = value === null;
  const percent = indeterminate ? 25 : Math.min(100, Math.max(0, (value / max) * 100));
  const stroke = Math.max(3, Math.round(size / 12));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={indeterminate ? undefined : Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('relative inline-grid place-items-center', className)}
      style={{ width: size, height: size }}
      {...props}
    >
      <svg
        aria-hidden
        width={size}
        height={size}
        viewBox={`0 0 ${String(size)} ${String(size)}`}
        className={indeterminate ? 'animate-spin' : undefined}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-surface-sunken"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - percent / 100)}
          transform={`rotate(-90 ${String(size / 2)} ${String(size / 2)})`}
          className={cn(
            strokeTone[tone],
            'transition-[stroke-dashoffset] duration-(--animate-duration-slow) ease-standard',
          )}
        />
      </svg>
      {showValue && !indeterminate ? (
        <span
          className="absolute font-medium tabular-nums text-fg"
          style={{ fontSize: Math.max(10, size / 4) }}
        >
          {Math.round(percent)}
        </span>
      ) : null}
    </div>
  );
}
