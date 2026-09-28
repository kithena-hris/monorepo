import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * Labelled values read down a page: a record's details, a summary before a
 * submit, the detail row of a table.
 *
 * A `<dl>`, because that is what it is. A screen reader announces each term
 * with its definition, which a grid of spans cannot make it do.
 *
 * Two layouts. `columns` puts every label in one fixed-width column so the
 * values line up and can be scanned without the labels; it is the desk
 * default. `split` pushes each value to the far edge of its row, which is how
 * a phone lists settings, and it is what `columns` becomes under a finger,
 * where a 160px label column would leave the values a sliver.
 */

export interface KeyValueItem {
  /** Stable key. Defaults to the label when the label is a string. */
  id?: string;
  label: ReactNode;
  /** Text, a `Money`, a `Badge`, an `Avatar` and a name. Anything inline. */
  value: ReactNode;
}

export interface KeyValuesProps extends Omit<ComponentPropsWithoutRef<'dl'>, 'children'> {
  items: readonly KeyValueItem[];
  /** `columns` aligns the values in one column; `split` pushes each to the row's end. */
  layout?: 'columns' | 'split';
  /** Width of the label column in the `columns` layout, e.g. `'12rem'`. */
  labelWidth?: string;
}

export function KeyValues({
  items,
  layout = 'columns',
  labelWidth = '10rem',
  className,
  style,
  ...props
}: KeyValuesProps): JSX.Element {
  const split = layout === 'split';

  return (
    <dl
      className={cn('flex flex-col', className)}
      style={{ ...style, ['--reach-kv-label' as string]: labelWidth }}
      {...props}
    >
      {items.map((item, index) => (
        <div
          key={item.id ?? (typeof item.label === 'string' ? item.label : index)}
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
