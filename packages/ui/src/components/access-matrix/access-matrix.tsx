'use client';

import { Eye, Info, Minus, Pencil } from 'lucide-react';
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * Who can see a value and who can change it, as one grid.
 *
 * Two lists of checkboxes ("who can see", "who can change") let a reader build
 * a rule nobody means: somebody who may change a value they cannot see. Here
 * each audience is one row with two cells, and changing always includes
 * seeing, so turning on a change turns on the see beside it and locks it. The
 * lock is said in words (`aria-disabled` and the cell's name), not only by
 * the dimmed cell.
 *
 * A real `<table>`, so a screen reader announces "Their manager, Sees,
 * pressed" with the row and column headers, and each cell is a toggle button.
 *
 * `AccessStrip` is the same rule, read-only and small enough for a list row:
 * one glyph per audience, light for sees and solid for changes.
 */
export interface AccessAudience {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: ReactNode;
  /** False where changing makes no sense (everybody in the directory). */
  readonly canChange?: boolean;
}

export interface AccessValue {
  readonly see: readonly string[];
  readonly change: readonly string[];
}

export type AccessColumn = 'see' | 'change';

/**
 * The next value after pressing one cell. Pure, so the rule is tested without
 * a DOM: changing implies seeing, and a see that a change holds cannot be
 * turned off on its own.
 */
export function toggleAccess(value: AccessValue, id: string, column: AccessColumn): AccessValue {
  const has = (list: readonly string[]) => list.includes(id);
  const without = (list: readonly string[]) => list.filter((x) => x !== id);
  if (column === 'change') {
    return has(value.change)
      ? { see: value.see, change: without(value.change) }
      : { see: has(value.see) ? value.see : [...value.see, id], change: [...value.change, id] };
  }
  if (has(value.change)) return value;
  return has(value.see)
    ? { see: without(value.see), change: value.change }
    : { see: [...value.see, id], change: value.change };
}

export interface AccessMatrixProps extends Omit<ComponentPropsWithoutRef<'div'>, 'onChange'> {
  readonly audiences: readonly AccessAudience[];
  readonly value: AccessValue;
  /** Leave out for a read-only grid. */
  readonly onChange?: (next: AccessValue) => void;
  /** Washes one row: the one that just changed, or the one being explained. */
  readonly highlight?: string;
  /** The line under the grid. `false` hides it. */
  readonly footer?: ReactNode;
  readonly seeLabel?: string;
  readonly changeLabel?: string;
  /** Names the table. */
  readonly label?: string;
}

function Cell({
  on,
  locked,
  kind,
  name,
  onPress,
}: {
  readonly on: boolean;
  readonly locked: boolean;
  readonly kind: AccessColumn;
  readonly name: string;
  readonly onPress?: (() => void) | undefined;
}): JSX.Element {
  const glyph = on ? (
    kind === 'change' ? (
      <Pencil aria-hidden />
    ) : (
      <Eye aria-hidden />
    )
  ) : (
    <Minus aria-hidden />
  );
  const look = cn(
    'relative inline-grid h-8 w-16 place-items-center rounded-sm [&_svg]:size-[0.9375rem] touch:h-9 touch:w-13',
    on
      ? kind === 'change'
        ? 'bg-accent-solid text-fg-on-accent'
        : 'bg-accent-subtle text-accent-fg'
      : 'bg-surface-sunken text-fg-subtle',
    locked && 'opacity-60',
  );
  if (onPress === undefined) {
    return (
      <span className={look} role="img" aria-label={`${name}: ${on ? 'yes' : 'no'}`}>
        {glyph}
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-disabled={locked || undefined}
      aria-label={locked ? `${name}, because they can change it` : name}
      onClick={locked ? undefined : onPress}
      className={cn(
        look,
        'tap-target transition-colors duration-(--animate-duration-fast)',
        !locked && (on ? 'hover:opacity-90' : 'hover:bg-surface-hover hover:text-fg-muted'),
        locked ? 'cursor-not-allowed' : 'cursor-pointer',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
      )}
    >
      {glyph}
    </button>
  );
}

export function AccessMatrix({
  audiences,
  value,
  onChange,
  highlight,
  footer,
  seeLabel = 'Sees',
  changeLabel = 'Changes',
  label = 'Who can see and change it',
  className,
  ...props
}: AccessMatrixProps): JSX.Element {
  const press = (id: string, column: AccessColumn) =>
    onChange === undefined
      ? undefined
      : () => {
          onChange(toggleAccess(value, id, column));
        };
  return (
    <div
      className={cn(
        'overflow-hidden rounded-md shadow-[inset_0_0_0_1px_var(--reach-color-border)] touch:rounded-[1.125rem]',
        className,
      )}
      {...props}
    >
      <table aria-label={label} className="w-full border-collapse text-start">
        <thead>
          <tr className="bg-surface-sunken text-xs font-semibold text-fg-muted">
            <th scope="col" className="px-3.5 py-2.5 text-start font-semibold">
              Who
            </th>
            <th scope="col" className="w-20 px-2 py-2.5 text-center font-semibold touch:w-16">
              {seeLabel}
            </th>
            <th
              scope="col"
              className="w-20 py-2.5 ps-2 pe-3.5 text-center font-semibold touch:w-18"
            >
              {changeLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {audiences.map((a) => {
            const change = value.change.includes(a.id);
            const see = change || value.see.includes(a.id);
            return (
              <tr
                key={a.id}
                className={cn(
                  'border-t border-border',
                  highlight === a.id && 'bg-accent-subtle/45',
                )}
              >
                <th scope="row" className="px-3.5 py-2 text-start font-normal">
                  <span className="flex min-w-0 items-center gap-2.5">
                    {a.icon ? (
                      <span aria-hidden className="shrink-0 text-fg-muted [&_svg]:size-4">
                        {a.icon}
                      </span>
                    ) : null}
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-fg touch:text-base">
                        {a.label}
                      </span>
                      {a.description ? (
                        <span className="block text-xs text-fg-subtle touch:hidden">
                          {a.description}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </th>
                <td className="px-2 py-2 text-center">
                  <Cell
                    on={see}
                    locked={change}
                    kind="see"
                    name={`${a.label} ${seeLabel.toLowerCase()} it`}
                    onPress={press(a.id, 'see')}
                  />
                </td>
                <td className="py-2 ps-2 pe-3.5 text-center">
                  {a.canChange === false ? null : (
                    <Cell
                      on={change}
                      locked={false}
                      kind="change"
                      name={`${a.label} ${changeLabel.toLowerCase()} it`}
                      onPress={press(a.id, 'change')}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {footer === false ? null : (
        <p className="flex items-center gap-1.5 border-t border-border px-3.5 py-2.5 text-xs text-fg-muted">
          <Info aria-hidden className="size-3.5 shrink-0" />
          {footer ?? 'Anyone who can change it can also see it.'}
        </p>
      )}
    </div>
  );
}

export interface AccessStripProps extends Omit<ComponentPropsWithoutRef<'span'>, 'children'> {
  readonly audiences: readonly AccessAudience[];
  readonly value: AccessValue;
}

/** The same rule in a list row: light for sees, solid for changes, outlined for neither. */
export function AccessStrip({
  audiences,
  value,
  className,
  ...props
}: AccessStripProps): JSX.Element {
  const words = audiences.map((a) => {
    const change = value.change.includes(a.id);
    const see = change || value.see.includes(a.id);
    return `${a.label}: ${change ? 'changes' : see ? 'sees' : 'no access'}`;
  });
  return (
    <span
      role="img"
      aria-label={words.join('; ')}
      className={cn('inline-flex items-center gap-[3px]', className)}
      {...props}
    >
      {audiences.map((a) => {
        const change = value.change.includes(a.id);
        const see = change || value.see.includes(a.id);
        return (
          <span
            key={a.id}
            title={a.label}
            className={cn(
              'inline-grid size-6 place-items-center rounded-[7px] [&_svg]:size-3',
              change
                ? 'bg-accent-solid text-fg-on-accent'
                : see
                  ? 'bg-accent-subtle text-accent-fg'
                  : 'text-icon-muted shadow-[inset_0_0_0_1px_var(--reach-color-border)]',
            )}
          >
            {a.icon}
          </span>
        );
      })}
    </span>
  );
}
