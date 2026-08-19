import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * An ordered history: an approval chain, an audit trail, a record's revisions.
 *
 * This is the shape an event-sourced HRIS produces naturally, and the reason
 * the component exists at the system level. Two dates are not a decoration
 * here. `occurredAt` (when we recorded it) and `effectiveFrom` (when it takes
 * effect in the domain) genuinely differ, and a promotion entered on the 15th
 * effective the 1st has to show both or the reader cannot explain the
 * retroactive payroll delta.
 *
 * An `<ol>` because the order is the meaning; the connector is drawn with a
 * pseudo-element so it never becomes a list item of its own.
 */

export function Timeline({ className, ...props }: ComponentPropsWithoutRef<'ol'>): JSX.Element {
  return <ol className={cn('relative space-y-0', className)} {...props} />;
}

export interface TimelineItemProps extends Omit<ComponentPropsWithoutRef<'li'>, 'title'> {
  title: ReactNode;
  /** When it was recorded. */
  timestamp?: ReactNode;
  /** When it takes effect, if that differs from when it was recorded. */
  effectiveFrom?: ReactNode;
  /** Dot colour. Carries no meaning on its own, the title does. */
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
  /** Replaces the dot: an avatar, a status icon. */
  marker?: ReactNode;
  /** The last item, which stops the connector rather than leaving it dangling. */
  last?: boolean;
}

const dotTone = {
  neutral: 'bg-surface border-border-strong',
  accent: 'bg-accent border-accent',
  success: 'bg-success border-success',
  warning: 'bg-warning border-warning',
  danger: 'bg-danger border-danger',
} as const;

export function TimelineItem({
  className,
  title,
  timestamp,
  effectiveFrom,
  tone = 'neutral',
  marker,
  last = false,
  children,
  ...props
}: TimelineItemProps): JSX.Element {
  return (
    <li className={cn('relative flex gap-3 pb-5 last:pb-0', className)} {...props}>
      <div className="relative flex shrink-0 flex-col items-center">
        {marker ?? (
          <span className={cn('mt-1 size-2.5 rounded-full border-2', dotTone[tone])} aria-hidden />
        )}
        {!last ? <span aria-hidden className="mt-1 w-px flex-1 bg-border" /> : null}
      </div>

      <div className="min-w-0 flex-1 pb-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p className="min-w-0 text-base font-medium text-fg">{title}</p>
          {timestamp ? <span className="text-xs text-fg-subtle">{timestamp}</span> : null}
        </div>
        {effectiveFrom ? (
          <p className="mt-0.5 text-xs text-fg-muted">Effective {effectiveFrom}</p>
        ) : null}
        {children ? <div className="mt-1.5 text-sm text-fg-muted">{children}</div> : null}
      </div>
    </li>
  );
}
