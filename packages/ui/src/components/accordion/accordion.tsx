'use client';

import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDown } from 'lucide-react';
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * Progressive disclosure for a long form or a record with many sections.
 *
 * Worth being honest about the cost: content inside a collapsed panel is not
 * findable with the browser's own find-in-page, and on a screen the user has
 * to scan, three collapsed sections are slower than one long one. Use it when
 * the sections are genuinely independent, an employee's tax details versus
 * their bank details, not to make a long page look short.
 *
 * The collapse animates against `--radix-accordion-content-height`, which the
 * primitive measures for us. `height: auto` is not animatable, so a hand-rolled
 * version of this either jumps or hard-codes a height that is wrong.
 */

export type AccordionProps = ComponentPropsWithoutRef<typeof AccordionPrimitive.Root>;

export function Accordion({ className, ...props }: AccordionProps): JSX.Element {
  // `collapsible` only exists in `single` mode. In `multiple` mode Radix does
  // not recognise it and forwards it to the DOM, where React warns about a
  // non-boolean attribute, so it is dropped here rather than at every call
  // site that toggles `type` from a control.
  // Narrowing on `type` rather than widening the object: in the `multiple`
  // branch Radix's own props have no `collapsible`, so destructuring it out is
  // checked, where the old cast asserted a property onto a union that only one
  // of its members has.
  //
  // The types say a `multiple` accordion has no `collapsible` at all, so this
  // cannot be done by narrowing alone: the key that must be removed is one
  // TypeScript already believes is absent. Re-adding it and destructuring it
  // back out builds an object provably without the key, and does it without
  // asserting a shape onto the union.
  const forwarded = props.type === 'multiple' ? { ...props, collapsible: undefined } : props;

  return (
    <AccordionPrimitive.Root
      className={cn('divide-y divide-border rounded-lg border border-border bg-surface', className)}
      {...forwarded}
    />
  );
}

export function AccordionItem({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>): JSX.Element {
  return <AccordionPrimitive.Item className={cn('min-w-0', className)} {...props} />;
}

export interface AccordionTriggerProps extends ComponentPropsWithoutRef<
  typeof AccordionPrimitive.Trigger
> {
  /** Right-aligned summary that stays visible while the panel is closed. */
  meta?: ReactNode;
}

export function AccordionTrigger({
  className,
  children,
  meta,
  ...props
}: AccordionTriggerProps): JSX.Element {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        className={cn(
          'group flex min-h-tap flex-1 items-center gap-3 px-4 py-3 text-left text-base font-medium text-fg',
          'transition-colors duration-(--animate-duration-fast) hover:bg-surface-hover',
          'active:bg-surface-active',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
          className,
        )}
        {...props}
      >
        <span className="min-w-0 flex-1 truncate">{children}</span>
        {meta ? <span className="shrink-0 text-sm text-fg-muted">{meta}</span> : null}
        <ChevronDown
          aria-hidden
          className="size-4 shrink-0 text-fg-subtle transition-transform duration-(--animate-duration-normal) ease-standard group-data-[state=open]:rotate-180"
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

export function AccordionContent({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>): JSX.Element {
  return (
    <AccordionPrimitive.Content
      className={cn(
        'overflow-hidden text-base text-fg-muted',
        'data-[state=open]:animate-collapse-down data-[state=closed]:animate-collapse-up',
      )}
      {...props}
    >
      <div className={cn('px-4 pt-1 pb-4', className)}>{children}</div>
    </AccordionPrimitive.Content>
  );
}
