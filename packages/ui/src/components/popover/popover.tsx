'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';
import type { ComponentPropsWithoutRef, JSX } from 'react';

import { cn } from '../../lib/cn';

/**
 * A non-modal surface anchored to a trigger.
 *
 * The distinction that decides which of the three to reach for:
 *
 * | Use | When |
 * | --- | --- |
 * | `Tooltip` | A label. No interactive content, ever. It is not focusable. |
 * | `Popover` | A small piece of interactive UI: a filter editor, a date picker. Dismissed by clicking away. The page stays usable. |
 * | `Dialog` | Something the user must resolve before continuing. Traps focus and blocks the page. |
 *
 * A popover holding a form with a Save button that changes a record is a
 * dialog wearing the wrong clothes.
 */

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export interface PopoverContentProps extends ComponentPropsWithoutRef<
  typeof PopoverPrimitive.Content
> {
  /** Draws the little tail pointing at the trigger. */
  arrow?: boolean;
  /**
   * Lock the panel to the trigger's width. Right for a combobox list, where a
   * panel wider than its input reads as a different control; wrong for a
   * filter editor, which needs the room.
   */
  matchTriggerWidth?: boolean;
}

export function PopoverContent({
  className,
  align = 'start',
  sideOffset = 6,
  collisionPadding = 12,
  arrow = false,
  matchTriggerWidth = false,
  children,
  ...props
}: PopoverContentProps): JSX.Element {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        // Without collision padding a popover opened near the bottom of a
        // phone viewport renders under the browser chrome, where it cannot be
        // scrolled to because it is in a portal.
        collisionPadding={collisionPadding}
        className={cn(
          'z-50 rounded-lg border border-border bg-surface p-3 text-base text-fg shadow-lg',
          // Never wider than the viewport, and never taller than the space
          // Radix measured for it. Both are custom properties the primitive
          // publishes, and both are the difference between a usable popover on
          // a 375px phone and one with its Save button off-screen.
          'max-w-[calc(100vw-1.5rem)]',
          matchTriggerWidth && 'w-(--radix-popover-trigger-width)',
          'max-h-(--radix-popover-content-available-height) overflow-y-auto overscroll-contain',
          'origin-(--radix-popover-content-transform-origin)',
          'data-[state=open]:animate-scale-in data-[state=closed]:animate-scale-out',
          className,
        )}
        {...props}
      >
        {children}
        {arrow ? (
          <PopoverPrimitive.Arrow
            // Continues the popover surface. See the note in `tooltip.tsx`.
            data-decorative
            className="fill-surface stroke-border"
            width={11}
            height={5}
          />
        ) : null}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}
