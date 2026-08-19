'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { ArrowLeft, X } from 'lucide-react';
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * A whole page, presented over the one behind it.
 *
 * The shape every product eventually needs and few build deliberately: an
 * editor, an onboarding flow, a document viewer: something that deserves the
 * full screen and a URL, but that the user is *inside* rather than having
 * navigated to. Closing it should return them to exactly where they were, with
 * their filters and scroll position intact.
 *
 * ### Why this is a dialog and not a route
 *
 * It is both, in a real app: the route is what makes it linkable and
 * survivable across a refresh, and the dialog semantics are what make it
 * behave. The component supplies the second half.
 *
 * - focus is trapped, so Tab cannot wander into the page underneath;
 * - the page underneath is `aria-hidden`, so a screen reader does not read
 *   two pages at once;
 * - Escape closes, and focus returns to whatever opened it;
 * - the body does not scroll behind it.
 *
 * A route-as-modal without those four is a full-screen div that a keyboard
 * user can tab straight out of and a screen-reader user never learns they are
 * in.
 *
 * ### Against `Dialog` and `Sheet`
 *
 * | | Use for |
 * | --- | --- |
 * | `Dialog` | A decision or a short form. Sized to its content. |
 * | `Sheet` | Detail beside a list you want to keep seeing. |
 * | `ModalPage` | A task with its own header, its own scroll and its own actions. Fills the screen. |
 */

const surface = cva(
  [
    'fixed z-50 flex flex-col overflow-hidden bg-canvas focus-visible:outline-none',
    'data-[state=open]:animate-slide-in-bottom data-[state=closed]:animate-slide-out-bottom',
  ],
  {
    variants: {
      size: {
        /** Edge to edge at every width. Editors, viewers, wizards. */
        full: 'inset-0',
        /** Full on a phone; an inset card with a visible page behind it from `md`. */
        inset:
          'inset-0 md:inset-6 md:rounded-xl md:border md:border-border md:shadow-xl xl:inset-x-[max(1.5rem,calc((100vw-84rem)/2))]',
        /** Full on a phone; a tall centred column from `md`. Forms and flows. */
        column:
          'inset-0 md:inset-y-8 md:left-1/2 md:w-full md:max-w-3xl md:-translate-x-1/2 md:rounded-xl md:border md:border-border md:shadow-xl',
      },
    },
    defaultVariants: { size: 'full' },
  },
);

export const ModalPage = DialogPrimitive.Root;
export const ModalPageTrigger = DialogPrimitive.Trigger;
export const ModalPageClose = DialogPrimitive.Close;

export interface ModalPageContentProps
  extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, VariantProps<typeof surface> {}

export function ModalPageContent({
  className,
  size,
  children,
  ...props
}: ModalPageContentProps): JSX.Element {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-material="scrim"
        className={cn(
          'fixed inset-0 z-50 bg-overlay',
          'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out',
        )}
      />
      <DialogPrimitive.Content
        data-scroll-lock
        className={cn(surface({ size }), className)}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export interface ModalPageHeaderProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  /** Status badges, a save indicator, a step counter. */
  meta?: ReactNode;
  /** Actions at the trailing edge. Keep it to two; the primary one belongs in the footer on a phone. */
  actions?: ReactNode;
  /**
   * `close` renders an ✕, `back` renders a labelled ← for a flow the user is
   * stepping through. Pick by what the control actually does: ✕ discards, ←
   * goes up a level.
   */
  dismiss?: 'close' | 'back' | 'none';
  dismissLabel?: string;
}

export function ModalPageHeader({
  className,
  title,
  description,
  meta,
  actions,
  dismiss = 'close',
  dismissLabel,
  ...props
}: ModalPageHeaderProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-3 border-b border-border bg-surface px-3 py-2.5 pt-safe-top sm:px-4',
        className,
      )}
      {...props}
    >
      {dismiss !== 'none' ? (
        <DialogPrimitive.Close
          className={cn(
            'inline-flex min-h-tap shrink-0 items-center gap-1.5 rounded-md px-2 text-sm text-fg-muted',
            'transition-colors hover:bg-surface-hover hover:text-fg',
            'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
          )}
        >
          {dismiss === 'back' ? (
            <>
              <ArrowLeft className="size-4" aria-hidden />
              <span className="max-sm:sr-only">{dismissLabel ?? 'Back'}</span>
            </>
          ) : (
            <>
              <X className="size-4" aria-hidden />
              <span className="sr-only">{dismissLabel ?? 'Close'}</span>
            </>
          )}
        </DialogPrimitive.Close>
      ) : null}

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <DialogPrimitive.Title className="truncate text-base font-semibold text-fg">
            {title}
          </DialogPrimitive.Title>
          {meta}
        </div>
        {description ? (
          <DialogPrimitive.Description className="truncate text-xs text-fg-muted">
            {description}
          </DialogPrimitive.Description>
        ) : (
          // Radix warns when a dialog has no description, and the warning is
          // right: something has to describe the surface. When there is no
          // visible subtitle the title carries it alone, declared explicitly.
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        )}
      </div>

      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** The one scroll container. Page padding belongs here. */
export function ModalPageBody({
  className,
  ...props
}: ComponentPropsWithoutRef<'div'>): JSX.Element {
  return (
    <div
      className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain', className)}
      {...props}
    />
  );
}

/**
 * Sticky action bar. Reversed on a phone so the confirming action sits under
 * the thumb, and padded for the home indicator.
 */
export function ModalPageFooter({
  className,
  ...props
}: ComponentPropsWithoutRef<'div'>): JSX.Element {
  return (
    <div
      className={cn(
        'flex shrink-0 flex-col-reverse gap-2 border-t border-border bg-surface px-4 py-3 pb-safe-bottom',
        'sm:flex-row sm:items-center sm:justify-end',
        '[&>*]:w-full sm:[&>*]:w-auto',
        className,
      )}
      {...props}
    />
  );
}
