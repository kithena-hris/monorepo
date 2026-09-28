'use client';

import { Columns3, Lock } from 'lucide-react';
import { useId, useState, type JSX } from 'react';

import { cn } from '../../lib/cn';
import { Button } from '../button/button';
import { Checkbox } from '../checkbox/checkbox';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '../popover/popover';
import { SortableList } from '../sortable/sortable';
import { SearchField } from '../typed-fields/typed-fields';

/**
 * Which columns a table shows, and in what order.
 *
 * Controlled, and nothing more: the chooser holds no state and remembers
 * nothing. Where a choice is kept (a user's browser, their profile, nowhere)
 * is the application's decision, because the design system cannot know
 * whose choice it is or how long it should last.
 *
 * ### Showing and ordering are one list
 *
 * A checkbox list beside a separate "reorder" dialog makes somebody find the
 * same column twice. Here each row is both: tick it to show it, drag it by
 * its grip to place it. Its Move buttons, the keyboard's and the screen
 * reader's way, appear when focus is in the row. The boxes commit as they are
 * ticked, with no Save button: each change is small, visible behind the panel
 * and undone by ticking again.
 *
 * Past eight columns the list gets a search box. While a search is typed the
 * grips go away: reordering a filtered list has no clear meaning for the rows
 * it is hiding.
 *
 * ### A locked column stays
 *
 * The identity column (a name, an invoice number) is `locked`: always shown,
 * never moved. A table with no identity column is a grid of anonymous values.
 *
 * ### The trigger says the state
 *
 * A popover hides what it holds, so the trigger carries the count: "Columns
 * (6 of 11)". Somebody wondering why a column is missing is told before they
 * open anything.
 */

export interface ColumnChoice {
  id: string;
  label: string;
  /** Always shown, and never moved. Use it for the identity column. */
  locked?: boolean;
}

export interface ColumnChooserValue {
  /** Every column's id, in display order. */
  order: readonly string[];
  /** The ids shown. Locked columns are shown whatever this says. */
  visible: readonly string[];
}

export interface ColumnChooserProps {
  /** Every column the table can show. Their order here is the default order. */
  columns: readonly ColumnChoice[];
  value: ColumnChooserValue;
  onChange: (value: ColumnChooserValue) => void;
  /** Offers "Reset" when present: the application knows what its default is. */
  onReset?: () => void;
  /** The trigger's word. */
  label?: string;
  size?: 'sm' | 'md';
}

/** Past this many columns the list gets a search box. */
const SEARCH_FROM = 8;

/**
 * The columns in the order to show them: the saved order first, then any
 * column the saved order has never heard of (a field added since), and never
 * one that no longer exists.
 */
export function orderColumns(
  columns: readonly ColumnChoice[],
  order: readonly string[],
): ColumnChoice[] {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const known = order.flatMap((id) => {
    const column = byId.get(id);
    return column === undefined ? [] : [column];
  });
  const seen = new Set(known.map((c) => c.id));
  const placed = [...known, ...columns.filter((c) => !seen.has(c.id))];
  // Locked columns keep their declared place at the front.
  return [...placed.filter((c) => c.locked === true), ...placed.filter((c) => c.locked !== true)];
}

export function ColumnChooser({
  columns,
  value,
  onChange,
  onReset,
  label = 'Columns',
  size = 'md',
}: ColumnChooserProps): JSX.Element {
  const headingId = useId();
  const [query, setQuery] = useState('');
  const ordered = orderColumns(columns, value.order);
  const shown = new Set(value.visible);
  const isShown = (c: ColumnChoice): boolean => c.locked === true || shown.has(c.id);
  const count = ordered.filter(isShown).length;

  const toggle = (id: string, on: boolean): void => {
    const next = new Set(shown);
    if (on) next.add(id);
    else next.delete(id);
    onChange({
      order: ordered.map((c) => c.id),
      visible: ordered.filter((c) => next.has(c.id)).map((c) => c.id),
    });
  };

  const needle = query.trim().toLowerCase();
  const matching = needle
    ? ordered.filter((column) => column.label.toLowerCase().includes(needle))
    : ordered;

  const row = (column: ColumnChoice): JSX.Element => (
    // The row is the label, so the whole strip toggles the box.
    <label
      className={cn(
        'flex min-h-8 min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-sm text-fg touch:min-h-11 touch:text-base',
        column.locked === true && 'cursor-default',
      )}
    >
      <Checkbox
        checked={isShown(column)}
        disabled={column.locked === true}
        onCheckedChange={(checked) => {
          toggle(column.id, checked === true);
        }}
      />
      <span className="min-w-0 flex-1 truncate">{column.label}</span>
      {column.locked === true ? (
        <Lock aria-hidden className="size-4 shrink-0 text-fg-subtle" />
      ) : null}
    </label>
  );

  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <Button size={size} variant="subtle" startIcon={<Columns3 />}>
          {label}
          <span className="sr-only">
            {' '}
            ({count} of {ordered.length})
          </span>
          <span
            aria-hidden
            className="grid h-5 min-w-5 place-items-center rounded-full bg-accent-fg/12 px-1.5 text-2xs font-bold tabular-nums"
          >
            {count}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex w-80 flex-col gap-1 p-3"
        aria-labelledby={headingId}
      >
        <div className="flex items-center gap-2 pb-1">
          <p id={headingId} className="text-base font-semibold text-fg">
            Show and order columns
          </p>
          <p className="ms-auto text-xs font-medium text-fg-muted tabular-nums">
            {count} of {ordered.length}
          </p>
        </div>

        {ordered.length >= SEARCH_FROM ? (
          <SearchField
            label="Find a column"
            placeholder="Find a column"
            value={query}
            onValueChange={setQuery}
            className="mb-1"
          />
        ) : null}

        <div className="max-h-[min(24rem,60vh)] overflow-y-auto overscroll-contain">
          {needle ? (
            <ul aria-label="Columns" className="flex flex-col gap-0.5">
              {matching.map((column) => (
                <li key={column.id} className="flex items-center gap-3 px-1">
                  {row(column)}
                </li>
              ))}
              {matching.length === 0 ? (
                <li className="px-1 py-2 text-sm text-fg-muted">No column called “{query}”.</li>
              ) : null}
            </ul>
          ) : (
            <SortableList
              appearance="plain"
              label="Columns"
              items={ordered}
              itemLabel={(c) => c.label}
              moveButtons="on-focus"
              onReorder={(move) => {
                onChange({ order: move.order, visible: value.visible });
              }}
            >
              {row}
            </SortableList>
          )}
        </div>

        <div className="mt-1 flex items-center justify-between gap-2">
          {onReset === undefined ? (
            <span />
          ) : (
            <Button size="sm" variant="ghost" onClick={onReset}>
              Reset
            </Button>
          )}
          <PopoverClose asChild>
            <Button size="sm" variant="primary">
              Done
            </Button>
          </PopoverClose>
        </div>
      </PopoverContent>
    </Popover>
  );
}
