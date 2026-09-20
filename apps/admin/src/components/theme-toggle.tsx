'use client';

import { Button, Tooltip, icons } from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';

import { THEME_KEY } from '../lib/theme';

const SunIcon = icons.theme;
const MoonIcon = icons.themeDark;

/**
 * Light or dark, and it is remembered.
 *
 * Reach expresses dark mode as a `dark` class on an ancestor — `tokens.css`
 * redefines every semantic colour under `.dark`, and the Tailwind variant is
 * `&:where(.dark, .dark *)`. So the whole mechanism is one class on `<html>`,
 * which is what `apps/docs` does too.
 *
 * The class is not set here on first paint. It is set by the inline script in
 * the root layout, before the browser has drawn anything; this component only
 * reads what that decided and changes it afterwards. A React effect runs after
 * hydration, which on a dark-preferring machine means a white page first —
 * brief, and the one frame nobody forgives.
 *
 * Icon-only, so it carries an `aria-label` and a tooltip: the icon set's own
 * rules say an icon is never the only signal, and a control whose entire
 * meaning is a glyph is exactly the case that rule is about. The glyph shows
 * where the button *goes*, not where you are — a moon means "make it dark".
 */
export function ThemeToggle(): JSX.Element {
  const [dark, setDark] = useState(false);

  // Reads the DOM rather than the preference, because the inline script may
  // have honoured a stored choice that disagrees with the system.
  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  const Icon = dark ? SunIcon : MoonIcon;

  return (
    <Tooltip content={label}>
      <Button
        variant="ghost"
        size="sm"
        // `startIcon` with no children is what makes this icon-only: the
        // variant is derived from the props rather than passed, so the square
        // shape and the label cannot drift apart.
        startIcon={<Icon aria-hidden />}
        aria-label={label}
        aria-pressed={dark}
        onClick={() => {
          const next = !dark;
          setDark(next);
          document.documentElement.classList.toggle('dark', next);
          // `try`, because Safari's private mode throws on write and a theme
          // that cannot be remembered is not a reason to break the button.
          try {
            localStorage.setItem(THEME_KEY, next ? 'dark' : 'light');
          } catch {
            /* not remembered, still applied */
          }
        }}
      />
    </Tooltip>
  );
}
