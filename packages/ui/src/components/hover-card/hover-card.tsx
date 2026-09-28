'use client';

import { Slot } from '@radix-ui/react-slot';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type JSX,
  type PointerEvent,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';
import { HOVER_CLOSE_MS, HOVER_OPEN_MS } from '../../lib/motion';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  type PopoverContentProps,
} from '../popover/popover';

/**
 * A peek at a person or record, from its name.
 *
 * Built on `Popover` rather than Radix `HoverCard`, which Reach does not
 * install. Radix's version is pointer-only by design and says its content is
 * for sighted mouse users; this one keeps that contract at a desk and adds the
 * two ways in that it lacks:
 *
 * - **Pointer.** Opens after `openDelay` (`HOVER_OPEN_MS`) resting on the trigger, and
 *   stays open while the pointer is on the card, so the gap between the two can
 *   be crossed. Leaving both closes it after `closeDelay`.
 * - **Keyboard focus.** Focusing the trigger opens the same peek, without
 *   taking focus from it. Escape closes it.
 * - **Long-press.** Under a finger there is no hover, so pressing and holding
 *   the trigger opens the card and moves focus into it, and the tap that would
 *   have followed does not also follow the link.
 *
 * The card is a preview. Everything in it has to be reachable another way,
 * usually on the page the trigger links to, because a keyboard user tabbing
 * past a name never enters the card.
 */

interface HoverCardControl {
  openSoon: () => void;
  closeSoon: () => void;
  hold: () => void;
  openNow: (takeFocus: boolean) => void;
  /** Whether the current open should move focus into the card. */
  takeFocus: () => boolean;
}

const HoverCardContext = createContext<HoverCardControl | null>(null);

function useControl(): HoverCardControl {
  const control = use(HoverCardContext);
  if (control === null) throw new Error('HoverCard parts must be inside <HoverCard>.');
  return control;
}

export interface HoverCardProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Milliseconds the pointer rests on the trigger before the card opens. */
  openDelay?: number;
  /** Milliseconds before the card closes once the pointer has left both. */
  closeDelay?: number;
  children?: ReactNode;
}

export function HoverCard({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  openDelay = HOVER_OPEN_MS,
  closeDelay = HOVER_CLOSE_MS,
  children,
}: HoverCardProps): JSX.Element {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const open = openProp ?? uncontrolled;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusOnOpen = useRef(false);

  const setOpen = useCallback(
    (next: boolean) => {
      setUncontrolled(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const hold = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => hold, [hold]);

  const control = useMemo<HoverCardControl>(
    () => ({
      openSoon: () => {
        hold();
        focusOnOpen.current = false;
        timer.current = setTimeout(() => {
          setOpen(true);
        }, openDelay);
      },
      closeSoon: () => {
        hold();
        timer.current = setTimeout(() => {
          setOpen(false);
        }, closeDelay);
      },
      hold,
      openNow: (takeFocus) => {
        hold();
        focusOnOpen.current = takeFocus;
        setOpen(true);
      },
      takeFocus: () => focusOnOpen.current,
    }),
    [hold, setOpen, openDelay, closeDelay],
  );

  return (
    <Popover
      // A preview beside what it previews; a sheet would cover the link.
      sheetOnTouch={false}
      open={open}
      onOpenChange={(next) => {
        hold();
        setOpen(next);
      }}
    >
      <HoverCardContext value={control}>{children}</HoverCardContext>
    </Popover>
  );
}

/** Whether a pointer event came from something that can hover. */
const mouse = (event: PointerEvent): boolean => event.pointerType !== 'touch';

/** How long a finger is held before it counts as a long-press, in milliseconds. */
const LONG_PRESS = 500;

export interface HoverCardTriggerProps extends ComponentPropsWithoutRef<'a'> {
  /**
   * Use the child element, such as a `Button` or a router link, as the
   * trigger instead of an `<a>`.
   */
  asChild?: boolean;
}

export function HoverCardTrigger({
  className,
  asChild = false,
  children,
  ...props
}: HoverCardTriggerProps): JSX.Element {
  const control = useControl();
  const Comp = asChild ? Slot : 'a';
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressed = useRef(false);

  const cancelPress = (): void => {
    if (press.current !== null) clearTimeout(press.current);
    press.current = null;
  };

  return (
    <PopoverAnchor asChild>
      <Comp
        // The trigger stays the caller's link: the card previews where the
        // name goes, it never replaces going there.
        className={cn('[-webkit-touch-callout:none]', className)}
        onPointerEnter={(event: PointerEvent) => {
          if (mouse(event)) control.openSoon();
        }}
        onPointerLeave={(event: PointerEvent) => {
          if (mouse(event)) control.closeSoon();
        }}
        onPointerDown={(event: PointerEvent) => {
          if (mouse(event)) return;
          pressed.current = false;
          cancelPress();
          press.current = setTimeout(() => {
            pressed.current = true;
            control.openNow(true);
          }, LONG_PRESS);
        }}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        onClick={(event) => {
          // The lift after a long-press is not a tap on the link.
          if (pressed.current) {
            event.preventDefault();
            pressed.current = false;
          }
        }}
        onContextMenu={(event) => {
          if (pressed.current) event.preventDefault();
        }}
        onFocus={control.openSoon}
        onBlur={control.closeSoon}
        {...props}
      >
        {children}
      </Comp>
    </PopoverAnchor>
  );
}

export function HoverCardContent({
  className,
  onOpenAutoFocus,
  ...props
}: PopoverContentProps): JSX.Element {
  const control = useControl();
  return (
    <PopoverContent
      align="start"
      className={cn('w-75 p-4', className)}
      onPointerEnter={control.hold}
      onPointerLeave={(event) => {
        if (event.pointerType !== 'touch') control.closeSoon();
      }}
      // Focus inside the card keeps it open; leaving it closes it, the same
      // as the pointer.
      onFocus={control.hold}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) control.closeSoon();
      }}
      onOpenAutoFocus={(event) => {
        onOpenAutoFocus?.(event);
        // A peek never takes focus from the trigger; a long-press does, since
        // the finger has left the trigger and the actions are what it wants.
        if (!control.takeFocus()) event.preventDefault();
      }}
      {...props}
    />
  );
}
