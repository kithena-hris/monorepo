'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { useCallback, useRef, type ComponentPropsWithoutRef, type JSX } from 'react';

import { cn } from '../../lib/cn';
import { useCoarsePointer, usePrefersReducedMotion } from '../../lib/use-media-query';
import { useDragDismiss, type DragAxis } from '../../lib/use-drag-dismiss';

/**
 * An edge-anchored panel: detail without losing the list behind it.
 *
 * This is the workhorse for record detail in an HRIS. A leave request opened
 * from a queue of forty belongs in a sheet, because the reviewer's context is
 * the queue, a route change loses their scroll position, their filters and
 * their place, and a centred modal covers the very row they are comparing
 * against.
 *
 * It is still modal (focus trapped, Escape closes), so it is the wrong choice
 * for anything the user needs to reference while working elsewhere.
 */

const sheet = cva(
  ['fixed z-50 flex flex-col border-border bg-surface shadow-xl', 'focus-visible:outline-none'],
  {
    variants: {
      side: {
        right:
          'inset-y-0 right-0 h-full w-full border-l pe-safe-right sm:max-w-md data-[state=open]:animate-slide-in-right data-[state=closed]:animate-slide-out-right',
        left: 'inset-y-0 left-0 h-full w-full border-r ps-safe-left sm:max-w-md data-[state=open]:animate-slide-in-left data-[state=closed]:animate-slide-out-left',
        bottom:
          'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl border-t pb-safe-bottom data-[state=open]:animate-slide-in-bottom data-[state=closed]:animate-slide-out-bottom',
        top: 'inset-x-0 top-0 max-h-[92dvh] rounded-b-2xl border-b pt-safe-top data-[state=open]:animate-slide-in-top data-[state=closed]:animate-slide-out-top',
      },
      size: {
        sm: '',
        md: '',
        lg: '',
        full: '',
      },
    },
    compoundVariants: [
      // Width applies to the vertical edges, height to the horizontal ones, so
      // one `size` prop cannot be a single class list.
      { side: ['left', 'right'], size: 'sm', class: 'sm:max-w-sm' },
      { side: ['left', 'right'], size: 'md', class: 'sm:max-w-md' },
      { side: ['left', 'right'], size: 'lg', class: 'sm:max-w-2xl' },
      { side: ['left', 'right'], size: 'full', class: 'sm:max-w-none' },
      { side: ['top', 'bottom'], size: 'sm', class: 'max-h-[40dvh]' },
      { side: ['top', 'bottom'], size: 'md', class: 'max-h-[65dvh]' },
      { side: ['top', 'bottom'], size: 'lg', class: 'max-h-[92dvh]' },
      { side: ['top', 'bottom'], size: 'full', class: 'h-dvh max-h-dvh' },
    ],
    defaultVariants: { side: 'right', size: 'md' },
  },
);

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export interface SheetContentProps
  extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, VariantProps<typeof sheet> {
  showCloseButton?: boolean;
  /**
   * Let the panel be dragged toward its own edge to dismiss.
   *
   * On by default for a coarse pointer and off for a mouse, which is not a
   * screen-size decision: a thumb has no Escape key and no close button within
   * reach at the top of a full-height panel, so the gesture is the primary way
   * out. A mouse has both, and a draggable panel under a cursor mostly means
   * text selection that starts dragging the sheet instead.
   *
   * Pass `false` to opt a panel out, for example one whose body scrolls
   * horizontally and would fight a left/right drag.
   */
  swipeToDismiss?: boolean;
}

/**
 * Which axis each anchoring maps to. A panel dismisses along the edge it came
 * from and no other: something that slid in from the right and leaves through
 * the bottom loses the user's model of where it went.
 */
const dragAxisForSide: Record<'right' | 'left' | 'bottom' | 'top', DragAxis> = {
  right: 'right',
  left: 'left',
  bottom: 'bottom',
  top: 'top',
};

export function SheetContent({
  className,
  children,
  side,
  size,
  showCloseButton = true,
  swipeToDismiss,
  ...props
}: SheetContentProps): JSX.Element {
  const resolvedSide = side ?? 'right';
  const coarse = useCoarsePointer();
  const reducedMotion = usePrefersReducedMotion();

  /*
   * Reduced motion disables the gesture rather than just shortening it. The
   * setting is about content moving across the visual field, and a panel
   * tracking a finger is the largest, most continuous movement in the system,
   * there is no gentler version of it, so the close button and Escape carry the
   * dismissal instead.
   */
  const dragEnabled = (swipeToDismiss ?? coarse) && !reducedMotion;

  /*
   * Radix owns open/closed. The gesture decides *that* the panel closes; Radix
   * still decides what closing involves, restoring focus to the trigger,
   * unlocking scroll, running the exit animation, firing `onOpenChange` for a
   * controlled consumer.
   *
   * Clicking a real (visually hidden) Close is how we ask. The alternative,
   * synthesising an Escape keydown, goes through a different code path than the
   * one we want: it would also dismiss any dialog this sheet is nested in, and a
   * consumer who passed `onEscapeKeyDown` to guard against losing a half-filled
   * form would have their guard silently swallow the swipe.
   */
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const requestClose = useCallback(() => {
    closeRef.current?.click();
  }, []);

  const drag = useDragDismiss({
    axis: dragAxisForSide[resolvedSide],
    enabled: dragEnabled,
    onDismiss: requestClose,
  });

  /*
   * A grab handle, but only on the horizontal edges. It is the affordance, the
   * thing that says this panel can be pulled, and the gesture is undiscoverable
   * without one.
   *
   * Left and right sheets deliberately get none. A vertical bar down the edge of
   * a full-height panel is the universal look of a resize handle, so drawing one
   * promises resizing and delivers dismissal.
   */
  const handle = dragEnabled && (resolvedSide === 'bottom' || resolvedSide === 'top');
  const grabHandle = (
    <div
      // Decorative. The gesture it advertises is an enhancement over the close
      // button and Escape, both of which remain, so there is nothing here for a
      // screen reader to act on.
      aria-hidden="true"
      className="grid h-6 shrink-0 cursor-grab place-items-center active:cursor-grabbing"
    >
      <div className="h-1 w-9 rounded-full bg-border-strong" />
    </div>
  );

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
        ref={dragEnabled ? drag.ref : undefined}
        data-scroll-lock
        data-dragging={drag.dataDragging}
        className={cn(
          sheet({ side, size }),
          /*
           * While a finger is down the panel's transform is written every frame
           * from the gesture. Any CSS transition or keyframe on `transform`
           * would be interpolating toward a target that has already moved, so
           * the panel lags the finger by the transition duration. Both have to
           * stand down for the duration of the drag.
           */
          dragEnabled && 'data-[dragging]:transition-none data-[dragging]:animate-none',
          // Announce the axis so a drag never turns into a browser scroll
          // gesture halfway through. Without this the panel and the page fight
          // over the same finger.
          dragEnabled &&
            (resolvedSide === 'bottom' || resolvedSide === 'top' ? 'touch-pan-x' : 'touch-pan-y'),
          className,
        )}
        {...props}
      >
        {/* Bottom sheet: the handle is the first thing, at the edge nearest the
            thumb. In flow rather than absolutely positioned, so it takes its own
            height and the header below it starts underneath, an absolute handle
            sits on top of the sheet's title. */}
        {handle && resolvedSide === 'bottom' ? grabHandle : null}
        {children}
        {/* Top sheet: same affordance, at that panel's own free edge, which is
            the bottom one. Last in flow for the same reason. */}
        {handle && resolvedSide === 'top' ? grabHandle : null}
        {/*
         * The gesture's handle on Radix. Kept mounted independently of
         * `showCloseButton`, because a panel can legitimately have no visible
         * close, a wizard step, say, and still be swipeable; the swipe would
         * otherwise have nothing to click. `aria-hidden` and `tabIndex={-1}`
         * because it is not a control anyone should reach: the visible close
         * below and Escape are the accessible routes out, and a screen reader
         * announcing two identical close buttons is a worse experience than
         * announcing one.
         */}
        {dragEnabled ? (
          <DialogPrimitive.Close
            ref={closeRef}
            aria-hidden="true"
            tabIndex={-1}
            className="sr-only"
          />
        ) : null}
        {showCloseButton ? (
          <DialogPrimitive.Close
            className={cn(
              'absolute top-4 right-4 grid size-8 place-items-center rounded-sm text-fg-subtle',
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

export function SheetHeader({ className, ...props }: ComponentPropsWithoutRef<'div'>): JSX.Element {
  return (
    <div
      className={cn(
        'shrink-0 space-y-1 border-b border-border px-5 py-4 pr-14 pt-safe-top',
        className,
      )}
      {...props}
    />
  );
}

export function SheetTitle({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Title>): JSX.Element {
  return (
    <DialogPrimitive.Title className={cn('text-lg font-semibold text-fg', className)} {...props} />
  );
}

export function SheetDescription({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Description>): JSX.Element {
  return (
    <DialogPrimitive.Description className={cn('text-sm text-fg-muted', className)} {...props} />
  );
}

export function SheetBody({ className, ...props }: ComponentPropsWithoutRef<'div'>): JSX.Element {
  return (
    <div
      className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4', className)}
      {...props}
    />
  );
}

/**
 * Sticky action bar. It sits inside the panel rather than after it so it stays
 * visible while the body scrolls, on a phone, an approve button that requires
 * scrolling a 40-field form to reach is a button that gets missed.
 */
export function SheetFooter({ className, ...props }: ComponentPropsWithoutRef<'div'>): JSX.Element {
  return (
    <div
      className={cn(
        'flex shrink-0 flex-col-reverse gap-2 border-t border-border bg-surface px-5 py-3',
        'sm:flex-row sm:justify-end',
        '[&>*]:w-full sm:[&>*]:w-auto',
        className,
      )}
      {...props}
    />
  );
}
