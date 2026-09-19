import { TooltipProvider } from '@reach/ui';
import { kithenaMarkDataUri } from '@reach/ui/brand/kithena-mark-data-uri';
import type { Metadata } from 'next';
import type { JSX, ReactNode } from 'react';

import { ToastHost } from '../components/toast-host';

import './globals.css';

export const metadata: Metadata = {
  title: 'Kithena Admin',
  description: 'Internal back-office.',
  // Same mark as the product, on purpose: an operator with both open should be
  // able to tell the tabs apart by the title, not by two different logos.
  icons: { icon: kithenaMarkDataUri },
};

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="en" suppressHydrationWarning>
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
          <ToastHost>{children}</ToastHost>
        </TooltipProvider>
      </body>
    </html>
  );
}
