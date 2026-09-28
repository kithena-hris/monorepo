import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';

export interface ChartCardProps extends Omit<ComponentPropsWithoutRef<'section'>, 'title'> {
  /** What the chart measures, in words: "Headcount by team". */
  title: ReactNode;
  /** The headline figure, printed large above the chart. */
  value?: ReactNode;
  /** One line of context under the title or figure. */
  description?: ReactNode;
  /** Top-right slot: a period picker, a segmented control, a menu. */
  action?: ReactNode;
}

/**
 * The card a chart sits in.
 *
 * Title first and quiet, the figure large, then the chart: the order a reader
 * asks in ("what is this, how much, how has it moved"). Lifted off the canvas
 * with a shadow rather than outlined, because a hairline border around a plot
 * full of hairline gridlines is one more line to read past.
 *
 * Padding and radius grow under a finger to match the phone's cards; nothing
 * here asks how wide the window is.
 */
export function ChartCard({
  title,
  value,
  description,
  action,
  className,
  children,
  ...props
}: ChartCardProps): JSX.Element {
  return (
    <section
      className={cn(
        'min-w-0 rounded-lg bg-surface p-6 text-fg shadow-sm',
        'touch:rounded-[22px] touch:p-[18px]',
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          'flex flex-wrap items-start justify-between gap-3',
          value === undefined ? 'mb-4' : 'mb-5',
        )}
      >
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-fg-muted">{title}</h3>
          {value === undefined ? null : (
            <p className="mt-1.5 font-display text-2xl leading-[1.1] font-bold tracking-[-0.03em] tabular-nums touch:text-[30px]">
              {value}
            </p>
          )}
          {description === undefined ? null : (
            <p className="mt-1 text-sm text-pretty text-fg-muted">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
