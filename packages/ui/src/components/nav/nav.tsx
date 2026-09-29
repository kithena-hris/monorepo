'use client';

import * as CollapsiblePrimitive from '@radix-ui/react-collapsible';
import { Slot } from '@radix-ui/react-slot';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  Children,
  cloneElement,
  createContext,
  use,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
  type JSX,
  type ReactElement,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';
import { HOVER_CLOSE_MS, HOVER_OPEN_MS } from '../../lib/motion';
import { Badge } from '../badge/badge';
import { RailContext, useRailCollapsed } from '../page-layout/page-layout';
import { Popover, PopoverAnchor, PopoverContent } from '../popover/popover';
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
  /**
   * Groups side by side where the container has room: a flyout that lays an
   * area's places out as a menu rather than one long column. Each direct
   * child, usually a `NavGroup`, takes a column; they stack again when the
   * container is narrow. The width the container has decides, never the
   * window's.
   */
  columns?: 1 | 2 | 3;
  /**
   * `ruled` is an item's own pages, listed under it in the sidebar (its
   * `subnav`): 38px rows along a rule down the start side, level with the
   * parent's icon, the current one drawn as an accent stretch of that rule.
   */
  variant?: 'plain' | 'ruled';
}

const listByLevel = {
  1: 'space-y-0.5',
  2: 'space-y-px ps-3',
  // A rule down the side, so a tertiary list reads as *within* something
  // rather than as a third independent menu.
  3: 'ms-3 space-y-px border-s border-border ps-3',
} as const;

const listColumns = {
  1: '',
  2: 'grid gap-x-4 gap-y-5 space-y-0 @xl:grid-cols-2',
  3: 'grid gap-x-4 gap-y-5 space-y-0 @xl:grid-cols-2 @4xl:grid-cols-3',
} as const;

/** Set by a `NavList` with columns: its groups are a menu's columns, headed as such. */
const MenuColumns = createContext(false);

/** Set by a `ruled` `NavList`: its items are an item's pages, along the rule. */
const RuledList = createContext(false);

/**
 * Set by a compact `MegaMenu`: its described items are one column of rows,
 * the count at the end of the row rather than beside the name.
 */
export const CompactMenu = createContext(false);

export function NavList({
  className,
  level = 1,
  columns = 1,
  variant = 'plain',
  ...props
}: NavListProps): JSX.Element {
  if (variant === 'ruled') {
    return (
      <RuledList value={true}>
        <ul className={cn('min-w-0 space-y-0.5 pt-0.5', className)} {...props} />
      </RuledList>
    );
  }
  const list = (
    <ul className={cn('min-w-0', listByLevel[level], listColumns[columns], className)} {...props} />
  );
  return columns === 1 ? (
    list
  ) : (
    <MenuColumns value={true}>
      <div className="@container">{list}</div>
    </MenuColumns>
  );
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
   * One line under the label on what the destination is for, in a menu that
   * has room for it. It describes the link (`aria-describedby`) rather than
   * joining its name, so the item is still announced by its label. With a
   * description the icon sits in a tile, which is what makes a menu of them
   * scannable.
   */
  description?: ReactNode;
  /**
   * How much room the `flyout` gets: `sm` (default) for a short list of
   * sections, `lg` for a menu of described places in columns, `compact` for
   * seven described places or fewer in one column (a compact `MegaMenu`).
   */
  flyoutSize?: 'sm' | 'lg' | 'compact';
  /**
   * This destination's own pages, listed under it rather than beside it: a
   * `NavList variant="ruled"` of level-2 items. Shown while `expanded`; a
   * chevron says which way it is. The parent is then not marked current, the
   * page under it is.
   *
   * With both this and a `flyout`, the flyout is the collapsed rail's only:
   * in an expanded sidebar the pages are inline and nothing opens on hover.
   */
  subnav?: ReactNode;
  /** Whether `subnav` is shown. Usually: whether the current page is under this one. */
  expanded?: boolean;
  /**
   * The sections of this destination, shown beside it on demand rather than
   * as a column that is always open. Usually a `Nav` of level-2 items.
   *
   * It opens on hover (after a short delay, and closes after another, so a
   * pointer crossing the sidebar does not flash it), when the item takes
   * keyboard focus, on ArrowRight, and on the first tap of a touch — the
   * second tap follows the link. Escape or ArrowLeft closes it and returns
   * focus to the item. It is rendered in place rather than in a portal, so
   * Tab goes from the item into its sections and on out the other side.
   *
   * It stays in the collapsed rail, where it replaces the tooltip: the
   * sections are the one thing a rail cannot otherwise show.
   */
  flyout?: ReactNode;
}

// A primary item is a 44px row of 15px type, the sidebar's own scale; the
// levels below it are 14px at a desk, 16px under a finger, which the type
// scale has no step for: `sm` is 13 and `base` 15 at a desk.
const itemByLevel = {
  1: 'min-h-11 touch:min-h-12 gap-3 px-3 text-[0.9375rem] touch:text-[1rem]',
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
  flyout,
  description,
  flyoutSize = 'sm',
  subnav,
  expanded = false,
  ...props
}: NavItemProps): JSX.Element {
  const collapsed = useRailCollapsed();
  const describedBy = useId();
  const described = description !== undefined && description !== null;
  const ruled = use(RuledList) && level === 2;
  const compact = use(CompactMenu) && described;
  const fly = useFlyout();
  const showSubnav = subnav !== undefined && expanded && !collapsed;
  // The page under it carries the mark; the parent as well would be two for one place.
  const marked = current && !showSubnav;
  // With its pages inline, nothing hovers: the flyout is the collapsed rail's.
  const flies = flyout !== undefined && (subnav === undefined || collapsed);
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
            described
              ? cn(
                  'flex size-10 items-center justify-center rounded-[0.75rem] [&_svg]:size-[1.1875rem]',
                  'transition-colors duration-(--animate-duration-fast)',
                  marked
                    ? 'bg-accent-subtle text-accent-fg'
                    : 'bg-surface-sunken text-fg group-hover/nav-item:bg-surface-active',
                )
              : cn(
                  // The icon is quieter than the label until the item is current,
                  // or open over its pages.
                  marked
                    ? 'text-accent-fg'
                    : showSubnav
                      ? 'text-fg'
                      : 'text-fg-muted group-hover/nav-item:text-fg',
                  level === 3 ? '[&_svg]:size-3.5' : '[&_svg]:size-[18px]',
                ),
          )}
        >
          {icon}
        </span>
      ) : null}

      {/*
       * The label is never removed, only hidden. A rail whose items have no
       * accessible name is a rail nobody can navigate with a screen reader,
       * and `sr-only` costs nothing.
       *
       * `data-rail-label` is what fades first when the rail collapses
       * (`PageLayout`), before the width moves.
       */}
      {described && !asIcon ? (
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          {/* The count sits with the name it counts, as a menu reads it. */}
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={cn('truncate font-semibold text-fg', compact && 'text-[0.9375rem]/[1.3]')}
            >
              {label}
            </span>
            {badge && !compact ? <span className="shrink-0">{badge}</span> : null}
          </span>
          {/* Out of the link's name, into its description: the item is still
              announced as its label, then this line. */}
          <span
            id={describedBy}
            aria-hidden
            className={cn(
              'line-clamp-2 text-xs leading-snug text-fg-muted',
              compact && 'text-[0.8125rem]/[1.4]',
            )}
          >
            {description}
          </span>
        </span>
      ) : (
        <span data-rail-label="" className={cn('min-w-0 flex-1 truncate', asIcon && 'sr-only')}>
          {label}
        </span>
      )}

      {/* In a compact menu the count ends the row, where a list puts it. */}
      {badge && !asIcon && (!described || compact) ? (
        <span data-rail-label="" className="shrink-0">
          {badge}
        </span>
      ) : null}

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

      {/* Which way its pages are: open under it, or somewhere to go. */}
      {subnav !== undefined && !asIcon ? (
        <span data-rail-label="" aria-hidden className="shrink-0 text-fg-subtle">
          {showSubnav ? (
            <ChevronDown className="size-[15px]" />
          ) : (
            <ChevronRight className="size-[15px] rtl:rotate-180" />
          )}
        </span>
      ) : null}
    </>
  );

  const link = (
    <Comp
      // `aria-current` is the state. The background is the reminder.
      aria-current={marked ? 'page' : undefined}
      aria-describedby={described && !asIcon ? describedBy : undefined}
      className={cn(
        // A filled, rounded row, so the current item reads as a place the
        // reader is standing rather than as a selected row in a table.
        'group/nav-item relative flex items-center rounded-[0.75rem]',
        // A described item is two lines and a tile: aligned to the top, with
        // room around it, and a floor that is a tap target on any pointer.
        described && !asIcon && 'min-h-tap items-start py-2',
        'transition-[background-color,color] duration-(--animate-duration-fast) ease-standard',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
        ruled
          ? cn(
              // Along the rule, which runs level with the parent's icon.
              'ms-5.25 min-h-9.5 gap-2 rounded-[0.625rem] ps-4.75 pe-2.5 text-[0.875rem] touch:min-h-12 touch:text-[1rem]',
              'before:absolute before:inset-y-0 before:start-0 before:w-[1.5px] before:bg-border-strong',
              marked
                ? 'bg-accent-subtle font-semibold text-accent-fg before:w-0.5 before:bg-accent'
                : 'font-medium text-fg-muted hover:bg-surface-hover hover:text-fg',
            )
          : cn(
              itemByLevel[level],
              marked
                ? described && !asIcon
                  ? // In a menu of described places the tile carries the accent; a
                    // washed row as well would be two marks for one fact.
                    'bg-surface-sunken'
                  : 'bg-accent-subtle font-semibold text-accent-fg'
                : cn(
                    'text-fg hover:bg-surface-hover',
                    showSubnav ? 'font-semibold' : 'font-medium',
                  ),
            ),
        // In a compact menu, one row a tile high, centred on it.
        compact && 'items-center gap-3 rounded-[0.875rem] p-2.5',
        asIcon && 'justify-center px-0',
        className,
      )}
      {...props}
      {...(flies ? fly.triggerProps : {})}
    >
      {child === null ? inside : cloneElement(child, undefined, inside)}
    </Comp>
  );

  if (flies) {
    return (
      // Anchored under a finger too: the flyout is a column beside its item,
      // rendered in place for Tab order, never a sheet.
      <Popover open={fly.open} onOpenChange={fly.setOpen} modal={false} sheetOnTouch={false}>
        <PopoverAnchor asChild>
          <li className="min-w-0" {...fly.anchorProps}>
            {link}
            <PopoverContent
              {...fly.contentProps}
              portal={false}
              side="right"
              align="start"
              // Clear of the sidebar's own padding and border.
              sideOffset={asIcon ? 10 : 16}
              // Not a dialog: Radix gives its content `role="dialog"`, and what
              // is inside is navigation that names itself.
              role={undefined}
              className={cn(
                flyoutSize === 'lg'
                  ? 'w-[min(51.25rem,calc(100vw-6rem))] rounded-xl p-5'
                  : flyoutSize === 'compact'
                    ? 'w-[min(21.25rem,calc(100vw-6rem))] rounded-[1.375rem] p-2.5 shadow-xl'
                    : 'w-60 p-2',
                // Out of the item and back into it, rather than the popover's zoom.
                'origin-left popover-motion',
              )}
            >
              {/* Its items are not in the rail, even when this one is. */}
              <RailContext value={{ collapsed: false }}>{flyout}</RailContext>
            </PopoverContent>
          </li>
        </PopoverAnchor>
      </Popover>
    );
  }

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
    <li className="min-w-0">
      {link}
      {/* Its pages, under it: a list inside its item, the way an outline reads. */}
      {showSubnav ? <div data-rail-label="">{subnav}</div> : null}
    </li>
  );
}

/** How long a pointer rests before a flyout opens, and lingers before it closes. */
const FLYOUT_OPEN_MS = HOVER_OPEN_MS;
const FLYOUT_CLOSE_MS = HOVER_CLOSE_MS;

/**
 * The state and handlers behind `NavItem`'s `flyout`.
 *
 * The pointer is asked what it is (`pointerType`) at the moment it acts, which
 * is the only honest answer: a laptop with a touch screen has both, and no
 * media query says which one is in use right now.
 */
function useFlyout() {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);
  // Whether it was open when a touch began: the first tap opens, the second goes.
  const openAtTouch = useRef<boolean | null>(null);
  // Focus handed back on close must not open it again.
  const returning = useRef(false);

  const clear = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const later = (next: boolean, ms: number): void => {
    clear();
    timer.current = setTimeout(() => {
      setOpen(next);
    }, ms);
  };
  useEffect(() => clear, []);

  // Opening now cancels a close the pointer scheduled on its way out.
  const show = (): void => {
    clear();
    setOpen(true);
  };
  const close = (focusTrigger: boolean): void => {
    clear();
    setOpen(false);
    if (focusTrigger) {
      returning.current = true;
      trigger.current?.focus();
      returning.current = false;
    }
  };

  return {
    open,
    setOpen: (next: boolean): void => {
      clear();
      setOpen(next);
    },
    anchorProps: {
      onPointerEnter: (event: { pointerType: string }): void => {
        if (event.pointerType === 'mouse') later(true, FLYOUT_OPEN_MS);
      },
      // Not while the keyboard is in it: a pointer drifting off must not take
      // the sections out from under the focus.
      onPointerLeave: (event: { pointerType: string; currentTarget: Element }): void => {
        if (event.pointerType !== 'mouse') return;
        if (event.currentTarget.contains(document.activeElement)) return;
        later(false, FLYOUT_CLOSE_MS);
      },
      // Focus moving anywhere outside the item and its sections closes them at
      // once: tabbing on past the menu, or into the page, is leaving it.
      onBlur: (event: { currentTarget: Element; relatedTarget: EventTarget | null }): void => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        clear();
        setOpen(false);
      },
    },
    triggerProps: {
      ref: (node: HTMLElement | null): void => {
        trigger.current = node;
      },
      'aria-expanded': open,
      'aria-controls': open ? contentId : undefined,
      onPointerDown: (event: { pointerType: string }): void => {
        openAtTouch.current = event.pointerType === 'mouse' ? null : open;
      },
      onFocus: (): void => {
        if (!returning.current) show();
      },
      onClick: (event: { preventDefault: () => void }): void => {
        if (openAtTouch.current === false) {
          event.preventDefault();
          show();
        }
        openAtTouch.current = null;
      },
      onKeyDown: (event: KeyboardEvent): void => {
        if (event.key !== 'ArrowRight') return;
        event.preventDefault();
        show();
        // After the content has mounted. Into the sections themselves when the
        // flyout has any, past a mega menu's search and recent chips.
        requestAnimationFrame(() => {
          const root = content.current;
          (
            root?.querySelector<HTMLElement>('nav a[href]') ??
            root?.querySelector<HTMLElement>('a[href], button:not(:disabled)')
          )?.focus();
        });
      },
    },
    contentProps: {
      id: contentId,
      ref: content,
      onOpenAutoFocus: (event: Event): void => {
        event.preventDefault();
      },
      onCloseAutoFocus: (event: Event): void => {
        event.preventDefault();
      },
      onEscapeKeyDown: (event: globalThis.KeyboardEvent): void => {
        event.preventDefault();
        close(content.current?.contains(document.activeElement) === true);
      },
      onKeyDown: (event: KeyboardEvent): void => {
        if (event.key !== 'ArrowLeft') return;
        event.preventDefault();
        close(true);
      },
      // Following one of its links closes it; the page it goes to is the answer.
      onClick: (event: { target: EventTarget }): void => {
        if (event.target instanceof Element && event.target.closest('a[href]') !== null) {
          close(false);
        }
      },
    },
  };
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
  const menuColumn = use(MenuColumns);

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
      <li className={cn('min-w-0 pt-3.5 first:pt-0', menuColumn && 'pt-0', className)} {...props}>
        <h3
          id={labelId}
          className={cn(
            'px-2.5 pb-1.5 text-xs font-semibold text-fg-subtle',
            // A menu column's heading: small capitals over a hairline, the
            // way a console heads a column of destinations.
            menuColumn &&
              'mx-2.5 mb-1.5 border-b border-border px-0 pb-2 text-2xs tracking-[0.08em] uppercase text-fg-subtle',
          )}
        >
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
  /** A shorter label for under a finger, where a row of pills has less room: "Access". */
  shortLabel?: string;
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
  /**
   * Renders horizontally: the tabs of a page, each its own URL, under the
   * page's header (`href` and `current="page"`), or a rail that does not
   * exist on a narrow screen.
   */
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
   * How the current item is marked. Vertical: `line`, the accent stretch of a
   * rule down the side, for a table of contents; `fill`, a washed row, for a
   * list of sections carrying counts and status (vertical's default is
   * `line`). Horizontal: `fill`, a row of pills (the default); `line`, tabs
   * underlined in the accent over a hairline, each count a pill: an umbrella
   * page's tabs under its header.
   */
  variant?: 'line' | 'fill';
  /**
   * What the list becomes under a finger: `pills`, a scrolling row of pills
   * (under the title, for a vertical list); `list`, rows that each push a
   * screen (vertical only). Left out, it stays as it is at a finger's size.
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
  variant,
  touchLayout,
  ...props
}: TertiaryNavProps): JSX.Element {
  const titleId = useId();
  const vertical = orientation === 'vertical';
  const fill = vertical && variant === 'fill';
  // Horizontal: tabs on a line when asked for, otherwise pills.
  const tabs = !vertical && variant === 'line';
  const touchPills = (vertical || tabs) && touchLayout === 'pills';
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
            : tabs
              ? // Tabs over a hairline the marker sits on, scrolling when
                // there are more than fit.
                'flex gap-1 overflow-x-auto overscroll-x-contain shadow-[inset_0_-1px_0_var(--color-border)] [scrollbar-width:none] touch:gap-0'
              : // A scrolling row of pills, as a phone shows it under the title.
                // The vertical padding is the room each pill's tap-target hit
                // area needs inside a strip that clips.
                'flex gap-1.5 overflow-x-auto overscroll-x-contain py-1',
          touchPills &&
            'touch:flex touch:gap-1.5 touch:space-y-0 touch:overflow-x-auto touch:overscroll-x-contain touch:border-0 touch:py-1 touch:shadow-none',
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
                // Under a finger, tabs share the row out between them.
                tabs && !touchPills && 'touch:flex-1',
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
                    : tabs
                      ? cn(
                          'h-11 shrink-0 px-3 font-semibold touch:text-[0.9375rem]',
                          !touchPills && 'touch:h-12 touch:justify-center',
                          active ? 'text-fg' : 'text-fg-muted hover:text-fg',
                          // The marker: a 3px stretch of accent standing on the hairline.
                          active &&
                            'after:absolute after:inset-x-3 after:bottom-0 after:h-[3px] after:rounded-t-[3px] after:bg-accent',
                          touchPills && 'touch:after:hidden',
                        )
                      : cn(
                          'h-8 touch:h-9 tap-target shrink-0 rounded-control px-3.5 font-semibold',
                          active
                            ? 'bg-invert text-fg-on-invert'
                            : 'bg-surface-sunken text-fg-muted hover:bg-surface-hover hover:text-fg',
                        ),
                  /*
                   * The same pill, for a column or a row of tabs that becomes
                   * pills under a finger.
                   *
                   * Important, and it has to be. These override the desk's own
                   * classes (`text-fg`, `h-11`, `px-3`), and a remote's
                   * stylesheet, loaded after the shell's into the same layer,
                   * may define those again: a later `.text-fg` beats an earlier
                   * `touch:text-fg-on-invert` of the same specificity, and the
                   * active pill's label went the colour of its fill.
                   */
                  touchPills &&
                    cn(
                      'tap-target touch:h-9! touch:min-h-0! touch:shrink-0 touch:rounded-control! touch:border-0! touch:px-3.5! touch:text-[0.9375rem]! touch:font-semibold',
                      active
                        ? 'touch:bg-invert! touch:text-fg-on-invert!'
                        : 'touch:bg-surface-sunken! touch:text-fg-muted!',
                    ),
                  // A settings-style row that pushes its section's screen.
                  touchList &&
                    'touch:ms-0 touch:min-h-13 touch:rounded-none touch:border-0 touch:border-b touch:border-border touch:bg-transparent touch:px-4 touch:font-medium touch:text-fg',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
                )}
              >
                <span className={cn('min-w-0 truncate', !tabs && 'flex-1')}>
                  {item.shortLabel === undefined ? (
                    item.label
                  ) : (
                    // One of the two is displayed, and that one is the link's name.
                    <>
                      <span className="touch:hidden">{item.label}</span>
                      <span className="hidden touch:inline!">{item.shortLabel}</span>
                    </>
                  )}
                </span>
                {item.badge ? <span className="shrink-0">{item.badge}</span> : null}
                {item.count != null && tabs ? (
                  // Each tab's own count, as a pill: filled on the tab you are on.
                  <span
                    className={cn(
                      'inline-grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-[0.6875rem] font-bold tabular-nums',
                      active
                        ? 'bg-accent-solid text-fg-on-accent'
                        : 'bg-surface-active text-fg-muted',
                    )}
                  >
                    {item.count}
                  </span>
                ) : item.count != null ? (
                  <span
                    className={cn(
                      'shrink-0 text-xs font-semibold text-fg-subtle tabular-nums',
                      touchList && 'touch:text-base touch:font-normal touch:text-fg-muted',
                      touchPills && active && 'touch:text-fg-on-invert!',
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
