'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Slot } from '@radix-ui/react-slot';
import {
  createContext,
  use,
  useId,
  useLayoutEffect,
  useState,
  type ComponentProps,
  type ComponentPropsWithoutRef,
  type JSX,
} from 'react';

import { cn } from '../../lib/cn';
import { useCoarseOverlay, usePortalContainer } from '../../lib/portal-container';
import { SheetContent } from '../sheet/sheet';

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
 *
 * ### Under a finger it is a sheet
 *
 * A panel pinned to a trigger halfway down a phone opens under the thumb and
 * half off the screen. Under a coarse pointer, or inside a subtree marked
 * `data-pointer="coarse"`, the same parts render as a bottom sheet: a Radix
 * dialog, so it takes a scrim, traps focus, and closes on a swipe down as well
 * as Escape. Nothing changes for the caller; the parts switch primitive
 * together. `sheetOnTouch={false}` keeps a panel anchored where its position
 * is the point: a combobox list under its input, a tour step.
 */

/**
 * Present while this popover renders as a sheet. A sheet has no title of its
 * own, so it is named by its trigger, which reports its id here.
 */
interface SheetMode {
  triggerId: string | undefined;
  setTriggerId: (id: string) => void;
}

const SheetModeContext = createContext<SheetMode | null>(null);

export interface PopoverProps extends ComponentPropsWithoutRef<typeof PopoverPrimitive.Root> {
  /**
   * Open as a bottom sheet under a finger. On by default; turn it off for a
   * panel that has to stay beside its anchor.
   */
  sheetOnTouch?: boolean;
}

export function Popover({ sheetOnTouch = true, modal, ...props }: PopoverProps): JSX.Element {
  const coarse = useCoarseOverlay();
  const [triggerId, setTriggerId] = useState<string>();

  if (sheetOnTouch && coarse) {
    return (
      <SheetModeContext value={{ triggerId, setTriggerId }}>
        <DialogPrimitive.Root {...props} />
      </SheetModeContext>
    );
  }
  // Reset, so an anchored popover opened inside a sheet does not take its own
  // parts for a sheet's.
  return (
    <SheetModeContext value={null}>
      <PopoverPrimitive.Root {...(modal === undefined ? {} : { modal })} {...props} />
    </SheetModeContext>
  );
}

export function PopoverTrigger(
  props: ComponentProps<typeof PopoverPrimitive.Trigger>,
): JSX.Element {
  const sheet = use(SheetModeContext);
  const fallbackId = useId();
  const id = props.id ?? fallbackId;
  const report = sheet?.setTriggerId;
  useLayoutEffect(() => {
    report?.(id);
  }, [report, id]);

  return sheet ? (
    <DialogPrimitive.Trigger id={id} {...props} />
  ) : (
    <PopoverPrimitive.Trigger {...props} />
  );
}

export function PopoverClose(props: ComponentProps<typeof PopoverPrimitive.Close>): JSX.Element {
  return use(SheetModeContext) ? (
    <DialogPrimitive.Close {...props} />
  ) : (
    <PopoverPrimitive.Close {...props} />
  );
}

/** A sheet has nothing to anchor to, so there the anchor is only its child. */
export function PopoverAnchor({
  asChild = false,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Anchor>): JSX.Element {
  if (!use(SheetModeContext)) return <PopoverPrimitive.Anchor asChild={asChild} {...props} />;
  return asChild ? <Slot {...props} /> : <div {...props} />;
}

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
  /**
   * Render into a portal at the end of `<body>`, which is the default. Off for
   * a panel that has to sit in the document where its trigger is — a nav
   * flyout, whose links should come next in Tab order rather than after the
   * whole page. Radix positions it `fixed` either way, so an `overflow` on an
   * ancestor does not clip it; a `transform` or `filter` on one would.
   */
  portal?: boolean;
}

export function PopoverContent({
  className,
  align = 'start',
  sideOffset = 6,
  collisionPadding = 12,
  arrow = false,
  matchTriggerWidth = false,
  portal = true,
  children,
  ...props
}: PopoverContentProps): JSX.Element {
  const sheet = use(SheetModeContext);
  const container = usePortalContainer();

  if (sheet) {
    const named = props['aria-label'] !== undefined || props['aria-labelledby'] !== undefined;
    return (
      <SheetContent
        side="auto"
        showCloseButton={false}
        // Named by what opened it: "Columns", "Start date".
        aria-labelledby={named ? undefined : sheet.triggerId}
        // Radix warns about a dialog with no description unless told there is none.
        aria-describedby={undefined}
        className={cn(
          'p-5 pt-3 text-base',
          className,
          // Whatever width the anchored panel asked for, a sheet spans the edge,
          // with the sheet's own gutters and room for the home indicator.
          'w-full max-w-none overflow-y-auto overscroll-contain touch:w-full',
          'touch:px-5 touch:pb-[max(1.25rem,var(--spacing-safe-bottom))]',
        )}
        {...withoutPlacement(props)}
      >
        {/* Radix checks that a title exists; the name comes from the trigger. */}
        <DialogPrimitive.Title asChild>
          <span hidden />
        </DialogPrimitive.Title>
        {children}
      </SheetContent>
    );
  }

  const content = (
    <PopoverPrimitive.Content
      align={align}
      sideOffset={sideOffset}
      // Without collision padding a popover opened near the bottom of a
      // phone viewport renders under the browser chrome, where it cannot be
      // scrolled to because it is in a portal.
      collisionPadding={collisionPadding}
      className={cn(
        // Raised and shadowed rather than outlined: elevation separates it
        // from the page, and a phone gets the rounder corner of its sheets.
        'z-50 rounded-md bg-surface-raised p-4 text-base text-fg shadow-lg touch:rounded-lg',
        // Never wider than the viewport, and never taller than the space
        // Radix measured for it. Both are custom properties the primitive
        // publishes, and both are the difference between a usable popover on
        // a 375px phone and one with its Save button off-screen.
        'max-w-[calc(100vw-1.5rem)]',
        matchTriggerWidth && 'w-(--radix-popover-trigger-width)',
        'max-h-(--radix-popover-content-available-height) overflow-y-auto overscroll-contain',
        'origin-(--radix-popover-content-transform-origin)',
        'popover-motion',
        className,
      )}
      {...props}
    >
      {children}
      {arrow ? (
        <PopoverPrimitive.Arrow
          // Continues the popover surface. See the note in `tooltip.tsx`.
          data-decorative
          className="fill-surface-raised"
          width={11}
          height={5}
        />
      ) : null}
    </PopoverPrimitive.Content>
  );
  return portal ? (
    <PopoverPrimitive.Portal container={container}>{content}</PopoverPrimitive.Portal>
  ) : (
    content
  );
}

type Placement =
  | 'side'
  | 'alignOffset'
  | 'avoidCollisions'
  | 'collisionBoundary'
  | 'arrowPadding'
  | 'sticky'
  | 'hideWhenDetached'
  | 'updatePositionStrategy';

/** Placement only an anchored panel understands, dropped before a sheet sees it. */
function withoutPlacement({
  side: _side,
  alignOffset: _alignOffset,
  avoidCollisions: _avoidCollisions,
  collisionBoundary: _collisionBoundary,
  arrowPadding: _arrowPadding,
  sticky: _sticky,
  hideWhenDetached: _hideWhenDetached,
  updatePositionStrategy: _updatePositionStrategy,
  ...rest
}: Omit<PopoverContentProps, 'align' | 'sideOffset' | 'collisionPadding' | 'arrow'>): Omit<
  PopoverContentProps,
  Placement | 'align' | 'sideOffset' | 'collisionPadding' | 'arrow'
> {
  return rest;
}
