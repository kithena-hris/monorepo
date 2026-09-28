'use client';

import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import type { ComponentPropsWithoutRef, JSX } from 'react';

import { cn } from '../../lib/cn';
import { usePortalContainer } from '../../lib/portal-container';
import { fieldShell, floatShell, floatValue } from '../field/field-styles';

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

export interface SelectTriggerProps extends ComponentPropsWithoutRef<
  typeof SelectPrimitive.Trigger
> {
  /** Matches `Button` and `Input`, so a mixed toolbar row lines up. */
  size?: 'sm' | 'md' | 'lg';
}

export function SelectTrigger({
  className,
  children,
  size = 'md',
  ...props
}: SelectTriggerProps): JSX.Element {
  return (
    <SelectPrimitive.Trigger
      // Under a thumb the label of a 56px trigger floats inside it, as it
      // does on an `Input`.
      data-float={size === 'sm' ? undefined : ''}
      className={cn(
        fieldShell({ size }),
        size !== 'sm' && floatShell,
        'tap-target justify-between text-start',
        'cursor-pointer focus-visible:outline-none',
        'data-[state=open]:bg-surface data-[state=open]:ring-2 data-[state=open]:ring-accent data-[state=open]:ring-inset',
        'data-[placeholder]:[&>span:first-child]:text-fg-subtle',
        className,
      )}
      {...props}
    >
      <span className={cn('flex min-w-0 flex-1 items-center self-stretch', floatValue)}>
        <span className="truncate">{children}</span>
      </span>
      <SelectPrimitive.Icon asChild>
        <ChevronsUpDown className="size-[1.125rem] shrink-0 text-fg-muted" aria-hidden="true" />
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
    <SelectPrimitive.Portal container={usePortalContainer()}>
      <SelectPrimitive.Content
        position={position}
        sideOffset={4}
        className={cn(
          'relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md touch:rounded-[1.25rem]',
          'bg-surface-raised text-fg shadow-lg',
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
        <SelectPrimitive.Viewport className="p-1.5">{children}</SelectPrimitive.Viewport>
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
      className={cn('px-2.5 pt-2 pb-1 text-xs font-semibold text-fg-subtle', className)}
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
        'relative flex min-h-9 cursor-pointer items-center gap-2.5 rounded-[0.5625rem] py-1.5 ps-2.5 pe-8',
        'touch:min-h-12 touch:rounded-[0.875rem] touch:ps-3',
        'text-sm text-fg outline-none select-none touch:text-md',
        'data-highlighted:bg-surface-sunken data-[state=checked]:font-semibold',
        'data-disabled:pointer-events-none data-disabled:text-fg-disabled',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span className="absolute end-2.5 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-4 text-accent-fg" aria-hidden="true" />
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
    <SelectPrimitive.Separator className={cn('mx-2 my-1.5 h-px bg-border', className)} {...props} />
  );
}
