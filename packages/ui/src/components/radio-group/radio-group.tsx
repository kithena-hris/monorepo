'use client';

import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';
import { useId } from 'react';

import { cn } from '../../lib/cn';

/**
 * One choice from a small set, all options visible.
 *
 * The line against `Select`: a radio group shows every option and its cost is
 * vertical space, so it wins up to about five options and loses badly above
 * ten. It is also the honest control when the options are not equivalent.
 * "unpaid leave" and "parental leave" have consequences a collapsed dropdown
 * hides.
 *
 * A radio group with two options that are opposites is a `Switch`.
 */

export function RadioGroup({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>): JSX.Element {
  return (
    <RadioGroupPrimitive.Root
      className={cn(
        'grid gap-2 data-[orientation=horizontal]:auto-cols-max data-[orientation=horizontal]:grid-flow-col',
        className,
      )}
      {...props}
    />
  );
}

export interface RadioGroupItemProps extends Omit<
  ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>,
  'children'
> {
  /** The visible label. Always render one, a bare dot is unusable. */
  children: ReactNode;
  /** Second line, for the consequence of choosing this option. */
  description?: ReactNode;
}

export function RadioGroupItem({
  className,
  children,
  description,
  id,
  ...props
}: RadioGroupItemProps): JSX.Element {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const descriptionId = `${controlId}-description`;

  return (
    // A disabled option dims its dot and its label, never its description: that
    // line is usually why it cannot be chosen, and has to stay readable.
    <div className="group/radio flex items-start gap-2.5">
      <RadioGroupPrimitive.Item
        id={controlId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          // The 44px target is a pseudo-element rather than a bigger circle:
          // a 44px radio would be a visual error, but a 20px one is unhittable.
          // 18px at a desk and 24px under a thumb, like `Checkbox`.
          'relative mt-0.5 grid size-[1.125rem] shrink-0 place-items-center rounded-full border-[1.5px] border-border-strong',
          'touch:mt-0 touch:size-6',
          'transition-[border-color,background-color,box-shadow,transform] duration-(--animate-duration-fast)',
          'active:scale-[0.92] motion-reduce:active:scale-100',
          'hover:border-accent',
          'data-[state=checked]:border-accent data-[state=checked]:bg-accent',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
          'disabled:pointer-events-none disabled:opacity-50',
          'aria-invalid:border-danger',
          'touch:before:absolute touch:before:top-1/2 touch:before:left-1/2 touch:before:size-tap',
          'touch:before:-translate-x-1/2 touch:before:-translate-y-1/2 touch:before:content-[""]',
          className,
        )}
        {...props}
      >
        <RadioGroupPrimitive.Indicator className="size-[0.4375rem] rounded-full bg-fg-on-accent data-[state=checked]:animate-scale-in touch:size-2.5" />
      </RadioGroupPrimitive.Item>
      <div className="min-w-0">
        <label
          htmlFor={controlId}
          className="block cursor-pointer text-base text-fg select-none group-has-[:disabled]/radio:cursor-default group-has-[:disabled]/radio:opacity-50"
        >
          {children}
        </label>
        {description ? (
          <p id={descriptionId} className="mt-0.5 text-sm text-fg-muted">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The same control as a set of cards, for a choice that deserves the weight,
 * a pay schedule, a termination reason. The whole card is the target, which is
 * also what makes it work on a phone.
 */
export function RadioCard({
  className,
  children,
  description,
  id,
  ...props
}: RadioGroupItemProps): JSX.Element {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const descriptionId = `${controlId}-description`;
  const labelId = `${controlId}-label`;

  return (
    <label
      htmlFor={controlId}
      className={cn(
        // A raised card; the chosen one takes the accent wash and a 2px ring,
        // so the choice is a shape as well as a colour.
        'flex cursor-pointer items-start gap-3 rounded-md bg-surface p-4 shadow-sm touch:rounded-[1.125rem]',
        'transition-[background-color,box-shadow] duration-(--animate-duration-normal) ease-standard',
        'hover:bg-surface-hover',
        'has-[[data-state=checked]]:bg-accent-subtle has-[[data-state=checked]]:ring-2 has-[[data-state=checked]]:ring-accent has-[[data-state=checked]]:ring-inset',
        'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-border-focus',
        'has-[:disabled]:pointer-events-none has-[:disabled]:opacity-50',
        className,
      )}
    >
      {/*
       * Named by its title alone. The card is the label, so without this the
       * name would be the title and the description run together, and the
       * description would then be read a second time as the description.
       */}
      <RadioGroupPrimitive.Item
        id={controlId}
        aria-labelledby={labelId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          'mt-0.5 grid size-[1.125rem] shrink-0 place-items-center rounded-full border-[1.5px] border-border-strong',
          'touch:mt-0 touch:size-6',
          'transition-colors duration-(--animate-duration-fast)',
          'data-[state=checked]:border-accent data-[state=checked]:bg-accent',
          // The card draws the focus ring; a second one on the dot is noise.
          'focus-visible:outline-none',
        )}
        {...props}
      >
        <RadioGroupPrimitive.Indicator className="size-[0.4375rem] rounded-full bg-fg-on-accent data-[state=checked]:animate-scale-in touch:size-2.5" />
      </RadioGroupPrimitive.Item>
      <div className="min-w-0">
        <span id={labelId} className="block text-base font-semibold text-fg">
          {children}
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
