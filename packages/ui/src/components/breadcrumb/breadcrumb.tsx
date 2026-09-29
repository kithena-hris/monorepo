import { Check, ChevronDown, ChevronLeft, ChevronRight, Ellipsis } from 'lucide-react';
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type JSX,
  type ReactNode,
} from 'react';

import { Slot, Slottable } from '@radix-ui/react-slot';

import { cn } from '../../lib/cn';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../dropdown-menu/dropdown-menu';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '../sheet/sheet';
import { useCoarsePointer } from '../../lib/use-media-query';

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

export interface BreadcrumbMenuProps {
  /** The page you are on: the trigger's label. */
  readonly label: string;
  /**
   * Where else you could be at this level, grouped: the sections of the same
   * area. The current one is marked, and each is a link, so middle-click and
   * "open in a new tab" still work.
   */
  readonly groups: readonly {
    readonly label: string;
    readonly items: readonly {
      readonly href: string;
      readonly label: string;
      readonly current?: boolean;
    }[];
  }[];
  /** What the menu is, for a screen reader: "People sections". */
  readonly menuLabel: string;
  /**
   * Render each item's link through the app's router link. It receives the
   * href and the label and must return an `<a>` or a framework `Link`.
   */
  readonly renderLink?: (item: { href: string; label: string }) => ReactNode;
  /**
   * `crumb` (default) is the last crumb of a trail. `title` is the same
   * switcher as a page title, the way a phone's navigation bar carries it:
   * the title itself opens the siblings.
   */
  readonly variant?: 'crumb' | 'title';
}

/** Items whose label contains the query, groups that still have one. Pure, for the tests. */
export function filterSiblings(
  groups: BreadcrumbMenuProps['groups'],
  query: string,
): BreadcrumbMenuProps['groups'] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return groups;
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.label.toLowerCase().includes(needle)),
    }))
    .filter((group) => group.items.length > 0);
}

/** Below this many siblings a filter is more to read than it saves. */
const FILTER_FROM = 7;

/**
 * The last crumb, as a menu of its siblings: "People › Directory ▾".
 *
 * Still the page you are on (`aria-current`), and also the fastest way to the
 * next section over without going back to the area first. A menu button, not
 * a link: it opens the list rather than going anywhere, and the list is links,
 * the current one ticked.
 *
 * A long list gets a filter at the top: typing narrows it, ↓ goes into what is
 * left, and ↵ opens the first match. Under a finger the list is a sheet from
 * the bottom rather than a dropdown under a 44px trigger, grouped the same way.
 */
export function BreadcrumbMenu({
  label,
  groups,
  menuLabel,
  renderLink = ({ href, label: text }) => <a href={href}>{text}</a>,
  variant = 'crumb',
}: BreadcrumbMenuProps): JSX.Element {
  const coarse = useCoarsePointer();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const content = useRef<HTMLDivElement | null>(null);
  const count = groups.reduce((n, g) => n + g.items.length, 0);
  const filterable = count >= FILTER_FROM;
  const shown = filterSiblings(groups, query);

  // A long list opens with the caret in its filter, after the menu has taken focus.
  useEffect(() => {
    if (!open || !filterable || coarse) return undefined;
    const frame = requestAnimationFrame(() => {
      content.current?.querySelector('input')?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [open, filterable, coarse]);

  const trigger = (
    <button
      type="button"
      aria-current="page"
      aria-label={`${label}, ${menuLabel}`}
      className={cn(
        'relative tap-target inline-flex max-w-full items-center gap-1 rounded-sm text-fg',
        'hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus',
        'data-[state=open]:bg-surface-hover',
        variant === 'title' ? 'min-h-11 px-2 text-md font-semibold' : '-mx-1 px-1 font-medium',
      )}
    >
      <span className="truncate">{label}</span>
      <ChevronDown aria-hidden className="size-3.5 shrink-0 text-fg-subtle" />
    </button>
  );

  const reset = (next: boolean): void => {
    setOpen(next);
    if (!next) setQuery('');
  };

  if (coarse) {
    return (
      <Sheet open={open} onOpenChange={reset}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="bottom" size="lg">
          <SheetHeader>
            <SheetTitle>{menuLabel}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            <nav aria-label={menuLabel} className="flex flex-col gap-4 pb-4">
              {groups.map((group) => (
                <div key={group.label} className="flex flex-col gap-2">
                  <h3 className="px-1 text-xs font-semibold text-fg-subtle">{group.label}</h3>
                  <ul className="overflow-hidden rounded-[1.125rem] bg-surface-sunken">
                    {group.items.map((item) => (
                      <li
                        key={item.href}
                        className="relative border-b border-border last:border-b-0"
                      >
                        <Slot
                          aria-current={item.current === true ? 'page' : undefined}
                          className={cn(
                            'flex min-h-tap items-center px-3.5 pe-11 text-base text-fg',
                            'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
                            item.current === true && 'font-semibold',
                          )}
                          onClick={() => {
                            reset(false);
                          }}
                        >
                          {renderLink(item)}
                        </Slot>
                        {item.current === true ? (
                          <Check
                            aria-hidden
                            className="pointer-events-none absolute end-3.5 top-1/2 size-4.5 -translate-y-1/2 text-accent-fg"
                          />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </SheetBody>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={reset}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-60" aria-label={menuLabel}>
        {filterable ? (
          <div ref={content} className="p-1 pb-1.5">
            <input
              type="search"
              value={query}
              aria-label={`Filter ${menuLabel.toLowerCase()}`}
              placeholder="Filter"
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  content.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
                  return;
                }
                if (event.key === 'Enter') {
                  event.preventDefault();
                  content.current?.querySelector<HTMLElement>('[role="menuitem"]')?.click();
                  return;
                }
                // The menu's own typeahead would take the letters; the field keeps them.
                if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
              }}
              className="h-8 w-full rounded-sm bg-surface-sunken px-2.5 text-sm text-fg outline-none placeholder:text-fg-subtle focus-visible:shadow-[inset_0_0_0_2px_var(--reach-color-border-focus)]"
            />
          </div>
        ) : null}
        {shown.length === 0 ? (
          <p className="px-2.5 py-2 text-sm text-fg-muted">Nothing matches.</p>
        ) : null}
        {shown.map((group, index) => (
          <Fragment key={group.label}>
            {index === 0 ? null : <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
              {group.items.map((item) => (
                <DropdownMenuItem
                  key={item.href}
                  asChild
                  {...(item.current === true ? { 'aria-current': 'page' as const } : {})}
                  className={cn(
                    item.current === true &&
                      "font-semibold after:ms-auto after:ps-4 after:text-accent-fg after:content-['✓'_/_'']",
                  )}
                >
                  <Slot>{renderLink(item)}</Slot>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
