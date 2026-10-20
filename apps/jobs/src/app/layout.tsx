import { Avatar, Button, KithenaMark, TooltipProvider, icons } from '@reach/ui';
import { kithenaMarkDataUri } from '@reach/ui/brand/kithena-mark-data-uri';
import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import type { JSX, ReactNode } from 'react';

import './globals.css';
import { ThemeToggle } from '../components/theme-toggle';
import { SESSION_COOKIE, me } from '../lib/account';
import { THEME_KEY, themeScript } from '../lib/theme';

export const metadata: Metadata = {
  metadataBase: new URL(process.env['JOBS_ORIGIN'] ?? 'https://jobs.kithena.com'),
  title: { default: 'Kithena Jobs', template: '%s · Kithena Jobs' },
  description: 'Every open job at companies that hire on Kithena. No account needed to apply.',
  icons: { icon: kithenaMarkDataUri },
};

/** Kithena Jobs (REC-090): one header, the page, a short footer, nothing else. */
export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}): Promise<JSX.Element> {
  const jar = await cookies();
  // Who is signed in, for the header: the account's name and the picture Google vouched for.
  const account = jar.get(SESSION_COOKIE) === undefined ? null : await me();
  // The chosen theme on the server too, so the first paint is already right; the script covers the system default.
  const dark = jar.get(THEME_KEY)?.value === 'dark';
  return (
    <html lang="en" className={dark ? 'dark' : undefined} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-dvh flex-col bg-canvas text-fg">
        <TooltipProvider>
          <header className="sticky top-0 z-20 border-b border-border bg-canvas/90 backdrop-blur">
            <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
              <Link
                href="/"
                className="flex items-center gap-2 text-lg font-bold tracking-[-0.01em]"
              >
                <KithenaMark className="size-6 text-accent" />
                Kithena Jobs
              </Link>
              <nav aria-label="Site" className="ms-auto flex items-center gap-1">
                <ThemeToggle />
                <Button asChild variant="ghost" size="sm">
                  <Link href="/search">Search</Link>
                </Button>
                {account !== null ? (
                  <>
                    <Button asChild variant="secondary" size="sm">
                      <Link href="/me" className="flex items-center gap-2">
                        <Avatar
                          name={account.name}
                          src={account.pictureUrl ?? undefined}
                          size="xs"
                          aria-hidden
                        />
                        Your applications
                      </Link>
                    </Button>
                    <form action="/auth/sign-out" method="post">
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        aria-label="Sign out"
                        startIcon={<icons.signOut aria-hidden />}
                      />
                    </form>
                  </>
                ) : (
                  <Button asChild variant="secondary" size="sm">
                    <Link href="/sign-in">Sign in</Link>
                  </Button>
                )}
              </nav>
            </div>
          </header>
          <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 pb-24 sm:px-6 lg:pb-8">
            {children}
          </main>
          <footer className="border-t border-border">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-fg-muted sm:px-6">
              <span>Jobs published by companies that hire on Kithena.</span>
              <span>Your data stays with the company you apply to.</span>
            </div>
          </footer>
        </TooltipProvider>
      </body>
    </html>
  );
}
