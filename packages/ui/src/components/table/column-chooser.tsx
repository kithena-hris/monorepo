'use client';

import { Columns3 } from 'lucide-react';
import { useId, type JSX } from 'react';

import { Button } from '../button/button';
import { Checkbox } from '../checkbox/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '../popover/popover';
import { SortableList } from '../sortable/sortable';

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
 * same column twice. Here each row is both: tick it to show it, drag it (or
 * use its Move buttons, which are the keyboard's and the screen reader's
 * way) to place it.
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

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size={size} startIcon={<Columns3 />}>
          {label} ({count} of {ordered.length})
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80" aria-labelledby={headingId}>
        <div className="flex items-center justify-between gap-2 pb-2">
          <p id={headingId} className="text-base font-medium text-fg">
            Show and order columns
          </p>
          {onReset === undefined ? null : (
            <Button size="sm" variant="ghost" onClick={onReset}>
              Reset
            </Button>
          )}
        </div>
        <div className="max-h-[min(24rem,60vh)] overflow-y-auto overscroll-contain">
          <SortableList
            label="Columns"
            items={ordered}
            itemLabel={(c) => c.label}
            onReorder={(move) => {
              onChange({ order: move.order, visible: value.visible });
            }}
          >
            {(column) => {
              const id = `${headingId}-${column.id}`;
              return (
                <span className="flex min-w-0 items-center gap-2.5">
                  <Checkbox
                    id={id}
                    checked={isShown(column)}
                    disabled={column.locked === true}
                    onCheckedChange={(checked) => {
                      toggle(column.id, checked === true);
                    }}
                  />
                  <label htmlFor={id} className="min-w-0 cursor-pointer truncate text-base text-fg">
                    {column.label}
                  </label>
                </span>
              );
            }}
          </SortableList>
        </div>
      </PopoverContent>
    </Popover>
  );
}
