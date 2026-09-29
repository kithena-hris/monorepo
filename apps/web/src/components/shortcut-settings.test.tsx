// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import type { ComponentPropsWithoutRef } from 'react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ShortcutPrefs as Prefs } from '../lib/shortcuts';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: (props: ComponentPropsWithoutRef<'a'>) => <a {...props} />,
}));
vi.mock('../app/(app)/settings/shortcuts/actions', () => ({ saveShortcuts: vi.fn() }));

const { ShortcutSettings } = await import('./shortcut-settings');
const { Shortcuts } = await import('./shortcuts');
const { effective } = await import('../lib/shortcuts');

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/**
 * The page as the shell gives it the shortcuts: what `store` holds is what
 * the server has, and every save replaces it, as identity's row does.
 */
function renderPage(store: { prefs: Prefs; saves: Prefs[] }) {
  function Harness() {
    const [prefs, setPrefs] = useState(store.prefs);
    return (
      <Shortcuts
        value={{
          prefs,
          table: effective(prefs.bindings),
          destinations: new Map([
            ['go.home', '/'],
            ['go.directory', '/people/directory/list'],
          ]),
          keysFor: () => undefined,
          openHelp: () => undefined,
          save: (next) => {
            store.saves.push(next);
            store.prefs = next;
            setPrefs(next);
            return Promise.resolve(null);
          },
        }}
      >
        <main>
          <ShortcutSettings />
        </main>
      </Shortcuts>
    );
  }
  return render(<Harness />);
}

const fresh = (): { prefs: Prefs; saves: Prefs[] } => ({
  prefs: { bindings: {}, characterKeys: true },
  saves: [],
});

/** Presses the recorder for `label`, then the keys. */
function record(label: string, ...keys: { key: string; metaKey?: boolean; ctrlKey?: boolean }[]) {
  const recorder = screen.getByRole('button', { name: label });
  act(() => {
    fireEvent.click(recorder);
  });
  for (const key of keys) {
    act(() => {
      fireEvent.keyDown(recorder, key);
    });
  }
  return recorder;
}

/** The error the field for `label` shows. */
const errorOf = (label: string): string | null => {
  const recorder = screen.getByRole('button', { name: label });
  const ids = (recorder.getAttribute('aria-describedby') ?? '').split(' ');
  return (
    ids.map((id) => document.getElementById(id)).find((el) => el?.getAttribute('role') === 'alert')
      ?.textContent ?? null
  );
};

describe('Settings › Keyboard shortcuts', () => {
  it('refuses keys another shortcut already has, on the field, naming the clash', () => {
    const store = fresh();
    renderPage(store);
    const recorder = record('Home', { key: 'g' }, { key: 'd' });
    expect(errorOf('Home')).toBe('G then D already opens Directory. Choose another.');
    expect(recorder.getAttribute('aria-invalid')).toBe('true');
    expect(store.saves).toEqual([]);
    // The fixed ones count too.
    record('Home', { key: 'k', ctrlKey: true });
    expect(errorOf('Home')).toBe('Ctrl+K already opens search. Choose another.');
    expect(store.saves).toEqual([]);
  });

  it('refuses a prefix clash either way, and keys the browser owns', () => {
    vi.useFakeTimers();
    const store = fresh();
    renderPage(store);
    record('Search this page', { key: 'g' });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(errorOf('Search this page')).toBe(
      'G starts G then H, which opens Home. Choose another.',
    );
    record('Home', { key: '/' }, { key: 'x' });
    expect(errorOf('Home')).toBe(
      '/ already searches the page, so / then X could never be reached. Choose another.',
    );
    record('Directory', { key: 'w', ctrlKey: true });
    expect(errorOf('Directory')).toBe(
      'Ctrl+W belongs to your browser or computer. Choose another.',
    );
    expect(store.saves).toEqual([]);
  });

  it('saves new keys, shows them again when the page is opened again, and resets them', () => {
    const store = fresh();
    const first = renderPage(store);
    record('Home', { key: 'g' }, { key: 'z' });
    expect(store.saves.at(-1)).toEqual({
      bindings: { 'go.home': ['g', 'z'] },
      characterKeys: true,
    });
    expect(errorOf('Home')).toBeNull();
    first.unmount();

    // Opened again, from what was stored.
    renderPage(store);
    const home = screen.getByRole('button', { name: 'Home' });
    expect(home.textContent).toBe('G then Z');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Reset Home' }));
    });
    expect(store.saves.at(-1)).toEqual({ bindings: {}, characterKeys: true });
    expect(screen.getByRole('button', { name: 'Home' }).textContent).toBe('G then H');
  });

  it('resets every change at once, and keeps whether single keys are on', () => {
    const store = fresh();
    store.prefs = {
      bindings: { 'go.home': ['g', 'z'], 'page.search': ['mod+shift+f'] },
      characterKeys: false,
    };
    renderPage(store);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Reset all to the defaults' }));
    });
    expect(store.saves.at(-1)).toEqual({ bindings: {}, characterKeys: false });
    act(() => {
      fireEvent.click(screen.getByRole('switch', { name: 'Single-key shortcuts' }));
    });
    expect(store.saves.at(-1)).toEqual({ bindings: {}, characterKeys: true });
  });

  // Three axe runs over a whole settings page: slow on a loaded runner, not stuck.
  it('is axe-clean, while it records and while it refuses', async () => {
    const store = fresh();
    const { container } = renderPage(store);
    const clean = async () => {
      const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
      return result.violations.map((v) => v.id);
    };
    expect(await clean()).toEqual([]);
    record('Home', { key: 'g' }, { key: 'd' });
    expect(await clean()).toEqual([]);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Directory' }));
    });
    expect(within(container).getByText('Press the keys. Escape cancels.')).toBeTruthy();
    expect(await clean()).toEqual([]);
  }, 60_000);
});
