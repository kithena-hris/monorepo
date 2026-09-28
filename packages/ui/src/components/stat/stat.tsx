import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * A single headline number.
 *
 * Two rules that keep a dashboard honest:
 *
 * 1. **A delta needs a period.** "+12%" is meaningless; "+12% vs last quarter"
 *    is a fact. `deltaLabel` is required whenever `delta` is set.
 * 2. **Up is not good.** Headcount up is growth; attrition up is a problem.
 *    `direction` says which way the number moved and `sentiment` says whether
 *    that is good, and they are separate props because they are separate
 *    questions. Getting this wrong paints a resignation spike green.
 */

export interface StatProps extends ComponentPropsWithoutRef<'div'> {
  label: string;
  /** The number itself. Pass a `<Money>` or a formatted string, never a float. */
  value: ReactNode;
  /** A unit set small after the value: `days`, `%`, `FTE`. */
  unit?: string;
  /** e.g. `+12%`, `−4 days`. */
  delta?: string;
  /** What the delta is measured against. Required alongside `delta`. */
  deltaLabel?: string;
  direction?: 'up' | 'down' | 'flat';
  /** Whether that movement is good news. Defaults to neutral. */
  sentiment?: 'positive' | 'negative' | 'neutral';
  /**
   * A sparkline or small chart. It sits beside the value, bottom-aligned, and
   * drops underneath it when the tile is too narrow for both.
   */
  chart?: ReactNode;
  /** One line of context under everything else. */
  description?: ReactNode;
  icon?: ReactNode;
}

const sentimentClass = {
  positive: 'text-success-fg',
  negative: 'text-danger-fg',
  neutral: 'text-fg-muted',
} as const;

const directionIcon = {
  up: ArrowUpRight,
  down: ArrowDownRight,
  flat: ArrowRight,
} as const;

export function Stat({
  className,
  label,
  value,
  unit,
  delta,
  deltaLabel,
  direction = 'flat',
  sentiment = 'neutral',
  chart,
  description,
  icon,
  ...props
}: StatProps): JSX.Element {
  const DirectionIcon = directionIcon[direction];

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1.5 rounded-lg bg-surface p-5 shadow-sm touch:p-4',
        // Container query, not a breakpoint: this tile is dropped into a
        // 4-across grid, a 2-across tablet grid and a 320px sidebar, and only
        // the tile knows which one it landed in.
        '@container',
        className,
      )}
      {...props}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-fg-muted">{label}</p>
        {icon ? <span className="shrink-0 text-fg-subtle [&_svg]:size-4">{icon}</span> : null}
      </div>

      <div className="flex min-w-0 flex-wrap items-end justify-between gap-x-3 gap-y-2">
        <p
          className={cn(
            'font-display leading-[1.05] font-bold tracking-[-0.03em] tabular-nums text-fg',
            // Sized by the tile, not by a step. A figure like "€9,834,500" in a
            // two-across phone grid is wider than a fixed 24px can hold, and a
            // number that runs out of its card is worse than a smaller one. At
            // 14% of the tile's width a ten-character figure still fits;
            // `anywhere` is the last resort for a longer one, never overflow.
            'text-[clamp(1.125rem,14cqi,2.125rem)] [overflow-wrap:anywhere]',
          )}
        >
          {value}
          {unit ? (
            <span className="ms-1 text-[0.5em] font-semibold tracking-normal text-fg-muted">
              {unit}
            </span>
          ) : null}
        </p>
        {chart ? <div className="min-w-0 shrink-0">{chart}</div> : null}
      </div>

      {delta ? (
        <p className={cn('flex items-center gap-1 text-xs', sentimentClass[sentiment])}>
          <DirectionIcon aria-hidden className="size-3.5 shrink-0" />
          <span className="font-semibold tabular-nums">{delta}</span>
          {deltaLabel ? <span className="truncate text-fg-muted">{deltaLabel}</span> : null}
        </p>
      ) : null}

      {description ? <p className="text-sm text-fg-muted text-pretty">{description}</p> : null}
    </div>
  );
}
