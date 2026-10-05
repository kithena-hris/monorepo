import { GLOBALS_UPDATED, SET_GLOBALS } from 'storybook/internal/core-events';
// The manager entry is compiled with the classic JSX transform, so React has
// to be in scope or the whole manager renders blank (the web Storybook's
// `manager.tsx` has the history).
import React from 'react';
import { addons, types, useGlobals } from 'storybook/manager-api';

import { darkTheme, lightTheme } from './manager-theme';

/**
 * The manager chrome, mirroring the web Storybook's: the Reach brand and
 * colours, a chrome that follows the theme the story is in, and a one-press
 * theme toggle in place of a two-item menu.
 */

addons.setConfig({
  // A guess until the preview announces its globals a moment later.
  theme:
    typeof globalThis.matchMedia === 'function' &&
    globalThis.matchMedia('(prefers-color-scheme: dark)').matches
      ? darkTheme
      : lightTheme,
});

addons.register('reach/theme-sync', (api) => {
  // Compared first: re-theming re-renders the manager, which announces its
  // globals again, and an unconditional call makes the two ends talk forever.
  let current: 'light' | 'dark' | null = null;
  const apply = (payload: { globals?: Record<string, unknown> }): void => {
    const next = payload.globals?.['theme'] === 'dark' ? 'dark' : 'light';
    if (next === current) return;
    current = next;
    api.setOptions({ theme: next === 'dark' ? darkTheme : lightTheme });
  };
  api.on(SET_GLOBALS, apply);
  api.on(GLOBALS_UPDATED, apply);
});

addons.add('reach/theme-toggle', {
  type: types.TOOL,
  title: 'Theme',
  render: function ThemeToggle() {
    const [globals, updateGlobals] = useGlobals();
    const dark = globals['theme'] === 'dark';
    return (
      <button
        type="button"
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
        <span aria-hidden>{dark ? '●' : '○'}</span>
        {dark ? 'Dark' : 'Light'}
      </button>
    );
  },
});
