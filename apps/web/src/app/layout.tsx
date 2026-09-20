import { themePreset } from '@kithena/contracts';
import { brandRamp } from '@reach/ui';
import { kithenaMarkDataUri } from '@reach/ui/brand/kithena-mark-data-uri';
import type { Metadata } from 'next';
import type { JSX, ReactNode } from 'react';

import { currentTenant } from '../lib/branding';
import { THEME_KEY } from '../lib/theme';

import './globals.css';

export const metadata: Metadata = {
  title: 'Kithena',
  description: 'Reference client. The API is the product.',
  // The mark as a data URI rather than a file in `public/`: it is generated
  // from the same constant the drift test guards, so the tab icon cannot fall
  // out of step with the logo the app renders.
  icons: { icon: kithenaMarkDataUri },
};

/**
 * Light or dark, decided before the first paint.
 *
 * Inline and blocking, which is the whole point: an effect runs after
 * hydration, so a machine set to dark would be shown a white page first. That
 * flash is the reason this is a string of JavaScript in the document rather
 * than a `useEffect` like the rest of the app.
 *
 * A stored choice wins over the system preference, because somebody who chose
 * light on a dark machine meant it. `try`, because Safari's private mode throws
 * on `localStorage` and a theme is not worth a blank page.
 */
const themeScript = `try{var s=localStorage.getItem(${JSON.stringify(THEME_KEY)});var d=s?s==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d)}catch(e){}`;

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}): Promise<JSX.Element> {
  /*
   * The company's brand ramp, on `<html>` and deliberately not on a wrapper.
   *
   * `brandRamp` explains why at length; the short version is that
   * `--reach-color-accent: var(--reach-brand-600)` is declared on `:root`, so
   * the substitution happens there and re-pointing the ramp any further down
   * the tree is too late to affect it.
   *
   * In the layout rather than per page so that every screen on this hostname —
   * sign-in, dashboard, and whatever a module adds later — is the same colour
   * without each one remembering to ask.
   */
  const tenant = await currentTenant();
  const preset =
    tenant?.branding.themeId == null ? undefined : themePreset(tenant.branding.themeId);

  // `suppressHydrationWarning` because the theme class is written to <html>
  // before paint, which the server render cannot know about.
  return (
    <html lang="en" suppressHydrationWarning style={preset ? brandRamp(preset.hue) : undefined}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
