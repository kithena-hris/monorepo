'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';

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
  side?: ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>['side'];
  align?: ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>['align'];
  children: ReactNode;
}

export function Tooltip({
  content,
  side = 'top',
  align = 'center',
  children,
  ...props
}: TooltipProps): JSX.Element {
  return (
    <TooltipPrimitive.Root {...props}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          className={cn(
            'z-50 max-w-xs rounded-sm bg-fg px-2 py-1 text-xs text-canvas shadow-md',
            'data-[state=delayed-open]:animate-scale-in data-[state=instant-open]:animate-fade-in',
            'data-[state=closed]:animate-fade-out',
            'origin-(--radix-tooltip-content-transform-origin)',
          )}
        >
          {content}
          <TooltipPrimitive.Arrow
            // The tail is the bubble, drawn a few pixels further down. It shares
            // the bubble's fill by design, so a contrast check that treats it as
            // an icon reads 1:1 and is asking the wrong question: what has to be
            // visible here is the bubble against the page, not the tail against
            // the bubble.
            data-decorative
            className="fill-fg"
            width={10}
            height={5}
          />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
