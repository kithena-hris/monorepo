'use client';

import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import type {
  ComponentPropsWithRef,
  ComponentPropsWithoutRef,
  JSX,
  MouseEvent,
  ReactNode,
  Ref,
} from 'react';

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
 * **These primitives stay a table under a finger.** They are what a hand-built
 * grid, a bulk editor or a comparison is made of, and there the scroll
 * container is the honest answer: it keeps the column order and the ability to
 * compare two rows. `DataTable`, which knows which column is the row's
 * identity, is the one that turns into a list of cards on a phone.
 */

export interface TableProps extends ComponentPropsWithoutRef<'table'> {
  /**
   * Pins the header while the body scrolls. Requires a bounded height on the
   * container: pass it through `containerClassName`.
   */
  stickyHeader?: boolean;
  /** Class for the scroll container, not the table. Height goes here. */
  containerClassName?: string;
  /** Removes the surface, radius and shadow, for a table already inside a card. */
  bare?: boolean;
  /** Shorter rows and smaller type, for a table read as a ledger rather than a list. */
  dense?: boolean;
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
  dense = false,
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
      // Contained sideways only, and not `data-scroll-lock`, which contains
      // both axes. This box is `overflow: auto` in both, so it is a scroll
      // container even at its content's full height, and Chromium honours a
      // `contain` there: a wheel or a swipe over the table stopped dead
      // instead of scrolling the page, and a table taller than the screen
      // could not be scrolled past from on top of it. A table given a
      // bounded height scrolls itself and hands the page the rest.
      className={cn(
        // `isolate`: the pinned header's stacking stays inside the table,
        // under the page's own bars and anything laid over the table.
        'isolate w-full overflow-auto overscroll-x-contain',
        // A raised surface, not a ruled box: the rows are separated by hairlines
        // and the table itself by its shadow, the same as every other card.
        !bare && 'rounded-lg bg-surface shadow-sm',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
        containerClassName,
      )}
    >
      <table
        data-sticky-header={stickyHeader || undefined}
        data-dense={dense || undefined}
        className={cn(
          'w-full caption-bottom border-collapse text-base data-dense:text-sm',
          className,
        )}
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
        // No fill: the header is told apart by its type and the hairline under
        // it, so the table reads as one surface rather than a banded form.
        '[&>tr]:border-b [&>tr]:border-border',
        // Sticky lives on the cells, not the row: `position: sticky` does
        // nothing on a `<thead>` or `<tr>` in a `border-collapse` table.
        // Pinned, every cell is opaque and above the body's pinned column
        // (`z-10`): glass let the rows show through as they passed under it,
        // and a pinned body cell at the header's own `z-10` came later in the
        // document and painted over it.
        '[[data-sticky-header]_&_th]:sticky [[data-sticky-header]_&_th]:top-0 [[data-sticky-header]_&_th]:z-20',
        '[[data-sticky-header]_&_th]:bg-surface',
        '[[data-sticky-header]_&_th]:shadow-[inset_0_-1px_0_var(--reach-color-border)]',
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: ComponentPropsWithoutRef<'tbody'>): JSX.Element {
  return <tbody className={cn('divide-y divide-border', className)} {...props} />;
}

export function TableFooter({
  className,
  ...props
}: ComponentPropsWithoutRef<'tfoot'>): JSX.Element {
  return <tfoot className={cn('border-t border-border font-semibold', className)} {...props} />;
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
        interactive && 'cursor-pointer hover:bg-surface-sunken',
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
  /**
   * Called with the direction the column should move to, and the click, so a
   * multi-column sort can read `shiftKey`.
   */
  onSort?: (direction: Exclude<SortDirection, null>, event: MouseEvent<HTMLButtonElement>) => void;
  /**
   * This column's place in a multi-column sort, from 1. Drawn as a small
   * number beside the arrow. Only the first carries `aria-sort`, as ARIA
   * asks: one sorted header at a time.
   */
  sortPriority?: number;
  /** Keeps the column visible while the rest of the table scrolls sideways. */
  sticky?: boolean;
  /** A control on the header's edge, beside the sort button rather than in it: a column resizer. */
  resizer?: ReactNode;
  children?: ReactNode;
}

export function TableHead({
  className,
  numeric = false,
  sortable = false,
  sortDirection = null,
  onSort,
  sortPriority,
  sticky = false,
  resizer,
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
      aria-sort={
        sortable
          ? sortPriority && sortPriority > 1
            ? 'none'
            : (sortDirection ?? 'none')
          : undefined
      }
      className={cn(
        'h-10.5 px-3 text-left align-middle text-xs font-semibold whitespace-nowrap text-fg-muted',
        'first:ps-5 last:pe-5 [[data-dense]_&]:h-8.5 [[data-dense]_&]:first:ps-4 [[data-dense]_&]:last:pe-4',
        // Sorted is the one header drawn in full ink: the arrow says which
        // way, the colour says which column, before the arrow is even found.
        sortDirection && 'text-fg',
        numeric && 'text-right',
        // Opaque, and over the rest of a pinned header (`TableHeader`, whose
        // rule is more specific, hence `!`): the corner, which both the header
        // cells scrolling sideways and the pinned column scrolling up pass under.
        sticky && 'sticky left-0 z-30! bg-surface',
        resizer !== undefined && !sticky && 'relative',
        resizer !== undefined && 'overflow-visible',
        className,
      )}
      {...props}
    >
      {sortable ? (
        <button
          type="button"
          onClick={(event) => {
            onSort?.(sortDirection === 'ascending' ? 'descending' : 'ascending', event);
          }}
          className={cn(
            'group -mx-1 inline-flex min-h-tap items-center gap-1 rounded-xs px-1',
            'transition-colors hover:text-fg',
            'focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-border-focus',
            numeric && 'flex-row-reverse',
          )}
        >
          {children}
          <SortIcon
            aria-hidden
            className={cn(
              'size-3.5 transition-opacity',
              sortDirection ? 'opacity-100' : 'text-fg-subtle opacity-60 group-hover:opacity-100',
            )}
          />
          {sortPriority === undefined ? null : (
            <>
              <span aria-hidden className="text-[0.625rem] leading-none font-bold text-fg-subtle">
                {sortPriority}
              </span>
              <span className="sr-only">
                , sort {sortPriority}, {sortDirection}
              </span>
            </>
          )}
        </button>
      ) : (
        children
      )}
      {resizer}
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
        'h-14 px-3 py-2 align-middle text-fg',
        'first:ps-5 last:pe-5 [[data-dense]_&]:h-10 [[data-dense]_&]:py-1.5 [[data-dense]_&]:first:ps-4 [[data-dense]_&]:last:pe-4',
        numeric && 'text-right whitespace-nowrap tabular-nums',
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
