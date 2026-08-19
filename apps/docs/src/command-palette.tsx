'use client';

/**
 * ⌘K.
 *
 * A reader who knows the name of the component wants to type it and press
 * Enter, not to find the sidebar, scroll it, and click. The previous ⌘K merely
 * focused a filter box, which still left them navigating with the mouse.
 *
 * Built on Reach's `Dialog`, so the focus trap, the Escape handling, the scroll
 * lock and the return of focus to whatever was focused before are the design
 * system's problem rather than this file's. What is left is the list and the
 * keyboard, which is the part that is actually specific to a palette.
 */

import { Dialog, DialogContent, DialogTitle, Kbd } from '@reach/ui';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';

export interface CommandItem {
  readonly slug: string;
  readonly title: string;
  /** The sidebar group, shown as the second line so duplicates are separable. */
  readonly group: string;
}

/**
 * Subsequence matching, the way an editor's file switcher works.
 *
 * "dtp" finds "Date picker" because the letters appear in order. Substring
 * matching would not, and a reader who has learned that habit in VS Code will
 * try it here within about a minute.
 *
 * The score is what keeps the ordering sane: an earlier first match and tighter
 * spacing between matched letters both rank higher, so typing "tab" puts "Tabs"
 * above "Tags input" instead of leaving the order to chance.
 */
function score(haystack: string, needle: string): number | null {
  if (needle === '') return 0;
  const text = haystack.toLowerCase();
  let at = -1;
  let total = 0;

  for (const character of needle.toLowerCase()) {
    const found = text.indexOf(character, at + 1);
    if (found === -1) return null;
    // A gap costs; a run of adjacent letters costs nothing.
    total += found - at - 1;
    at = found;
  }

  // A match that starts at the beginning of the name is almost always the one
  // the reader meant.
  return total + (text.startsWith(needle.toLowerCase()) ? 0 : 4);
}

export function CommandPalette({
  open,
  onOpenChange,
  items,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: readonly CommandItem[];
  onSelect: (slug: string) => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const needle = query.trim();
    return items
      .map((item) => ({ item, rank: score(`${item.title} ${item.group}`, needle) }))
      .filter((row): row is { item: CommandItem; rank: number } => row.rank !== null)
      .toSorted((a, b) => a.rank - b.rank || a.item.title.localeCompare(b.item.title))
      .slice(0, 40)
      .map((row) => row.item);
  }, [items, query]);

  // A new query means a new list, and the highlight has to start at the top of
  // it rather than sitting on whatever index it happened to hold.
  useEffect(() => {
    setActive(0);
  }, [query]);

  // Reopening should not resume someone else's half-typed search.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  /*
   * Keep the highlighted row on screen while arrowing.
   *
   * `block: 'nearest'` scrolls the minimum needed, so holding the down arrow
   * walks the list a row at a time instead of jumping it half a panel per step.
   */
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const commit = useCallback(
    (slug: string) => {
      onOpenChange(false);
      onSelect(slug);
    },
    [onOpenChange, onSelect],
  );

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      // The list is the thing being navigated, so the caret must not move too.
      event.preventDefault();
      setActive((current) => {
        const next = event.key === 'ArrowDown' ? current + 1 : current - 1;
        // Wrapping, because a list this short is faster to reach from either end.
        return (next + results.length) % Math.max(results.length, 1);
      });
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = results[active];
      if (chosen) commit(chosen.slug);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-24 max-w-lg translate-y-0 p-0"
        onOpenAutoFocus={(event) => {
          /*
           * Focus the field, not the panel. Radix focuses the first tabbable
           * element by default, which here would be the close button, and the
           * reader would have to press Tab before they could type.
           */
          event.preventDefault();
          const input = event.currentTarget as HTMLElement;
          input.querySelector<HTMLInputElement>('input')?.focus();
        }}
      >
        <DialogTitle className="sr-only">Search the documentation</DialogTitle>

        <div className="border-b border-border p-2">
          <input
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search components…"
            aria-label="Search components"
            // The listbox pattern: the input keeps focus and tells assistive
            // tech which option is active, so arrowing is announced.
            role="combobox"
            aria-expanded
            aria-controls="command-results"
            aria-activedescendant={results[active] ? `command-${results[active].slug}` : undefined}
            className="w-full bg-transparent px-2 py-1.5 text-base text-fg outline-none placeholder:text-fg-subtle"
          />
        </div>

        <ul
          ref={listRef}
          id="command-results"
          role="listbox"
          aria-label="Results"
          className="max-h-80 overflow-y-auto p-1.5"
        >
          {results.map((item, index) => (
            <li
              key={item.slug}
              id={`command-${item.slug}`}
              role="option"
              aria-selected={index === active}
              // Pointer-down, not click: the highlight should already have moved
              // by the time the reader has finished pressing.
              onPointerDown={(event) => {
                event.preventDefault();
                commit(item.slug);
              }}
              onPointerMove={() => {
                setActive(index);
              }}
              className={[
                'flex cursor-pointer items-baseline justify-between gap-3 rounded-sm px-2.5 py-1.5',
                index === active ? 'bg-surface-hover text-fg' : 'text-fg-muted',
              ].join(' ')}
            >
              <span className="text-sm">{item.title}</span>
              <span className="text-2xs text-fg-subtle uppercase">{item.group}</span>
            </li>
          ))}

          {results.length === 0 ? (
            <li className="px-2.5 py-6 text-center text-sm text-fg-muted">
              Nothing matches “{query}”.
            </li>
          ) : null}
        </ul>

        <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-2xs text-fg-subtle">
          <span className="flex items-center gap-1">
            <Kbd keyName="up" />
            <Kbd keyName="down" /> to move
          </span>
          <span className="flex items-center gap-1">
            <Kbd keyName="enter" /> to open
          </span>
          <span className="flex items-center gap-1">
            <Kbd keyName="esc" /> to close
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
