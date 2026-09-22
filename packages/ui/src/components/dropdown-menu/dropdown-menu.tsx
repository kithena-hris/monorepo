'use client';

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type JSX,
} from 'react';

import { cn } from '../../lib/cn';

/**
 * Action menu.
 *
 * A menu holds commands. If the items set a value. That is a Select, and the
 * difference is not cosmetic, the two have different keyboard contracts and
 * announce differently.
 */
/**
 * Hover handlers, shared with the trigger and the content.
 *
 * A context rather than props threaded through, because the two halves are
 * rendered by the caller and the gap between them is exactly where a naive
 * implementation closes the menu as the pointer crosses it.
 */
interface HoverState {
  readonly enabled: boolean;
  readonly open: () => void;
  readonly close: () => void;
  readonly hold: () => void;
  /**
   * Whether the pointer is what opened this, rather than a click or a key.
   *
   * The content reads it to decide whether to take focus. A menu the pointer
   * opened must not — moving the pointer past somebody's name should not steal
   * the caret out of whatever they were typing. A menu a key opened must, or
   * the arrow keys have nothing to move through and the items cannot be
   * reached at all.
   */
  readonly openedByPointer: () => boolean;
}

const HoverContext = createContext<HoverState | null>(null);

export interface DropdownMenuProps
  // `onOpenChange` is re-declared rather than inherited. Radix types it as a
  // method signature, and destructuring one trips `unbound-method` — a rule
  // that is right in general and wrong about a callback prop. Declared as a
  // property it is both more accurate and quiet.
  extends Omit<ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Root>, 'onOpenChange'> {
  onOpenChange?: (open: boolean) => void;
  /**
   * Also open on hover, in addition to click and keyboard.
   *
   * **In addition, never instead.** A menu that only opens on hover is a menu
   * a keyboard cannot reach and a touch screen has no gesture for, and the
   * items here are commands rather than a preview — which is also why this is
   * not `HoverCard`, whose content is documented as non-essential.
   *
   * Closing is delayed. The pointer has to cross the gap between the trigger
   * and the floating content, and a menu that closes during that journey
   * cannot be clicked at all.
   */
  openOnHover?: boolean;
  /** Milliseconds before a hover-opened menu closes. */
  hoverCloseDelay?: number;
}

export function DropdownMenu({
  openOnHover = false,
  hoverCloseDelay = 150,
  open,
  defaultOpen,
  onOpenChange,
  modal,
  ...props
}: DropdownMenuProps): JSX.Element {
  /*
   * Seeded from `defaultOpen`, which hover mode used to drop on the floor.
   *
   * The hover branch below is controlled — `open: open ?? hoverOpen` — so an
   * uncontrolled `defaultOpen` never reached Radix and a menu asked to start
   * open started closed. Seeding the state is the whole fix, and it keeps
   * `defaultOpen` meaning the same thing in both modes.
   */
  const [hoverOpen, setHoverOpen] = useState(defaultOpen ?? false);
  const pointerOpened = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hold = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const hover = useMemo<HoverState>(
    () => ({
      enabled: openOnHover,
      open: () => {
        hold();
        pointerOpened.current = true;
        setHoverOpen(true);
        onOpenChange?.(true);
      },
      close: () => {
        hold();
        timer.current = setTimeout(() => {
          setHoverOpen(false);
          onOpenChange?.(false);
        }, hoverCloseDelay);
      },
      hold,
      openedByPointer: () => pointerOpened.current,
    }),
    [openOnHover, hoverCloseDelay, hold, onOpenChange],
  );

  /*
   * A hover menu is not modal, and that is what makes hover work at all.
   *
   * Radix defaults `modal` to true, which puts `pointer-events: none` on the
   * body while the menu is open. The trigger is not inside the content, so it
   * stops receiving pointer events the instant the menu appears —
   * `pointerleave` fires on a pointer that has not moved, the close timer runs,
   * the body is restored, the pointer is found over the trigger again, and it
   * reopens. Measured on the sidebar profile menu: every open and close paired
   * exactly with `pointer-events` going `none` and back, for as long as the
   * pointer stayed there.
   *
   * Resolved here rather than spread before `...props`, which is where this
   * first went and where it did nothing. `DropdownMenuProps` extends Radix's
   * root props, so `modal` is a prop a caller may name — and any caller that
   * spreads an object carrying `modal: undefined` (Storybook's args do, for
   * every documented prop) puts the default back. `undefined` has to mean
   * "not asked", not "asked for the default".
   *
   * Losing modality costs nothing here. It is what stops the rest of the page
   * being marked inert for a menu a stray pointer movement is meant to
   * dismiss, and dismissal still works either way: `DismissableLayer` handles
   * outside clicks and Escape.
   */
  const resolvedModal = modal ?? !openOnHover;

  // Uncontrolled unless hover is on. Taking control otherwise would break
  // every existing caller that passes neither `open` nor `onOpenChange`.
  const rootProps = openOnHover
    ? {
        open: open ?? hoverOpen,
        onOpenChange: (next: boolean) => {
          hold();
          // Radix is the one reporting this, so it was a click, a key or a
          // dismissal — never the pointer, which goes through `hover.open`
          // above. A click on a trigger the pointer is already over arrives
          // here after `pointerenter` and correctly overwrites it.
          if (next) pointerOpened.current = false;
          setHoverOpen(next);
          onOpenChange?.(next);
        },
      }
    : {
        ...(open === undefined ? {} : { open }),
        ...(defaultOpen === undefined ? {} : { defaultOpen }),
        ...(onOpenChange === undefined ? {} : { onOpenChange }),
      };

  return (
    <HoverContext value={hover}>
      <DropdownMenuPrimitive.Root modal={resolvedModal} {...rootProps} {...props} />
    </HoverContext>
  );
}

export function DropdownMenuTrigger({
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>): JSX.Element {
  const hover = useContext(HoverContext);

  return (
    <DropdownMenuPrimitive.Trigger
      {...(hover?.enabled === true
        ? { onPointerEnter: hover.open, onPointerLeave: hover.close }
        : {})}
      {...props}
    />
  );
}
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;

const surface = [
  'z-50 min-w-[10rem] overflow-hidden rounded-md border border-border bg-surface p-1',
  'text-fg shadow-lg',
  'data-[state=open]:animate-scale-in data-[state=closed]:animate-scale-out',
  'origin-(--radix-dropdown-menu-content-transform-origin)',
];

const item = [
  'relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-base',
  'outline-none select-none [&_svg]:size-4 [&_svg]:text-fg-subtle',
  'data-highlighted:bg-surface-hover data-highlighted:text-fg',
  'data-disabled:pointer-events-none data-disabled:text-fg-disabled',
];

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>): JSX.Element {
  const hover = useContext(HoverContext);

  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(surface, className)}
        {...(hover?.enabled === true
          ? {
              onPointerEnter: hover.hold,
              onPointerLeave: hover.close,
              /*
               * Focus follows the key, never the pointer.
               *
               * A menu the pointer merely passed over must not take focus:
               * moving toward somebody's name at the bottom of a sidebar
               * should not pull the caret out of whatever they were typing.
               *
               * A menu opened with Enter or Space must, and this is where that
               * was lost. It used to prevent the focus unconditionally, which
               * made a keyboard-opened menu one you could open and never enter
               * — arrow keys had nothing to move through and sign-out could not
               * be reached at all, in the one component whose own
               * documentation says hover is "in addition, never instead".
               *
               * The reason it was unconditional has since been fixed: content
               * that took focus used to close the menu, because a modal menu
               * had disabled pointer events on the body and the trigger was
               * already losing hover. See `resolvedModal` above.
               */
              onOpenAutoFocus: (event: Event) => {
                if (hover.openedByPointer()) event.preventDefault();
              },
            }
          : {})}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  destructive = false,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
  /** Irreversible or data-losing. Confirm separately; colour is not consent. */
  destructive?: boolean;
}): JSX.Element {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        item,
        destructive &&
          'text-danger-fg data-highlighted:bg-danger-subtle data-highlighted:text-danger-fg [&_svg]:text-current',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>): JSX.Element {
  return (
    <DropdownMenuPrimitive.CheckboxItem className={cn(item, 'pl-8', className)} {...props}>
      <span className="absolute left-2 grid size-4 place-items-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="size-4" aria-hidden="true" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>): JSX.Element {
  return (
    <DropdownMenuPrimitive.RadioItem className={cn(item, 'pl-8', className)} {...props}>
      <span className="absolute left-2 grid size-4 place-items-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <span className="size-2 rounded-full bg-accent" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>): JSX.Element {
  return (
    <DropdownMenuPrimitive.Label
      className={cn(
        'px-2 py-1.5 text-2xs font-semibold tracking-wide text-fg-subtle uppercase',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>): JSX.Element {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  );
}

export function DropdownMenuShortcut({
  className,
  ...props
}: ComponentPropsWithoutRef<'span'>): JSX.Element {
  return (
    <span
      className={cn('ml-auto font-mono text-2xs tracking-widest text-fg-subtle', className)}
      {...props}
    />
  );
}

export function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger>): JSX.Element {
  return (
    <DropdownMenuPrimitive.SubTrigger
      className={cn(item, 'data-[state=open]:bg-surface-hover', className)}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto size-4" aria-hidden="true" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

export function DropdownMenuSubContent({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>): JSX.Element {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.SubContent className={cn(surface, className)} {...props} />
    </DropdownMenuPrimitive.Portal>
  );
}
