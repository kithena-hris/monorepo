'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { JSX } from 'react';

import { cn } from '../../lib/cn';
import { Button } from '../button/button';

/**
 * Offset pagination.
 *
 * Worth stating the trade rather than hiding it: `LIMIT/OFFSET` over a table
 * that is being written to shows duplicates and skips rows as pages move, and
 * `OFFSET 40000` is a sequential scan. For a directory the user filters down
 * to a few hundred rows that is fine and the ability to jump to page 12 is
 * worth more. For an audit log or an event stream, use keyset pagination and
 * the infinite list instead: see the Patterns page.
 *
 * The window is elided rather than rendered in full: 900 page buttons is not a
 * navigation control, and every one of them is a tab stop.
 */

export interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Pages either side of the current one before eliding. */
  siblings?: number;
  /** Total row count, for the "Showing 21–40 of 912" summary. */
  totalItems?: number;
  pageSize?: number;
  className?: string;
  /** Accessible name, for a page with more than one pager on it. */
  label?: string;
}

const ELLIPSIS = 'ellipsis' as const;

/** Exported for the unit test: the elision is the only logic in this file. */
export function paginationRange(
  page: number,
  pageCount: number,
  siblings: number,
): readonly (number | typeof ELLIPSIS)[] {
  // First, last, current, its siblings, and the two ellipses: below that total
  // there is nothing to hide and the full list is shorter than the elided one.
  const total = siblings * 2 + 5;
  if (pageCount <= total) return Array.from({ length: pageCount }, (_, i) => i + 1);

  const left = Math.max(page - siblings, 1);
  const right = Math.min(page + siblings, pageCount);
  const showLeftEllipsis = left > 2;
  const showRightEllipsis = right < pageCount - 1;

  if (!showLeftEllipsis && showRightEllipsis) {
    const count = siblings * 2 + 3;
    return [...Array.from({ length: count }, (_, i) => i + 1), ELLIPSIS, pageCount];
  }
  if (showLeftEllipsis && !showRightEllipsis) {
    const count = siblings * 2 + 3;
    return [1, ELLIPSIS, ...Array.from({ length: count }, (_, i) => pageCount - count + 1 + i)];
  }
  return [
    1,
    ELLIPSIS,
    ...Array.from({ length: right - left + 1 }, (_, i) => left + i),
    ELLIPSIS,
    pageCount,
  ];
}

export function Pagination({
  page,
  pageCount,
  onPageChange,
  siblings = 1,
  totalItems,
  pageSize,
  className,
  label = 'Pagination',
}: PaginationProps): JSX.Element {
  const items = paginationRange(page, pageCount, siblings);
  const first = totalItems && pageSize ? (page - 1) * pageSize + 1 : null;
  const last = totalItems && pageSize ? Math.min(page * pageSize, totalItems) : null;

  return (
    <nav
      aria-label={label}
      className={cn('flex flex-wrap items-center justify-between gap-3', className)}
    >
      {first && last && totalItems ? (
        <p className="text-sm text-fg-muted">
          Showing{' '}
          <span className="font-medium tabular-nums text-fg">
            {first}–{last}
          </span>{' '}
          of <span className="font-medium tabular-nums text-fg">{totalItems}</span>
        </p>
      ) : (
        <span />
      )}

      <ul className="flex items-center gap-1">
        <li>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => {
              onPageChange(page - 1);
            }}
            startIcon={<ChevronLeft />}
          />
        </li>

        {/* The numbered window is the part that does not fit on a phone; the
            live "Page 3 of 46" below replaces it rather than being a second,
            redundant control at wide sizes. */}
        {items.map((item, index) =>
          item === ELLIPSIS ? (
            <li
              key={`ellipsis-${String(index)}`}
              aria-hidden
              className="hidden px-1 text-sm text-fg-subtle sm:block"
            >
              …
            </li>
          ) : (
            <li key={item} className="hidden sm:block">
              <Button
                size="sm"
                variant={item === page ? 'subtle' : 'ghost'}
                aria-label={`Page ${String(item)}`}
                aria-current={item === page ? 'page' : undefined}
                onClick={() => {
                  onPageChange(item);
                }}
                className="min-w-8 tabular-nums"
              >
                {item}
              </Button>
            </li>
          ),
        )}

        <li aria-live="polite" className="px-2 text-sm tabular-nums text-fg-muted sm:hidden">
          Page {page} of {pageCount}
        </li>

        <li>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Next page"
            disabled={page >= pageCount}
            onClick={() => {
              onPageChange(page + 1);
            }}
            startIcon={<ChevronRight />}
          />
        </li>
      </ul>
    </nav>
  );
}
