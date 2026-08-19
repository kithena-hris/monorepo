import { cva, type VariantProps } from 'class-variance-authority';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';

/* -------------------------------------------------------------------------- */
/* Alert                                                                       */
/* -------------------------------------------------------------------------- */

const alert = cva('flex gap-3 rounded-md border p-3.5 text-sm', {
  variants: {
    tone: {
      info: 'border-info-border bg-info-subtle text-info-fg',
      success: 'border-success-border bg-success-subtle text-success-fg',
      warning: 'border-warning-border bg-warning-subtle text-warning-fg',
      danger: 'border-danger-border bg-danger-subtle text-danger-fg',
    },
  },
  defaultVariants: { tone: 'info' },
});

const alertIcon = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
} as const;

export interface AlertProps
  extends Omit<ComponentPropsWithoutRef<'div'>, 'title'>, VariantProps<typeof alert> {
  title?: ReactNode;
  /** Suppress the leading icon when the surrounding layout already conveys tone. */
  hideIcon?: boolean;
  /** Trailing action, typically a `Button` with `variant="ghost"`. */
  action?: ReactNode;
}

/**
 * Inline message about the surrounding content.
 *
 * `danger` and `warning` announce assertively; the quieter tones do not
 * interrupt what a screen reader is currently saying.
 */
export function Alert({
  className,
  tone = 'info',
  title,
  hideIcon = false,
  action,
  children,
  ...props
}: AlertProps): JSX.Element {
  const Icon = alertIcon[tone ?? 'info'];
  const urgent = tone === 'danger' || tone === 'warning';

  return (
    <div
      role={urgent ? 'alert' : 'status'}
      aria-live={urgent ? 'assertive' : 'polite'}
      className={cn(alert({ tone }), 'motion-safe:animate-slide-up', className)}
      {...props}
    >
      {hideIcon ? null : <Icon className="mt-px size-4 shrink-0" aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title && 'mt-1', 'text-fg-muted')}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Skeleton                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Loading placeholder.
 *
 * Shaped like the content it replaces, so the layout does not jump when data
 * lands. A spinner where a table will be is a layout shift you scheduled.
 */
export function Skeleton({ className, ...props }: ComponentPropsWithoutRef<'div'>): JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'rounded-sm bg-surface-sunken',
        'bg-[linear-gradient(90deg,transparent,var(--reach-color-surface-hover),transparent)]',
        'bg-[length:200%_100%] animate-shimmer',
        'motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* EmptyState                                                                  */
/* -------------------------------------------------------------------------- */

export interface EmptyStateProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

/**
 * Nothing to show.
 *
 * An empty state names the reason and offers the next step. "No results" on
 * its own tells the user what they can already see.
 */
export function EmptyState({
  className,
  icon,
  title,
  description,
  action,
  ...props
}: EmptyStateProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border',
        'px-6 py-12 text-center',
        className,
      )}
      {...props}
    >
      {icon ? (
        <div className="grid size-10 place-items-center rounded-full bg-surface-sunken text-fg-subtle [&_svg]:size-5">
          {icon}
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="text-base font-semibold text-fg">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-sm text-fg-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
