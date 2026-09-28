/**
 * The bar a selection summons, shared by `DataTable` and `Kanban`.
 *
 * An inverted pill, so it reads as a mode the page is in rather than one more
 * row, with its buttons restyled as translucent pills on the dark fill. The
 * buttons are the caller's own `Button`s; the descendant selectors outrank a
 * variant's single class, which is what lets a `secondary` action sit on the
 * inverted fill without every caller having to know it is there.
 */
export const bulkBarClass = [
  'mx-auto flex w-fit max-w-full flex-wrap items-center gap-1.5',
  'rounded-2xl bg-invert py-1.5 ps-4.5 pe-1.5 text-fg-on-invert shadow-lg',
  // An accent focus ring vanishes against an inverted fill in one theme or the
  // other; the ink the fill is drawn for is the one that always contrasts.
  '[--reach-color-border-focus:var(--reach-color-fg-on-invert)]',
  '[&_button]:rounded-full [&_button]:border-0 [&_button]:bg-fg-on-invert/12 [&_button]:text-fg-on-invert [&_button]:shadow-none',
  '[&_button:hover]:bg-fg-on-invert/20 [&_button:hover]:text-fg-on-invert',
].join(' ');
