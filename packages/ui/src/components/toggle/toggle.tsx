'use client';

import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import * as TogglePrimitive from '@radix-ui/react-toggle';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentPropsWithoutRef, JSX } from 'react';

import { cn } from '../../lib/cn';

/**
 * A button that stays pressed.
 *
 * `aria-pressed`, not `aria-checked`: this is a two-state button, not a
 * checkbox, and the difference is what a screen reader says out loud. Use it
 * for a view mode or a formatting state, anything where the label describes
 * the action and the pressed state describes the current setting.
 */

const toggle = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap',
    'transition-[background-color,color,box-shadow,transform] duration-(--animate-duration-normal) ease-standard',
    'active:scale-[0.97] motion-reduce:active:scale-100',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
    'disabled:pointer-events-none disabled:opacity-55',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        ghost:
          'text-fg-muted hover:bg-surface-hover hover:text-fg data-[state=on]:bg-accent-subtle data-[state=on]:text-accent-fg',
        outline:
          'border border-border bg-surface text-fg-muted hover:bg-surface-hover data-[state=on]:border-accent data-[state=on]:bg-accent-subtle data-[state=on]:text-accent-fg',
      },
      size: {
        sm: 'h-control-sm px-2 text-xs [&_svg]:size-3.5',
        md: 'h-control-md px-3 text-base [&_svg]:size-4',
        lg: 'h-control-lg px-4 text-md [&_svg]:size-[1.125rem]',
      },
      iconOnly: { true: 'aspect-square px-0', false: '' },
    },
    defaultVariants: { variant: 'ghost', size: 'md', iconOnly: false },
  },
);

export interface ToggleProps
  extends ComponentPropsWithoutRef<typeof TogglePrimitive.Root>, VariantProps<typeof toggle> {}

export function Toggle({ className, variant, size, iconOnly, ...props }: ToggleProps): JSX.Element {
  return (
    <TogglePrimitive.Root
      className={cn(toggle({ variant, size, iconOnly }), className)}
      {...props}
    />
  );
}

/**
 * A segmented control: a small set of mutually exclusive views.
 *
 * `type="single"` renders a radio group to assistive tech, which is the
 * correct model, "list or grid" is one value with two options, not two
 * independent switches. `type="multiple"` is the filter case, where several
 * can be on at once.
 *
 * Above four or five segments this stops working on a phone; that is a `Select`.
 */
export function ToggleGroup({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>): JSX.Element {
  return (
    <ToggleGroupPrimitive.Root
      className={cn(
        'inline-flex items-center gap-1 rounded-lg bg-surface-sunken p-1',
        // Below `xs` the segments share the row equally instead of overflowing
        // it: four fixed-width segments do not fit on a 375px screen.
        'max-xs:flex max-xs:w-full max-xs:[&>*]:flex-1',
        className,
      )}
      {...props}
    />
  );
}

export interface ToggleGroupItemProps
  extends ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>, VariantProps<typeof toggle> {}

export function ToggleGroupItem({
  className,
  size,
  iconOnly,
  ...props
}: ToggleGroupItemProps): JSX.Element {
  return (
    <ToggleGroupPrimitive.Item
      className={cn(
        toggle({ variant: 'ghost', size, iconOnly }),
        // Inside a group the selected segment lifts onto a surface, so the
        // group reads as one control with a moving indicator rather than as a
        // row of buttons that happen to be adjacent.
        'data-[state=on]:bg-surface data-[state=on]:text-fg data-[state=on]:shadow-xs',
        className,
      )}
      {...props}
    />
  );
}
