'use client';

import { Columns3, Lock } from 'lucide-react';
import { useId, useState, type JSX, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Button } from '../button/button';
import { Checkbox } from '../checkbox/checkbox';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '../popover/popover';
import { SortableList } from '../sortable/sortable';
import { SearchField } from '../typed-fields/typed-fields';

/**
 * Which columns a table shows, and in what order.
 *
 * A popover of checkboxes that commit as they are ticked, with no Save button:
 * each change is small, visible behind the panel and undone by ticking again.
 * The trigger states the count, because a popover hides its state and
 * something outside it has to say what the state is.
 *
 * With `onReorder`, every row gets a grip. Dragging and the keyboard (Space on
 * the grip, then the arrows) both work, through `SortableList`. While a search
 * is typed the grips go away: reordering a filtered list has no clear meaning
 * for the rows it is hiding.
 *
 * A `locked` column, the row's identity, stays ticked, disabled and in place. A
 * table with no identity column is a grid of anonymous numbers.
 */

export interface ColumnChoice {
  id: string;
  label: string;
  /** Always visible and never moved. Use it for the column saying whose row it is. */
  locked?: boolean;
}

export interface ColumnChooserProps {
  /** Every column the table can show, in its current order. */
  columns: readonly ColumnChoice[];
  /** Ids of the visible columns. */
  visible: readonly string[];
  onVisibleChange: (visible: readonly string[]) => void;
  /** The ids in their new order. Omitted, the columns cannot be reordered. */
  onReorder?: (order: readonly string[]) => void;
  /** Puts back the table's default set. Omitted, no reset is offered. */
  onReset?: () => void;
  /** Trigger text. The count is appended. */
  label?: ReactNode;
}

/** Past this many columns the list gets a search box. */
const SEARCH_FROM = 8;

export function ColumnChooser({
  columns,
  visible,
  onVisibleChange,
  onReorder,
  onReset,
  label = 'Columns',
}: ColumnChooserProps): JSX.Element {
  const headingId = useId();
  const [query, setQuery] = useState('');

  // Locked columns count as shown whether or not the caller listed them, and
  // every change hands back ids in the table's own column order.
  const shown = new Set([
    ...visible,
    ...columns.filter((column) => column.locked === true).map((column) => column.id),
  ]);
  const toggle = (id: string, on: boolean): void => {
    onVisibleChange(
      columns.filter((column) => (column.id === id ? on : shown.has(column.id))).map((c) => c.id),
    );
  };

  const needle = query.trim().toLowerCase();
  const matching = needle
    ? columns.filter((column) => column.label.toLowerCase().includes(needle))
    : columns;

  const row = (column: ColumnChoice): JSX.Element => (
    // The row is the label, so the whole strip toggles the box.
    <label
      className={cn(
        'flex min-h-8 flex-1 cursor-pointer items-center gap-2.5 text-sm text-fg touch:min-h-11 touch:text-base',
        column.locked && 'cursor-default',
      )}
    >
      <Checkbox
        checked={shown.has(column.id)}
        disabled={column.locked === true}
        onCheckedChange={(checked) => {
          toggle(column.id, checked === true);
        }}
      />
      <span className="min-w-0 flex-1 truncate">{column.label}</span>
    </label>
  );

  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="subtle" startIcon={<Columns3 />}>
          {label}
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent-fg/12 px-1.5 text-2xs font-bold tabular-nums">
            {shown.size}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-72 flex-col gap-1 p-3 touch:w-80">
        <div className="flex items-center gap-2 pb-1">
          <p id={headingId} className="text-base font-semibold text-fg">
            Columns
          </p>
          <p className="ms-auto text-xs font-medium text-fg-muted tabular-nums">
            {shown.size} of {columns.length}
          </p>
        </div>

        {columns.length >= SEARCH_FROM ? (
          <SearchField
            label="Find a column"
            placeholder="Find a column"
            value={query}
            onValueChange={setQuery}
            className="mb-1"
          />
        ) : null}

        <div role="group" aria-labelledby={headingId} className="max-h-80 overflow-y-auto">
          {onReorder && !needle ? (
            <SortableList
              appearance="plain"
              label="Column order"
              items={columns}
              itemLabel={(column) => column.label}
              hideMoveButtons
              onReorder={(move) => {
                onReorder(move.order);
              }}
            >
              {row}
            </SortableList>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {matching.map((column) => (
                <li key={column.id} className="flex items-center gap-3 px-1">
                  {column.locked ? (
                    <Lock aria-hidden className="size-4 shrink-0 text-fg-subtle" />
                  ) : null}
                  {row(column)}
                </li>
              ))}
              {matching.length === 0 ? (
                <li className="px-1 py-2 text-sm text-fg-muted">No column called “{query}”.</li>
              ) : null}
            </ul>
          )}
        </div>

        <div className="mt-1 flex items-center justify-between gap-2">
          {onReset ? (
            <Button size="sm" variant="ghost" onClick={onReset}>
              Reset
            </Button>
          ) : (
            <span />
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
