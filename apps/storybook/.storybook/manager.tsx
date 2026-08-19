import { GLOBALS_UPDATED, SET_GLOBALS } from 'storybook/internal/core-events';
// The manager entry is compiled with the classic JSX transform, so every
// element becomes `React.createElement` and React has to be in scope. Without
// this import the bundle builds cleanly and the whole manager renders blank:
// that is what took out two earlier versions of the toggle below.
import React from 'react';
import { addons, types, useGlobals } from 'storybook/manager-api';

import { darkTheme, lightTheme } from './manager-theme';

/**
 * The manager chrome: sidebar, sidebar footer, toolbar, addon panel, document
 * title, brand.
 *
 * This has to be a separate entry point from `main.ts`. `managerHead` can only
 * append to the head, and a second `<title>` there is ignored because the
 * browser keeps the first one, so the tab kept saying "storybook" however many
 * titles were injected. `brandTitle` is the supported way in, and it is also
 * what puts the mark in the sidebar instead of Storybook's own logo.
 *
 * The mark arrives as a constant rather than being read off disk. This file is
 * bundled for the browser, so an earlier version that called `readFileSync`
 * ran fine under `storybook dev` and failed the production build outright:
 * "Could not resolve node:fs".
 *
 * ### Following the toolbar's theme switch
 *
 * The manager is a different document from the preview, and the theme control
 * sets a Storybook *global*, which lives in the preview. So the chrome does not
 * follow it for free. A first version of this file called `setConfig` once with
 * the operating system's preference and stopped there, which left the sidebar
 * and its footer in one theme while the story beside them was in the other.
 *
 * Globals cross the channel, so the manager can listen for them.
 * `SET_GLOBALS` arrives when the preview first announces its globals, and
 * `GLOBALS_UPDATED` on every change after that. `api.setOptions` re-themes the
 * chrome in place, which `setConfig` alone does not do once the manager has
 * rendered.
 */

addons.setConfig({
  // Something has to be set before the preview has said anything, or the chrome
  // renders unthemed for a frame. The operating system is the best guess
  // available at that point, and the channel corrects it a moment later.
  theme:
    typeof globalThis.matchMedia === 'function' &&
    globalThis.matchMedia('(prefers-color-scheme: dark)').matches
      ? darkTheme
      : lightTheme,
});

addons.register('reach/theme-sync', (api) => {
  // What the chrome is currently wearing. `setOptions` re-renders the manager,
  // and the manager announcing itself puts another globals message on the
  // channel, so calling it unconditionally makes the two ends talk to each
  // other: a single click took about a second to settle. Comparing first turns
  // that into one render.
  let current: 'light' | 'dark' | null = null;

  const apply = (payload: { globals?: Record<string, unknown> }): void => {
    // `withThemeByClassName` is configured with `light` and `dark` in
    // `preview.tsx`. Anything else is treated as light rather than left alone,
    // so the chrome can never be stranded mid-way.
    const next = payload.globals?.['theme'] === 'dark' ? 'dark' : 'light';
    if (next === current) return;
    current = next;
    api.setOptions({ theme: next === 'dark' ? darkTheme : lightTheme });
  };

  api.on(SET_GLOBALS, apply);
  api.on(GLOBALS_UPDATED, apply);
});

/**
 * A one-click theme toggle, in place of a two-value dropdown.
 *
 * `globalTypes` renders any toolbar entry as a menu, which costs a click and a
 * pointer trip to pick between exactly two things.
 *
 * Deliberately plain: a `<button>` with inline styles, no `styled`, and nothing
 * read off Storybook's theme object. Two earlier versions of this tool blanked
 * the entire manager, once by importing `IconButton` from
 * `storybook/internal/components` and once by reaching into `theme.*`. Both
 * built cleanly and failed only at runtime, so the safest shape is the one with
 * the fewest things that can be undefined.
 */
addons.add('reach/theme-toggle', {
  type: types.TOOL,
  title: 'Theme',
  render: function ThemeToggle() {
    const [globals, updateGlobals] = useGlobals();
    const dark = globals['theme'] === 'dark';
    return (
      <button
        type="button"
        // A switch between two states says which one it is in, rather than
        // leaving a screen reader to infer it from a label that changes.
        aria-pressed={dark}
        title={dark ? 'Theme: dark. Switch to light.' : 'Theme: light. Switch to dark.'}
        onClick={() => {
          updateGlobals({ theme: dark ? 'light' : 'dark' });
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          height: 28,
          padding: '0 10px',
          border: 0,
          borderRadius: 4,
          background: 'transparent',
          color: 'currentColor',
          font: 'inherit',
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        <span aria-hidden>{dark ? '\u25CF' : '\u25CB'}</span>
        {dark ? 'Dark' : 'Light'}
      </button>
    );
  },
});
