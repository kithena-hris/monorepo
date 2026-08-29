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
        <ToastHost>{children}</ToastHost>
      </body>
    </html>
  );
}
