import { ChevronRight, MoreHorizontal } from 'lucide-react';
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { Slot } from '@radix-ui/react-slot';

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
 * On a narrow screen the middle collapses rather than wrapping to three lines,
 * the first and last crumb are the two that carry the navigation.
 */

export function Breadcrumb({ className, ...props }: ComponentPropsWithoutRef<'nav'>): JSX.Element {
  return <nav aria-label="Breadcrumb" className={cn('min-w-0', className)} {...props} />;
}

export function BreadcrumbList({
  className,
  ...props
}: ComponentPropsWithoutRef<'ol'>): JSX.Element {
  return (
    <ol
      className={cn('flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-fg-muted', className)}
      {...props}
    />
  );
}

export interface BreadcrumbItemProps extends ComponentPropsWithoutRef<'li'> {
  /**
   * Hide this crumb below `sm`. Apply it to the middle of a deep trail; the
   * `BreadcrumbEllipsis` beside it stays as the signal that something folded.
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
        collapsible && 'max-sm:hidden',
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
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
        className,
      )}
      {...props}
    />
  );
}

export function BreadcrumbPage({
  className,
  ...props
}: ComponentPropsWithoutRef<'span'>): JSX.Element {
  return (
    <span
      aria-current="page"
      className={cn('truncate font-medium text-fg', className)}
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
      {children ?? <ChevronRight className="size-3.5" />}
    </li>
  );
}

export function BreadcrumbEllipsis({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<'span'> & { children?: ReactNode }): JSX.Element {
  return (
    <span className={cn('hidden text-fg-subtle max-sm:inline-flex', className)} {...props}>
      {children ?? <MoreHorizontal className="size-4" />}
      <span className="sr-only">Collapsed levels</span>
    </span>
  );
}
