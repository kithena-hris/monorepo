import { describe, expect, it } from 'vitest';

import { HR, FINANCE, PEOPLE_NAV } from './people-nav.fixture';
import { placesFor } from './remotes';
import {
  SHORTCUTS,
  adjacentPage,
  destinationOf,
  effective,
  problemIn,
  problemWith,
  spoken,
} from './shortcuts';
import { prefsFrom } from './shortcut-prefs';

describe('the shortcut table', () => {
  it('has no collisions: no two shortcuts share keys, and none starts another', () => {
    for (const shortcut of SHORTCUTS) {
      expect({
        id: shortcut.id,
        problem: problemWith(SHORTCUTS, shortcut.id, shortcut.keys),
      }).toEqual({
        id: shortcut.id,
        problem: null,
      });
    }
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length);
  });

  it('goes everywhere with G then a letter', () => {
    const goTo = SHORTCUTS.filter((s) => s.id.startsWith('go.'));
    expect(goTo.map((s) => s.label)).toEqual([
      'Home',
      'Time off',
      'People',
      'Directory',
      'Review',
      'Import & export',
      'Insights',
      'Inbox',
      'My profile',
      'Settings',
      'Activity',
      'Keyboard shortcuts',
    ]);
    for (const s of goTo) expect(s.keys[0]).toBe('g');
    // G R opens Review; it replaced G A and G Q.
    expect(SHORTCUTS.find((s) => s.id === 'go.review')?.keys).toEqual(['g', 'r']);
    expect(SHORTCUTS.find((s) => s.id === 'go.activity')?.href).toBe('/settings/activity');
  });
});

describe('refusing keys', () => {
  const table = effective({});

  it('refuses keys another shortcut has, naming what they do', () => {
    expect(problemWith(table, 'go.home', ['g', 'd'])).toBe(
      'G then D already opens Directory. Choose another.',
    );
    // A changed shortcut counts as much as a default one.
    const changed = effective({ 'go.directory': ['g', 'e'] });
    expect(problemWith(changed, 'go.home', ['g', 'e'])).toBe(
      'G then E already opens Directory. Choose another.',
    );
    expect(problemWith(changed, 'go.home', ['g', 'd'])).toBeNull();
  });

  it('refuses the fixed keys too: ⌘K, ⌘\\, ?, /, Esc, [ and ]', () => {
    expect(problemWith(table, 'go.home', ['mod+k'], true)).toBe(
      '⌘K already opens search. Choose another.',
    );
    expect(problemWith(table, 'go.home', ['mod+k'])).toBe(
      'Ctrl+K already opens search. Choose another.',
    );
    expect(problemWith(table, 'go.home', ['mod+\\'], true)).toBe(
      '⌘\\ already collapses the sidebar. Choose another.',
    );
    expect(problemWith(table, 'go.home', ['?'])).toBe(
      '? already shows the keyboard shortcuts. Choose another.',
    );
    expect(problemWith(table, 'go.home', ['/'])).toBe(
      '/ already searches the page. Choose another.',
    );
    expect(problemWith(table, 'go.home', ['escape'])).toBe(
      'Esc already closes what is open. Choose another.',
    );
    expect(problemWith(table, 'go.home', ['['])).toBe(
      '[ already moves to the previous tab. Choose another.',
    );
    expect(problemWith(table, 'go.home', [']'])).toBe(
      '] already moves to the next tab. Choose another.',
    );
  });

  it('refuses a prefix clash, either way round', () => {
    expect(problemWith(table, 'page.search', ['g'])).toBe(
      'G starts G then H, which opens Home. Choose another.',
    );
    expect(problemWith(table, 'go.home', ['/', 'h'])).toBe(
      '/ already searches the page, so / then H could never be reached. Choose another.',
    );
  });

  it('refuses what the browser or the computer owns', () => {
    for (const [keys, message] of [
      [['mod+w'], '⌘W belongs to your browser or computer. Choose another.'],
      [['mod+t'], '⌘T belongs to your browser or computer. Choose another.'],
      [['mod+l'], '⌘L belongs to your browser or computer. Choose another.'],
      [['mod+r'], '⌘R belongs to your browser or computer. Choose another.'],
      [['mod+q'], '⌘Q belongs to your browser or computer. Choose another.'],
      [['g', 'tab'], 'Tab belongs to your browser or computer. Choose another.'],
    ] as const) {
      expect(problemWith(table, 'go.home', keys, true)).toBe(message);
    }
    expect(problemWith(table, 'go.home', ['mod+w'])).toBe(
      'Ctrl+W belongs to your browser or computer. Choose another.',
    );
  });

  it('takes keys nothing else has, with or without a modifier', () => {
    expect(problemWith(table, 'go.home', ['g', 'z'])).toBeNull();
    expect(problemWith(table, 'go.directory', ['mod+shift+d'])).toBeNull();
    expect(problemWith(table, 'go.directory', ['g', 'd'])).toBeNull();
    expect(problemWith(table, 'go.home', [])).toBe('Press the keys for this shortcut.');
    expect(problemWith(table, 'go.home', ['g', 'h', 'x'])).toBe(
      'A shortcut is one key or two in a row. Choose another.',
    );
  });

  it('checks the whole set on the server, where a fixed key and an unknown one are refused too', () => {
    expect(problemIn({ 'go.home': ['g', 'z'], 'go.inbox': ['g', 'b'] })).toBeNull();
    expect(problemIn({ 'go.home': ['g', 'z'], 'go.inbox': ['g', 'z'] })).toBe(
      'G then Z already opens Inbox. Choose another.',
    );
    expect(problemIn({ palette: ['mod+e'] }, true)).toBe('⌘K cannot be changed.');
    expect(problemIn({ 'go.nowhere': ['g', 'z'] })).toBe('That shortcut does not exist.');
  });
});

describe('when keys can be live together', () => {
  const table = effective({});

  it('lets two screens’ row actions share a letter, and nothing else', () => {
    // R declines on Approvals and reminds on Completeness: never both focused.
    expect(problemWith(table, 'row.remind', ['r'])).toBeNull();
    expect(problemWith(table, 'row.edit', ['r'])).toBeNull();
    // A row's key is live with the list's and the page's.
    expect(problemWith(table, 'row.remind', ['x'])).toBe(
      'X already selects the row. Choose another.',
    );
    expect(problemWith(table, 'row.edit', ['c'])).toBe('C already creates. Choose another.');
    expect(problemWith(table, 'list.select', ['c'])).toBe('C already creates. Choose another.');
    // But not on the same screen.
    expect(problemWith(table, 'row.decline', ['a'])).toBe(
      'A already approves the change. Choose another.',
    );
  });

  it('keeps list and row keys to one chord, and lets Space stay the quick look', () => {
    expect(problemWith(table, 'list.select', ['g', 'x'])).toBe(
      'A key for a list or a row is one key, with or without a modifier. Choose another.',
    );
    expect(problemWith(table, 'list.preview', ['space'])).toBeNull();
    expect(problemWith(table, 'go.home', ['space'])).toBe(
      'Space belongs to your browser or computer. Choose another.',
    );
    expect(problemWith(table, 'list.extend-next', ['shift+n'], true)).toBeNull();
    expect(spoken(['shift+j'], true)).toBe('⇧J');
  });
});

describe('reading stored preferences', () => {
  it('keeps what parses and falls back to the defaults for anything else', () => {
    const stored = { bindings: { 'go.home': ['g', 'z'] }, characterKeys: false };
    expect(prefsFrom(stored)).toEqual(stored);
    expect(prefsFrom(null)).toEqual({ bindings: {}, characterKeys: true });
    expect(prefsFrom({ bindings: { 'go.home': ['g', 'h', 'x'] }, characterKeys: true })).toEqual({
      bindings: {},
      characterKeys: true,
    });
    expect(spoken(['mod+shift+d'], true)).toBe('⌘⇧D');
    expect(spoken(['mod+shift+d'])).toBe('Ctrl+Shift+D');
  });
});

describe('where each go-to shortcut goes', () => {
  const hr = {
    sections: placesFor(PEOPLE_NAV, HR).sections,
    people: true,
    timeOff: false,
    activity: true,
  };
  const at = (id: string, reach = hr) =>
    destinationOf(
      SHORTCUTS.find((s) => s.id === id) ?? {
        id,
        group: 'Navigation',
        label: id,
        does: '',
        keys: [],
      },
      reach,
    );

  it('opens each People section at the first page under it this viewer opens', () => {
    expect(at('go.directory')).toBe('/people/directory/list');
    expect(at('go.review')).toBe('/people/review/waiting');
    expect(at('go.insights')).toBe('/people/insights/what-changed');
    const finance = { ...hr, sections: placesFor(PEOPLE_NAV, FINANCE).sections, activity: false };
    expect(at('go.review', finance)).toBe('/people/review/waiting');
    expect(at('go.insights', finance)).toBeNull();
    expect(at('go.activity', finance)).toBeNull();
  });

  it('goes nowhere the company does not have', () => {
    const none = { sections: [], people: false, timeOff: false, activity: false };
    expect(at('go.home', none)).toBe('/');
    expect(at('go.settings', none)).toBe('/settings');
    expect(at('go.people', none)).toBeNull();
    expect(at('go.inbox', none)).toBeNull();
    expect(at('go.time-off', hr)).toBeNull();
  });
});

describe('[ and ]', () => {
  const sections = placesFor(PEOPLE_NAV, HR).sections;

  it('step through the Directory’s views, keeping the search and filters but not the page', () => {
    const at = { pathname: '/people/directory/list', search: '?q=ada&after=x' };
    expect(adjacentPage(sections, '/people/directory/list', at, 1)).toBe(
      '/people/directory/cards?q=ada',
    );
    expect(adjacentPage(sections, '/people/directory/list', at, -1)).toBeNull();
    expect(
      adjacentPage(
        sections,
        '/people/directory/org-chart',
        { pathname: '/people/directory/org-chart', search: '?focus=a&layout=b&q=ada' },
        -1,
      ),
    ).toBe('/people/directory/cards?q=ada');
  });

  it('step through an umbrella page’s tabs, and stop at either end', () => {
    const at = (route: string) => ({ pathname: route, search: '' });
    expect(adjacentPage(sections, '/people/review/flagged', at('/people/review/flagged'), 1)).toBe(
      '/people/review/asked',
    );
    expect(
      adjacentPage(
        sections,
        '/people/insights/what-changed',
        at('/people/insights/what-changed'),
        -1,
      ),
    ).toBeNull();
    expect(
      adjacentPage(sections, '/people/review/decided', at('/people/review/decided'), 1),
    ).toBeNull();
    expect(
      adjacentPage(sections, '/people/import-export', at('/people/import-export'), 1),
    ).toBeNull();
  });
});
