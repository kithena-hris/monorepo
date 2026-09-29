'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { ArrowLeft, X } from 'lucide-react';
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { usePortalContainer } from '../../lib/portal-container';

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

/*
 * The sizes step up on the width of what the page is presented *in*, not on
 * the window's. The content sits inside the overlay, and the overlay, which
 * always covers exactly that space, is the query container: in an app that is
 * the viewport, in a phone preview on a wide monitor it is the phone, and the
 * phone gets the phone's edge-to-edge page. `@3xl` is 48rem, `@7xl` 80rem.
 */

/**
 * `small` and `medium`: edge to edge until the space is 40rem wide, then a
 * card in the middle, sized to its content and never taller than the space.
 * Below 40rem a centred card would be a full-screen page with a margin
 * nobody can use, so it is simply the full-screen page.
 */
const centred = [
  'inset-0 @[40rem]:inset-auto @[40rem]:top-1/2 @[40rem]:left-1/2 @[40rem]:-translate-1/2',
  '@[40rem]:max-h-[calc(100%-4rem)] @[40rem]:rounded-xl @[40rem]:shadow-xl',
];

const surface = cva(
  [
    '@container fixed z-50 flex flex-col overflow-hidden bg-canvas focus-visible:outline-none',
    'data-[state=open]:animate-slide-in-bottom data-[state=closed]:animate-slide-out-bottom',
  ],
  {
    variants: {
      size: {
        /** Edge to edge at every width. Editors, viewers, wizards. */
        full: 'inset-0',
        /** Full on a phone; an inset card with a visible page behind it from `md`. */
        inset:
          'inset-0 @3xl:inset-6 @3xl:rounded-xl @3xl:shadow-xl @7xl:inset-x-[max(1.5rem,calc((100cqw-84rem)/2))]',
        /** Full on a phone; a tall centred column from `md`. Forms and flows. */
        column:
          'inset-0 @3xl:inset-y-8 @3xl:left-1/2 @3xl:w-full @3xl:max-w-3xl @3xl:-translate-x-1/2 @3xl:rounded-xl @3xl:shadow-xl',
        /**
         * Full on a phone; from 40rem a centred card 420px wide, as tall as its
         * content. A short task: a rename, one question with a form in it.
         */
        small: [centred, '@[40rem]:w-[26.25rem]'],
        /** As `small`, 640px wide. A task with a few sections. */
        medium: [centred, '@[40rem]:w-[min(40rem,calc(100%-3rem))]'],
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
    <DialogPrimitive.Portal container={usePortalContainer()}>
      {/* The content inside the overlay, Radix's own "scrollable overlay"
          arrangement, so the overlay can be the container the sizes query. */}
      <DialogPrimitive.Overlay
        data-material="scrim"
        className={cn(
          '@container fixed inset-0 z-50 bg-overlay',
          'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out',
        )}
      >
        <DialogPrimitive.Content
          data-scroll-lock
          className={cn(surface({ size }), className)}
          {...props}
        >
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Overlay>
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
        'flex shrink-0 items-center gap-3 border-b border-border bg-surface px-4 py-2.5 pt-safe-top touch:px-3',
        className,
      )}
      {...props}
    >
      {dismiss !== 'none' ? (
        <DialogPrimitive.Close
          className={cn(
            // A pill on a fill, the shape of every other control, rather than
            // a bare glyph that has to be hovered to show it is pressable.
            'inline-flex min-h-control-sm min-w-control-sm shrink-0 items-center justify-center gap-1.5 rounded-control bg-surface-sunken px-2 text-sm font-semibold text-fg',
            'transition-colors hover:bg-surface-hover touch:min-h-tap touch:min-w-tap',
            'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
          )}
        >
          {dismiss === 'back' ? (
            <>
              <ArrowLeft className="size-4" aria-hidden />
              <span className="pe-1 @max-xl:sr-only">{dismissLabel ?? 'Back'}</span>
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
          <DialogPrimitive.Title className="truncate text-md font-semibold text-fg">
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
        '@2xl:flex-row @2xl:items-center @2xl:justify-end',
        '[&>*]:w-full @2xl:[&>*]:w-auto',
        className,
      )}
      {...props}
    />
  );
}
