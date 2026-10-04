'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import {
  useSyncExternalStore,
  type ComponentPropsWithoutRef,
  type JSX,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';
import { usePortalContainer } from '../../lib/portal-container';

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
  sheetOnTouch = true,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  /**
   * Under a finger, rise as a bottom sheet (the default). `false` keeps it a
   * centred dialog there too: for a short, focused task (a few fields, one
   * outcome) whose whole form fits on screen, where a sheet would cover the
   * page for no reason. A long or scrolling editor stays a sheet.
   */
  sheetOnTouch?: boolean;
}): JSX.Element {
  return (
    <InPortal container={usePortalContainer()}>
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
          'fixed z-50 flex flex-col bg-surface-raised text-fg shadow-xl',
          'focus-visible:outline-none',
          // At a desk, centred, with a margin kept to the window edge however
          // narrow the window gets.
          'top-1/2 left-1/2 max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2',
          'rounded-[1.5rem]',
          'data-[state=open]:animate-scale-in data-[state=closed]:animate-scale-out',
          // Under a finger it is a bottom sheet, not a shrunken dialog. A centred
          // modal puts its actions out of the thumb's reach and its close button
          // in the corner hardest to reach one-handed. This follows the pointer,
          // not the window width: a tablet is held the same way a phone is.
          //
          // `dvh`, not `vh`: mobile Safari's `vh` is the height with the URL bar
          // hidden, so a `90vh` sheet is taller than the visible page until the
          // user scrolls.
          sheetOnTouch
            ? [
                'touch:inset-x-2 touch:top-auto touch:bottom-[max(0.5rem,var(--spacing-safe-bottom))]',
                'touch:max-h-[92dvh] touch:w-auto touch:max-w-none touch:translate-x-0 touch:translate-y-0',
                'touch:rounded-[2.25rem]',
                'touch:data-[state=open]:animate-slide-in-bottom touch:data-[state=closed]:animate-slide-out-bottom',
              ]
            : // Centred under a finger too, a 16px gutter each side.
              'touch:rounded-[1.75rem] touch:max-h-[85dvh] touch:max-w-none',
          className,
        )}
        {...props}
      >
        {/* Grabber. Purely a signifier that the surface came from the bottom
            edge, it is decorative, and the sheet is dismissed by the close
            button, Escape or the overlay, all of which work without a gesture. */}
        {sheetOnTouch ? (
          <div
            aria-hidden
            className="mx-auto mt-2 hidden h-[5px] w-9 shrink-0 rounded-full bg-border-strong touch:block"
          />
        ) : null}
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            className={cn(
              'absolute top-4 right-4 grid size-8 place-items-center rounded-full text-fg-muted tap-target',
              'transition-colors hover:bg-surface-sunken hover:text-fg touch:bg-surface-sunken',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
            )}
          >
            <X className="size-4" aria-hidden="true" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </InPortal>
  );
}

const subscribeNever = (): (() => void) => () => undefined;

/**
 * The portal, once the page is live. A dialog open in the server's HTML (one
 * the address asked for) has no `document` to portal into there, and a portal
 * draws nothing until it mounts; so on the server and while hydrating it is
 * drawn where it sits — fixed, so in the same place — and moves into the
 * portal right after. The first HTML already shows it open.
 */
function InPortal({
  container,
  children,
}: {
  readonly container: HTMLElement | null | undefined;
  readonly children: ReactNode;
}): JSX.Element {
  const live = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  return live ? (
    <DialogPrimitive.Portal container={container}>{children}</DialogPrimitive.Portal>
  ) : (
    <>{children}</>
  );
}

export function DialogHeader({
  className,
  ...props
}: ComponentPropsWithoutRef<'div'>): JSX.Element {
  return (
    <div
      className={cn(
        'shrink-0 space-y-1.5 px-6 pt-6 pr-14 pb-4 touch:px-5.5 touch:pt-4 touch:pr-14',
        className,
      )}
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
      className={cn(
        'font-display text-lg leading-tight font-bold tracking-tight text-fg',
        'touch:text-[1.125rem] touch:font-semibold',
        className,
      )}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Description>): JSX.Element {
  return (
    <DialogPrimitive.Description
      className={cn('text-[0.875rem] leading-normal text-fg-muted touch:text-sm', className)}
      {...props}
    />
  );
}

export function DialogBody({ className, ...props }: ComponentPropsWithoutRef<'div'>): JSX.Element {
  // `min-h-0` is what makes the flex child actually scroll: a flex item's
  // default minimum is its content, so without it the body pushes the sheet
  // past the viewport instead of overflowing inside it.
  return (
    <div
      className={cn(
        'min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-2 touch:px-5.5',
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
      // Under a finger the actions share the row equally, so neither is a 90px
      // target on a 400px sheet, and wrap to a second row rather than squeeze
      // a long label. The confirming action stays last, on the thumb's side.
      className={cn(
        'flex shrink-0 flex-wrap justify-end gap-2 px-6 pt-2 pb-6',
        'touch:px-5.5 touch:pb-5.5 touch:[&>*]:flex-[1_1_8rem]',
        className,
      )}
      {...props}
    />
  );
}
