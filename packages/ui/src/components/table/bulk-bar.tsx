'use client';

import { X } from 'lucide-react';
import type { JSX, ReactNode } from 'react';

import { bulkBarClass } from '../../lib/bulk-bar';
import { cn } from '../../lib/cn';
import { PINNED_BAR } from '../../lib/pinned';
import { Button } from '../button/button';

/**
 * The bar a selection summons: how many are picked, what can be done to
 * them, and the way out. `DataTable` draws its own with this; a table that
 * is not a `DataTable` puts one under itself the same way.
 *
 * Under the table and sticky to the bottom of the viewport, not floating
 * over the table. In flow it never covers the last row: under a short table
 * it simply sits beneath it, and on a long one it rides the bottom edge until
 * the table's end scrolls up to meet it. Inverted, so it reads as a mode the
 * page is in rather than one more row. It wraps on a narrow screen instead of
 * pushing the count off it.
 */
export function BulkBar({
  count,
  onClear,
  children,
  className,
}: {
  /** How many are selected; the bar is not drawn for none. */
  count: number;
  onClear: () => void;
  /** The actions, as `Button`s; the bar restyles them for its fill. */
  children: ReactNode;
  className?: string;
}): JSX.Element | null {
  if (count === 0) return null;
  return (
    <div
      role="group"
      aria-label={`${String(count)} selected`}
      {...PINNED_BAR}
      className={cn('sticky bottom-4 z-20', bulkBarClass, 'motion-safe:animate-pop-in', className)}
    >
      <span aria-live="polite" className="text-sm font-semibold tabular-nums">
        {count} selected
      </span>
      <span aria-hidden className="mx-2 h-5 w-px bg-fg-on-invert/25" />
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
      <Button
        size="sm"
        variant="ghost"
        aria-label="Clear selection"
        startIcon={<X />}
        onClick={onClear}
      />
    </div>
  );
}
