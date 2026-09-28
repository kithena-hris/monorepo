import { ChevronLeft, ChevronRight, Ellipsis } from 'lucide-react';
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { Slot, Slottable } from '@radix-ui/react-slot';

import { cn } from '../../lib/cn';

/**
 * Where this record sits, and how to get back up.
 *
 * Two details that are usually wrong elsewhere: the separators are
 * `aria-hidden`, so a screen reader reads "People, Engineering, Grace Hopper"
 * rather than "People slash Engineering slash"; and the last item is not a
 * link, because a link to the page you are on is a dead control. It carries
 * `aria-current="page"` instead.
 *
 * Where the trail is narrow the middle collapses rather than wrapping to three
 * lines, the first and last crumb are the two that carry the navigation.
 * "Narrow" is the space the trail has, not the window: the nav is a container,
 * so a trail in a 360px side panel on a wide monitor folds the same way it
 * does on a phone.
 *
 * Under a finger it goes further and keeps one crumb: the parent, as a back
 * link ("‹ Platform"). A phone has no room for a trail and a thumb has no use
 * for one; what it wants is the way up.
 */

export function Breadcrumb({ className, ...props }: ComponentPropsWithoutRef<'nav'>): JSX.Element {
  return <nav aria-label="Breadcrumb" className={cn('@container min-w-0', className)} {...props} />;
}

export function BreadcrumbList({
  className,
  ...props
}: ComponentPropsWithoutRef<'ol'>): JSX.Element {
  return (
    <ol
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-1.5 text-[0.875rem] font-medium text-fg-muted',
        'touch:text-sm',
        // On a phone only the parent remains, the crumb before the page and its
        // separator, as the back link. Its chevron is drawn by `BreadcrumbLink`.
        'touch:[&>li]:hidden touch:[&>li:nth-last-child(3)]:inline-flex touch:[&>li:nth-last-child(3)]:text-accent-fg',
        className,
      )}
      {...props}
    />
  );
}

export interface BreadcrumbItemProps extends ComponentPropsWithoutRef<'li'> {
  /**
   * Hide this crumb when the trail has less than 24rem. Apply it to the middle
   * of a deep trail; the `BreadcrumbEllipsis` beside it stays as the signal
   * that something folded.
   */
  collapsible?: boolean;
}

export function BreadcrumbItem({
  className,
  collapsible = false,
  ...props
}: BreadcrumbItemProps): JSX.Element {
  return (
    <li
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5',
        collapsible && '@max-sm:hidden',
        className,
      )}
      {...props}
    />
  );
}

export interface BreadcrumbLinkProps extends ComponentPropsWithoutRef<'a'> {
  asChild?: boolean;
}

export function BreadcrumbLink({
  className,
  asChild = false,
  children,
  ...props
}: BreadcrumbLinkProps): JSX.Element {
  // The prop was declared here and never implemented, so it reached the DOM as
  // an `aschild` attribute and React warned about it on every render. A
  // breadcrumb step is not always an `<a>`: a step that only changes local
  // state is a button, and it has to keep the link's styling.
  const Component = asChild ? Slot : 'a';

  return (
    <Component
      className={cn(
        'truncate rounded-xs transition-colors hover:text-fg',
        // A step is a target, not a word in a sentence: under a finger it is
        // the tap floor tall and at least as wide. Grown by its line height rather
        // than `tap-target`, because `truncate` would clip a pseudo-element.
        'touch:inline-block touch:min-h-tap touch:min-w-tap touch:leading-11 touch:text-center',
        // An icon crumb (Home) sits on the middle of that tall line, not its top.
        'touch:[&>svg]:inline touch:[&>svg]:align-middle',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
        className,
      )}
      {...props}
    >
      {/* The back chevron: shown only under a finger, where the parent crumb
          is all that is left of the trail. */}
      <ChevronLeft aria-hidden className="-ms-1 me-0.5 hidden size-4.5 rtl:rotate-180" />
      <Slottable>{children}</Slottable>
    </Component>
  );
}

export function BreadcrumbPage({
  className,
  ...props
}: ComponentPropsWithoutRef<'span'>): JSX.Element {
  return (
    <span
      aria-current="page"
      className={cn('truncate font-semibold text-fg', className)}
      {...props}
    />
  );
}

export function BreadcrumbSeparator({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<'li'>): JSX.Element {
  return (
    <li aria-hidden role="presentation" className={cn('text-fg-subtle', className)} {...props}>
      {children ?? <ChevronRight className="size-3.5 rtl:rotate-180" />}
    </li>
  );
}

export function BreadcrumbEllipsis({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<'span'> & { children?: ReactNode }): JSX.Element {
  return (
    <span
      className={cn(
        'hidden h-6 w-7 items-center justify-center rounded-sm bg-surface-sunken text-fg-muted',
        '@max-sm:inline-flex',
        className,
      )}
      {...props}
    >
      {children ?? <Ellipsis className="size-4" aria-hidden />}
      <span className="sr-only">Collapsed levels</span>
    </span>
  );
}
