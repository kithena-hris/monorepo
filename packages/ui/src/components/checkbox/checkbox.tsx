'use client';

import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import type { ComponentPropsWithoutRef, JSX } from 'react';

import { cn } from '../../lib/cn';

export type CheckboxProps = ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>;

/**
 * Binary or tri-state selection.
 *
 * `checked="indeterminate"` is a real state, not a styling trick: a
 * select-all header checkbox over a partially selected table must report
 * `aria-checked="mixed"`, which the primitive handles.
 */
export function Checkbox({ className, ...props }: CheckboxProps): JSX.Element {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        // 18px at a desk, 24px under a thumb, with the hit area grown to the
        // tap floor either way by `tap-target`.
        'peer relative grid size-[1.125rem] shrink-0 place-items-center rounded-[0.3125rem] border-[1.5px] border-border-strong',
        'touch:size-6 touch:rounded-[0.5rem]',
        'tap-target',
        // Radix renders this as a <button>, which is `cursor: default`. A 16px
        // box with no label of its own gives the pointer nothing else to react
        // to, so without this the only hover feedback on a table's select-all
        // is a 1px border colour, and the control reads as decoration.
        // `Switch`, `RadioGroup` and `Rating` already do this; `Checkbox` was
        // the one that did not.
        'cursor-pointer bg-transparent ease-standard',
        'transition-[background-color,border-color,box-shadow,transform] duration-(--animate-duration-instant)',
        // 8% on a 16px box is ~1.3px: the smallest press that is still legible.
        'active:scale-[0.92] motion-reduce:active:scale-100',
        'hover:border-accent',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
        'data-[state=checked]:border-accent-solid data-[state=checked]:bg-accent-solid data-[state=checked]:text-fg-on-accent',
        'data-[state=indeterminate]:border-accent-solid data-[state=indeterminate]:bg-accent-solid data-[state=indeterminate]:text-fg-on-accent',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border-strong',
        'aria-invalid:border-danger',
        'disabled:data-[state=checked]:border-surface-active disabled:data-[state=checked]:bg-surface-active',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        // The tick scales in from the centre of the box, which reads as the
        // box filling rather than as a glyph appearing on top of it.
        className="grid place-items-center text-current data-[state=checked]:animate-scale-in data-[state=indeterminate]:animate-scale-in"
      >
        {props.checked === 'indeterminate' ? (
          <Minus className="size-3 touch:size-4.5" strokeWidth={3} aria-hidden="true" />
        ) : (
          <Check className="size-3 touch:size-4.5" strokeWidth={3} aria-hidden="true" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
