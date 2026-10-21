'use client';

import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import { useId, type ComponentPropsWithoutRef, type JSX, type ReactNode } from 'react';

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

export interface CheckboxCardProps extends Omit<CheckboxProps, 'children'> {
  /** The title. */
  children: ReactNode;
  /** A line under the title: what choosing it means. */
  description?: ReactNode;
  /** Beside the title: a `Badge`, such as "By law". */
  badge?: ReactNode;
}

/**
 * The same control as a card, for choosing several from a set that deserves
 * the weight: the benefits a job comes with, the channels to publish on. It
 * is `RadioCard`'s shape for a multiple choice, so the two read as one family;
 * the whole card is the target, which is what makes it work on a phone.
 */
export function CheckboxCard({
  className,
  children,
  description,
  badge,
  id,
  ...props
}: CheckboxCardProps): JSX.Element {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const labelId = `${controlId}-label`;
  const descriptionId = `${controlId}-description`;
  return (
    <label
      htmlFor={controlId}
      className={cn(
        'flex h-full cursor-pointer items-start gap-3 rounded-md bg-surface p-4 shadow-sm touch:rounded-[1.125rem]',
        'transition-[background-color,box-shadow] duration-(--animate-duration-normal) ease-standard',
        'hover:bg-surface-hover',
        'has-[[data-state=checked]]:bg-accent-subtle has-[[data-state=checked]]:ring-2 has-[[data-state=checked]]:ring-accent has-[[data-state=checked]]:ring-inset',
        'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-border-focus',
        'has-[:disabled]:cursor-default',
        className,
      )}
    >
      <Checkbox
        id={controlId}
        aria-labelledby={labelId}
        aria-describedby={description ? descriptionId : undefined}
        // The card draws the focus ring; a second one on the box is noise.
        className="mt-0.5 focus-visible:outline-none touch:mt-0"
        {...props}
      />
      <div className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span id={labelId} className="block text-sm font-semibold text-fg">
            {children}
          </span>
          {badge}
        </span>
        {description ? (
          <span id={descriptionId} className="mt-0.5 block text-sm text-fg-muted">
            {description}
          </span>
        ) : null}
      </div>
    </label>
  );
}
