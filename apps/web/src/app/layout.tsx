import { themePreset } from '@kithena/contracts';
import { brandRamp } from '@reach/ui';
import { kithenaMarkDataUri } from '@reach/ui/brand/kithena-mark-data-uri';
import type { Metadata } from 'next';
import type { JSX, ReactNode } from 'react';

import { currentTenant } from '../lib/branding';

import './globals.css';

export const metadata: Metadata = {
  title: 'Kithena',
  description: 'Reference client. The API is the product.',
  // The mark as a data URI rather than a file in `public/`: it is generated
  // from the same constant the drift test guards, so the tab icon cannot fall
  // out of step with the logo the app renders.
  icons: { icon: kithenaMarkDataUri },
};

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
      <body>{children}</body>
    </html>
  );
}
