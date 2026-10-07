import { Columns3 } from 'lucide-react-native';
import { useState } from 'react';
import { Text as CssText, View } from 'react-native-css/components';
import Sortable from 'react-native-sortables';

import { cn } from '../../lib/cn.ts';
import { floatingSurface } from '../../lib/floating.tsx';
import { dragMotion, move, ReorderHandle, useAnnouncer } from '../../lib/reorder.tsx';
import { Button } from '../button/button.tsx';
import { Checkbox } from '../checkbox/checkbox.tsx';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '../dialog/dialog.tsx';
import { Icon } from '../icon/icon.tsx';
import { Text } from '../text/text.tsx';
import { SearchField } from '../typed-fields/typed-fields.tsx';

export type ColumnChoice = { id: string; label: string; locked?: boolean };

export type ColumnChooserValue = {
  /** Every column's id, in display order. */
  order: readonly string[];
  /** The ids that show. Locked columns always do. */
  visible: readonly string[];
};

export type ColumnChooserProps = {
  /** Every column the table can show. Their order here is the default order. */
  columns: readonly ColumnChoice[];
  value: ColumnChooserValue;
  onChange: (value: ColumnChooserValue) => void;
  /** Offers "Reset" when present: the application knows what its default is. */
  onReset?: () => void;
  /** The trigger's word, and the panel's heading. */
  label?: string;
  /** The trigger's size. `sm` on a phone, as the design draws it beside a table. */
  size?: 'sm' | 'md';
  /**
   * Draw the panel in place, without a trigger or a modal of its own: for a
   * panel that already sits on the page.
   */
  inline?: boolean;
  /** Done, in an `inline` panel. In the modal, Done closes it. */
  onDone?: () => void;
  className?: string | undefined;
};

/** Past this many columns the list gets a search box. */
const SEARCH_FROM = 8;

/**
 * The columns in the order to show them: the saved order first, then any
 * column the saved order has never heard of (a field added since), and never
 * one that no longer exists. Locked columns keep their place at the front.
 */
export function orderColumns(
  columns: readonly ColumnChoice[],
  order: readonly string[],
): ColumnChoice[] {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const known = order.flatMap((id) => {
    const column = byId.get(id);
    return column ? [column] : [];
  });
  const seen = new Set(known.map((c) => c.id));
  const placed = [...known, ...columns.filter((c) => !seen.has(c.id))];
  return [...placed.filter((c) => c.locked === true), ...placed.filter((c) => c.locked !== true)];
}

/**
 * Which of a table's columns show, and in what order, as the web's
 * `ColumnChooser`: a tinted "Columns" button with the count, opening a
 * centred modal (a short task, so not a sheet), or with `inline` the panel
 * where it is drawn. A locked column (the name) always shows and stays first.
 * Long-press a grip to drag, or move a row from its handle with the keyboard
 * or a screen reader; ticking a box shows or hides the column. The caller
 * saves the choice per table.
 */
export function ColumnChooser({
  columns,
  value,
  onChange,
  onReset,
  label = 'Columns',
  size = 'sm',
  inline = false,
  onDone,
  className,
}: ColumnChooserProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const ordered = orderColumns(columns, value.order);
  const count = ordered.filter((c) => c.locked === true || value.visible.includes(c.id)).length;

  if (inline) {
    return (
      <Panel
        columns={ordered}
        value={value}
        onChange={onChange}
        onReset={onReset}
        label={label}
        count={count}
        query={query}
        onQuery={setQuery}
        done={
          <Button variant="primary" size="sm" {...(onDone ? { onPress: onDone } : {})}>
            Done
          </Button>
        }
        className={cn(floatingSurface, 'p-4', className)}
      />
    );
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) setQuery('');
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="tinted"
          size={size}
          startIcon={<Icon icon={Columns3} />}
          endIcon={<TriggerCount count={count} />}
          accessibilityLabel={`${label}, ${String(count)} of ${String(ordered.length)} showing`}
          className={className}
        >
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent label={label} className="gap-0 p-4">
        <Panel
          columns={ordered}
          value={value}
          onChange={onChange}
          onReset={onReset}
          label={label}
          count={count}
          query={query}
          onQuery={setQuery}
          done={
            <DialogClose asChild>
              <Button variant="primary" size="sm">
                Done
              </Button>
            </DialogClose>
          }
        />
      </DialogContent>
    </Dialog>
  );
}

/** The trigger's count: a small accent wash, as the web's. */
function TriggerCount({ count }: { count: number; size?: number; tone?: unknown }) {
  return (
    <View
      aria-hidden
      className="h-5 min-w-5 items-center justify-center overflow-hidden rounded-full px-1.5"
    >
      <View className="absolute inset-0 bg-accent-fg opacity-[0.12]" />
      <CssText className="text-[11px] leading-none font-bold text-accent-fg tabular-nums">
        {count}
      </CssText>
    </View>
  );
}

function Panel({
  columns: ordered,
  value,
  onChange,
  onReset,
  label,
  count,
  query,
  onQuery,
  done,
  className,
}: {
  columns: readonly ColumnChoice[];
  value: ColumnChooserValue;
  onChange: (value: ColumnChooserValue) => void;
  onReset: (() => void) | undefined;
  label: string;
  count: number;
  query: string;
  onQuery: (query: string) => void;
  done: React.ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  const { announce, region } = useAnnouncer();
  const ids = ordered.map((c) => c.id);
  const needle = query.trim().toLowerCase();
  const found = needle ? ordered.filter((c) => c.label.toLowerCase().includes(needle)) : ordered;

  const reorder = (from: number, to: number): void => {
    const target = ordered[to];
    const moving = ordered[from];
    if (!moving || !target || moving.locked || target.locked || from === to) return;
    onChange({ ...value, order: move(ids, from, to) });
    announce(`${moving.label}, moved to position ${String(to + 1)} of ${String(ids.length)}.`);
  };
  const toggle = (id: string, on: boolean): void => {
    const next = new Set(value.visible);
    if (on) next.add(id);
    else next.delete(id);
    onChange({ order: ids, visible: ids.filter((x) => next.has(x)) });
  };

  const row = (column: ColumnChoice, index: number): React.JSX.Element => (
    <View className="min-h-11 flex-row items-center gap-2.5">
      <ReorderHandle
        label={`Move ${column.label}`}
        locked={column.locked ?? false}
        size={15}
        onMove={(delta) => {
          reorder(index, index + delta);
        }}
      />
      <Checkbox
        checked={column.locked === true || value.visible.includes(column.id)}
        disabled={column.locked ?? false}
        onCheckedChange={(on) => {
          toggle(column.id, on);
        }}
        className="flex-1"
      >
        {column.label}
      </Checkbox>
    </View>
  );

  return (
    <View role="group" aria-label={label} className={cn('gap-1', className)}>
      <View className="flex-row items-center">
        <Text weight="semibold">{label}</Text>
        <CssText className="ml-auto text-[12px] leading-none font-medium text-fg-muted tabular-nums">
          {`${String(count)} of ${String(ordered.length)}`}
        </CssText>
      </View>
      {ordered.length >= SEARCH_FROM ? (
        <SearchField
          size="sm"
          value={query}
          onValueChange={onQuery}
          placeholder="Find a column"
          label="Find a column"
        />
      ) : null}
      {needle ? (
        // While searching, rows only show and hide; order is for the full list.
        <View className="gap-1">
          {found.map((column) => (
            <View key={column.id}>{row(column, ids.indexOf(column.id))}</View>
          ))}
          {found.length === 0 ? (
            <CssText className="py-2 text-subhead leading-[1.3] text-fg-muted">
              {`No column called “${query}”.`}
            </CssText>
          ) : null}
        </View>
      ) : (
        <Sortable.Grid
          data={ordered as ColumnChoice[]}
          columns={1}
          rowGap={4}
          keyExtractor={columnKey}
          customHandle
          {...dragMotion}
          onDragEnd={({ fromIndex, toIndex }) => {
            reorder(fromIndex, toIndex);
          }}
          renderItem={({ item, index }) => row(item, index)}
        />
      )}
      <View className="mt-1.5 flex-row justify-between">
        {onReset ? (
          <Button variant="ghost" size="sm" onPress={onReset}>
            Reset
          </Button>
        ) : (
          <View />
        )}
        {done}
      </View>
      {region}
    </View>
  );
}

const columnKey = (c: ColumnChoice): string => c.id;
