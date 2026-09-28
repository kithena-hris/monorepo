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
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
  /**
   * A glyph in a 28px disc of the tone's wash instead of the plain dot: a
   * send, a tick, a clock. For a chain of different kinds of step.
   */
  icon?: ReactNode;
  /**
   * Where the event sits against now. `current` pulses, so the step being
   * waited on is the one the eye lands on. `upcoming` is hollow and muted,
   * and the line into it is dashed: it has not happened, and may not.
   */
  status?: 'past' | 'current' | 'upcoming';
  /** Replaces the dot entirely: an avatar, say. */
  marker?: ReactNode;
  /** The last item, which stops the connector rather than leaving it dangling. */
  last?: boolean;
}

/** Solid dot, wash behind an icon, and the ring of a hollow step, per tone. */
const toneClasses = {
  neutral: { dot: 'bg-fg-subtle', icon: 'bg-surface-sunken text-fg-muted', ring: 'ring-fg-subtle' },
  accent: { dot: 'bg-accent', icon: 'bg-accent-subtle text-accent-fg', ring: 'ring-accent' },
  success: { dot: 'bg-success', icon: 'bg-success-subtle text-success-fg', ring: 'ring-success' },
  warning: { dot: 'bg-warning', icon: 'bg-warning-subtle text-warning-fg', ring: 'ring-warning' },
  danger: { dot: 'bg-danger', icon: 'bg-danger-subtle text-danger-fg', ring: 'ring-danger' },
  info: { dot: 'bg-info', icon: 'bg-info-subtle text-info-fg', ring: 'ring-info' },
} as const;

export function TimelineItem({
  className,
  title,
  timestamp,
  effectiveFrom,
  tone = 'neutral',
  icon,
  status = 'past',
  marker,
  last = false,
  children,
  ...props
}: TimelineItemProps): JSX.Element {
  const upcoming = status === 'upcoming';
  const tones = toneClasses[tone];

  const dot = icon ? (
    <span
      aria-hidden
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-full [&_svg]:size-3.5',
        upcoming ? 'bg-surface text-fg-muted ring-2 ring-border-strong ring-inset' : tones.icon,
        status === 'current' && 'animate-pulse-ring',
      )}
    >
      {icon}
    </span>
  ) : (
    <span
      aria-hidden
      className={cn(
        'mt-[5px] size-3 shrink-0 rounded-full',
        upcoming ? cn('bg-surface ring-2 ring-inset', tones.ring) : tones.dot,
        status === 'current' && 'animate-pulse-ring',
      )}
    />
  );

  return (
    <li
      data-status={status}
      className={cn(
        'relative flex gap-3.5',
        /*
         * The line into an upcoming event is dashed, and it is drawn by the
         * item before it, so that item asks whether its next sibling is still
         * to come. A custom property carries the answer down to the line.
         */
        '[--timeline-line:solid] data-[status=upcoming]:[--timeline-line:dashed]',
        'has-[+[data-status=upcoming]]:[--timeline-line:dashed]',
        className,
      )}
      {...props}
    >
      <div className={cn('flex shrink-0 flex-col items-center', icon ? 'w-7' : 'w-3')}>
        {marker ?? dot}
        {!last ? (
          <span
            aria-hidden
            className="my-1 min-h-4 w-0 flex-1 border-s-2 border-border-strong [border-inline-start-style:var(--timeline-line)]"
          />
        ) : null}
      </div>

      <div className={cn('min-w-0 flex-1', !last && 'pb-4.5', icon && 'pt-1')}>
        <div className="flex items-baseline justify-between gap-3">
          <p
            className={cn(
              'min-w-0 text-[0.875rem]/[1.35] font-semibold touch:text-[1rem]/[1.35]',
              upcoming ? 'text-fg-muted' : 'text-fg',
            )}
          >
            {title}
          </p>
          {timestamp ? (
            <span className="shrink-0 text-xs whitespace-nowrap tabular-nums text-fg-subtle">
              {timestamp}
            </span>
          ) : null}
        </div>
        {effectiveFrom ? (
          <p className="mt-0.5 text-xs text-fg-muted">Effective {effectiveFrom}</p>
        ) : null}
        {children ? (
          <div className="mt-0.5 text-[0.8125rem]/[1.5] text-pretty text-fg-muted touch:text-[0.9375rem]/[1.5]">
            {children}
          </div>
        ) : null}
      </div>
    </li>
  );
}
