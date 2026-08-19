'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentPropsWithoutRef, JSX } from 'react';

import { cn } from '../../lib/cn';

/**
 * Modal dialog.
 *
 * Focus is trapped, the page behind is inert, and Escape closes. All three are
 * required for a modal to be a modal; the primitive provides them, so this
 * layer is presentation only.
 *
 * Modals interrupt. Use one for a decision that blocks the task, not to show
 * detail that a panel or a route could carry.
 */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
}): JSX.Element {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-material="scrim"
        className={cn(
          'fixed inset-0 z-50 bg-overlay backdrop-blur-[2px]',
          'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out',
        )}
      />
      <DialogPrimitive.Content
        data-scroll-lock
        className={cn(
          'fixed z-50 flex flex-col border border-border bg-surface shadow-xl',
          'focus-visible:outline-none',
          // Below `sm` this is a bottom sheet, not a shrunken dialog. A centred
          // modal on a 375px screen puts its actions under the thumb's blind
          // spot and its close button at the top-left corner, the hardest point
          // on the device to reach one-handed.
          //
          // `dvh`, not `vh`: mobile Safari's `vh` is the height with the URL bar
          // hidden, so a `90vh` sheet is taller than the visible page until the
          // user scrolls.
          'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl border-b-0 pb-safe-bottom',
          'data-[state=open]:animate-slide-in-bottom data-[state=closed]:animate-slide-out-bottom',
          'sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:w-full sm:max-w-lg',
          'sm:max-h-[85dvh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border-b sm:pb-0',
          'sm:data-[state=open]:animate-scale-in sm:data-[state=closed]:animate-scale-out',
          className,
        )}
        {...props}
      >
        {/* Grabber. Purely a signifier that the surface came from the bottom
            edge, it is decorative, and the sheet is dismissed by the close
            button, Escape or the overlay, all of which work without a gesture. */}
        <div
          aria-hidden
          className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border-strong sm:hidden"
        />
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            className={cn(
              'absolute top-4 right-4 grid size-7 place-items-center rounded-sm text-fg-subtle',
              'transition-colors hover:bg-surface-hover hover:text-fg',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
            )}
          >
            <X className="size-4" aria-hidden="true" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({
  className,
  ...props
}: ComponentPropsWithoutRef<'div'>): JSX.Element {
  return (
    <div
      className={cn('shrink-0 space-y-1.5 px-5 pt-5 pr-14 pb-4 sm:px-6 sm:pt-6', className)}
      {...props}
    />
  );
}

export function DialogTitle({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Title>): JSX.Element {
  return (
    <DialogPrimitive.Title
      className={cn('text-lg leading-none font-semibold text-fg', className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Description>): JSX.Element {
  return (
    <DialogPrimitive.Description className={cn('text-sm text-fg-muted', className)} {...props} />
  );
}

export function DialogBody({ className, ...props }: ComponentPropsWithoutRef<'div'>): JSX.Element {
  // `min-h-0` is what makes the flex child actually scroll: a flex item's
  // default minimum is its content, so without it the body pushes the sheet
  // past the viewport instead of overflowing inside it.
  return (
    <div
      className={cn(
        'min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-2 sm:px-6',
        className,
      )}
      {...props}
    />
  );
}

export function DialogFooter({
  className,
  ...props
}: ComponentPropsWithoutRef<'div'>): JSX.Element {
  return (
    <div
      // Reversed on a phone so the confirming action sits at the bottom, under
      // the thumb, and full width so it is not a 90px target on a 430px screen.
      className={cn(
        'flex shrink-0 flex-col-reverse gap-2 px-5 py-4 sm:flex-row sm:justify-end sm:px-6',
        '[&>*]:w-full sm:[&>*]:w-auto',
        className,
      )}
      {...props}
    />
  );
}
