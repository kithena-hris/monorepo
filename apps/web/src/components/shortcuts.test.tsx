// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import type { ComponentPropsWithoutRef } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const push = vi.fn<(href: string) => void>();
let pathname = '/';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: (props: ComponentPropsWithoutRef<'a'>) => <a data-next-link="" {...props} />,
}));
vi.mock('../app/(app)/people/actions', () => ({ searchPeople: vi.fn(() => Promise.resolve([])) }));
vi.mock('../app/(app)/settings/shortcuts/actions', () => ({
  saveShortcuts: vi.fn(() => Promise.resolve({ ok: true })),
}));
vi.mock('../app/assistant/actions', () => ({ askAssistant: vi.fn() }));

const { AppShell } = await import('./app-shell');
const { useScreenCommand } = await import('@reach/ui');
const { shortcutHandler } = await import('./shortcuts');
const { placesFor } = await import('../lib/remotes');
const { EMPTY_SHELL } = await import('../lib/shell-data');
const { HR, PEOPLE_NAV } = await import('../lib/people-nav.fixture');
const { SHORTCUTS, effective } = await import('../lib/shortcuts');
const manifest = (await import('../../people/public/routes.json')).default;

beforeAll(() => {
  // jsdom has no layout: no `scrollIntoView`, which the palette's list asks
  // for, and no `matchMedia`, which the layout's rail asks of the pointer.
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
});

afterEach(() => {
  cleanup();
  push.mockClear();
  pathname = '/';
  window.history.replaceState(null, '', '/');
});

const hr = placesFor(PEOPLE_NAV, HR);
const shell = {
  ...EMPTY_SHELL,
  roles: { hr: true, admin: false, finance: false },
  sections: hr.sections,
  settings: hr.settings,
  // The manifest's own, with where each is offered (`on`).
  actions: placesFor({ sections: [], actions: manifest.actions }, HR).actions,
  routes: manifest.routes.map((r) => r.path),
};

function renderShell(children: React.ReactNode = <p>Page</p>, characterKeys = true) {
  return render(
    <AppShell
      person={{ name: 'Ada Lovelace', email: 'ada@acme.example' }}
      companyName="Acme"
      entitlements={['module.people']}
      shell={shell}
      shortcuts={{ bindings: {}, characterKeys }}
    >
      {children}
    </AppShell>,
  );
}

/** Keys pressed one after another on whatever has focus, or on the page. */
function press(...keys: (string | { key: string; ctrlKey?: boolean; metaKey?: boolean })[]): void {
  for (const key of keys) {
    const init = typeof key === 'string' ? { key } : key;
    fireEvent.keyDown(document.activeElement ?? document.body, init);
  }
}

describe('the key handler', () => {
  const run = vi.fn(() => true);
  afterEach(() => {
    run.mockClear();
  });
  const handler = () =>
    shortcutHandler({ table: effective({}), characterKeys: true, run, now: () => 0 });

  it('never fires while typing in a field', () => {
    const on = handler();
    const input = document.createElement('input');
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    document.body.append(input, editor);
    for (const target of [input, editor]) {
      for (const key of ['g', 'd', '/', '?']) {
        const event = new KeyboardEvent('keydown', { key, bubbles: true });
        target.addEventListener('keydown', on, { once: true });
        target.dispatchEvent(event);
      }
    }
    expect(run).not.toHaveBeenCalled();
    input.remove();
    editor.remove();
  });

  it('never fires a single-key shortcut with ⌘, Ctrl or Alt held', () => {
    const on = handler();
    for (const modifier of ['metaKey', 'ctrlKey', 'altKey'] as const) {
      on(new KeyboardEvent('keydown', { key: 'g', [modifier]: true }));
      on(new KeyboardEvent('keydown', { key: 'd' }));
      on(new KeyboardEvent('keydown', { key: 'g' }));
      on(new KeyboardEvent('keydown', { key: 'd', [modifier]: true }));
      on(new KeyboardEvent('keydown', { key: '/', [modifier]: true }));
    }
    expect(run).not.toHaveBeenCalled();
  });

  it('leaves every single key alone once they are turned off', () => {
    const on = shortcutHandler({
      table: effective({ 'go.directory': ['mod+shift+d'] }),
      characterKeys: false,
      run,
    });
    for (const key of ['g', 'h', '/', '?', '[']) on(new KeyboardEvent('keydown', { key }));
    expect(run).not.toHaveBeenCalled();
    // A shortcut with a modifier still works: that is what WCAG 2.1.4 leaves on.
    on(new KeyboardEvent('keydown', { key: 'D', metaKey: true, shiftKey: true }));
    expect(run).toHaveBeenCalledWith('go.directory', expect.anything());
  });

  it('forgets the G after a second', () => {
    let t = 0;
    const on = shortcutHandler({ table: effective({}), characterKeys: true, run, now: () => t });
    on(new KeyboardEvent('keydown', { key: 'g' }));
    t = 1500;
    on(new KeyboardEvent('keydown', { key: 'd' }));
    expect(run).not.toHaveBeenCalled();
  });
});

describe('the shortcuts, in the shell', () => {
  it('each go-to shortcut navigates, client-side, to where it goes for this viewer', () => {
    renderShell();
    const expected: Record<string, string> = {
      'go.home': '/',
      'go.people': '/people',
      'go.directory': '/people/directory/list',
      'go.approvals': '/people/approvals',
      'go.data-health': '/people/data-health/completeness',
      'go.import-export': '/people/import-export',
      'go.insights': '/people/insights/headcount',
      'go.inbox': '/inbox',
      'go.me': '/people/me',
      'go.settings': '/settings',
      'go.activity': '/settings/activity',
      'go.shortcuts': '/settings/shortcuts',
    };
    for (const shortcut of SHORTCUTS.filter((s) => s.id.startsWith('go.'))) {
      push.mockClear();
      press(...shortcut.keys);
      if (expected[shortcut.id] === undefined) {
        // Time off is not built: its keys go nowhere rather than to a 404.
        expect({ id: shortcut.id, pushed: push.mock.calls }).toEqual({ id: shortcut.id, pushed: [] });
      } else {
        expect({ id: shortcut.id, to: push.mock.calls[0]?.[0] }).toEqual({
          id: shortcut.id,
          to: expected[shortcut.id],
        });
      }
    }
  });

  it('[ and ] move through the Directory’s views and an umbrella page’s tabs', () => {
    pathname = '/people/directory/cards';
    window.history.replaceState(null, '', '/people/directory/cards?q=ada');
    const { unmount } = renderShell();
    press(']');
    expect(push).toHaveBeenLastCalledWith('/people/directory/org-chart?q=ada');
    press('[');
    expect(push).toHaveBeenLastCalledWith('/people/directory/list?q=ada');
    unmount();

    pathname = '/people/insights/turnover';
    window.history.replaceState(null, '', pathname);
    renderShell();
    press(']');
    expect(push).toHaveBeenLastCalledWith('/people/insights/data-quality');
  });

  it('/ focuses the page’s search, and types nothing into it', () => {
    renderShell(<input type="search" aria-label="Search people" />);
    const field = screen.getByRole('searchbox', { name: 'Search people' });
    // jsdom lays nothing out, so nothing is on screen; this field is.
    field.getClientRects = () => [new DOMRect(0, 0, 200, 40)] as unknown as DOMRectList;
    const event = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
    act(() => {
      document.body.dispatchEvent(event);
    });
    expect(document.activeElement).toBe(field);
    expect(event.defaultPrevented).toBe(true);
    // Now in the field, G then D is two letters of a search, not a shortcut.
    press('g', 'd');
    expect(push).not.toHaveBeenCalled();
  });

  it('? opens every shortcut, by group, in an axe-clean dialog with the switch that turns them off', async () => {
    renderShell();
    act(() => {
      press('?');
    });
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    const goTo = within(within(dialog).getByRole('region', { name: 'Navigation' }));
    expect(goTo.getByText('Directory')).toBeTruthy();
    // Time off is not built here, so it is not listed as somewhere to go.
    expect(goTo.queryByText('Time off')).toBeNull();
    expect(within(dialog).getByRole('region', { name: 'Everywhere' }).textContent).toContain(
      'Search and run a command',
    );
    expect(within(dialog).getByRole('switch', { name: 'Single-key shortcuts' })).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Change shortcuts' }).getAttribute('href')).toBe(
      '/settings/shortcuts',
    );
    const result = await axe.run(dialog, {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  }, 20_000);

  it('shows each destination’s keys in the account menu', async () => {
    renderShell();
    const trigger = screen.getByRole('button', { name: /Ada Lovelace/ });
    act(() => {
      fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
      fireEvent.keyDown(trigger, { key: 'Enter' });
    });
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /My profile/ }).textContent).toContain('G then M');
    expect(within(menu).getByRole('menuitem', { name: /Keyboard shortcuts/ }).textContent).toContain(
      '?',
    );
  });
});

describe('C, ⌘Enter and the palette’s actions', () => {
  it('C makes what the page makes: Add person on People, an export on Import & export', () => {
    pathname = '/people/directory/list';
    const { unmount } = renderShell();
    press('c');
    expect(push).toHaveBeenLastCalledWith('/people/new');
    unmount();
    pathname = '/people/import-export';
    renderShell();
    press('c');
    expect(push).toHaveBeenLastCalledWith('/people/export');
  });

  it('C runs what the screen offers instead, and does nothing where nothing is made', () => {
    const newSchedule = vi.fn();
    function Insights(): null {
      useScreenCommand({ id: 'create', label: 'New schedule', run: newSchedule });
      return null;
    }
    pathname = '/people/insights/headcount';
    const { unmount } = renderShell(<Insights />);
    press('c');
    expect(newSchedule).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    unmount();
    pathname = '/settings';
    renderShell();
    press('c');
    expect(push).not.toHaveBeenCalled();
  });

  it('⌘Enter submits the form a field is in, even while typing in it', () => {
    const submitted = vi.fn((event: SubmitEvent) => {
      event.preventDefault();
    });
    renderShell(
      <form aria-label="Note" onSubmit={(event) => {
          submitted(event.nativeEvent);
        }}>
        <textarea aria-label="Note text" />
        <button type="submit">Save</button>
      </form>,
    );
    const field = screen.getByRole('textbox', { name: 'Note text' });
    field.focus();
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true });
    expect(submitted).toHaveBeenCalledTimes(1);
    // A plain Enter in a textarea is a new line, not a submit.
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(submitted).toHaveBeenCalledTimes(1);
  });

  it('⌘K runs actions too, each with its keys, and what ran last comes first', async () => {
    pathname = '/people/directory/list';
    renderShell();
    act(() => {
      fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    });
    const palette = await screen.findByRole('dialog', { name: 'Search people and pages' });
    const create = within(palette).getByRole('option', { name: /Create… Add person/ });
    expect(create.textContent).toContain('C');
    expect(within(palette).getByRole('option', { name: /Switch to dark mode/ })).toBeTruthy();
    expect(within(palette).getByRole('option', { name: /Show keyboard shortcuts/ })).toBeTruthy();
    act(() => {
      fireEvent.click(within(palette).getByRole('option', { name: /Inbox/ }));
    });
    expect(push).toHaveBeenLastCalledWith('/inbox');
    act(() => {
      fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    });
    const again = await screen.findByRole('dialog', { name: 'Search people and pages' });
    const recent = within(again).getByRole('group', { name: 'Recent' });
    expect(within(recent).getByRole('option', { name: /Inbox/ })).toBeTruthy();
  });

  it('is axe-clean with a row of a list focused', async () => {
    const { DataTable } = await import('@reach/ui');
    const { container } = renderShell(
      <DataTable
        label="People"
        rows={[{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Grace' }]}
        rowId={(r) => r.id}
        columns={[{ id: 'name', header: 'Name', cell: (r) => r.name }]}
        selectable
        onRowClick={vi.fn()}
      />,
    );
    // J from the page: into the list, on its first row.
    press('j');
    const row = document.activeElement;
    expect(row?.getAttribute('data-row-id')).toBe('a');
    const result = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  }, 20_000);
});
