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
  ...props
}: DropdownMenuProps): JSX.Element {
  const [hoverOpen, setHoverOpen] = useState(false);
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
    }),
    [openOnHover, hoverCloseDelay, hold, onOpenChange],
  );

  // Uncontrolled unless hover is on. Taking control otherwise would break
  // every existing caller that passes neither `open` nor `onOpenChange`.
  const rootProps = openOnHover
    ? {
        open: open ?? hoverOpen,
        onOpenChange: (next: boolean) => {
          hold();
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
      <DropdownMenuPrimitive.Root {...rootProps} {...props} />
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
              // The pointer never reaches content that steals focus on open
              // and then closes when the trigger loses hover.
              onOpenAutoFocus: (event: Event) => {
                event.preventDefault();
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
