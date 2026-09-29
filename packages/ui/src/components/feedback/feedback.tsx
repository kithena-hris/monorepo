import { cva, type VariantProps } from 'class-variance-authority';
import { Bell, CircleAlert, CircleCheck, Info, Sparkles, TriangleAlert, X } from 'lucide-react';
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Button } from '../button/button';

/* -------------------------------------------------------------------------- */
/* Alert                                                                       */
/* -------------------------------------------------------------------------- */

const alert = cva('flex gap-3 px-4 py-3.5 text-fg', {
  variants: {
    tone: {
      info: '',
      success: '',
      warning: '',
      danger: '',
      accent: '',
      neutral: '',
    },
    /**
     * `soft` is the tinted card that sits among content. `outline` keeps the
     * surface and only marks the edge, for a busy background. `solid` is the
     * full colour, for a blocking problem only. `banner` runs edge to edge at
     * the top of a page or panel.
     */
    variant: {
      soft: 'rounded-[0.875rem] touch:rounded-[1.125rem]',
      outline:
        'rounded-[0.875rem] bg-surface shadow-[inset_0_0_0_1px_var(--reach-color-border-strong)] touch:rounded-[1.125rem]',
      solid: 'rounded-[0.875rem] touch:rounded-[1.125rem]',
      banner: 'rounded-none',
    },
  },
  compoundVariants: [
    { variant: ['soft', 'banner'], tone: 'info', class: 'bg-info-subtle' },
    { variant: ['soft', 'banner'], tone: 'success', class: 'bg-success-subtle' },
    { variant: ['soft', 'banner'], tone: 'warning', class: 'bg-warning-subtle' },
    { variant: ['soft', 'banner'], tone: 'danger', class: 'bg-danger-subtle' },
    { variant: ['soft', 'banner'], tone: 'accent', class: 'bg-accent-subtle' },
    { variant: ['soft', 'banner'], tone: 'neutral', class: 'bg-surface-sunken' },
    // The same fills as a solid `Badge`: each holds 4.5:1 with its text in
    // both themes, which a warning yellow with white text never does.
    { variant: 'solid', tone: 'info', class: 'bg-info-fg text-surface' },
    { variant: 'solid', tone: 'success', class: 'bg-success-solid text-fg-on-solid' },
    { variant: 'solid', tone: 'warning', class: 'bg-warning-fg text-surface' },
    { variant: 'solid', tone: 'danger', class: 'bg-danger-solid text-fg-on-solid' },
    { variant: 'solid', tone: 'accent', class: 'bg-accent-solid text-fg-on-accent' },
    { variant: 'solid', tone: 'neutral', class: 'bg-invert text-fg-on-invert' },
  ],
  defaultVariants: { tone: 'info', variant: 'soft' },
});

type AlertTone = NonNullable<VariantProps<typeof alert>['tone']>;

const alertIcon = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
  accent: Sparkles,
  neutral: Bell,
} as const;

/** The glyph carries the tone; the words stay at full contrast. */
const alertIconTone: Record<AlertTone, string> = {
  info: 'text-info-fg',
  success: 'text-success-fg',
  warning: 'text-warning-fg',
  danger: 'text-danger-fg',
  accent: 'text-accent-fg',
  neutral: 'text-fg-muted',
};

export interface AlertProps
  extends Omit<ComponentPropsWithoutRef<'div'>, 'title'>, VariantProps<typeof alert> {
  title?: ReactNode;
  /** Suppress the leading icon when the surrounding layout already conveys tone. */
  hideIcon?: boolean;
  /**
   * Replaces the tone's glyph when the message has a better one: a lock for
   * "some values are masked", a quote for a plain-words summary. Still drawn in
   * the tone's colour.
   */
  icon?: ReactNode;
  /** Trailing action, typically a `Button` with `variant="ghost"`. */
  action?: ReactNode;
  /**
   * Actions under the message, for the "what now" of a failure: Retry, View
   * details. Small secondary buttons, left-aligned with the text.
   */
  actions?: ReactNode;
  /** Renders a close control. The alert does not hide itself; the caller does. */
  onDismiss?: () => void;
  /** Accessible name of the close control. */
  dismissLabel?: string;
}

/**
 * Inline message about the surrounding content.
 *
 * `danger` and `warning` announce assertively; the quieter tones do not
 * interrupt what a screen reader is currently saying.
 */
export function Alert({
  className,
  tone,
  variant,
  title,
  hideIcon = false,
  icon,
  action,
  actions,
  onDismiss,
  dismissLabel = 'Dismiss',
  children,
  ...props
}: AlertProps): JSX.Element {
  const resolvedTone = tone ?? 'info';
  const Icon = alertIcon[resolvedTone];
  const urgent = resolvedTone === 'danger' || resolvedTone === 'warning';
  // On a solid fill everything takes the fill's text colour.
  const solid = variant === 'solid';

  return (
    <div
      role={urgent ? 'alert' : 'status'}
      aria-live={urgent ? 'assertive' : 'polite'}
      className={cn(alert({ tone, variant }), 'motion-safe:animate-slide-up', className)}
      {...props}
    >
      {hideIcon ? null : icon !== undefined ? (
        <span
          aria-hidden="true"
          className={cn(
            'mt-px shrink-0 [&_svg]:size-5',
            solid ? null : alertIconTone[resolvedTone],
          )}
        >
          {icon}
        </span>
      ) : (
        <Icon
          className={cn('mt-px size-5 shrink-0', solid ? null : alertIconTone[resolvedTone])}
          aria-hidden="true"
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title ? (
          <p className="text-[0.875rem] leading-snug font-semibold touch:text-[1rem]">{title}</p>
        ) : null}
        {children ? (
          <div className={cn('text-sm leading-normal', solid ? null : 'text-fg-muted')}>
            {children}
          </div>
        ) : null}
        {actions ? <div className="mt-1.5 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
      {onDismiss ? (
        <Button
          variant="ghost"
          size="xs"
          onClick={onDismiss}
          aria-label={dismissLabel}
          startIcon={<X aria-hidden="true" />}
          // The wash has to read on any tone, so it is the text colour thinned
          // rather than a grey that disappears on the neutral alert.
          className={cn(
            '-me-1.5 -mt-1 hover:bg-[color-mix(in_oklch,currentColor_12%,transparent)]',
            solid ? 'text-current' : 'text-fg-muted hover:text-fg',
          )}
        />
      ) : null}
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
  /**
   * `accent` for an empty state that is an invitation — "Invite your team" —
   * rather than a report that there is nothing here.
   */
  tone?: 'neutral' | 'accent';
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
  tone = 'neutral',
  ...props
}: EmptyStateProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2.5 px-4 py-7 text-center',
        className,
      )}
      {...props}
    >
      {icon ? (
        <div
          aria-hidden
          className={cn(
            'grid size-14 place-items-center rounded-full [&_svg]:size-6.5',
            tone === 'accent'
              ? 'bg-accent-subtle text-accent-fg'
              : 'bg-surface-sunken text-fg-muted',
          )}
        >
          {icon}
        </div>
      ) : null}
      <div className="space-y-1.5">
        <p className="text-[1rem] leading-snug font-semibold text-fg touch:text-md">{title}</p>
        {description ? (
          <p className="mx-auto max-w-80 text-sm leading-normal text-pretty text-fg-muted">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="mt-1.5 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}
