import { useState } from 'react';
import { Text as CssText, View } from 'react-native-css/components';
import Sortable from 'react-native-sortables';

import { cn } from '../../lib/cn.ts';
import { floatingSurface } from '../../lib/floating.tsx';
import { dragMotion, move, ReorderHandle, useAnnouncer } from '../../lib/reorder.tsx';
import { Button } from '../button/button.tsx';
import { Checkbox } from '../checkbox/checkbox.tsx';
import { Text } from '../text/text.tsx';
import { SearchField } from '../typed-fields/typed-fields.tsx';

/**
 * Which of a table's columns show, and in what order, as the web's
 * `ColumnChooser`. A locked column (the name) always shows and stays first.
 * Long-press a grip to drag, or move a row from its handle with the keyboard
 * or a screen reader; ticking a box shows or hides the column. The caller
 * saves the choice per table.
 */

export type ColumnChoice = { id: string; label: string; locked?: boolean };

export type ColumnChooserValue = {
  /** Every column's id, in display order. */
  order: readonly string[];
  /** The ids that show. Locked columns always do. */
  visible: readonly string[];
};

export type ColumnChooserProps = {
  columns: readonly ColumnChoice[];
  value: ColumnChooserValue;
  onChange: (value: ColumnChooserValue) => void;
  /** Back to the table's own default. */
  onReset?: () => void;
  /** Closes whatever holds it. */
  onDone?: () => void;
  label?: string;
  /** Draws its own raised surface, for a chooser that sits on the page rather than in a popover. */
  inline?: boolean;
  className?: string | undefined;
};

/** The columns in the chooser's order, any not named in it at the end. */
export function orderColumns(
  columns: readonly ColumnChoice[],
  order: readonly string[],
): ColumnChoice[] {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const known = order.flatMap((id) => {
    const column = byId.get(id);
    return column ? [column] : [];
  });
  return [...known, ...columns.filter((c) => !order.includes(c.id))];
}

export function ColumnChooser({
  columns,
  value,
  onChange,
  onReset,
  onDone,
  label = 'Columns',
  inline = false,
  className,
}: ColumnChooserProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const { announce, region } = useAnnouncer();
  const ordered = orderColumns(columns, value.order);
  const ids = ordered.map((c) => c.id);
  const shown = ordered.filter((c) => c.locked || value.visible.includes(c.id)).length;
  const found = query
    ? ordered.filter((c) => c.label.toLowerCase().includes(query.trim().toLowerCase()))
    : ordered;

  const reorder = (from: number, to: number): void => {
    const target = ordered[to];
    const moving = ordered[from];
    if (!moving || !target || moving.locked || target.locked || from === to) return;
    onChange({ ...value, order: move(ids, from, to) });
    announce(`${moving.label}, moved to position ${String(to + 1)} of ${String(ids.length)}.`);
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
          onChange({
            ...value,
            visible: on
              ? [...value.visible, column.id]
              : value.visible.filter((id) => id !== column.id),
          });
        }}
        className="flex-1"
      >
        {column.label}
      </Checkbox>
    </View>
  );

  return (
    <View
      role="group"
      aria-label={label}
      className={cn('gap-1', inline && cn(floatingSurface, 'p-4'), className)}
    >
      <View className="flex-row items-center">
        <Text weight="semibold">{label}</Text>
        <CssText className="ml-auto text-[12px] leading-none font-medium text-fg-muted">
          {`${String(shown)} of ${String(columns.length)}`}
        </CssText>
      </View>
      <SearchField
        size="sm"
        value={query}
        onValueChange={setQuery}
        placeholder="Find a column"
        label="Find a column"
      />
      {query ? (
        // While searching, rows only show and hide; order is for the full list.
        <View className="gap-1">
          {found.map((column) => (
            <View key={column.id}>{row(column, ids.indexOf(column.id))}</View>
          ))}
        </View>
      ) : (
        <Sortable.Grid
          data={ordered}
          columns={1}
          rowGap={4}
          keyExtractor={(c) => c.id}
          customHandle
          {...dragMotion}
          onDragEnd={({ fromIndex, toIndex }) => {
            reorder(fromIndex, toIndex);
          }}
          renderItem={({ item, index }) => row(item, index)}
        />
      )}
      <View className="mt-1.5 flex-row justify-between">
        <Button variant="ghost" size="sm" {...(onReset ? { onPress: onReset } : {})}>
          Reset
        </Button>
        <Button variant="primary" size="sm" {...(onDone ? { onPress: onDone } : {})}>
          Done
        </Button>
      </View>
      {region}
    </View>
  );
}
