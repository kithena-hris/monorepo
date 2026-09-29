import { z } from 'zod';

import { currentPlace, currentTab, type Place } from './remotes';

/**
 * Every keyboard shortcut in the tenant app, in one table.
 *
 * The handler, the `?` dialog, the ⌘K palette, the sidebar's and the rail's
 * hints, People's flyout, the account menu and Settings › Keyboard shortcuts
 * all read this table, through `effective`, which lays a person's own keys
 * over it. Nothing else names a key.
 *
 * Going somewhere is `G` then a letter: two keys, so one stray press never
 * moves anybody, and every destination under one memorable prefix. Within a
 * page, `/` searches it and `[` `]` step through its tabs or views. The keys
 * with a modifier belong to the Reach components that handle them (⌘K the
 * palette, ⌘\ the sidebar) and are listed here so they can be shown and so
 * nothing is bound over them.
 *
 * Pure, and no `server-only`: the settings page validates a change with it as
 * it is recorded, and its server action validates the whole set again.
 */

export type ShortcutGroupName = 'Go to' | 'On a page' | 'Everywhere';

export interface Shortcut {
  readonly id: string;
  readonly group: ShortcutGroupName;
  readonly label: string;
  /** What it does, to finish "G then D already …": "opens Directory". */
  readonly does: string;
  /** Chords as Reach's `chordOf` writes them: `['g', 'd']`, `['mod+k']`. */
  readonly keys: readonly string[];
  /**
   * Where a go-to shortcut goes. For a People section, where the section
   * starts: `destinationOf` finds the page under it this viewer opens.
   */
  readonly href?: string;
  /** A Reach icon name, for the palette. */
  readonly icon?: string;
  /** Handled by a Reach component or the browser: listed, reserved, never rebound. */
  readonly fixed?: true;
}

const go = (id: string, label: string, letter: string, href: string, icon?: string): Shortcut => ({
  id: `go.${id}`,
  group: 'Go to',
  label,
  does: `opens ${label}`,
  keys: ['g', letter],
  href,
  ...(icon === undefined ? {} : { icon }),
});

export const SHORTCUTS: readonly Shortcut[] = [
  go('home', 'Home', 'h', '/', 'home'),
  go('time-off', 'Time off', 't', '/time-off', 'leave'),
  go('people', 'People', 'p', '/people', 'people'),
  go('directory', 'Directory', 'd', '/people/directory'),
  go('approvals', 'Approvals', 'a', '/people/approvals'),
  // Q for quality: H is home, and data health is the quality of the records.
  go('data-health', 'Data health', 'q', '/people/data-health'),
  go('import-export', 'Import & export', 'x', '/people/import-export'),
  go('insights', 'Insights', 'i', '/people/insights'),
  go('inbox', 'Inbox', 'n', '/inbox', 'inbox'),
  go('me', 'My profile', 'm', '/people/me', 'person'),
  go('settings', 'Settings', 's', '/settings', 'settings'),
  // L for log: who did what, when.
  go('activity', 'Activity', 'l', '/settings/activity', 'history'),
  go('shortcuts', 'Keyboard shortcuts', 'k', '/settings/shortcuts', 'shortcuts'),
  {
    id: 'page.search',
    group: 'On a page',
    label: 'Search this page',
    does: 'searches the page',
    keys: ['/'],
  },
  {
    id: 'page.previous',
    group: 'On a page',
    label: 'Previous tab or view',
    does: 'moves to the previous tab',
    keys: ['['],
  },
  {
    id: 'page.next',
    group: 'On a page',
    label: 'Next tab or view',
    does: 'moves to the next tab',
    keys: [']'],
  },
  {
    id: 'page.close',
    group: 'On a page',
    label: 'Close what is open',
    does: 'closes what is open',
    keys: ['escape'],
    fixed: true,
  },
  {
    id: 'help',
    group: 'Everywhere',
    label: 'Show keyboard shortcuts',
    does: 'shows the keyboard shortcuts',
    keys: ['?'],
    fixed: true,
  },
  {
    id: 'palette',
    group: 'Everywhere',
    label: 'Search people and pages',
    does: 'opens search',
    keys: ['mod+k'],
    fixed: true,
  },
  {
    id: 'sidebar',
    group: 'Everywhere',
    label: 'Collapse or expand the sidebar',
    does: 'collapses the sidebar',
    keys: ['mod+\\'],
    fixed: true,
  },
  {
    id: 'assistant',
    group: 'Everywhere',
    label: 'Open the assistant',
    does: 'opens the assistant',
    keys: ['mod+j'],
    fixed: true,
  },
];

export const GROUPS: readonly ShortcutGroupName[] = ['Go to', 'On a page', 'Everywhere'];

/** A chord's keys: `'mod+k'` is `['mod', 'k']`, `'mod++'` is `['mod', '+']`. Reach's `keysOfChord`. */
function keysOf(chord: string): string[] {
  if (chord === '+') return ['+'];
  return chord.endsWith('++') ? [...chord.slice(0, -2).split('+'), '+'] : chord.split('+');
}

/** A chord with no modifier: a key that types a character, which WCAG 2.1.4 lets a person turn off. */
export function isCharacterKey(chord: string): boolean {
  const keys = keysOf(chord);
  return keys.length === 1 && (keys[0]?.length === 1 || chord === 'space');
}

const WORDS: Readonly<Record<string, readonly [apple: string, other: string]>> = {
  mod: ['⌘', 'Ctrl'],
  shift: ['⇧', 'Shift'],
  alt: ['⌥', 'Alt'],
  escape: ['Esc', 'Esc'],
  enter: ['Return', 'Enter'],
  space: ['Space', 'Space'],
  tab: ['Tab', 'Tab'],
  backspace: ['Delete', 'Backspace'],
  delete: ['Del', 'Delete'],
  arrowup: ['↑', '↑'],
  arrowdown: ['↓', '↓'],
  arrowleft: ['←', '←'],
  arrowright: ['→', '→'],
};

/** Keys as words, for a sentence: "G then D", "⌘K" on a Mac, "Ctrl+K" elsewhere. */
export function spoken(keys: readonly string[], apple = false): string {
  return keys
    .map((chord) =>
      keysOf(chord)
        .map((key) => {
          const word = WORDS[key];
          if (word !== undefined) return apple ? word[0] : word[1];
          return key.length === 1 ? key.toUpperCase() : `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
        })
        .join(apple ? '' : '+'),
    )
    .join(' then ');
}

/**
 * What a person has changed, and whether keys without a modifier are on.
 * Stored per person (identity's account preference `shortcuts`), so their
 * keys follow them from one device to the next.
 */
export interface ShortcutPrefs {
  /** By shortcut id, the keys that replace its default. Only what differs. */
  readonly bindings: Readonly<Record<string, readonly string[]>>;
  /** Single-key shortcuts (`G` `D`, `/`, `?`): off for anyone they get in the way of (WCAG 2.1.4). */
  readonly characterKeys: boolean;
}

export const DEFAULT_PREFS: ShortcutPrefs = { bindings: {}, characterKeys: true };

/** A chord as `chordOf` writes one: modifiers, then a key. Checked, because it arrives from a browser. */
const Chord = z
  .string()
  .min(1)
  .max(24)
  .regex(/^(?:(?:mod|alt|shift)\+)*(?:.|[a-z][a-z0-9]*)$/u);

export const ShortcutPrefsSchema = z.object({
  bindings: z.record(z.string().max(64), z.array(Chord).min(1).max(2)),
  characterKeys: z.boolean(),
});

/** Stored preferences as the app uses them: anything unreadable is the defaults. */
export function prefsFrom(value: unknown): ShortcutPrefs {
  const parsed = ShortcutPrefsSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_PREFS;
}

/** The table with a person's own keys laid over the defaults. */
export function effective(bindings: ShortcutPrefs['bindings']): readonly Shortcut[] {
  return SHORTCUTS.map((s) => {
    const keys = bindings[s.id];
    return keys === undefined || s.fixed === true ? s : { ...s, keys };
  });
}

/**
 * Keys the browser or the computer already answers to, or that move around a
 * page. Binding over them would break something a person relies on.
 */
const RESERVED: ReadonlySet<string> = new Set([
  ...'acdfhlmnopqrstvwxyz0123456789'.split('').map((k) => `mod+${k}`),
  'mod+shift+t',
  'mod+shift+n',
  'mod+shift+w',
  'mod+shift+z',
  'mod+=',
  'mod+-',
  'mod+,',
  'mod+[',
  'mod+]',
  'mod+tab',
  'mod+shift+tab',
  'alt+arrowleft',
  'alt+arrowright',
  'tab',
  'shift+tab',
  'enter',
  'space',
  'backspace',
  'delete',
  'arrowup',
  'arrowdown',
  'arrowleft',
  'arrowright',
  'home',
  'end',
  'pageup',
  'pagedown',
  'f5',
  'f11',
  'f12',
]);

const startsWith = (keys: readonly string[], prefix: readonly string[]): boolean =>
  prefix.length < keys.length && prefix.every((chord, i) => keys[i] === chord);
const same = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((chord, i) => b[i] === chord);

/**
 * Why `keys` cannot be shortcut `id` in `table`, as the sentence the field
 * shows; `null` when they can.
 *
 * Refused: nothing, more than two chords, a key the browser or the computer
 * owns, keys another shortcut already has (fixed or changed), and a prefix
 * clash either way — `G` alone while `G` then `D` exists could never let the
 * second key through, and `G` then `D` while `G` alone exists could never be
 * reached.
 */
export function problemWith(
  table: readonly Shortcut[],
  id: string,
  keys: readonly string[],
  apple = false,
): string | null {
  const say = (k: readonly string[]): string => spoken(k, apple);
  if (keys.length === 0) return 'Press the keys for this shortcut.';
  if (keys.length > 2) return 'A shortcut is one key or two in a row. Choose another.';
  const owned = keys.find((chord) => RESERVED.has(chord));
  if (owned !== undefined) {
    return `${say([owned])} belongs to your browser or computer. Choose another.`;
  }
  for (const other of table) {
    if (other.id === id) continue;
    if (same(keys, other.keys)) {
      return `${say(keys)} already ${other.does}. Choose another.`;
    }
    if (startsWith(other.keys, keys)) {
      return `${say(keys)} starts ${say(other.keys)}, which ${other.does}. Choose another.`;
    }
    if (startsWith(keys, other.keys)) {
      return `${say(other.keys)} already ${other.does}, so ${say(keys)} could never be reached. Choose another.`;
    }
  }
  return null;
}

/** The first thing wrong with a whole set of changes, or `null`: what the server checks on saving. */
export function problemIn(bindings: ShortcutPrefs['bindings'], apple = false): string | null {
  const table = effective(bindings);
  for (const [id, keys] of Object.entries(bindings)) {
    const shortcut = SHORTCUTS.find((s) => s.id === id);
    if (shortcut === undefined) return 'That shortcut does not exist.';
    if (shortcut.fixed === true) return `${spoken(shortcut.keys, apple)} cannot be changed.`;
    const problem = problemWith(table, id, keys, apple);
    if (problem !== null) return problem;
  }
  return null;
}

/** What a viewer can reach, for resolving where each go-to shortcut goes. */
export interface Reachable {
  /** People's sections this viewer opens (`placesFor`); empty without People. */
  readonly sections: readonly Place[];
  /** Whether the company has People: its home, your profile and the inbox. */
  readonly people: boolean;
  /** Whether time off is there to open: bought and built. */
  readonly timeOff: boolean;
  /** Whether Settings › Activity is theirs to read: People administrators and HR. */
  readonly activity: boolean;
}

const PEOPLE_OWN = new Set(['/people', '/people/me', '/inbox']);

/** Where a go-to shortcut takes this viewer, or `null` where it goes nowhere they can open. */
export function destinationOf(shortcut: Shortcut, reach: Reachable): string | null {
  const { href } = shortcut;
  if (href === undefined) return null;
  if (PEOPLE_OWN.has(href)) return reach.people ? href : null;
  if (href.startsWith('/people/')) {
    const section = reach.sections.find(
      (s) => s.path === href || s.path.startsWith(`${href}/`),
    );
    return section?.path ?? null;
  }
  if (href === '/time-off') return reach.timeOff ? href : null;
  if (href === '/settings/activity') return reach.activity ? href : null;
  return href;
}

/** The Directory's views, in the order its switch shows them. */
export const DIRECTORY_VIEWS = ['list', 'cards', 'org-chart'] as const;
export type DirectoryView = (typeof DIRECTORY_VIEWS)[number];

/**
 * A Directory view's address, keeping the search and the filters from `search`
 * but not the page, nor what only the org chart reads.
 */
export function viewHref(view: DirectoryView, search: string): string {
  const q = new URLSearchParams(search);
  q.delete('after');
  if (view !== 'org-chart') for (const key of ['focus', 'layout']) q.delete(key);
  const qs = q.toString();
  return `/people/directory/${view}${qs === '' ? '' : `?${qs}`}`;
}

/**
 * The tab `step` away from this one, for `[` and `]`: the next Directory view
 * (with its search and filters), or the next tab of an umbrella page (Data
 * health, Insights) among those this viewer opens. `null` at either end, and
 * on a page with neither.
 */
export function adjacentPage(
  sections: readonly Place[],
  route: string | null,
  location: { readonly pathname: string; readonly search: string },
  step: 1 | -1,
): string | null {
  const view = DIRECTORY_VIEWS.findIndex((v) => location.pathname === `/people/directory/${v}`);
  if (view !== -1) {
    const next = DIRECTORY_VIEWS[view + step];
    return next === undefined ? null : viewHref(next, location.search);
  }
  const section = currentPlace(sections, route);
  const tab = currentTab(section, route);
  const tabs = section?.tabs;
  if (tabs === undefined || tab === undefined) return null;
  return tabs[tabs.indexOf(tab) + step]?.path ?? null;
}
