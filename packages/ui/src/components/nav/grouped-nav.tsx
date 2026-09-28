'use client';

import { ChevronDown, ChevronRight, Lock, Pin, SearchX } from 'lucide-react';
import {
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { closestFrom } from '../../lib/dom';
import { cn } from '../../lib/cn';
import { EmptyState } from '../feedback/feedback';
import { Kbd } from '../kbd/kbd';
import { SearchField } from '../typed-fields/typed-fields';

/**
 * A long list of destinations in labelled groups: settings, admin,
 * documentation.
 *
 * At a desk it is a sidebar that can be searched, whose groups can be folded
 * and whose items can nest up to three levels, with a guide line showing the
 * depth. Under a finger it is a settings screen: each group an inset list,
 * each item a row with a coloured tile that pushes its own screen, so there
 * is never an indented tree on a phone.
 *
 * ### Keys
 *
 * Every row is an ordinary link or button, so Tab works through them all.
 * On top of that:
 *
 * | Key | Does |
 * | --- | --- |
 * | ↑ ↓ Home End | Move between rows |
 * | → ← | Open or close a group or a nested item; ← on a child goes to its parent |
 * | / | Search |
 * | Enter in the search field | Opens the first result |
 *
 * The group holding the current page always starts open, so the reader can
 * see where they are.
 */

export interface GroupedNavItem {
  id: string;
  label: string;
  href?: string;
  icon?: ReactNode;
  count?: number;
  /** A status: New, Required, Enterprise. */
  badge?: ReactNode;
  pinned?: boolean;
  /** Visible, but behind a plan or a permission. */
  locked?: boolean;
  disabled?: boolean;
  /** Children. Up to two further levels. */
  items?: readonly GroupedNavItem[];
}

export interface GroupedNavGroup {
  id: string;
  label: string;
  icon?: ReactNode;
  items: readonly GroupedNavItem[];
}

function contains(item: GroupedNavItem, id: string | undefined): boolean {
  return id !== undefined && (item.items ?? []).some((kid) => kid.id === id || contains(kid, id));
}

function filterItems(items: readonly GroupedNavItem[], needle: string): GroupedNavItem[] {
  return items.flatMap((item) => {
    if (item.label.toLowerCase().includes(needle)) return [item];
    const kids = filterItems(item.items ?? [], needle);
    return kids.length > 0 ? [{ ...item, items: kids }] : [];
  });
}

/** Groups narrowed to items matching the query, keeping the parents of a nested match. */
export function filterNavGroups(
  groups: readonly GroupedNavGroup[],
  query: string,
): readonly GroupedNavGroup[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return groups;
  return groups
    .map((group) => ({ ...group, items: filterItems(group.items, needle) }))
    .filter((group) => group.items.length > 0);
}

function toggle(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function countItems(items: readonly GroupedNavItem[]): number {
  return items.reduce((sum, item) => sum + 1 + countItems(item.items ?? []), 0);
}

function Highlight({ text, query }: { text: string; query: string }): JSX.Element {
  const needle = query.trim();
  const at = needle === '' ? -1 : text.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-[3px] bg-warning-subtle text-inherit">
        {text.slice(at, at + needle.length)}
      </mark>
      {text.slice(at + needle.length)}
    </>
  );
}

// The phone's tile colours, taken in turn so neighbouring rows differ.
const tiles = [
  'touch:bg-chart-1',
  'touch:bg-chart-2',
  'touch:bg-chart-3',
  'touch:bg-chart-4',
  'touch:bg-chart-5',
  'touch:bg-chart-6',
] as const;

const indent = ['ps-2.5', 'ps-7', 'ps-11.5'] as const;
const guide = ['', 'start-4', 'start-8.5'] as const;

export interface GroupedNavProps extends Omit<
  ComponentPropsWithoutRef<'nav'>,
  'children' | 'onSelect'
> {
  /** Names the landmark. */
  label: string;
  groups: readonly GroupedNavGroup[];
  currentId?: string;
  onSelect?: (id: string) => void;
  /** Group headings fold their items away. */
  collapsible?: boolean;
  /** Group ids that start folded. The one holding `currentId` opens regardless. */
  defaultCollapsed?: readonly string[];
  /** Adds a search field that filters the list as the reader types. */
  searchable?: boolean;
  searchPlaceholder?: string;
  defaultQuery?: string;
  /** Under "No matches": where else to look. */
  noResults?: ReactNode;
}

export function GroupedNav({
  label,
  groups,
  currentId,
  onSelect,
  collapsible = false,
  defaultCollapsed = [],
  searchable = false,
  searchPlaceholder = 'Search',
  defaultQuery = '',
  noResults = 'Try a shorter or different word.',
  className,
  ...props
}: GroupedNavProps): JSX.Element {
  const navRef = useRef<HTMLElement>(null);
  const baseId = useId();
  const [query, setQuery] = useState(defaultQuery);
  const [closed, setClosed] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        defaultCollapsed.filter(
          (id) =>
            !groups
              .find((group) => group.id === id)
              ?.items.some((item) => item.id === currentId || contains(item, currentId)),
        ),
      ),
  );
  const [open, setOpen] = useState<ReadonlySet<string>>(() => {
    const ids = new Set<string>();
    const walk = (items: readonly GroupedNavItem[]): void => {
      for (const item of items) {
        if (contains(item, currentId)) ids.add(item.id);
        walk(item.items ?? []);
      }
    };
    for (const group of groups) walk(group.items);
    return ids;
  });

  const searching = query.trim() !== '';
  const shown = useMemo(() => filterNavGroups(groups, query), [groups, query]);
  const results = useMemo(
    () => shown.reduce((sum, group) => sum + countItems(group.items), 0),
    [shown],
  );

  const rows = (): HTMLElement[] =>
    [...(navRef.current?.querySelectorAll<HTMLElement>('[data-nav-row]') ?? [])].filter((el) =>
      el.checkVisibility(),
    );

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    const target = closestFrom(event.target, '[data-nav-row]');
    const inSearch = closestFrom(event.target, 'input') !== null;
    if (event.key === '/' && searchable && !inSearch) {
      event.preventDefault();
      navRef.current?.querySelector('input')?.focus();
      return;
    }
    if (event.key === 'ArrowDown' && inSearch) {
      event.preventDefault();
      rows()[0]?.focus();
      return;
    }
    if (!(target instanceof HTMLElement)) return;
    const list = rows();
    const at = list.indexOf(target);
    const focus = (index: number): void => {
      list[Math.min(Math.max(index, 0), list.length - 1)]?.focus();
    };
    const expanded = target.getAttribute('aria-expanded');
    switch (event.key) {
      case 'ArrowDown':
        focus(at + 1);
        break;
      case 'ArrowUp':
        focus(at - 1);
        break;
      case 'Home':
        focus(0);
        break;
      case 'End':
        focus(list.length - 1);
        break;
      case 'ArrowRight':
        if (expanded === 'false') target.click();
        break;
      case 'ArrowLeft':
        if (expanded === 'true') target.click();
        else {
          const parent = target.dataset['parent'];
          if (parent)
            navRef.current?.querySelector<HTMLElement>(`[data-row-id="${parent}"]`)?.focus();
        }
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  let tile = 0;

  const renderItem = (item: GroupedNavItem, depth: number, parent?: string): JSX.Element => {
    const current = item.id === currentId;
    const kids = item.items ?? [];
    const expanded = searching || open.has(item.id);
    const color = tiles[tile++ % tiles.length];

    const row = cn(
      'relative flex min-h-8.5 w-full items-center gap-2.5 rounded-sm pe-2.5 text-start text-sm',
      'transition-colors duration-(--animate-duration-fast) ease-standard',
      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
      indent[depth],
      current
        ? 'bg-accent-subtle font-semibold text-accent-fg'
        : 'font-medium text-fg hover:bg-surface-hover',
      item.disabled && 'pointer-events-none text-fg-disabled',
      // A settings screen: full-width rows in an inset list.
      'touch:min-h-13 touch:gap-3 touch:rounded-none touch:border-b touch:border-border touch:px-4 touch:text-base',
    );

    const inside = (chevron: 'disclosure' | 'push' | null): JSX.Element => (
      <>
        {depth > 0 ? (
          <span
            aria-hidden
            className={cn('absolute inset-y-0 w-px bg-border-strong', guide[depth])}
          />
        ) : null}
        {chevron === 'disclosure' ? (
          <ChevronRight
            aria-hidden
            className={cn(
              'size-3.5 shrink-0 text-fg-subtle transition-transform duration-(--animate-duration-normal)',
              expanded && 'rotate-90',
            )}
          />
        ) : null}
        {item.icon ? (
          <span
            aria-hidden
            className={cn(
              'grid shrink-0 place-items-center [&_svg]:size-4',
              current ? 'text-accent-fg' : 'text-fg-muted',
              'touch:size-7.5 touch:rounded-xs touch:text-fg-on-solid',
              color,
            )}
          >
            {item.icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate">
          <Highlight text={item.label} query={query} />
        </span>
        {item.pinned ? (
          <>
            <Pin aria-hidden className="size-3.5 shrink-0 text-fg-subtle" />
            <span className="sr-only">, pinned</span>
          </>
        ) : null}
        {item.locked ? (
          <>
            <Lock aria-hidden className="size-3.5 shrink-0 text-fg-subtle" />
            <span className="sr-only">, locked</span>
          </>
        ) : null}
        {item.badge ? <span className="shrink-0">{item.badge}</span> : null}
        {item.count != null ? (
          <span
            className={cn(
              'grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-2xs font-bold tabular-nums',
              current ? 'bg-accent-solid text-fg-on-accent' : 'bg-surface-active text-fg-muted',
              'touch:bg-transparent touch:px-0 touch:text-base touch:font-normal touch:text-fg-muted',
            )}
          >
            {item.count}
          </span>
        ) : null}
        {chevron === 'push' ? (
          <ChevronRight aria-hidden className="hidden size-4 shrink-0 text-fg-subtle touch:block" />
        ) : null}
      </>
    );

    const shared = {
      'data-nav-row': '',
      'data-row-id': item.id,
      'data-parent': parent,
    };

    const link = item.disabled ? (
      <span {...shared} aria-disabled="true" className={row}>
        {inside(null)}
      </span>
    ) : (
      <a
        {...shared}
        href={item.href ?? `#${item.id}`}
        aria-current={current ? 'page' : undefined}
        onClick={() => {
          onSelect?.(item.id);
        }}
        className={cn(row, kids.length > 0 && 'hidden touch:flex')}
      >
        {inside('push')}
      </a>
    );

    if (kids.length === 0) return <li key={item.id}>{link}</li>;

    const listId = `${baseId}-${item.id}`;
    return (
      <li key={item.id}>
        {/* At a desk the parent opens in place; on a phone it is a link to its own screen. */}
        <button
          type="button"
          {...shared}
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => {
            setOpen((set) => toggle(set, item.id));
          }}
          className={cn(row, 'touch:hidden')}
        >
          {inside('disclosure')}
        </button>
        {link}
        <ul id={listId} hidden={!expanded} className="flex flex-col gap-px touch:hidden">
          {kids.map((kid) => renderItem(kid, depth + 1, item.id))}
        </ul>
      </li>
    );
  };

  return (
    <nav
      ref={navRef}
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('flex min-w-0 flex-col gap-1 touch:gap-4.5', className)}
      {...props}
    >
      {searchable ? (
        <div className="mb-1.5 touch:mb-0">
          <SearchField
            size="sm"
            label={`Search ${label}`}
            placeholder={searchPlaceholder}
            value={query}
            onValueChange={setQuery}
            onSearch={(value) => {
              if (value.trim() === '') return;
              navRef.current?.querySelector<HTMLElement>('a[data-nav-row]')?.click();
            }}
          />
        </div>
      ) : null}

      {shown.map((group) => {
        const headingId = `${baseId}-group-${group.id}`;
        const listId = `${baseId}-list-${group.id}`;
        const isOpen = searching || !closed.has(group.id);
        const heading = (
          <>
            {group.icon ? (
              <span aria-hidden className="shrink-0 [&_svg]:size-3.5">
                {group.icon}
              </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate">{group.label}</span>
            {collapsible && !isOpen ? (
              <span className="tabular-nums">
                {group.items.length}
                <span className="sr-only"> items</span>
              </span>
            ) : null}
            {collapsible ? (
              <ChevronDown
                aria-hidden
                className={cn(
                  'size-3.5 shrink-0 transition-transform duration-(--animate-duration-normal)',
                  !isOpen && '-rotate-90',
                )}
              />
            ) : null}
          </>
        );
        const headingClass = cn(
          'flex w-full items-center gap-2 px-2.5 pt-2.5 pb-1.5 text-start text-xs font-semibold text-fg-subtle',
          'touch:px-4 touch:pt-0 touch:text-sm touch:font-medium touch:text-fg-muted',
        );
        return (
          <section key={group.id} aria-labelledby={headingId} className="flex flex-col gap-px">
            <h3 id={headingId} className={collapsible ? 'contents' : headingClass}>
              {collapsible ? (
                <button
                  type="button"
                  data-nav-row=""
                  aria-expanded={isOpen}
                  aria-controls={listId}
                  onClick={() => {
                    setClosed((set) => toggle(set, group.id));
                  }}
                  className={cn(
                    headingClass,
                    'rounded-sm hover:text-fg touch:min-h-tap',
                    'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
                  )}
                >
                  {heading}
                </button>
              ) : (
                heading
              )}
            </h3>
            <ul
              id={listId}
              hidden={!isOpen}
              className={cn(
                'flex flex-col gap-px',
                'touch:gap-0 touch:overflow-hidden touch:rounded-xl touch:bg-surface touch:shadow-sm',
                'touch:[&>li:last-child>*]:border-b-0',
              )}
            >
              {group.items.map((item) => renderItem(item, 0))}
            </ul>
          </section>
        );
      })}

      {searching ? (
        results === 0 ? (
          <EmptyState
            icon={<SearchX />}
            title={`No matches for “${query.trim()}”`}
            description={noResults}
            className="border-0 px-2 py-6"
          />
        ) : (
          <p aria-hidden className="flex items-center gap-1 px-2.5 py-2.5 text-xs text-fg-subtle">
            {results} {results === 1 ? 'result' : 'results'}
            <span className="flex items-center gap-1 touch:hidden">
              · <Kbd>↵</Kbd> opens the first
            </span>
          </p>
        )
      ) : null}
      {searchable ? (
        // Mounted before the first keystroke: a live region that appears with
        // its message is, to most screen readers, not live yet.
        <p aria-live="polite" className="sr-only">
          {searching ? `${String(results)} ${results === 1 ? 'result' : 'results'}` : ''}
        </p>
      ) : null}
    </nav>
  );
}
