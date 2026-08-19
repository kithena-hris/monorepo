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
  /** e.g. `+12%`, `−4 days`. */
  delta?: string;
  /** What the delta is measured against. Required alongside `delta`. */
  deltaLabel?: string;
  direction?: 'up' | 'down' | 'flat';
  /** Whether that movement is good news. Defaults to neutral. */
  sentiment?: 'positive' | 'negative' | 'neutral';
  /** A sparkline or small chart, rendered under the value. */
  chart?: ReactNode;
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
  delta,
  deltaLabel,
  direction = 'flat',
  sentiment = 'neutral',
  chart,
  icon,
  ...props
}: StatProps): JSX.Element {
  const DirectionIcon = directionIcon[direction];

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col rounded-lg border border-border bg-surface p-4',
        // Container query, not a breakpoint: this tile is dropped into a
        // 4-across grid, a 2-across tablet grid and a 320px sidebar, and only
        // the tile knows which one it landed in.
        '@container',
        className,
      )}
      {...props}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">{label}</p>
        {icon ? <span className="shrink-0 text-fg-subtle [&_svg]:size-4">{icon}</span> : null}
      </div>

      <p className="mt-2 text-xl font-semibold tabular-nums text-fg @sm:text-2xl">{value}</p>

      {delta ? (
        <p className={cn('mt-1 flex items-center gap-1 text-sm', sentimentClass[sentiment])}>
          <DirectionIcon aria-hidden className="size-3.5 shrink-0" />
          <span className="font-medium tabular-nums">{delta}</span>
          {deltaLabel ? <span className="truncate text-fg-muted">{deltaLabel}</span> : null}
        </p>
      ) : null}

      {chart ? <div className="mt-3 min-w-0">{chart}</div> : null}
    </div>
  );
}
