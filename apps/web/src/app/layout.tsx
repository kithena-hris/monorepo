import { themePreset } from '@kithena/contracts';
import { brandRamp } from '@reach/ui';
import { kithenaMarkDataUri } from '@reach/ui/brand/kithena-mark-data-uri';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import type { JSX, ReactNode } from 'react';

import { SpeedInsights } from '../components/speed-insights';
import { currentTenant } from '../lib/branding';
import { EARLY_PRESSES_SCRIPT } from '../lib/early-presses';
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
 * A stored choice is a cookie, so the server already draws it: `<html>` leaves
 * with `class="dark"` when that is what the person chose, and React owns the
 * class like any other prop. It used to be `localStorage`, set on `<html>` by
 * this script alone — and the one render React ever redoes from scratch, the
 * recovery from a hydration error, rebuilds `<html>` from its props and drops
 * any class it did not put there. A person who chose dark was shown light
 * after every reload of a page with such an error, and the menu said so.
 *
 * With nothing chosen, the system preference, which only the browser knows:
 * that is what this inline, blocking script is still for. An effect runs after
 * hydration, so a machine set to dark would be shown a white page first. A
 * stored choice wins over the system preference, because somebody who chose
 * light on a dark machine meant it.
 */
const themeScript = `try{var m=document.cookie.match(/(?:^|; )${THEME_KEY}=(dark|light)/);var d=m?m[1]==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d)}catch(e){}`;

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
  const [tenant, jar] = await Promise.all([currentTenant(), cookies()]);
  const theme = jar.get(THEME_KEY)?.value;
  const preset =
    tenant?.branding.themeId == null ? undefined : themePreset(tenant.branding.themeId);

  // `suppressHydrationWarning` because, with nothing chosen, the theme class
  // is written to <html> before paint from a preference the server cannot see.
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={theme === 'dark' ? 'dark' : undefined}
      style={preset ? brandRamp(preset.hue) : undefined}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* Before any markup: a press on a remote's screen before it hydrates is held, not lost. */}
        <script dangerouslySetInnerHTML={{ __html: EARLY_PRESSES_SCRIPT }} />
      </head>
      <body>
        {/*
          The app's own page, marked so a remote's stylesheet never styles it
          (`apps/web/people/src/contain-utilities.ts`). Everything else placed
          straight under <body> is a portal, which it may.
        */}
        <div data-remote-host="" className="contents">
          {children}
        </div>
        <SpeedInsights />
      </body>
    </html>
  );
}
