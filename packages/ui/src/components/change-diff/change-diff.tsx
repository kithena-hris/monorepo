import { ArrowRight } from 'lucide-react';
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * Before and after, one row per value that changed.
 *
 * For an approval somebody has to decide and an audit entry somebody has to
 * read later. The old value is struck through and the new one sits on a green
 * wash, and both are also `<del>` and `<ins>` with a spoken "was" and "now",
 * because strikethrough is invisible to a screen reader.
 *
 * At a desk a row is label, old, arrow, new, so a column of changes can be
 * read down either side. Under a finger the four stack, because a 390px row
 * has room for one value, not two and an arrow.
 */
export interface ChangeDiffItem {
  readonly id?: string;
  readonly label: ReactNode;
  readonly before: ReactNode;
  readonly after: ReactNode;
  /** An identifier, a bank account: set in the monospace face so digits line up. */
  readonly mono?: boolean;
}

export interface ChangeDiffProps extends Omit<ComponentPropsWithoutRef<'dl'>, 'children'> {
  readonly items: readonly ChangeDiffItem[];
}

export function ChangeDiff({ items, className, ...props }: ChangeDiffProps): JSX.Element {
  return (
    <dl className={cn('flex flex-col', className)} {...props}>
      {items.map((item, index) => (
        <div
          key={item.id ?? (typeof item.label === 'string' ? item.label : index)}
          className={cn(
            'grid items-center gap-2.5 border-b border-border py-2.5 last:border-b-0',
            'grid-cols-[9.375rem_minmax(0,1fr)_1.125rem_minmax(0,1fr)]',
            'touch:grid-cols-1 touch:gap-1.5 touch:py-3',
          )}
        >
          <dt className="text-sm text-fg-muted">{item.label}</dt>
          <dd className="contents">
            <del
              className={cn(
                'min-w-0 text-sm font-medium break-words text-fg-subtle line-through touch:text-base',
                item.mono && 'font-mono',
              )}
            >
              <span className="sr-only">was </span>
              {item.before}
            </del>
            <ArrowRight aria-hidden className="size-3.5 text-fg-subtle touch:hidden" />
            <ins
              className={cn(
                'w-fit max-w-full rounded-xs bg-success-subtle px-2 py-1 text-sm font-semibold break-words text-fg no-underline touch:text-base',
                item.mono && 'font-mono',
              )}
            >
              <span className="sr-only">now </span>
              {item.after}
            </ins>
          </dd>
        </div>
      ))}
    </dl>
  );
}
