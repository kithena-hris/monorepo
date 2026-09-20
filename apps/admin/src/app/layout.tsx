import { TooltipProvider } from '@reach/ui';
import { KithenaMark } from '@reach/ui';
import { kithenaMarkDataUri } from '@reach/ui/brand/kithena-mark-data-uri';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

import { THEME_KEY } from '../lib/theme';
import { ThemeToggle } from '../components/theme-toggle';
import { ToastHost } from '../components/toast-host';

import './globals.css';

export const metadata: Metadata = {
  title: 'Kithena Admin',
  description: 'Internal back-office.',
  // Same mark as the product, on purpose: an operator with both open should be
  // able to tell the tabs apart by the title, not by two different logos.
  icons: { icon: kithenaMarkDataUri },
};

/**
 * Dark mode, decided before the first paint.
 *
 * Inline and blocking, which is the whole point: an effect runs after
 * hydration, so a machine set to dark would be shown a white page first. That
 * flash is the reason this is a string of JavaScript in the document rather
 * than a `useEffect` like the rest of the app.
 *
 * A stored choice wins over the system preference, because somebody who picked
 * light on a dark machine meant it. `try` because Safari's private mode throws
 * on `localStorage`, and a theme is not worth a blank page.
 */
const themeScript = `try{var s=localStorage.getItem(${JSON.stringify(THEME_KEY)});var d=s?s==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d)}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    // `suppressHydrationWarning` because the script above edits `class` on this
    // element before React sees it, and React would otherwise report the
    // difference it was told to expect.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {/*
          `TooltipProvider` wraps the whole app, the same way `apps/web` wraps
          its shell and Storybook wraps every story.

          Radix requires it as an ancestor of any tooltip and throws without
          one, and `CopyButton` opts into a tooltip by default whenever it is
          icon-only — so the company page threw on render the moment it showed
          a copy button beside the tenant hostname, and the invitation panel
          would have thrown too, `CopyField` containing one of the same
          buttons. It is a provider, not a wrapper with an opinion: it carries
          the shared open delay, which is why one at the root beats one per
          call site.
        */}
        <TooltipProvider>
          <ToastHost>
            {/*
              One bar above every screen, which is also the way back.

              Each page used to be its own island: the mark was drawn on the
              list and nowhere else, and a screen reached from it — the wizard
              especially — had no route home that did not involve the browser's
              back button. A back-office is a place, and a place has a way out
              of every room.
            */}
            <header className="border-border bg-surface sticky top-0 z-40 border-b">
              <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-6">
                <Link
                  href="/"
                  className="hover:text-fg focus-visible:outline-border-focus flex items-center gap-2 rounded-sm text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <KithenaMark className="text-accent size-5" />
                  Kithena back-office
                </Link>
                <ThemeToggle />
              </div>
            </header>
            {children}
          </ToastHost>
        </TooltipProvider>
      </body>
    </html>
  );
}
