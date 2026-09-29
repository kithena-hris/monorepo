import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * Labelled values: a record's details, a summary before a submit, what is
 * configured read back before anybody opens it to change it.
 *
 * A `<dl>`, because that is what it is. A screen reader announces each term
 * with its definition, which a grid of spans cannot make it do.
 *
 * Three layouts.
 *
 * - `stacked` (default) puts each label above its value, so a long value wraps
 *   under its own label and a narrow card or a phone needs no second layout.
 *   `columns` spreads the pairs across the width the container has, never
 *   the window's.
 * - `aligned` puts every label in one fixed-width column so the values line up
 *   and can be scanned without the labels. Under a finger it becomes `split`,
 *   where a 160px label column would leave the values a sliver.
 * - `split` pushes each value to the far edge of its row, which is how a phone
 *   lists settings.
 */

export interface KeyValueItem {
  /** Stable key. Defaults to the label when the label is a string. */
  readonly id?: string;
  readonly label: ReactNode;
  /** Text, a `Money`, a `Badge`, an `Avatar` and a name. Anything inline. */
  readonly value: ReactNode;
}

export interface KeyValuesProps extends Omit<ComponentPropsWithoutRef<'dl'>, 'children'> {
  readonly items: readonly KeyValueItem[];
  /** Pairs per row where there is room, in the `stacked` layout: 1 (default), 2 or 3. */
  readonly columns?: 1 | 2 | 3;
  /** `stacked` puts the label above the value; `aligned` lines the values up; `split` pushes each to the row's end. */
  readonly layout?: 'stacked' | 'aligned' | 'split';
  /** Width of the label column in the `aligned` layout, e.g. `'12rem'`. */
  readonly labelWidth?: string;
}

const COLUMNS = {
  1: '',
  2: '@sm:grid-cols-2',
  3: '@sm:grid-cols-2 @lg:grid-cols-3',
} as const;

function keyOf(item: KeyValueItem, index: number): string | number {
  return item.id ?? (typeof item.label === 'string' ? item.label : index);
}

export function KeyValues({
  items,
  columns = 1,
  layout = 'stacked',
  labelWidth = '10rem',
  className,
  style,
  ...props
}: KeyValuesProps): JSX.Element {
  if (layout === 'stacked') {
    return (
      <div className="@container">
        <dl
          className={cn('grid gap-x-6 gap-y-3', COLUMNS[columns], className)}
          style={style}
          {...props}
        >
          {items.map((item, index) => (
            <div key={keyOf(item, index)} className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-xs text-fg-muted">{item.label}</dt>
              <dd className="text-sm font-medium break-words text-fg tabular-nums">{item.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  const split = layout === 'split';

  return (
    <dl
      className={cn('flex flex-col', className)}
      style={{ ...style, ['--reach-kv-label' as string]: labelWidth }}
      {...props}
    >
      {items.map((item, index) => (
        <div
          key={keyOf(item, index)}
          className={cn(
            'flex min-h-11 items-center justify-between gap-4 py-2 touch:min-h-13 touch:py-2.5',
            'border-b border-border last:border-b-0',
            !split &&
              'grid grid-cols-[var(--reach-kv-label)_minmax(0,1fr)] items-baseline touch:flex touch:items-center',
          )}
        >
          <dt className="shrink-0 text-sm text-fg-muted">{item.label}</dt>
          <dd
            className={cn(
              'flex min-w-0 flex-wrap items-center gap-1.5 text-sm font-medium text-fg tabular-nums',
              // Under a finger both layouts push the value to the far edge.
              'touch:justify-end touch:text-end',
              split && 'justify-end text-end',
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
