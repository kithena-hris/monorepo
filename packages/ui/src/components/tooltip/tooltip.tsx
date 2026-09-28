'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { usePortalContainer } from '../../lib/portal-container';

/**
 * Supplementary hint.
 *
 * A tooltip is never the only place information lives: it does not appear on
 * touch, and it disappears the moment the pointer leaves. Never put a validation
 * message, a price, or the meaning of an icon-only control in one, for the last
 * case, give the control an `aria-label` too.
 */
export const TooltipProvider = TooltipPrimitive.Provider;

export interface TooltipProps extends Pick<
  ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>,
  'open' | 'onOpenChange' | 'delayDuration'
> {
  content: ReactNode;
  /**
   * A keyboard shortcut, on a second line under the name: `<Kbd>G</Kbd>
   * <Kbd>N</Kbd>`. Keys inside it are redrawn for the inverted surface.
   */
  shortcut?: ReactNode;
  side?: ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>['side'];
  align?: ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>['align'];
  children: ReactNode;
}

export function Tooltip({
  content,
  shortcut,
  side = 'top',
  align = 'center',
  children,
  ...props
}: TooltipProps): JSX.Element {
  return (
    <TooltipPrimitive.Root {...props}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal container={usePortalContainer()}>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          className={cn(
            // The design's tooltip is the inverted surface: the one colour that
            // reads as "not part of the page" in both themes.
            // 13px on every pointer: a tooltip only ever appears under a mouse.
            'z-50 flex max-w-60 flex-col gap-0.5 rounded-[0.5rem] bg-invert px-2.5 py-1.5',
            'text-[0.8125rem]/[1.35] font-medium text-fg-on-invert shadow-md',
            'data-[state=delayed-open]:animate-scale-in data-[state=instant-open]:animate-fade-in',
            'data-[state=closed]:animate-fade-out',
            'origin-(--radix-tooltip-content-transform-origin)',
          )}
        >
          <span>{content}</span>
          {shortcut === undefined ? null : (
            <span
              className={cn(
                'flex gap-1 opacity-75',
                '[&_kbd]:border-fg-on-invert/30 [&_kbd]:bg-transparent [&_kbd]:text-fg-on-invert [&_kbd]:shadow-none',
              )}
            >
              {shortcut}
            </span>
          )}
          <TooltipPrimitive.Arrow
            // The tail is the bubble, drawn a few pixels further down. It shares
            // the bubble's fill by design, so a contrast check that treats it as
            // an icon reads 1:1 and is asking the wrong question: what has to be
            // visible here is the bubble against the page, not the tail against
            // the bubble.
            data-decorative
            className="fill-invert"
            width={10}
            height={5}
          />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
