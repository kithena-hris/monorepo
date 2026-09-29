'use client';

import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDown, Lock } from 'lucide-react';
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
      className={cn(
        'divide-y divide-border overflow-hidden rounded-[1.125rem] bg-surface shadow-sm',
        'touch:rounded-[1.375rem]',
        className,
      )}
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
  /** A second line under the title, for what the section holds. */
  description?: ReactNode;
  /** A leading glyph. Decorative; the title names the section. */
  icon?: ReactNode;
  /**
   * The heading level the trigger sits in. Each header is a real heading, so
   * a screen reader can jump between sections; `3` suits an accordion under a
   * section title, `2` one directly under the page's `h1`. A level that skips
   * one breaks the outline that jump relies on.
   */
  level?: 2 | 3 | 4 | 5 | 6;
}

export function AccordionTrigger({
  className,
  children,
  meta,
  description,
  icon,
  level = 3,
  ...props
}: AccordionTriggerProps): JSX.Element {
  const Heading = `h${String(level)}` as 'h3';
  return (
    <AccordionPrimitive.Header asChild>
      <Heading className="flex">
        <AccordionPrimitive.Trigger
          className={cn(
            'group flex min-h-14 flex-1 items-center gap-3 px-5 py-3 text-left text-base font-semibold text-fg',
            'touch:min-h-15 touch:px-4',
            'transition-colors duration-(--animate-duration-fast) hover:bg-surface-hover',
            'active:bg-surface-active',
            'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
            'data-disabled:text-fg-disabled data-disabled:hover:bg-transparent',
            className,
          )}
          {...props}
        >
          {icon ? (
            <span aria-hidden className="shrink-0 text-fg-muted [&_svg]:size-[1.125rem]">
              {icon}
            </span>
          ) : null}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate">{children}</span>
            {description ? (
              <span className="truncate text-sm font-normal text-fg-muted">{description}</span>
            ) : null}
          </span>
          {meta ? <span className="shrink-0 text-sm font-normal text-fg-muted">{meta}</span> : null}
          <ChevronDown
            aria-hidden
            className="size-[1.125rem] shrink-0 text-fg-muted transition-transform duration-(--animate-duration-normal) ease-standard group-data-disabled:hidden group-data-[state=open]:rotate-180"
          />
          {/* A locked section says so, rather than showing a chevron that
              does nothing. The reason belongs in `description`. */}
          <Lock
            aria-hidden
            className="hidden size-4 shrink-0 text-fg-subtle group-data-disabled:block"
          />
        </AccordionPrimitive.Trigger>
      </Heading>
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
        'overflow-hidden text-[0.875rem] leading-relaxed text-fg-muted touch:text-[1rem]',
        'data-[state=open]:animate-collapse-down data-[state=closed]:animate-collapse-up',
      )}
      {...props}
    >
      <div className={cn('px-5 pb-4.5 touch:px-4', className)}>{children}</div>
    </AccordionPrimitive.Content>
  );
}
