'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { elementFrom } from '../../lib/dom';
import { cn } from '../../lib/cn';
import { usePortalContainer } from '../../lib/portal-container';
import { Kbd, KbdShortcut } from '../kbd/kbd';
import { Spinner } from '../spinner/spinner';

/**
 * Search everything and run actions from one field.
 *
 * Two parts. `Command` is the field and its results, and renders anywhere;
 * `CommandPalette` puts it in a modal dialog opened by a shortcut, which is how
 * an app uses it. The split is what lets a docs page show the results without
 * opening a modal on top of itself.
 *
 * ### Why not a menu
 *
 * A menu moves focus into its items, and a palette cannot: the reader is
 * typing. So this is the APG combobox with a listbox popup, where DOM focus
 * stays in the input and the highlighted option is pointed at with
 * `aria-activedescendant`. The option count is announced as it changes, so a
 * query that narrows forty commands to two is audible rather than merely
 * visible.
 *
 * ### Keys
 *
 * | Key | Does |
 * | --- | --- |
 * | ↑ ↓ | Move through the results, wrapping at either end, skipping disabled ones |
 * | Enter | Run the highlighted command, or open its page if it has one |
 * | Backspace on an empty field | Back to the previous page |
 * | Esc | Close |
 */

export interface CommandItem {
  id: string;
  label: string;
  /** Second line: a job title, where a page lives. */
  description?: string;
  /** Drawn in a small tile. */
  icon?: ReactNode;
  /** Drawn bare, without the tile. For an `Avatar`. */
  avatar?: ReactNode;
  /** Items sharing a group render under one heading, in the order groups first appear. */
  group?: string;
  /** Extra words that should find this item without being shown. */
  keywords?: readonly string[];
  /**
   * Keys shown beside the item, as chords (`KbdShortcut`): `['g', 't']` is G
   * then T, `['mod+k']` is ⌘K. Hidden under a finger.
   */
  shortcut?: readonly string[];
  disabled?: boolean;
  onSelect?: () => void;
  /** Makes the item open a page of its own commands instead of running. */
  items?: readonly CommandItem[];
}

/**
 * Filters and ranks by the query. Pure, so the order is testable without a DOM.
 *
 * A label that starts with the query beats one with a word starting with it,
 * which beats one merely containing it, which beats a match only in the
 * description or keywords. Ties keep the caller's order, because that order
 * usually means something (recency, frequency).
 */
export function filterCommands(
  items: readonly CommandItem[],
  query: string,
): readonly CommandItem[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return items;
  const rank = (item: CommandItem): number => {
    const label = item.label.toLowerCase();
    if (label.startsWith(needle)) return 0;
    if (label.split(/\s+/).some((word) => word.startsWith(needle))) return 1;
    if (label.includes(needle)) return 2;
    const rest = [item.description ?? '', ...(item.keywords ?? [])].join(' ').toLowerCase();
    return rest.includes(needle) ? 3 : -1;
  };
  return items
    .map((item, index) => ({ item, index, score: rank(item) }))
    .filter((entry) => entry.score >= 0)
    .toSorted((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.item);
}

/** Groups in order of first appearance, so the best match's group comes first. */
function groupCommands(items: readonly CommandItem[]): [string, CommandItem[]][] {
  const map = new Map<string, CommandItem[]>();
  for (const item of items) {
    const key = item.group ?? '';
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return [...map.entries()];
}

/** The next enabled index from `from`, stepping by `delta` and wrapping. */
function step(items: readonly CommandItem[], from: number, delta: 1 | -1): number {
  for (let n = 1; n <= items.length; n += 1) {
    const index = (from + delta * n + items.length * n) % items.length;
    if (!items[index]?.disabled) return index;
  }
  return from;
}

function Highlight({ text, query }: { text: string; query: string }): JSX.Element {
  const needle = query.trim();
  const at = needle === '' ? -1 : text.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="bg-transparent font-semibold text-accent-fg">
        {text.slice(at, at + needle.length)}
      </mark>
      {text.slice(at + needle.length)}
    </>
  );
}

export interface CommandProps extends Omit<ComponentPropsWithoutRef<'div'>, 'onSelect'> {
  items: readonly CommandItem[];
  /** Accessible name of the field and the results. */
  label?: string;
  placeholder?: string;
  /** The starting query. Owned by the component from then on. */
  defaultQuery?: string;
  /** Called on every keystroke. Pair with `filter={false}` to search on a server. */
  onQueryChange?: (query: string) => void;
  /** `false` shows `items` exactly as given, for results filtered elsewhere. */
  filter?: boolean;
  /** A search is in flight: a spinner in the field, placeholders in the list. */
  loading?: boolean;
  /** Shown when nothing matches. */
  empty?: ReactNode;
  /** Ids of the pages to start inside, outermost first. */
  defaultPath?: readonly string[];
  /** Called after a command runs, and by the Cancel button under a finger. */
  onClose?: () => void;
}

export function Command({
  items,
  label = 'Search or run a command',
  placeholder = 'Search or type a command',
  defaultQuery = '',
  onQueryChange,
  filter = true,
  loading = false,
  empty,
  defaultPath = [],
  onClose,
  className,
  ...props
}: CommandProps): JSX.Element {
  const [query, setQuery] = useState(defaultQuery);
  const [path, setPath] = useState<readonly CommandItem[]>(() => {
    const found: CommandItem[] = [];
    let level: readonly CommandItem[] = items;
    for (const id of defaultPath) {
      const next = level.find((item) => item.id === id);
      if (!next?.items) break;
      found.push(next);
      level = next.items;
    }
    return found;
  });
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const optionId = useId();

  const page = path.at(-1);
  const results = useMemo(() => {
    const source = page?.items ?? items;
    return filter ? filterCommands(source, query) : source;
  }, [page, items, filter, query]);
  const groups = useMemo(() => groupCommands(results), [results]);
  // Flat order drives the keys: the reader arrows through the list they see.
  const flat = useMemo(() => groups.flatMap(([, list]) => list), [groups]);
  const activeItem = flat[active];

  useEffect(() => {
    listRef.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' });
  }, [active, flat]);

  const changeQuery = (next: string): void => {
    setQuery(next);
    setActive(0);
    onQueryChange?.(next);
  };

  const go = (next: readonly CommandItem[]): void => {
    setPath(next);
    changeQuery('');
    inputRef.current?.focus();
  };

  const run = (item: CommandItem): void => {
    if (item.disabled) return;
    if (item.items) {
      go([...path, item]);
      return;
    }
    item.onSelect?.();
    onClose?.();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && flat.length > 0) {
      event.preventDefault();
      setActive((current) => step(flat, current, event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter' && activeItem) {
      event.preventDefault();
      run(activeItem);
    } else if (event.key === 'Backspace' && query === '' && page) {
      event.preventDefault();
      go(path.slice(0, -1));
    }
  };

  const showEmpty = !loading && flat.length === 0;

  return (
    <div
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-lg bg-surface-raised text-fg shadow-xl',
        'touch:rounded-xl',
        className,
      )}
      {...props}
    >
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        {page ? (
          <button
            type="button"
            onClick={() => {
              go(path.slice(0, -1));
            }}
            aria-label={`Back from ${page.label}`}
            className={cn(
              'tap-target relative inline-flex h-6.5 shrink-0 items-center gap-1 rounded-xs bg-surface-sunken px-2.5',
              'text-xs font-semibold whitespace-nowrap text-fg',
              'transition-colors duration-(--animate-duration-fast) hover:bg-surface-active',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
            )}
          >
            <ChevronLeft aria-hidden className="size-3.5" />
            {page.label}
          </button>
        ) : (
          <Search aria-hidden className="size-5 shrink-0 text-fg-muted" />
        )}
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={label}
          aria-activedescendant={activeItem ? `${optionId}-${activeItem.id}` : undefined}
          autoComplete="off"
          spellCheck={false}
          value={query}
          placeholder={placeholder}
          onChange={(event) => {
            changeQuery(event.target.value);
          }}
          onKeyDown={onKeyDown}
          className="h-full min-w-0 flex-1 bg-transparent text-md text-fg outline-none placeholder:text-fg-subtle"
        />
        {loading ? <Spinner size="sm" label="Searching" /> : null}
        <Kbd className="touch:hidden">Esc</Kbd>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className={cn(
              'relative hidden min-h-tap shrink-0 items-center text-base font-medium text-accent-fg touch:inline-flex',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
            )}
          >
            Cancel
          </button>
        ) : null}
      </div>

      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={page ? page.label : label}
        aria-busy={loading || undefined}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5 empty:hidden"
      >
        {loading
          ? null
          : groups.map(([group, list]) => (
              <CommandGroup key={group || 'ungrouped'} heading={group}>
                {list.map((item) => {
                  const index = flat.indexOf(item);
                  const isActive = index === active;
                  return (
                    <div
                      key={item.id}
                      id={`${optionId}-${item.id}`}
                      role="option"
                      aria-selected={isActive}
                      aria-disabled={item.disabled || undefined}
                      data-active={isActive || undefined}
                      onClick={() => {
                        run(item);
                      }}
                      onPointerMove={() => {
                        if (!isActive && !item.disabled) setActive(index);
                      }}
                      className={cn(
                        'flex min-h-10.5 cursor-pointer items-center gap-3 rounded-sm px-2.5 py-1.5 select-none',
                        'touch:min-h-13',
                        'data-active:bg-surface-sunken',
                        'aria-disabled:cursor-default aria-disabled:text-fg-disabled',
                      )}
                    >
                      {item.avatar ? (
                        <span aria-hidden className="grid size-7 shrink-0 place-items-center">
                          {item.avatar}
                        </span>
                      ) : item.icon ? (
                        <span
                          aria-hidden
                          className="grid size-7 shrink-0 place-items-center rounded-xs bg-surface-sunken text-fg-muted [&_svg]:size-4"
                        >
                          {item.icon}
                        </span>
                      ) : null}
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-base font-medium">
                          <Highlight text={item.label} query={filter ? query : ''} />
                        </span>
                        {item.description ? (
                          <span className="truncate text-xs text-fg-muted">{item.description}</span>
                        ) : null}
                      </span>
                      {item.shortcut ? (
                        <KbdShortcut
                          aria-hidden
                          keys={item.shortcut}
                          className="shrink-0 touch:hidden"
                        />
                      ) : null}
                      {item.items ? (
                        <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-subtle" />
                      ) : null}
                    </div>
                  );
                })}
              </CommandGroup>
            ))}
      </div>

      {loading ? (
        <div aria-hidden className="flex flex-col gap-3 p-3.5">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-3">
              <span className="size-7 animate-pulse rounded-xs bg-surface-sunken" />
              <span className="flex flex-1 flex-col gap-1.5">
                <span className="h-2.5 w-3/5 animate-pulse rounded-full bg-surface-sunken" />
                <span className="h-2 w-1/3 animate-pulse rounded-full bg-surface-sunken" />
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {showEmpty ? (
        <div className="px-4 py-6">
          {empty ?? <p className="text-center text-sm text-fg-muted">No results</p>}
        </div>
      ) : null}

      <p aria-live="polite" className="sr-only">
        {loading
          ? ''
          : query === ''
            ? ''
            : `${String(flat.length)} ${flat.length === 1 ? 'result' : 'results'}`}
      </p>

      <div
        aria-hidden
        className="flex shrink-0 gap-3.5 border-t border-border px-4 py-2.5 text-xs text-fg-muted touch:hidden"
      >
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> move
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd> open
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>⌫</Kbd> back
        </span>
      </div>
    </div>
  );
}

function CommandGroup({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}): JSX.Element {
  const id = useId();
  if (!heading) return <div role="group">{children}</div>;
  return (
    <div role="group" aria-labelledby={id}>
      <div
        id={id}
        role="presentation"
        className="px-2.5 pt-2 pb-1 text-xs font-semibold text-fg-subtle"
      >
        {heading}
      </div>
      {children}
    </div>
  );
}

export interface CommandPaletteProps extends CommandProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * A letter that toggles the palette with ⌘ or Ctrl, anywhere on the page.
   * Off by default: two palettes mounted with the same key would both open.
   */
  hotkey?: string;
}

/**
 * `Command` in a modal dialog: centred near the top at a desk, full screen
 * under a finger, where it opens from a search button rather than a shortcut.
 */
export function CommandPalette({
  open,
  onOpenChange,
  hotkey,
  className,
  onClose,
  ...props
}: CommandPaletteProps): JSX.Element {
  useEffect(() => {
    if (!hotkey) return;
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === hotkey.toLowerCase()) {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [hotkey, open, onOpenChange]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal container={usePortalContainer()}>
        <DialogPrimitive.Overlay
          data-material="scrim"
          className={cn(
            'fixed inset-0 z-50 bg-overlay backdrop-blur-[2px]',
            'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out',
          )}
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // Focus the field, not the first tabbable, which on a nested page is
          // the back button.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            elementFrom(event.target)?.querySelector('input')?.focus();
          }}
          className={cn(
            'fixed inset-x-0 top-[12vh] z-50 mx-auto flex max-h-[76vh] w-[calc(100%-2rem)] max-w-140 flex-col',
            'focus-visible:outline-none',
            'popover-motion',
            'touch:inset-0 touch:max-h-none touch:w-full touch:max-w-none touch:pt-safe-top',
          )}
        >
          <DialogPrimitive.Title className="sr-only">
            {props.label ?? 'Command palette'}
          </DialogPrimitive.Title>
          <Command
            {...props}
            onClose={() => {
              onClose?.();
              onOpenChange(false);
            }}
            className={cn('touch:h-full touch:rounded-none touch:shadow-none', className)}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
