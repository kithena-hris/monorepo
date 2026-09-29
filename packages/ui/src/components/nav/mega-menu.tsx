'use client';

import type { ComponentPropsWithoutRef, JSX, KeyboardEvent, ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { CompactMenu } from './nav';

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
 *
 * `size="compact"` is the same menu for an area of seven places or fewer, the
 * content of a `flyoutSize="compact"` flyout: a title and its shortcut, one
 * column of rows (a plain `NavList` of described items, each count at the end
 * of its row), and the footer. ↑ and ↓ move through the rows.
 */
export interface MegaMenuProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  /** A `SearchField` to jump to a page. */
  readonly search?: ReactNode;
  /** Recent places, as `Chip`s, beside the search. */
  readonly recent?: ReactNode;
  /** A line under the columns: where the rest lives, a shortcut. */
  readonly footer?: ReactNode;
  /** The columns: a `NavList columns={2}` of `NavGroup`s; compact, one `NavList`. */
  readonly children: ReactNode;
  /** `lg` (default), columns for a large area; `compact`, one column of up to seven. */
  readonly size?: 'lg' | 'compact';
  /** The area's name, over a compact menu. */
  readonly title?: ReactNode;
  /** `Kbd`s beside the title: the shortcut that opens the area. */
  readonly shortcut?: ReactNode;
}

/** Each column's links, in order. A column is a group's list; with no groups, one column. */
function columnsOf(root: HTMLElement): HTMLAnchorElement[][] {
  const columns = [...root.querySelectorAll<HTMLUListElement>('ul[aria-labelledby]')]
    .map((list) => [...list.querySelectorAll<HTMLAnchorElement>('a[href]')])
    .filter((links) => links.length > 0);
  if (columns.length > 0) return columns;
  const links = [...root.querySelectorAll<HTMLAnchorElement>('nav a[href]')];
  return links.length > 0 ? [links] : [];
}

export function MegaMenu({
  search,
  recent,
  footer,
  children,
  size = 'lg',
  title,
  shortcut,
  className,
  onKeyDown,
  ...props
}: MegaMenuProps): JSX.Element {
  const compact = size === 'compact';
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
    <div
      className={cn('flex flex-col', compact ? 'gap-0' : 'gap-4.5', className)}
      onKeyDown={keys}
      {...props}
    >
      {title || shortcut ? (
        <div className="flex items-center justify-between gap-3 px-2.5 pt-2 pb-2.5">
          <span className="font-display text-[1rem]/none font-bold text-fg">{title}</span>
          {shortcut ? <span className="flex gap-0.75 text-fg-subtle">{shortcut}</span> : null}
        </div>
      ) : null}
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
      <CompactMenu value={compact}>{children}</CompactMenu>
      {footer ? (
        <div
          className={cn(
            'flex items-center rounded-md bg-surface-sunken text-fg-muted [&_svg]:shrink-0',
            compact
              ? 'mx-1 mt-1.5 mb-0.5 gap-2 rounded-[0.75rem] px-3 py-2.5 text-[0.8125rem]/[1.3] [&_svg]:size-3.5'
              : 'gap-2.5 px-3.5 py-3 text-sm [&_svg]:size-4',
          )}
        >
          {footer}
        </div>
      ) : null}
    </div>
  );
}
