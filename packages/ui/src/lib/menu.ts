/**
 * The look shared by every menu of commands: `DropdownMenu` and `ContextMenu`.
 *
 * Two Radix primitives, one appearance. Kept here rather than copied into each
 * so a row height or a highlight colour cannot drift between the menu a row's
 * button opens and the one a right-click on the same row opens.
 */

/**
 * A menu portalled into a container — the phone frame in the docs — flips and
 * shifts against that container rather than the window, or a menu opened at
 * the frame's edge is drawn outside it.
 */
export function boundaryOf(container: HTMLElement | undefined): {
  collisionBoundary?: HTMLElement;
} {
  return container ? { collisionBoundary: container } : {};
}

/** The floating panel. Raised, not bordered: the shadow is the edge. */
export const menuSurface = [
  'z-50 min-w-[12rem] overflow-hidden rounded-md bg-surface-raised p-1.5 text-fg shadow-lg',
  'touch:min-w-[15rem] touch:rounded-lg',
  'popover-motion',
];

/** A row: 36px at a desk, 48px under a finger. */
export const menuItem = [
  'relative flex min-h-9 cursor-default items-center gap-2.5 rounded-sm px-2.5 py-1.5',
  'text-[0.875rem] leading-snug outline-none select-none',
  'touch:min-h-12 touch:rounded-md touch:px-3 touch:text-md',
  '[&_svg]:size-[1.0625rem] [&_svg]:shrink-0 [&_svg]:text-fg-muted touch:[&_svg]:size-5',
  'transition-colors duration-(--animate-duration-instant)',
  'data-highlighted:bg-surface-sunken data-highlighted:text-fg',
  'data-disabled:pointer-events-none data-disabled:text-fg-disabled data-disabled:[&_svg]:text-fg-disabled',
];

/** Irreversible or data-losing. Confirm separately; colour is not consent. */
export const menuItemDestructive =
  'text-danger-fg data-highlighted:bg-danger-subtle data-highlighted:text-danger-fg [&_svg]:text-current';

/** Leaves room at the start for a check or a radio dot. */
export const menuItemIndented = 'ps-8 touch:ps-9.5';

export const menuIndicator =
  'absolute start-2.5 grid size-4 place-items-center text-accent-fg touch:start-3 touch:size-5';

export const menuLabel = 'px-2.5 pt-2 pb-1 text-xs font-semibold text-fg-subtle touch:px-3';

export const menuSeparator = 'mx-2 my-1.5 h-px bg-border touch:mx-3';

/** A shortcut hint. Hidden under a finger, where there is no keyboard to press it on. */
export const menuShortcut = 'ms-auto ps-4 text-xs tracking-wide text-fg-subtle touch:hidden';
