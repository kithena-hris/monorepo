'use client';

import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import type { ComponentPropsWithRef, ComponentPropsWithoutRef, JSX, ReactNode, Ref } from 'react';

import { cn } from '../../lib/cn';

/**
 * Tabular data.
 *
 * A real `<table>`, not a grid of divs: row and column association is what
 * lets a screen reader say "Basic salary, Amount, 4,200.00" instead of
 * reading forty numbers in sequence.
 *
 * Money and dates belong in a `<TableCell numeric>`, which switches on tabular
 * figures and right-aligns, so a column of amounts can be compared by eye.
 *
 * **On small screens, a table stays a table.** The scroll container is the
 * honest answer: it keeps the header association, the column order and the
 * ability to compare two rows, all of which a "card per row" transform throws
 * away. Where a card list genuinely is better, a directory read one person at
 * a time: render a list instead of a table, rather than pretending a table is
 * one. See the responsive Patterns story for both, side by side.
 */

export interface TableProps extends ComponentPropsWithoutRef<'table'> {
  /**
   * Pins the header while the body scrolls. Requires a bounded height on the
   * container: pass it through `containerClassName`.
   */
  stickyHeader?: boolean;
  /** Class for the scroll container, not the table. Height goes here. */
  containerClassName?: string;
  /** Removes the border and radius, for a table already inside a card. */
  bare?: boolean;
  /**
   * The scroll container, not the table.
   *
   * A virtualizer measures the element that actually scrolls, and here that is
   * the wrapper rather than the `<table>`. Exposing it keeps the wrapper an
   * implementation detail everywhere else.
   */
  containerRef?: Ref<HTMLDivElement>;
}

export function Table({
  className,
  containerClassName,
  containerRef,
  stickyHeader = false,
  bare = false,
  ...props
}: TableProps): JSX.Element {
  return (
    <div
      ref={containerRef}
      // `tabIndex` and a role: a scroll container that only a mouse can scroll
      // is unreachable from the keyboard, and axe is right to flag it. With
      // these, the region is focusable and the arrow keys scroll it.
      tabIndex={0}
      role="region"
      aria-label={props['aria-label'] ?? 'Table'}
      data-scroll-lock
      className={cn(
        'w-full overflow-auto overscroll-x-contain',
        !bare && 'rounded-lg border border-border',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
        containerClassName,
      )}
    >
      <table
        data-sticky-header={stickyHeader || undefined}
        className={cn('w-full caption-bottom border-collapse text-base', className)}
        {...props}
      />
    </div>
  );
}

export function TableHeader({
  className,
  ...props
}: ComponentPropsWithoutRef<'thead'>): JSX.Element {
  return (
    <thead
      className={cn(
        'bg-surface-sunken',
        // Sticky lives on the cells, not the row: `position: sticky` does
        // nothing on a `<thead>` or `<tr>` in a `border-collapse` table.
        '[[data-sticky-header]_&_th]:sticky [[data-sticky-header]_&_th]:top-0 [[data-sticky-header]_&_th]:z-10',
        '[[data-sticky-header]_&_th]:bg-surface-sunken',
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: ComponentPropsWithoutRef<'tbody'>): JSX.Element {
  return <tbody className={cn('divide-y divide-border bg-surface', className)} {...props} />;
}

export function TableFooter({
  className,
  ...props
}: ComponentPropsWithoutRef<'tfoot'>): JSX.Element {
  return (
    <tfoot
      className={cn('border-t border-border bg-surface-sunken font-medium', className)}
      {...props}
    />
  );
}

/**
 * `WithRef`, not `WithoutRef`: a row has to be reachable by a drag library,
 * which needs the node to measure and move it. React 19 passes `ref` as an
 * ordinary prop, so no `forwardRef` wrapper is needed to allow it.
 */
export interface TableRowProps extends ComponentPropsWithRef<'tr'> {
  /** Marks the row as the current selection for both styling and assistive tech. */
  selected?: boolean;
  /** Adds hover affordance. Set it only when the whole row is actually clickable. */
  interactive?: boolean;
}

export function TableRow({
  className,
  selected = false,
  interactive = false,
  ...props
}: TableRowProps): JSX.Element {
  return (
    <tr
      aria-selected={selected || undefined}
      data-state={selected ? 'selected' : undefined}
      className={cn(
        // An explicit background, not an inherited one: a sticky cell uses
        // `background: inherit`, and `inherit` from a transparent row is
        // transparent, which is how a pinned first column ends up with the
        // rest of the table scrolling visibly underneath it.
        //
        // The transition is `normal` rather than `instant`: a select-all
        // changes forty rows at once, and at 80ms that is a single frame in
        // which the table became a different colour. Long enough to read as a
        // wash, short enough that one click still feels immediate.
        'bg-surface transition-colors duration-(--animate-duration-normal)',
        interactive && 'cursor-pointer hover:bg-surface-hover',
        selected && 'bg-accent-subtle',
        className,
      )}
      {...props}
    />
  );
}

export type SortDirection = 'ascending' | 'descending' | null;

export interface TableHeadProps extends Omit<ComponentPropsWithoutRef<'th'>, 'onClick'> {
  numeric?: boolean;
  /** Makes the header a sort control. */
  sortable?: boolean;
  /** Current direction for this column. `null` means unsorted. */
  sortDirection?: SortDirection;
  /** Called with the direction the column should move to. */
  onSort?: (direction: Exclude<SortDirection, null>) => void;
  /** Keeps the column visible while the rest of the table scrolls sideways. */
  sticky?: boolean;
  children?: ReactNode;
}

export function TableHead({
  className,
  numeric = false,
  sortable = false,
  sortDirection = null,
  onSort,
  sticky = false,
  children,
  ...props
}: TableHeadProps): JSX.Element {
  const SortIcon =
    sortDirection === 'ascending'
      ? ArrowUp
      : sortDirection === 'descending'
        ? ArrowDown
        : ChevronsUpDown;

  return (
    <th
      scope="col"
      // `aria-sort` belongs on the cell, not on the button inside it. It is
      // also the only thing that tells a screen reader the table is currently
      // sorted by this column, an arrow glyph does not.
      aria-sort={sortable ? (sortDirection ?? 'none') : undefined}
      className={cn(
        'h-9 px-3 text-left align-middle text-2xs font-semibold tracking-wide text-fg-subtle uppercase',
        numeric && 'text-right',
        sticky && 'sticky left-0 z-20 bg-surface-sunken',
        className,
      )}
      {...props}
    >
      {sortable ? (
        <button
          type="button"
          onClick={() => {
            onSort?.(sortDirection === 'ascending' ? 'descending' : 'ascending');
          }}
          className={cn(
            'group -mx-1 inline-flex min-h-tap items-center gap-1 rounded-xs px-1 uppercase',
            'transition-colors hover:text-fg',
            'focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-border-focus',
            numeric && 'flex-row-reverse',
          )}
        >
          {children}
          <SortIcon
            aria-hidden
            className={cn(
              'size-3 transition-opacity',
              sortDirection ? 'opacity-100' : 'opacity-0 group-hover:opacity-60',
            )}
          />
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export interface TableCellProps extends ComponentPropsWithoutRef<'td'> {
  /** Right-aligns and locks tabular figures. Use for money, counts and dates. */
  numeric?: boolean;
  /** Pins the cell during horizontal scroll. Pair with a sticky `TableHead`. */
  sticky?: boolean;
}

export function TableCell({
  className,
  numeric = false,
  sticky = false,
  ...props
}: TableCellProps): JSX.Element {
  return (
    <td
      data-numeric={numeric || undefined}
      className={cn(
        'px-3 py-2.5 align-middle text-fg',
        numeric && 'text-right',
        // The identity column stays put while the other twelve scroll past.
        // Without it, a wide table on a phone is a grid of numbers with no
        // idea whose they are.
        sticky && 'sticky left-0 z-10 bg-[inherit]',
        className,
      )}
      {...props}
    />
  );
}

export function TableCaption({
  className,
  ...props
}: ComponentPropsWithoutRef<'caption'>): JSX.Element {
  return <caption className={cn('mt-3 text-xs text-fg-muted', className)} {...props} />;
}
