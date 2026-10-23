'use client';

import { Info } from 'lucide-react';
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Checkbox } from '../checkbox/checkbox';
import { t } from '../../lib/i18n';

/**
 * Who can see a value and who can change it, as one grid.
 *
 * Two lists of checkboxes ("who can see", "who can change") let a reader build
 * a rule nobody means: somebody who may change a value they cannot see. Here
 * each audience is one row with two cells, and changing always includes
 * seeing, so turning on a change ticks the See box beside it and locks it.
 * `allSee` does the same for every See box at once. A locked box is ticked,
 * paler, and says why in its name, not only by its colour.
 *
 * A real `<table>` of Reach checkboxes, so a screen reader announces "Their
 * manager can see, checked" with the row and column headers.
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

/** One audience's access as a single level: nothing, seeing, or changing (which sees). */
export type AccessLevel = 'none' | 'see' | 'change';

export function accessLevel(value: AccessValue, id: string): AccessLevel {
  return value.change.includes(id) ? 'change' : value.see.includes(id) ? 'see' : 'none';
}

/** The value with one audience set to `level`: the same rule, chosen as one step under a finger. */
export function withAccessLevel(value: AccessValue, id: string, level: AccessLevel): AccessValue {
  const see = value.see.filter((x) => x !== id);
  const change = value.change.filter((x) => x !== id);
  return level === 'none'
    ? { see, change }
    : level === 'see'
      ? { see: [...see, id], change }
      : { see: [...see, id], change: [...change, id] };
}

export interface AccessMatrixProps extends Omit<ComponentPropsWithoutRef<'div'>, 'onChange'> {
  readonly audiences: readonly AccessAudience[];
  readonly value: AccessValue;
  /** Leave out for a read-only grid. */
  readonly onChange?: (next: AccessValue) => void;
  /**
   * Everybody can see it, whoever is ticked: every See box is ticked and
   * locked, so the grid never says somebody cannot see what everybody can.
   * `value.see` is kept as it is, and shows again once this is off.
   */
  readonly allSee?: boolean;
  /** Why a See box is locked while `allSee` holds, read after its name. */
  readonly allSeeReason?: string;
  /** Washes one row: the one that just changed, or the one being explained. */
  readonly highlight?: string;
  /** The line under the grid. `false` hides it. */
  readonly footer?: ReactNode;
  readonly seeLabel?: string;
  readonly changeLabel?: string;
  /** Names the table. */
  readonly label?: string;
}

/**
 * One box. An implied tick (`locked`) is ticked and cannot be pressed, drawn
 * paler than one somebody chose, and says why in its name.
 */
function Cell({
  on,
  locked,
  name,
  onPress,
}: {
  readonly on: boolean;
  readonly locked: boolean;
  readonly name: string;
  readonly onPress?: (() => void) | undefined;
}): JSX.Element {
  return (
    <Checkbox
      checked={on}
      disabled={onPress === undefined || locked}
      aria-label={name}
      {...(onPress === undefined ? {} : { onCheckedChange: onPress })}
      className={cn(
        locked &&
          'disabled:opacity-100 disabled:data-[state=checked]:border-transparent disabled:data-[state=checked]:bg-accent-solid/35',
      )}
    />
  );
}

export function AccessMatrix({
  audiences,
  value,
  onChange,
  allSee = false,
  allSeeReason = 'because everyone can see it',
  highlight,
  footer,
  seeLabel = 'Can see',
  changeLabel = 'Can change',
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
        'overflow-hidden rounded-md shadow-[inset_0_0_0_1px_var(--reach-color-border)] touch:rounded-[1rem]',
        className,
      )}
      {...props}
    >
      <table aria-label={label} className="w-full border-collapse text-start">
        <thead>
          <tr className="bg-surface-sunken text-xs font-semibold text-fg-muted">
            <th scope="col" className="px-3.5 py-2.5 text-start font-semibold">
              {t('components.access-matrix.access-matrix.who', 'Who')}
            </th>
            <th scope="col" className="w-24 px-2 py-2.5 text-center font-semibold touch:w-14">
              {seeLabel}
            </th>
            <th
              scope="col"
              className="w-24 py-2.5 ps-2 pe-3.5 text-center font-semibold touch:w-16"
            >
              {changeLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {audiences.map((a) => {
            const change = value.change.includes(a.id);
            const see = allSee || change || value.see.includes(a.id);
            // Deterministic: a See box is ticked by `allSee`, by a change, or by itself.
            const why = allSee
              ? allSeeReason
              : change
                ? t(
                    'components.access-matrix.access-matrix.because_they_can_change_it',
                    'because they can change it',
                  )
                : null;
            return (
              <tr
                key={a.id}
                className={cn(
                  'border-t border-border',
                  highlight === a.id && 'bg-accent-subtle/45',
                )}
              >
                <th scope="row" className="px-3.5 py-2.5 text-start font-normal">
                  <span className="flex min-w-0 items-center gap-2.5">
                    {a.icon ? (
                      <span aria-hidden className="shrink-0 text-fg-muted [&_svg]:size-4">
                        {a.icon}
                      </span>
                    ) : null}
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-fg touch:text-base">
                        {a.label}
                      </span>
                      {a.description ? (
                        <span className="block text-xs text-fg-subtle">{a.description}</span>
                      ) : null}
                    </span>
                  </span>
                </th>
                <td className="px-2 py-2.5 text-center">
                  <span className="inline-grid place-items-center">
                    <Cell
                      on={see}
                      locked={why !== null}
                      name={`${a.label} ${seeLabel.toLowerCase()}${why === null ? '' : `, ${why}`}`}
                      onPress={press(a.id, 'see')}
                    />
                  </span>
                </td>
                <td className="py-2.5 ps-2 pe-3.5 text-center">
                  {a.canChange === false ? null : (
                    <span className="inline-grid place-items-center">
                      <Cell
                        on={change}
                        locked={false}
                        name={`${a.label} ${changeLabel.toLowerCase()}`}
                        onPress={press(a.id, 'change')}
                      />
                    </span>
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
          {footer ??
            t(
              'components.access-matrix.access-matrix.ticking_ticks_too',
              'Ticking {{changeLabel}} ticks {{seeLabel}} too.',
              { changeLabel, seeLabel },
            )}
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
    return t('components.access-matrix.access-matrix.text', '{{label}}: {{value}}', {
      label: a.label,
      value: change ? 'changes' : see ? 'sees' : 'no access',
    });
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
