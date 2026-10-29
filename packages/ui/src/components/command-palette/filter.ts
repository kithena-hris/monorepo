import type { ReactNode } from 'react';

/*
 * A command palette's items and how a query finds them, in a module of their
 * own: an app builds its items on every page, and opens the palette that
 * draws them (`command-palette.tsx`, `@reach/ui/command-palette`) only when
 * somebody asks for it.
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
