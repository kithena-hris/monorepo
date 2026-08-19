'use client';

import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import type { ComponentPropsWithoutRef, JSX } from 'react';

import { cn } from '../../lib/cn';

/**
 * A scroll container with a consistent scrollbar across platforms.
 *
 * macOS hides overlay scrollbars until you scroll, which on a desktop means a
 * scrollable panel gives no hint that it scrolls at all. This renders one that
 * is always sized and only fades, so the affordance survives.
 *
 * It does *not* replace native scrolling: the viewport is a real scroll
 * container, so momentum, rubber-banding, keyboard paging and screen-reader
 * scroll-into-view all behave normally. `overscroll-contain` stops a flick
 * inside the panel from scrolling the page behind it.
 */

export interface ScrollAreaProps extends ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> {
  orientation?: 'vertical' | 'horizontal' | 'both';
  /** Viewport class: put the height here (`h-72`, `max-h-[60dvh]`). */
  viewportClassName?: string;
}

export function ScrollArea({
  className,
  viewportClassName,
  orientation = 'vertical',
  children,
  ...props
}: ScrollAreaProps): JSX.Element {
  return (
    <ScrollAreaPrimitive.Root
      // `scrollHideDelay` at 600ms: long enough that the bar is still visible
      // when the flick ends, short enough that it does not linger.
      scrollHideDelay={600}
      className={cn('relative overflow-hidden', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-scroll-lock
        className={cn('size-full overscroll-contain rounded-[inherit]', viewportClassName)}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {orientation !== 'horizontal' ? <ScrollBar orientation="vertical" /> : null}
      {orientation !== 'vertical' ? <ScrollBar orientation="horizontal" /> : null}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

export function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>): JSX.Element {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      orientation={orientation}
      className={cn(
        'flex touch-none p-0.5 transition-opacity duration-(--animate-duration-normal) select-none',
        orientation === 'vertical' && 'h-full w-2.5 border-l border-l-transparent',
        orientation === 'horizontal' && 'h-2.5 flex-col border-t border-t-transparent',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border-strong hover:bg-fg-subtle" />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}
