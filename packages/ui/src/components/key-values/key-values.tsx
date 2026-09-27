import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * Settings read back as label and value, the way a console summarises what
 * is configured before anybody opens it to change it.
 *
 * A `<dl>`, because that is what it is: each term names the value that
 * follows, and a screen reader announces the pairing. Labels sit above their
 * values rather than beside them, so a long value wraps under its own label
 * and a narrow card or a phone needs no second layout. `columns` spreads the
 * pairs across the width the container has, never the window's.
 */
export interface KeyValuesProps extends Omit<ComponentPropsWithoutRef<'dl'>, 'children'> {
  readonly items: readonly { readonly label: string; readonly value: ReactNode }[];
  /** Pairs per row where there is room: 1 (default), 2 or 3. */
  readonly columns?: 1 | 2 | 3;
}

const COLUMNS = {
  1: '',
  2: '@sm:grid-cols-2',
  3: '@sm:grid-cols-2 @lg:grid-cols-3',
} as const;

export function KeyValues({
  items,
  columns = 1,
  className,
  ...props
}: KeyValuesProps): JSX.Element {
  return (
    <div className="@container">
      <dl className={cn('grid gap-x-6 gap-y-3', COLUMNS[columns], className)} {...props}>
        {items.map((item) => (
          <div key={item.label} className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-fg-muted text-xs">{item.label}</dt>
            <dd className="text-fg text-sm break-words tabular-nums">{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
