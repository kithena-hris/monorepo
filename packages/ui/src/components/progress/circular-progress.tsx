import type { ComponentPropsWithoutRef, JSX } from 'react';

import { cn } from '../../lib/cn';

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
  const stroke = Math.max(3, Math.round(size / 9));
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
          className="stroke-surface-active"
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
          className="absolute font-bold tabular-nums text-fg"
          style={{ fontSize: Math.max(10, Math.round(size / 4)) }}
        >
          {Math.round(percent)}
          {/* Below 40px the sign crowds the number out of the ring. */}
          {size >= 40 ? '%' : null}
        </span>
      ) : null}
    </div>
  );
}
