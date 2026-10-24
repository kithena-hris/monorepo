import { currentPlace, currentTab, type Place } from './remotes';
import { t } from './t';

/**
 * Every keyboard shortcut in the tenant app, in one table.
 *
 * The handler, the `?` dialog, the ⌘K palette, the sidebar's and the rail's
 * hints, People's flyout, the account menu and Settings › Keyboard shortcuts
 * all read this table, through `effective`, which lays a person's own keys
 * over it. Nothing else names a key.
 *
 * Linear's way, for an HR tool. Going somewhere is `G` then a letter: two
 * keys, so one stray press never moves anybody, and every destination under
 * one memorable prefix. Within a page, `/` searches it and `[` `]` step
 * through its tabs or views. A list moves on J and K, opens on Enter or O,
 * selects on X; the focused row's own actions are single letters (A approves,
 * R declines), and C creates whatever the page makes. The keys with a
 * modifier that Reach components answer (⌘K the palette, ⌘\ the sidebar) and
 * Escape are listed so they can be shown and so nothing is bound over them.
 *
 * `scope` says when a key is live. Global keys always; `list` keys while a
 * row of a list has focus, with the global ones; a `row:` scope's keys while a
 * row of that screen has focus. Two keys clash when they can be live at once:
 * a row key of Approvals may share its letter with one of Completeness, never
 * with a global or a list key.
 *
 * Pure, and no `server-only`: the settings page validates a change with it as
 * it is recorded, and its server action validates the whole set again.
 */

export type ShortcutGroupName =
  'Navigation' | 'Lists' | 'Actions' | 'Create' | 'Forms' | 'Everywhere';

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
  /** When it is live: everywhere (absent), in a focused list, or on one screen's focused row. */
  readonly scope?: 'list' | `row:${string}`;
}

/** Words in the reader's language, read when they are shown: the table itself is made once. */
type Words = () => string;

const go = (id: string, label: Words, letter: string, href: string, icon?: string): Shortcut => ({
  id: `go.${id}`,
  group: 'Navigation',
  get label(): string {
    return label();
  },
  get does(): string {
    return t('lib.shortcuts.opens_label', 'opens {{label}}', { label: label() });
  },
  keys: ['g', letter],
  href,
  ...(icon === undefined ? {} : { icon }),
});

const list = (id: string, label: Words, does: Words, keys: readonly string[]): Shortcut => ({
  id: `list.${id}`,
  group: 'Lists',
  get label(): string {
    return label();
  },
  get does(): string {
    return does();
  },
  keys,
  scope: 'list',
});

const row = (screen: string, id: string, label: Words, does: Words, key: string): Shortcut => ({
  id: `row.${id}`,
  group: 'Actions',
  get label(): string {
    return label();
  },
  get does(): string {
    return does();
  },
  keys: [key],
  scope: `row:${screen}`,
});

export const SHORTCUTS: readonly Shortcut[] = [
  go('home', () => t('lib.shortcuts.home', 'Home'), 'h', '/', 'home'),
  go('time-off', () => t('lib.shortcuts.time_off', 'Time off'), 't', '/time-off', 'leave'),
  go('people', () => t('lib.shortcuts.people', 'People'), 'p', '/people', 'people'),
  go('directory', () => t('lib.shortcuts.directory', 'Directory'), 'd', '/people/directory'),
  // R for Review: every decision and missing detail, in one queue.
  go('review', () => t('lib.shortcuts.review', 'Review'), 'r', '/people/review'),
  go(
    'import-export',
    () => t('lib.shortcuts.import_export', 'Import & export'),
    'x',
    '/people/import-export',
  ),
  go('insights', () => t('lib.shortcuts.insights', 'Insights'), 'i', '/people/insights'),
  go('inbox', () => t('lib.shortcuts.inbox', 'Inbox'), 'n', '/inbox', 'inbox'),
  go('me', () => t('lib.shortcuts.my_profile', 'My profile'), 'm', '/people/me', 'person'),
  go('settings', () => t('lib.shortcuts.settings', 'Settings'), 's', '/settings', 'settings'),
  // L for log: who did what, when.
  go(
    'activity',
    () => t('lib.shortcuts.activity', 'Activity'),
    'l',
    '/settings/activity',
    'history',
  ),
  go(
    'shortcuts',
    () => t('lib.shortcuts.keyboard_shortcuts', 'Keyboard shortcuts'),
    'k',
    '/settings/shortcuts',
    'shortcuts',
  ),
  {
    id: 'page.search',
    group: 'Navigation',
    get label(): string {
      return t('lib.shortcuts.search_this_page', 'Search this page');
    },
    get does(): string {
      return t('lib.shortcuts.searches_the_page', 'searches the page');
    },
    keys: ['/'],
    fixed: true,
  },
  {
    id: 'page.previous',
    group: 'Navigation',
    get label(): string {
      return t('lib.shortcuts.previous_tab_or_view', 'Previous tab or view');
    },
    get does(): string {
      return t('lib.shortcuts.moves_to_the_previous_tab', 'moves to the previous tab');
    },
    keys: ['['],
    fixed: true,
  },
  {
    id: 'page.next',
    group: 'Navigation',
    get label(): string {
      return t('lib.shortcuts.next_tab_or_view', 'Next tab or view');
    },
    get does(): string {
      return t('lib.shortcuts.moves_to_the_next_tab', 'moves to the next tab');
    },
    keys: [']'],
    fixed: true,
  },
  // First of the three Escapes, so a clash names the one everybody knows.
  {
    id: 'page.close',
    group: 'Everywhere',
    get label(): string {
      return t('lib.shortcuts.close_what_is_open', 'Close what is open');
    },
    get does(): string {
      return t('lib.shortcuts.closes_what_is_open', 'closes what is open');
    },
    keys: ['escape'],
    fixed: true,
  },
  list(
    'next',
    () => t('lib.shortcuts.next_row_or', 'Next row (or ↓)'),
    () => t('lib.shortcuts.moves_to_the_next_row', 'moves to the next row'),
    ['j'],
  ),
  list(
    'previous',
    () => t('lib.shortcuts.previous_row_or', 'Previous row (or ↑)'),
    () => t('lib.shortcuts.moves_to_the_previous_row', 'moves to the previous row'),
    ['k'],
  ),
  list(
    'open',
    () => t('lib.shortcuts.open_the_row_or_enter', 'Open the row (or Enter)'),
    () => t('lib.shortcuts.opens_the_row', 'opens the row'),
    ['o'],
  ),
  list(
    'select',
    () => t('lib.shortcuts.select_the_row', 'Select the row'),
    () => t('lib.shortcuts.selects_the_row', 'selects the row'),
    ['x'],
  ),
  list(
    'extend-next',
    () => t('lib.shortcuts.select_down_or', 'Select down (or ⇧↓)'),
    () => t('lib.shortcuts.extends_the_selection_down', 'extends the selection down'),
    ['shift+j'],
  ),
  list(
    'extend-previous',
    () => t('lib.shortcuts.select_up_or', 'Select up (or ⇧↑)'),
    () => t('lib.shortcuts.extends_the_selection_up', 'extends the selection up'),
    ['shift+k'],
  ),
  list(
    'preview',
    () => t('lib.shortcuts.quick_look', 'Quick look'),
    () => t('lib.shortcuts.opens_the_quick_look', 'opens the quick look'),
    ['space'],
  ),
  {
    id: 'list.clear',
    group: 'Lists',
    get label(): string {
      return t('lib.shortcuts.clear_the_selection_then_leave', 'Clear the selection, then leave');
    },
    get does(): string {
      return t('lib.shortcuts.clears_the_selection', 'clears the selection');
    },
    keys: ['escape'],
    fixed: true,
    scope: 'list',
  },
  row(
    'approvals',
    'approve',
    () => t('lib.shortcuts.approve_review', 'Approve (Review)'),
    () => t('lib.shortcuts.approves_the_change', 'approves the change'),
    'a',
  ),
  row(
    'approvals',
    'decline',
    () => t('lib.shortcuts.decline_review', 'Decline (Review)'),
    () => t('lib.shortcuts.declines_the_change', 'declines the change'),
    'r',
  ),
  row(
    'duplicates',
    'merge',
    () => t('lib.shortcuts.merge_review', 'Merge (Review)'),
    () => t('lib.shortcuts.compares_the_pair', 'compares the pair'),
    'm',
  ),
  row(
    'duplicates',
    'not-same',
    () => t('lib.shortcuts.not_the_same_person_review', 'Not the same person (Review)'),
    () => t('lib.shortcuts.keeps_the_pair_apart', 'keeps the pair apart'),
    'n',
  ),
  row(
    'completeness',
    'fill',
    () => t('lib.shortcuts.fill_in_review', 'Fill in (Review)'),
    () => t('lib.shortcuts.fills_in_the_gaps', 'fills in the gaps'),
    'f',
  ),
  row(
    'completeness',
    'remind',
    () => t('lib.shortcuts.remind_review', 'Remind (Review)'),
    () => t('lib.shortcuts.sends_a_reminder', 'sends a reminder'),
    'r',
  ),
  row(
    'directory',
    'edit',
    () => t('lib.shortcuts.edit_the_profile_directory', 'Edit the profile (Directory)'),
    () => t('lib.shortcuts.edits_the_profile', 'edits the profile'),
    'e',
  ),
  // V for view: on a profile an administrator may view as, it asks why and
  // starts; while viewing as somebody, it ends the view.
  {
    id: 'view-as',
    group: 'Actions',
    get label(): string {
      return t(
        'lib.shortcuts.view_as_this_person_or_end_viewing',
        'View as this person, or end viewing as them',
      );
    },
    get does(): string {
      return t('lib.shortcuts.views_as_them_or_ends_it', 'views as them, or ends it');
    },
    keys: ['v'],
    icon: 'visible',
  },
  // The clock in the top bar, on every page of a company with Time Off: the
  // screen that offers `clock` (`useScreenCommand`) opens and closes it.
  {
    id: 'clock',
    group: 'Everywhere',
    get label(): string {
      return t('lib.shortcuts.open_or_close_the_clock', 'Open or close the clock');
    },
    get does(): string {
      return t('lib.shortcuts.opens_the_clock', 'opens the clock');
    },
    keys: ['alt+t'],
    icon: 'scheduled',
  },
  {
    id: 'create',
    group: 'Create',
    get label(): string {
      return t(
        'lib.shortcuts.create_what_this_page_makes_a_person',
        'Create what this page makes: a person, a schedule, an export',
      );
    },
    get does(): string {
      return t('lib.shortcuts.creates', 'creates');
    },
    keys: ['c'],
  },
  {
    id: 'form.submit',
    group: 'Forms',
    get label(): string {
      return t('lib.shortcuts.submit_the_form_or_dialog', 'Submit the form or dialog');
    },
    get does(): string {
      return t('lib.shortcuts.submits_the_form', 'submits the form');
    },
    keys: ['mod+enter'],
  },
  {
    id: 'form.cancel',
    group: 'Forms',
    get label(): string {
      return t('lib.shortcuts.cancel', 'Cancel');
    },
    get does(): string {
      return t('lib.shortcuts.cancels', 'cancels');
    },
    keys: ['escape'],
    fixed: true,
  },
  {
    id: 'help',
    group: 'Everywhere',
    get label(): string {
      return t('lib.shortcuts.show_keyboard_shortcuts', 'Show keyboard shortcuts');
    },
    get does(): string {
      return t('lib.shortcuts.shows_the_keyboard_shortcuts', 'shows the keyboard shortcuts');
    },
    keys: ['?'],
    fixed: true,
  },
  {
    id: 'palette',
    group: 'Everywhere',
    get label(): string {
      return t('lib.shortcuts.search_and_run_a_command', 'Search and run a command');
    },
    get does(): string {
      return t('lib.shortcuts.opens_search', 'opens search');
    },
    keys: ['mod+k'],
    fixed: true,
  },
  {
    id: 'sidebar',
    group: 'Everywhere',
    get label(): string {
      return t('lib.shortcuts.collapse_or_expand_the_sidebar', 'Collapse or expand the sidebar');
    },
    get does(): string {
      return t('lib.shortcuts.collapses_the_sidebar', 'collapses the sidebar');
    },
    keys: ['mod+\\'],
    fixed: true,
  },
  {
    id: 'assistant',
    group: 'Everywhere',
    get label(): string {
      return t('lib.shortcuts.open_the_assistant', 'Open the assistant');
    },
    get does(): string {
      return t('lib.shortcuts.opens_the_assistant', 'opens the assistant');
    },
    keys: ['mod+j'],
    fixed: true,
  },
];

/** A group's heading, in the reader's language. */
export function groupName(group: ShortcutGroupName): string {
  switch (group) {
    case 'Navigation':
      return t('lib.shortcuts.group_navigation', 'Navigation');
    case 'Lists':
      return t('lib.shortcuts.group_lists', 'Lists');
    case 'Actions':
      return t('lib.shortcuts.group_actions', 'Actions');
    case 'Create':
      return t('lib.shortcuts.group_create', 'Create');
    case 'Forms':
      return t('lib.shortcuts.group_forms', 'Forms');
    case 'Everywhere':
      return t('lib.shortcuts.group_everywhere', 'Everywhere');
  }
}

export const GROUPS: readonly ShortcutGroupName[] = [
  'Navigation',
  'Lists',
  'Actions',
  'Create',
  'Forms',
  'Everywhere',
];

/** A chord's keys: `'mod+k'` is `['mod', 'k']`, `'mod++'` is `['mod', '+']`. Reach's `keysOfChord`. */
function keysOf(chord: string): string[] {
  if (chord === '+') return ['+'];
  return chord.endsWith('++') ? [...chord.slice(0, -2).split('+'), '+'] : chord.split('+');
}

/**
 * A chord that types a character: a letter, a digit, a symbol or Space, with
 * Shift or without and nothing else held. What WCAG 2.1.4 lets a person turn
 * off. Reach's `isCharacterChord`, which this file cannot import: its server
 * action must not load the design system.
 */
export function isCharacterKey(chord: string): boolean {
  const keys = keysOf(chord);
  const key = keys.at(-1) ?? '';
  return keys.slice(0, -1).every((k) => k === 'shift') && (key.length === 1 || key === 'space');
}

/** A key's name as printed on the keyboard in the reader's language: Ctrl is Strg on a German one. */
const WORDS = (): Readonly<Record<string, readonly [apple: string, other: string]>> => ({
  mod: ['⌘', t('lib.shortcuts.key_ctrl', 'Ctrl')],
  shift: ['⇧', t('lib.shortcuts.key_shift', 'Shift')],
  alt: ['⌥', t('lib.shortcuts.key_alt', 'Alt')],
  escape: [t('lib.shortcuts.key_esc', 'Esc'), t('lib.shortcuts.key_esc', 'Esc')],
  enter: [t('lib.shortcuts.key_return', 'Return'), t('lib.shortcuts.key_enter', 'Enter')],
  space: [t('lib.shortcuts.key_space', 'Space'), t('lib.shortcuts.key_space', 'Space')],
  tab: [t('lib.shortcuts.key_tab', 'Tab'), t('lib.shortcuts.key_tab', 'Tab')],
  backspace: [
    t('lib.shortcuts.key_delete_mac', 'Delete'),
    t('lib.shortcuts.key_backspace', 'Backspace'),
  ],
  delete: [t('lib.shortcuts.key_del', 'Del'), t('lib.shortcuts.key_delete', 'Delete')],
  arrowup: ['↑', '↑'],
  arrowdown: ['↓', '↓'],
  arrowleft: ['←', '←'],
  arrowright: ['→', '→'],
});

/** Keys as words, for a sentence: "G then D", "⌘K" on a Mac, "Ctrl+K" elsewhere. */
export function spoken(keys: readonly string[], apple = false): string {
  const words = WORDS();
  return keys
    .map((chord) =>
      keysOf(chord)
        .map((key) => {
          const word = words[key];
          if (word !== undefined) return apple ? word[0] : word[1];
          return key.length === 1
            ? key.toUpperCase()
            : `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
        })
        .join(apple ? '' : '+'),
    )
    .join(t('lib.shortcuts.then', ' then '));
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

/** Whether two shortcuts can be live at the same moment, and so must not share keys. */
function together(a: Shortcut, b: Shortcut): boolean {
  if (a.scope === undefined || b.scope === undefined) return true;
  if (a.scope === 'list' || b.scope === 'list') return true;
  return a.scope === b.scope;
}

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
  const self = table.find((s) => s.id === id) ?? SHORTCUTS.find((s) => s.id === id);
  const initial = SHORTCUTS.find((s) => s.id === id)?.keys ?? [];
  if (keys.length === 0)
    return t('lib.shortcuts.press_the_keys', 'Press the keys for this shortcut.');
  if (keys.length > 2)
    return t(
      'lib.shortcuts.one_key_or_two',
      'A shortcut is one key or two in a row. Choose another.',
    );
  if (self?.scope !== undefined && keys.length > 1) {
    return t(
      'lib.shortcuts.a_list_key_is_one_key',
      'A key for a list or a row is one key, with or without a modifier. Choose another.',
    );
  }
  // Its own default is allowed: Space previews a list, where nothing scrolls.
  const owned = same(keys, initial) ? undefined : keys.find((chord) => RESERVED.has(chord));
  if (owned !== undefined) {
    return t(
      'lib.shortcuts.belongs_to_your_browser',
      '{{keys}} belongs to your browser or computer. Choose another.',
      { keys: say([owned]) },
    );
  }
  for (const other of table) {
    if (other.id === id) continue;
    // Escape is three fixed things at once, each where it belongs.
    if (self?.fixed === true && other.fixed === true) continue;
    if (self !== undefined && !together(self, other)) continue;
    if (same(keys, other.keys)) {
      return t('lib.shortcuts.already_does', '{{keys}} already {{does}}. Choose another.', {
        keys: say(keys),
        does: other.does,
      });
    }
    if (startsWith(other.keys, keys)) {
      return t(
        'lib.shortcuts.starts_another',
        '{{keys}} starts {{other}}, which {{does}}. Choose another.',
        { keys: say(keys), other: say(other.keys), does: other.does },
      );
    }
    if (startsWith(keys, other.keys)) {
      return t(
        'lib.shortcuts.could_never_be_reached',
        '{{other}} already {{does}}, so {{keys}} could never be reached. Choose another.',
        { keys: say(keys), other: say(other.keys), does: other.does },
      );
    }
  }
  return null;
}

/** The first thing wrong with a whole set of changes, or `null`: what the server checks on saving. */
export function problemIn(bindings: ShortcutPrefs['bindings'], apple = false): string | null {
  const table = effective(bindings);
  for (const [id, keys] of Object.entries(bindings)) {
    const shortcut = SHORTCUTS.find((s) => s.id === id);
    if (shortcut === undefined)
      return t('lib.shortcuts.that_shortcut_does_not_exist', 'That shortcut does not exist.');
    if (shortcut.fixed === true)
      return t('lib.shortcuts.cannot_be_changed', '{{keys}} cannot be changed.', {
        keys: spoken(shortcut.keys, apple),
      });
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
    const section = reach.sections.find((s) => s.path === href || s.path.startsWith(`${href}/`));
    return section?.path ?? null;
  }
  if (href === '/time-off') return reach.timeOff ? href : null;
  if (href === '/settings/activity') return reach.activity ? href : null;
  return href;
}

/**
 * What C makes on this page when the screen itself offers nothing
 * (`useScreenCommand('create')` wins): the area's action offered here (Add
 * person, on People's pages), or a new export from Import & export.
 */
export function createOn(
  actions: readonly Place[],
  route: string | null,
  pathname: string,
): { readonly label: string; readonly path: string } | null {
  const here = route ?? pathname;
  const action = actions.find((a) =>
    a.on === undefined ? pathname.startsWith('/people') : a.on.includes(here),
  );
  if (action !== undefined) return { label: action.label, path: action.path };
  if (pathname === '/people/import-export')
    return { label: t('lib.shortcuts.new_export', 'New export'), path: '/people/export' };
  return null;
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
