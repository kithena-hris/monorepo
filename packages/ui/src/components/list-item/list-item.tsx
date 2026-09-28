import { ChevronRight } from 'lucide-react';
import {
  cloneElement,
  isValidElement,
  type ComponentPropsWithoutRef,
  type JSX,
  type ReactElement,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';

/**
 * The row most lists are built from, and the rounded group that holds them.
 *
 * The middle is always the same, a title and up to two lines under it. What
 * changes is what goes before (an avatar, an icon, a checkbox) and after (a
 * value, a switch, a button, a chevron).
 *
 * Not `ListDetail`, which is the two-pane layout a list and its selection live
 * in, and not a `Table`, whose columns line up across rows. A list row is read
 * one at a time.
 *
 * ### Interactive rows
 *
 * A row that opens something passes its link or button as the child with
 * `asChild`, and the whole row becomes that element: one target, one name, the
 * title. Such a row must not also hold a switch or a button; two targets
 * inside one is how a tap meant for the row flips a setting.
 */

export function List({ className, ...props }: ComponentPropsWithoutRef<'ul'>): JSX.Element {
  return (
    <ul
      className={cn(
        'overflow-hidden rounded-[1.125rem] bg-surface shadow-sm touch:rounded-[1.375rem]',
        // A hairline between rows, drawn as an inset shadow so it takes no
        // height and a selected row's fill reaches the edge.
        '[&>li:not(:last-child)]:shadow-[inset_0_-1px_0_var(--color-border)]',
        className,
      )}
      {...props}
    />
  );
}

export interface ListItemProps extends Omit<ComponentPropsWithoutRef<'li'>, 'title'> {
  /** An `Avatar`, an icon, or a `Checkbox`. */
  leading?: ReactNode;
  /** One line under the title, truncated. */
  description?: ReactNode;
  /** A longer passage under the description, clamped to two lines. */
  supporting?: ReactNode;
  /** Small text at the end of the title line, such as a timestamp. */
  meta?: ReactNode;
  /** A value, a `Badge`, a `Switch` or a `Button`, after the text. */
  trailing?: ReactNode;
  /** Draws a disclosure chevron: this row opens something. */
  chevron?: boolean;
  /** Tints the row. Pair it with `aria-current` or `aria-selected` on the child, as the pattern needs. */
  selected?: boolean;
  /** Dims the row. Mark the child `aria-disabled` if it is interactive. */
  disabled?: boolean;
  /** The row becomes its child, a link or a button; the child's text is the title. */
  asChild?: boolean;
}

type ChildElement = ReactElement<{ children?: ReactNode; className?: string }>;

export function ListItem({
  className,
  leading,
  description,
  supporting,
  meta,
  trailing,
  chevron = false,
  selected = false,
  disabled = false,
  asChild = false,
  children,
  ...props
}: ListItemProps): JSX.Element {
  const interactive = asChild && isValidElement(children);
  const row = cn(
    'group/row flex w-full min-h-14 items-center gap-3 px-4.5 py-2 text-start text-fg touch:min-h-16 touch:px-4',
    supporting && 'items-start py-3.5',
    selected && 'bg-accent-subtle',
    disabled && 'opacity-50',
    interactive && [
      'transition-colors duration-(--animate-duration-fast) ease-standard',
      !selected && 'hover:bg-surface-hover active:bg-surface-active',
      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
    ],
  );

  const content = (title: ReactNode): JSX.Element => (
    <>
      {leading ? <span className="flex shrink-0 items-center">{leading}</span> : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[0.875rem]/[1.3] font-semibold touch:text-[1rem]">
            {title}
          </span>
          {meta ? <span className="shrink-0 text-xs text-fg-subtle">{meta}</span> : null}
        </span>
        {description ? (
          <span className="truncate text-[0.8125rem]/[1.3] text-fg-muted touch:text-[0.875rem]">
            {description}
          </span>
        ) : null}
        {supporting ? (
          <span className="mt-1 line-clamp-2 text-[0.875rem]/[1.45] text-fg-muted touch:text-[0.9375rem]">
            {supporting}
          </span>
        ) : null}
      </span>
      {trailing ? (
        <span className="flex shrink-0 items-center gap-1 text-fg-muted">{trailing}</span>
      ) : null}
      {chevron ? (
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
      ) : null}
    </>
  );

  if (interactive) {
    const child = children as ChildElement;
    return (
      <li className={className} {...props}>
        {cloneElement(
          child,
          { className: cn(row, child.props.className) },
          content(child.props.children),
        )}
      </li>
    );
  }

  return (
    <li className={cn(row, className)} {...props}>
      {content(children)}
    </li>
  );
}
