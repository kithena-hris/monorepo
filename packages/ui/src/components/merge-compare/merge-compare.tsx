'use client';

import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { Equal } from 'lucide-react';
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * Two records side by side, and which value to keep for each field.
 *
 * Merging two records is only safe when every difference was looked at. So
 * each field that differs is a two-option radio group (the left value or the
 * right one), and each field that is the same is greyed out with an equals
 * sign and nothing to choose, so the eye goes to the rows that need a
 * decision.
 *
 * Controlled: `picks` maps a row's id to `0` (left) or `1` (right), and
 * `onPick` reports a change. Which side wins by default is the caller's call;
 * usually the fuller value.
 *
 * Under a finger the label column narrows and the values keep a line each,
 * truncated rather than wrapped, so a long email does not push the choice off
 * the screen.
 */
export interface MergeCompareRow {
  readonly id: string;
  readonly label: ReactNode;
  readonly values: readonly [ReactNode, ReactNode];
  /** The two are the same: nothing to choose. */
  readonly same?: boolean;
  /** The pick is fixed (the other value may not be taken): shown, not offered. */
  readonly disabled?: boolean;
}

export interface MergeCompareProps extends ComponentPropsWithoutRef<'div'> {
  /** The two records' headings: an avatar, a name, where it came from. */
  readonly sources: readonly [ReactNode, ReactNode];
  /** Plain names of the two, for the radios' labels: "Yuki Sato (sign-up)". */
  readonly sourceNames: readonly [string, string];
  readonly rows: readonly MergeCompareRow[];
  readonly picks: Readonly<Record<string, 0 | 1>>;
  readonly onPick?: (id: string, side: 0 | 1) => void;
}

const grid =
  'grid grid-cols-[11.25rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 touch:grid-cols-[5.625rem_minmax(0,1fr)_minmax(0,1fr)] touch:gap-2';

export function MergeCompare({
  sources,
  sourceNames,
  rows,
  picks,
  onPick,
  className,
  ...props
}: MergeCompareProps): JSX.Element {
  return (
    <div className={cn('flex flex-col', className)} {...props}>
      <div className={cn(grid, 'pb-2')}>
        <span />
        {sources.map((source, index) => (
          <div key={sourceNames[index]} className="min-w-0">
            {source}
          </div>
        ))}
      </div>
      {rows.map((row) => {
        const labelText = typeof row.label === 'string' ? row.label : row.id;
        return (
          <div
            key={row.id}
            className={cn(
              grid,
              'min-h-13 border-b border-border py-1 last:border-b-0 touch:min-h-12',
            )}
          >
            <span className="text-sm text-fg-muted">{row.label}</span>
            {row.same ? (
              row.values.map((value, index) => (
                <span
                  key={sourceNames[index]}
                  className="flex min-w-0 items-center gap-2.5 px-3 py-2 text-sm font-medium text-fg-muted touch:px-2"
                >
                  <Equal aria-hidden className="size-3.5 shrink-0 text-fg-subtle" />
                  <span className="truncate">{value}</span>
                  {index === 0 ? <span className="sr-only">, the same in both</span> : null}
                </span>
              ))
            ) : (
              <RadioGroupPrimitive.Root
                aria-label={labelText}
                value={String(picks[row.id] ?? 0)}
                onValueChange={(next) => {
                  onPick?.(row.id, next === '1' ? 1 : 0);
                }}
                disabled={onPick === undefined || row.disabled === true}
                className="contents"
              >
                {row.values.map((value, index) => (
                  <label
                    key={sourceNames[index]}
                    className={cn(
                      'flex min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm touch:px-2 touch:text-base',
                      'has-[:disabled]:cursor-default has-[:disabled]:opacity-60',
                      'transition-colors duration-(--animate-duration-fast)',
                      'has-[[data-state=checked]]:bg-accent-subtle has-[[data-state=checked]]:font-semibold',
                      'hover:bg-surface-hover has-[[data-state=checked]]:hover:bg-accent-subtle',
                      'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-border-focus',
                      'font-medium text-fg',
                    )}
                  >
                    <RadioGroupPrimitive.Item
                      value={String(index)}
                      aria-label={`${labelText}: keep ${sourceNames[index] ?? ''}`}
                      className={cn(
                        'relative grid size-[1.125rem] shrink-0 place-items-center rounded-full border-[1.5px] border-border-strong touch:size-6',
                        'data-[state=checked]:border-accent data-[state=checked]:bg-accent',
                        'focus-visible:outline-none',
                        'touch:before:absolute touch:before:top-1/2 touch:before:left-1/2 touch:before:size-tap touch:before:-translate-x-1/2 touch:before:-translate-y-1/2 touch:before:content-[""]',
                      )}
                    >
                      <RadioGroupPrimitive.Indicator className="size-[0.4375rem] rounded-full bg-fg-on-accent touch:size-2.5" />
                    </RadioGroupPrimitive.Item>
                    <span className="truncate">{value}</span>
                  </label>
                ))}
              </RadioGroupPrimitive.Root>
            )}
          </div>
        );
      })}
    </div>
  );
}
