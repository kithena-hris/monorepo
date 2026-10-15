import { KithenaMark, TooltipProvider } from '@reach/ui';
import { kithenaMarkDataUri } from '@reach/ui/brand/kithena-mark-data-uri';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env['JOBS_ORIGIN'] ?? 'https://jobs.kithena.com'),
  title: { default: 'Kithena Jobs', template: '%s · Kithena Jobs' },
  description: 'Jobs at companies that hire on Kithena. No account needed to search or apply.',
  icons: { icon: kithenaMarkDataUri },
};

/** Kithena Jobs (REC-090): one header, the page, nothing else. */
export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <body className="bg-[var(--reach-bg)] text-fg">
        <TooltipProvider>
          <header className="border-b border-[var(--reach-line)]">
            <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
              <Link href="/" className="flex items-center gap-2 text-lg font-bold">
                <KithenaMark className="size-6 text-accent" />
                Kithena Jobs
              </Link>
            </div>
          </header>
          <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
            {children}
          </main>
        </TooltipProvider>
      </body>
    </html>
  );
}
