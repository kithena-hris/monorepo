'use client';

import * as CollapsiblePrimitive from '@radix-ui/react-collapsible';
import { Slot } from '@radix-ui/react-slot';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  Children,
  cloneElement,
  useId,
  type ComponentPropsWithoutRef,
  type JSX,
  type ReactElement,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';
import { Badge } from '../badge/badge';
import { useRailCollapsed } from '../page-layout/page-layout';
import { Tooltip } from '../tooltip/tooltip';

/**
 * Navigation, at three levels.
 *
 * ### What the levels are for
 *
 * | Level | What it lists | Where it lives |
 * | --- | --- | --- |
 * | **Primary** | Products and top-level areas: People, Time off, Payroll | The sidebar, always visible |
 * | **Secondary** | Sections of the current area: Directory, Org chart, Imports | Under its primary item, or across the top of the content |
 * | **Tertiary** | Places *within the current page*: the sections of a long form, the parts of a record | Beside the content, or in the aside |
 *
 * The distinction is not decorative. A tertiary item does not change the page,
 * it moves within it, so it is an in-page anchor, it should update as the
 * reader scrolls, and it must not look like something that navigates away.
 * Getting that wrong is why so many products have a sidebar with eleven items
 * where four of them are the same page.
 *
 * ### Markup
 *
 * `<ul>` and `<li>` throughout, so a screen reader announces "list, 6 items"
 * and the reader knows how much navigation there is before committing to it.
 * The current item carries `aria-current="page"`, not a class, not a colour.
 *
 * ### The collapsed rail
 *
 * Inside a collapsed `PageLayout` sidebar this renders as icons with tooltips
 * and screen-reader-only labels, reading the state from context rather than
 * from a prop threaded through four components. Every destination stays
 * present and stays in the same order, so the muscle memory survives.
 *
 * An item with no icon cannot collapse to one, so it keeps its label. That is
 * the honest failure: a truncated word beats a blank row.
 */

export interface NavProps extends ComponentPropsWithoutRef<'nav'> {
  /** Names the landmark. Two navs on one page with the same name are one nav. */
  label: string;
  /** Tertiary navigation is usually not a landmark: see `TertiaryNav`. */
  as?: 'nav' | 'div';
}

export function Nav({ className, label, as = 'nav', children, ...props }: NavProps): JSX.Element {
  const Comp = as;
  const collapsed = useRailCollapsed();
  return (
    <Comp
      aria-label={label}
      className={cn(
        'min-w-0',
        className,
        /*
         * Important, and it has to be.
         *
         * A screen sizes its navigation for the expanded rail, typically
         * `lg:w-56`. Ordering this after `className` is not enough: Tailwind
         * emits variant utilities after unprefixed ones, so `lg:w-56` wins at
         * that breakpoint whatever order the class attribute is in. The rail
         * then stays 14rem wide inside a 3.5rem column, every item centres
         * itself against the wrong width, and the icons land outside the
         * visible strip.
         */
        collapsed && 'w-full! min-w-0',
      )}
      {...props}
    >
      {children}
    </Comp>
  );
}

export interface NavListProps extends ComponentPropsWithoutRef<'ul'> {
  /** 1 primary, 2 secondary, 3 tertiary. Drives indentation and type size. */
  level?: 1 | 2 | 3;
}

const listByLevel = {
  1: 'space-y-0.5',
  2: 'space-y-px ps-3',
  // A rule down the side, so a tertiary list reads as *within* something
  // rather than as a third independent menu.
  3: 'ms-3 space-y-px border-s border-border ps-3',
} as const;

export function NavList({ className, level = 1, ...props }: NavListProps): JSX.Element {
  return <ul className={cn('min-w-0', listByLevel[level], className)} {...props} />;
}

export interface NavItemProps extends Omit<ComponentPropsWithoutRef<'a'>, 'children'> {
  children: ReactNode;
  level?: 1 | 2 | 3;
  icon?: ReactNode;
  /** A count or a status. Hidden in a collapsed rail, where there is no room. */
  badge?: ReactNode;
  /** The page you are on. Renders `aria-current`, which is what carries it. */
  current?: boolean;
  /**
   * Render something else, a framework `Link`. The default is an `<a>`
   * because navigation is a link, and a `<button>` that navigates breaks
   * middle-click, right-click, and opening in a new tab.
   *
   * The child is the link and its children are the label:
   * `<NavItem asChild icon={…}><Link href="/people">People</Link></NavItem>`.
   * The icon, badge and action are drawn inside it as they are inside the
   * `<a>`, so a client-side route looks and reads exactly like a plain one.
   */
  asChild?: boolean;
  /** Trailing control: a pin, an overflow menu. */
  action?: ReactNode;
  /**
   * A second line under the label, for a menu of destinations people do not
   * know by name yet: "Org chart", *Who reports to whom*. Hidden in a rail.
   */
  description?: ReactNode;
}

// 14px at a desk, 16px under a finger, which the type scale has no step
// for: `sm` is 13 and `base` 15 at a desk.
const itemByLevel = {
  1: 'min-h-9.5 touch:min-h-12 gap-2.5 px-2.5 text-[0.875rem] touch:text-[1rem]',
  2: 'min-h-9.5 touch:min-h-12 gap-2.5 px-2.5 text-[0.875rem] touch:text-[1rem]',
  3: 'min-h-7 touch:min-h-tap gap-2 px-2.5 text-sm',
} as const;

export function NavItem({
  className,
  children,
  level = 1,
  icon,
  badge,
  current = false,
  asChild = false,
  action,
  description,
  ...props
}: NavItemProps): JSX.Element {
  const collapsed = useRailCollapsed();
  const Comp = asChild ? Slot : 'a';
  /*
   * With `asChild` the one child is the link, and the label is its children.
   * `Slot` takes exactly one element, so the icon, label and badge are put
   * inside that element rather than beside it — which is what they are inside
   * the `<a>`.
   */
  const child = asChild
    ? (Children.only(children) as ReactElement<{ children?: ReactNode }>)
    : null;
  const label = child === null ? children : child.props.children;
  // Only a level-1 item with an icon can survive as a rail.
  const asIcon = collapsed && level === 1 && Boolean(icon);
  /*
   * Anything else is not rendered while the rail is collapsed.
   *
   * The alternative, which this used to do, was to keep the label. At 3.5rem
   * that is a word clipped mid-letter, and a nested section list rendered as
   * four of them: the rail reads as broken rather than as collapsed. These
   * destinations come back the moment it expands, which is the behaviour a
   * collapse control implies.
   */
  if (collapsed && !asIcon) return <></>;

  const inside = (
    <>
      {icon ? (
        <span
          aria-hidden
          className={cn(
            'shrink-0',
            // The icon is quieter than the label until the item is current.
            current ? 'text-accent-fg' : 'text-fg-muted group-hover/nav-item:text-fg',
            level === 3 ? '[&_svg]:size-3.5' : '[&_svg]:size-[18px]',
          )}
        >
          {icon}
        </span>
      ) : null}

      {/*
       * The label is never removed, only hidden. A rail whose items have no
       * accessible name is a rail nobody can navigate with a screen reader,
       * and `sr-only` costs nothing.
       */}
      {description !== undefined && !asIcon ? (
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-2">
          <span className="truncate">{label}</span>
          <span className="truncate text-xs font-normal text-fg-muted">{description}</span>
        </span>
      ) : (
        <span className={cn('min-w-0 flex-1 truncate', asIcon && 'sr-only')}>{label}</span>
      )}

      {badge && !asIcon ? <span className="shrink-0">{badge}</span> : null}

      {/*
       * A count still has to reach someone using the rail. It becomes a dot on
       * the icon, and the number stays in the accessible name.
       */}
      {badge && asIcon ? (
        <span
          aria-hidden
          className="absolute end-2 top-2 size-1.5 rounded-full bg-accent ring-2 ring-surface"
        />
      ) : null}

      {action && !asIcon ? <span className="shrink-0">{action}</span> : null}
    </>
  );

  const link = (
    <Comp
      // `aria-current` is the state. The background is the reminder.
      aria-current={current ? 'page' : undefined}
      className={cn(
        // A filled, rounded row, so the current item reads as a place the
        // reader is standing rather than as a selected row in a table.
        'group/nav-item relative flex items-center rounded-[0.75rem]',
        'transition-[background-color,color] duration-(--animate-duration-fast) ease-standard',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
        itemByLevel[level],
        current
          ? 'bg-accent-subtle font-semibold text-accent-fg'
          : 'font-medium text-fg hover:bg-surface-hover',
        asIcon && 'justify-center px-0',
        className,
      )}
      {...props}
    >
      {child === null ? inside : cloneElement(child, undefined, inside)}
    </Comp>
  );

  // The tooltip only exists in the rail, where the label is not on screen.
  // Wrapping it everywhere would put a tooltip on text that is already there.
  return asIcon ? (
    <li>
      <Tooltip
        content={
          badge ? (
            <span className="flex items-center gap-1.5">
              {label}
              <Badge size="sm" tone="accent">
                {badge}
              </Badge>
            </span>
          ) : (
            label
          )
        }
        side="right"
      >
        {link}
      </Tooltip>
    </li>
  ) : (
    <li className="min-w-0">{link}</li>
  );
}

export interface NavGroupProps extends ComponentPropsWithoutRef<'li'> {
  /** The heading. Becomes a divider in a collapsed rail. */
  label: string;
  /** Makes the group expandable. Without it the heading is a plain label. */
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** A count of what is inside, for a collapsed group. */
  badge?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
}

/**
 * A labelled group of items, the usual home for secondary navigation.
 *
 * Collapsible groups animate against `--radix-collapsible-content-height`,
 * measured by the primitive: `height: auto` is not animatable, which is why a
 * hand-rolled version of this either jumps or hard-codes a wrong height.
 */
export function NavGroup({
  className,
  label,
  collapsible = false,
  defaultOpen = true,
  badge,
  icon,
  children,
  ...props
}: NavGroupProps): JSX.Element {
  const collapsed = useRailCollapsed();
  const labelId = useId();

  if (collapsed) {
    // A heading with nothing to head. The rule keeps the grouping legible
    // without a word nobody can read at 56px wide.
    return (
      <li
        className={cn(
          'min-w-0',
          // A group whose items all hid themselves leaves a rule with nothing
          // under it. `:has` asks the question at paint time, which is the only
          // point at which the answer is known: whether a child rendered
          // depends on its own props, not on anything this component can see.
          '[&:has(>ul:empty)]:hidden',
          className,
        )}
        {...props}
      >
        <hr className="my-2 border-border" aria-hidden />
        <span className="sr-only">{label}</span>
        <ul className="space-y-0.5">{children}</ul>
      </li>
    );
  }

  if (!collapsible) {
    return (
      <li className={cn('min-w-0 pt-3.5 first:pt-0', className)} {...props}>
        <h3 id={labelId} className="px-2.5 pb-1.5 text-xs font-semibold text-fg-subtle">
          {label}
        </h3>
        <ul aria-labelledby={labelId} className="min-w-0 space-y-0.5">
          {children}
        </ul>
      </li>
    );
  }

  return (
    <li className={cn('min-w-0 pt-2', className)} {...props}>
      <CollapsiblePrimitive.Root defaultOpen={defaultOpen}>
        <CollapsiblePrimitive.Trigger
          className={cn(
            'group/nav-group flex min-h-8 touch:min-h-tap w-full items-center gap-2 rounded-[0.75rem] px-2.5 text-start',
            'text-xs font-semibold text-fg-subtle',
            'transition-colors duration-(--animate-duration-fast) hover:bg-surface-hover hover:text-fg',
            'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
          )}
        >
          {icon ? (
            <span aria-hidden className="shrink-0 [&_svg]:size-3.5">
              {icon}
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {badge ? <span className="shrink-0">{badge}</span> : null}
          {/* At the end, where a toggle sits, so the heading still lines up
              with the headings that do not fold. */}
          <ChevronDown
            aria-hidden
            className="size-3.5 shrink-0 transition-transform duration-(--animate-duration-normal) ease-standard group-data-[state=open]/nav-group:rotate-180"
          />
        </CollapsiblePrimitive.Trigger>

        <CollapsiblePrimitive.Content
          className={cn(
            'overflow-hidden',
            'data-[state=open]:animate-collapse-down data-[state=closed]:animate-collapse-up',
          )}
        >
          {/* Indented to the label of an item with an icon, so the group's
              rows read as belonging to the heading above them. */}
          <ul className="min-w-0 space-y-0.5 ps-6 pt-0.5">{children}</ul>
        </CollapsiblePrimitive.Content>
      </CollapsiblePrimitive.Root>
    </li>
  );
}

export type TertiaryNavStatus = 'success' | 'warning' | 'danger' | 'info';

export interface TertiaryNavItem {
  id: string;
  label: string;
  badge?: ReactNode;
  /** Defaults to `#id`, an anchor in this page. A section that is a page of its own passes its URL. */
  href?: string;
  /** A number: documents on file, open tasks. */
  count?: number;
  /** A dot, for a section that is complete, needs attention or is blocked. Spoken, not only coloured. */
  status?: TertiaryNavStatus;
  /** 1 indents a subsection, in a table of contents. */
  depth?: 0 | 1;
}

export interface TertiaryNavProps
  // `onSelect` is omitted too: the DOM's is a `ReactEventHandler`, and this
  // one takes the section id. Shadowing it would be a silent type conflict.
  extends Omit<ComponentPropsWithoutRef<'nav'>, 'children' | 'onSelect' | 'title'> {
  label: string;
  items: readonly TertiaryNavItem[];
  /** The section currently in view. The caller owns the scroll observation. */
  activeId?: string;
  onSelect?: (id: string) => void;
  /** Renders horizontally, for a rail that does not exist on a narrow screen. */
  orientation?: 'vertical' | 'horizontal';
  /** A visible heading over a vertical list: the record's name, or "On this page". */
  title?: ReactNode;
  /**
   * `location` (the default) for anchors within one document. `page` for
   * sections that are pages of a record, Personal, Employment, Pay, where
   * choosing one changes what is on screen.
   */
  current?: 'location' | 'page';
  /**
   * How a vertical list marks the current item: `line`, the accent stretch of
   * a rule down the side, for a table of contents; `fill`, a washed row, for
   * a list of sections carrying counts and status.
   */
  variant?: 'line' | 'fill';
  /**
   * What a vertical list becomes under a finger: `pills`, a scrolling row
   * under the title; `list`, rows that each push a screen. Left out, it stays
   * a column at a finger's size.
   */
  touchLayout?: 'pills' | 'list';
}

const statusDot: Record<TertiaryNavStatus, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

const statusWord: Record<TertiaryNavStatus, string> = {
  success: 'complete',
  warning: 'needs attention',
  danger: 'blocked',
  info: 'information',
};

/**
 * In-page navigation: the sections of the page you are already on.
 *
 * Two things make this different from the other two levels, and both are easy
 * to get wrong:
 *
 * 1. **It does not navigate.** The items are anchors within the document, so
 *    they are `<a href="#section">`, which keeps middle-click, "copy link"
 *    and the browser's own back button working, all of which a `<button>`
 *    would throw away.
 * 2. **The current item is `aria-current="location"`, not `"page"`.** The page
 *    has not changed; the reader's position within it has. A screen reader
 *    says "current location" rather than "current page", which is the
 *    difference the reader needs.
 *
 * The exception is a record's sections that are pages of their own, which
 * pass `href` and `current="page"`: the same list, telling the truth about
 * what choosing an item does.
 *
 * Which section is active is the caller's business, an `IntersectionObserver`
 * over the headings, usually. Putting a scroll listener in here would make
 * every consumer pay for one whether they wanted it or not.
 */
export function TertiaryNav({
  className,
  label,
  items,
  activeId,
  onSelect,
  orientation = 'vertical',
  title,
  current = 'location',
  variant = 'line',
  touchLayout,
  ...props
}: TertiaryNavProps): JSX.Element {
  const titleId = useId();
  const vertical = orientation === 'vertical';
  const fill = vertical && variant === 'fill';
  const touchPills = vertical && touchLayout === 'pills';
  const touchList = vertical && touchLayout === 'list';
  return (
    <nav aria-label={label} className={cn('min-w-0', className)} {...props}>
      {title && vertical ? (
        <p
          id={titleId}
          className={cn(
            'pb-2.5 text-xs font-semibold text-fg-subtle',
            fill ? 'px-3' : 'ps-3.5',
            (touchPills || touchList) && 'touch:sr-only',
          )}
        >
          {title}
        </p>
      ) : null}
      <ul
        aria-labelledby={title && vertical ? titleId : undefined}
        className={cn(
          'min-w-0',
          orientation === 'vertical'
            ? fill
              ? 'space-y-0.5'
              : 'space-y-px border-s border-border'
            : // A scrolling row of pills, as a phone shows it under the title.
              // The vertical padding is the room each pill's tap-target hit
              // area needs inside a strip that clips.
              'flex gap-1.5 overflow-x-auto overscroll-x-contain py-1',
          touchPills &&
            'touch:flex touch:gap-1.5 touch:space-y-0 touch:overflow-x-auto touch:overscroll-x-contain touch:border-0 touch:py-1',
          touchList &&
            'touch:space-y-0 touch:overflow-hidden touch:rounded-xl touch:border-0 touch:bg-surface touch:shadow-sm',
        )}
      >
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <li
              key={item.id}
              className={cn(
                orientation === 'vertical' ? 'min-w-0' : 'shrink-0',
                touchPills && 'touch:shrink-0',
              )}
            >
              <a
                href={item.href ?? `#${item.id}`}
                // `location`, not `page`: the page has not changed, the
                // reader's position within it has.
                aria-current={active ? current : undefined}
                onClick={() => {
                  onSelect?.(item.id);
                }}
                className={cn(
                  'relative flex items-center gap-2 text-sm',
                  'transition-[color,border-color,background-color] duration-(--animate-duration-fast) ease-standard',
                  orientation === 'vertical'
                    ? fill
                      ? cn(
                          'min-h-8.5 touch:min-h-tap truncate rounded-sm px-3',
                          active
                            ? 'bg-surface-sunken font-semibold text-fg'
                            : 'font-medium text-fg-muted hover:bg-surface-hover hover:text-fg',
                        )
                      : cn(
                          'min-h-7 touch:min-h-tap -ms-px truncate border-s-2 ps-3.5',
                          item.depth === 1 && 'ps-7',
                          active
                            ? 'border-accent font-semibold text-accent-fg'
                            : 'border-transparent font-medium text-fg-muted hover:border-border-strong hover:text-fg',
                        )
                    : cn(
                        'h-8 touch:h-9 tap-target shrink-0 rounded-control px-3.5 font-semibold',
                        active
                          ? 'bg-invert text-fg-on-invert'
                          : 'bg-surface-sunken text-fg-muted hover:bg-surface-hover hover:text-fg',
                      ),
                  // The same pill, for a column that becomes a row under a finger.
                  touchPills &&
                    cn(
                      'tap-target touch:h-9 touch:min-h-0 touch:shrink-0 touch:rounded-control touch:border-0 touch:px-3.5 touch:font-semibold',
                      active
                        ? 'touch:bg-invert touch:text-fg-on-invert'
                        : 'touch:bg-surface-sunken touch:text-fg-muted',
                    ),
                  // A settings-style row that pushes its section's screen.
                  touchList &&
                    'touch:ms-0 touch:min-h-13 touch:rounded-none touch:border-0 touch:border-b touch:border-border touch:bg-transparent touch:px-4 touch:font-medium touch:text-fg',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.badge ? <span className="shrink-0">{item.badge}</span> : null}
                {item.count != null ? (
                  <span
                    className={cn(
                      'shrink-0 text-xs font-semibold text-fg-subtle tabular-nums',
                      touchList && 'touch:text-base touch:font-normal touch:text-fg-muted',
                      touchPills && active && 'touch:text-fg-on-invert',
                    )}
                  >
                    {item.count}
                  </span>
                ) : null}
                {item.status ? (
                  <span className={cn('size-2 shrink-0 rounded-full', statusDot[item.status])}>
                    <span className="sr-only">, {statusWord[item.status]}</span>
                  </span>
                ) : null}
                {touchList ? (
                  <ChevronRight
                    aria-hidden
                    className="hidden size-4 shrink-0 text-fg-subtle touch:block"
                  />
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
