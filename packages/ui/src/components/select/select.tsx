'use client';

import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { ComponentPropsWithoutRef, JSX } from 'react';

import { cn } from '../../lib/cn';

/**
 * Single-choice control.
 *
 * Above roughly a dozen options this is the wrong component: use a
 * searchable combobox. A 400-entry cost-centre list in a select is a support
 * ticket waiting to happen.
 */
export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

const triggerSize = {
  sm: 'h-control-sm px-2.5 text-xs',
  md: 'h-control-md px-3 text-base',
  lg: 'h-control-lg px-3.5 text-md',
} as const;

export interface SelectTriggerProps extends ComponentPropsWithoutRef<
  typeof SelectPrimitive.Trigger
> {
  /** Matches `Button` and `Input`, so a mixed toolbar row lines up. */
  size?: keyof typeof triggerSize;
}

export function SelectTrigger({
  className,
  children,
  size = 'md',
  ...props
}: SelectTriggerProps): JSX.Element {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-md',
        triggerSize[size],
        'border border-border bg-surface text-fg shadow-xs',
        'transition-[border-color,box-shadow,transform] duration-(--animate-duration-fast) ease-standard',
        'active:scale-[0.995] motion-reduce:active:scale-100',
        'data-[placeholder]:text-fg-subtle',
        'focus-visible:border-border-focus focus-visible:ring-2 focus-visible:ring-border-focus/30',
        'focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-fg-disabled',
        'aria-invalid:border-danger aria-invalid:ring-danger/25',
        '[&>span]:truncate',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.Content>): JSX.Element {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        sideOffset={4}
        className={cn(
          'relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md',
          'border border-border bg-surface text-fg shadow-lg',
          'data-[state=open]:animate-scale-in data-[state=closed]:animate-scale-out',
          'origin-(--radix-select-content-transform-origin)',
          position === 'popper' && 'w-full min-w-(--radix-select-trigger-width)',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center text-fg-subtle">
          <ChevronUp className="size-4" aria-hidden="true" />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center text-fg-subtle">
          <ChevronDown className="size-4" aria-hidden="true" />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectLabel({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.Label>): JSX.Element {
  return (
    <SelectPrimitive.Label
      className={cn(
        'px-2 py-1.5 text-2xs font-semibold tracking-wide text-fg-subtle uppercase',
        className,
      )}
      {...props}
    />
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.Item>): JSX.Element {
  return (
    <SelectPrimitive.Item
      className={cn(
        'relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2',
        'text-base text-fg outline-none select-none',
        'data-highlighted:bg-accent-subtle data-highlighted:text-accent-fg',
        'data-disabled:pointer-events-none data-disabled:text-fg-disabled',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span className="absolute right-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-4" aria-hidden="true" />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
}

export function SelectSeparator({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>): JSX.Element {
  return (
    <SelectPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
  );
}
