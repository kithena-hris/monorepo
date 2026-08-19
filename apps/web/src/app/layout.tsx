import { kithenaMarkDataUri } from '@reach/ui/brand/kithena-mark-data-uri';
import type { Metadata } from 'next';
import type { JSX, ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'Kithena',
  description: 'Reference client. The API is the product.',
  // The mark as a data URI rather than a file in `public/`: it is generated
  // from the same constant the drift test guards, so the tab icon cannot fall
  // out of step with the logo the app renders.
  icons: { icon: kithenaMarkDataUri },
};

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  // `suppressHydrationWarning` because the theme class is written to <html>
  // before paint, which the server render cannot know about.
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
