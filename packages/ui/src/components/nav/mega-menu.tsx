'use client';

import type { ComponentPropsWithoutRef, JSX, KeyboardEvent, ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * An area's whole menu, hung off its sidebar item.
 *
 * The content of a `NavItem` `flyout` with `flyoutSize="lg"`: a field to jump
 * to a page, the recent places as chips, the area's destinations in labelled
 * columns (a `NavList columns` of `NavGroup`s whose items carry a
 * `description`, and a count only where something needs action), and a quiet
 * footer for what lives elsewhere.
 *
 * The flyout opens on hover, on focus and →, and on a tap; this adds the arrow
 * keys a menu of columns needs. ↑ and ↓ move within a column, ← and → move
 * across columns to the same row, and ← from the first column hands back to
 * the flyout, which closes and returns to the sidebar item. Every destination
 * stays a link, so ↵, middle-click and "open in a new tab" all behave.
 */
export interface MegaMenuProps extends ComponentPropsWithoutRef<'div'> {
  /** A `SearchField` to jump to a page. */
  readonly search?: ReactNode;
  /** Recent places, as `Chip`s, beside the search. */
  readonly recent?: ReactNode;
  /** A line under the columns: where the rest lives, a shortcut. */
  readonly footer?: ReactNode;
  /** The columns: a `NavList columns={2}` of `NavGroup`s. */
  readonly children: ReactNode;
}

/** Each column's links, in order. A column is a group's list. */
function columnsOf(root: HTMLElement): HTMLAnchorElement[][] {
  return [...root.querySelectorAll<HTMLUListElement>('ul[aria-labelledby]')]
    .map((list) => [...list.querySelectorAll<HTMLAnchorElement>('a[href]')])
    .filter((links) => links.length > 0);
}

export function MegaMenu({
  search,
  recent,
  footer,
  children,
  className,
  onKeyDown,
  ...props
}: MegaMenuProps): JSX.Element {
  const keys = (event: KeyboardEvent<HTMLDivElement>): void => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const columns = columnsOf(event.currentTarget);
    const col = columns.findIndex((links) => links.includes(event.target as HTMLAnchorElement));
    if (col < 0) {
      // From the search field, ↓ goes into the first column.
      if (event.key === 'ArrowDown' && columns[0]?.[0] !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        columns[0][0].focus();
      }
      return;
    }
    const links = columns[col] ?? [];
    const row = links.indexOf(event.target as HTMLAnchorElement);
    let next: HTMLAnchorElement | undefined;
    if (event.key === 'ArrowDown') next = links[(row + 1) % links.length];
    if (event.key === 'ArrowUp') next = links[(row - 1 + links.length) % links.length];
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const to = columns[col + (event.key === 'ArrowRight' ? 1 : -1)];
      // ← from the first column is the flyout's: it closes and returns to the item.
      if (to === undefined) return;
      next = to[Math.min(row, to.length - 1)];
    }
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    next.focus();
  };

  return (
    // The keys are handled for the links inside, which are the interactive
    // elements; the container only listens.
    <div className={cn('flex flex-col gap-4.5', className)} onKeyDown={keys} {...props}>
      {search || recent ? (
        <div className="flex flex-wrap items-center gap-2.5">
          {search ? <div className="min-w-48 flex-1">{search}</div> : null}
          {recent ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-fg-subtle">Recent</span>
              {recent}
            </div>
          ) : null}
        </div>
      ) : null}
      {children}
      {footer ? (
        <div className="flex items-center gap-2.5 rounded-md bg-surface-sunken px-3.5 py-3 text-sm text-fg-muted [&_svg]:size-4 [&_svg]:shrink-0">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
