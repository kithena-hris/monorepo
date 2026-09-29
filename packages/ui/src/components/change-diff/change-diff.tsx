import { ArrowRight } from 'lucide-react';
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Checkbox } from '../checkbox/checkbox';

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
 *
 * ### Reviewing a set of proposed changes
 *
 * The same rows, each one kept or dropped before anything is applied: give
 * `onSelectedChange` and each row a `selected` and a `selectLabel`, and a
 * checkbox leads the row. Something new has no `before`, and reads as "new"
 * rather than as a change from nothing. A `note` sits under the row — why it
 * must be ticked on purpose (`tone="warning"`), or why it cannot be applied
 * (`tone="danger"`) — and `actions` sit at its end.
 */
export interface ChangeDiffItem {
  readonly id?: string;
  readonly label: ReactNode;
  /** Absent or null for something new. */
  readonly before?: ReactNode;
  readonly after: ReactNode;
  /** An identifier, a bank account: set in the monospace face so digits line up. */
  readonly mono?: boolean;
  /** Kept, when the list is a selection. */
  readonly selected?: boolean;
  /** The checkbox's name, when `label` is not plain words. */
  readonly selectLabel?: string;
  readonly note?: ReactNode;
  readonly tone?: 'neutral' | 'warning' | 'danger';
  readonly actions?: ReactNode;
}

export interface ChangeDiffProps extends Omit<ComponentPropsWithoutRef<'dl'>, 'children'> {
  readonly items: readonly ChangeDiffItem[];
  /** Makes each row one to keep or drop. */
  readonly onSelectedChange?: (id: string, selected: boolean) => void;
}

const NOTE_TONE = {
  neutral: 'text-fg-muted',
  warning: 'text-warning-fg',
  danger: 'text-danger-fg',
} as const;

export function ChangeDiff({
  items,
  onSelectedChange,
  className,
  ...props
}: ChangeDiffProps): JSX.Element {
  const selectable = onSelectedChange !== undefined;
  return (
    <dl className={cn('flex flex-col', className)} {...props}>
      {items.map((item, index) => {
        const id = item.id ?? (typeof item.label === 'string' ? item.label : String(index));
        const isNew = item.before === undefined || item.before === null;
        const withActions = items.some((i) => i.actions !== undefined);
        return (
          <div
            key={id}
            className={cn(
              'grid items-center gap-x-2.5 gap-y-1 border-b border-border py-2.5 last:border-b-0',
              selectable && withActions
                ? 'grid-cols-[1.125rem_9.375rem_minmax(0,1fr)_1.125rem_minmax(0,1fr)_auto]'
                : selectable
                  ? 'grid-cols-[1.125rem_9.375rem_minmax(0,1fr)_1.125rem_minmax(0,1fr)]'
                  : withActions
                    ? 'grid-cols-[9.375rem_minmax(0,1fr)_1.125rem_minmax(0,1fr)_auto]'
                    : 'grid-cols-[9.375rem_minmax(0,1fr)_1.125rem_minmax(0,1fr)]',
              'touch:grid-cols-1 touch:gap-1.5 touch:py-3',
              selectable && item.selected === false && 'opacity-70',
            )}
          >
            {selectable ? (
              <Checkbox
                checked={item.selected === true}
                aria-label={
                  item.selectLabel ??
                  (typeof item.label === 'string' ? item.label : `Change ${String(index + 1)}`)
                }
                onCheckedChange={(checked) => {
                  onSelectedChange(id, checked === true);
                }}
              />
            ) : null}
            <dt className="text-sm text-fg-muted">{item.label}</dt>
            <dd className="contents">
              {isNew ? (
                <span className="text-sm text-fg-subtle touch:hidden" aria-hidden>
                  New
                </span>
              ) : (
                <del
                  className={cn(
                    'min-w-0 text-sm font-medium break-words text-fg-subtle line-through touch:text-base',
                    item.mono && 'font-mono',
                  )}
                >
                  <span className="sr-only">was </span>
                  {item.before}
                </del>
              )}
              <ArrowRight aria-hidden className="size-3.5 text-fg-subtle touch:hidden" />
              <ins
                className={cn(
                  'w-fit max-w-full rounded-xs bg-success-subtle px-2 py-1 text-sm font-semibold break-words text-fg no-underline touch:text-base',
                  item.mono && 'font-mono',
                )}
              >
                <span className="sr-only">{isNew ? 'new ' : 'now '}</span>
                {item.after}
              </ins>
              {item.actions === undefined ? (
                withActions ? (
                  <span />
                ) : null
              ) : (
                <span className="flex items-center gap-1 justify-self-end">{item.actions}</span>
              )}
              {item.note === undefined || item.note === null ? null : (
                <span
                  className={cn(
                    'col-span-full text-sm',
                    selectable && 'ps-7 touch:ps-0',
                    NOTE_TONE[item.tone ?? 'neutral'],
                  )}
                >
                  {item.note}
                </span>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
