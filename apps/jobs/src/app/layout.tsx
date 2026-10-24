import { Avatar, Button, KithenaMark, TooltipProvider } from '@reach/ui';
import { kithenaMarkDataUri } from '@reach/ui/brand/kithena-mark-data-uri';
import type { PublicCompany } from '@kithena/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies, headers } from 'next/headers';
import type { JSX, ReactNode } from 'react';

import './globals.css';
import { AccountMenu } from '../components/account-menu';
import { I18nProvider } from '../components/i18n-provider';
import { ThemeToggle } from '../components/theme-toggle';
import { SESSION_COOKIE, me } from '../lib/account';
import { company as readCompany } from '../lib/api';
import { t } from '../lib/i18n';
import { pageWords, requestLanguage } from '../lib/rsc-words';
import { THEME_KEY, themeScript } from '../lib/theme';

/**
 * The company a page is for (`x-kithena-company`, set by the proxy from the
 * path or the company's own domain), as its careers page shows it; null on
 * Kithena Jobs' own pages, or when the company cannot be read.
 */
async function pageCompany(): Promise<PublicCompany | null> {
  const slug = (await headers()).get('x-kithena-company');
  if (slug === null) return null;
  const answer = await readCompany(slug);
  return answer.ok ? answer.data.company : null;
}

export async function generateMetadata(): Promise<Metadata> {
  const company = await pageCompany();
  const metadataBase = new URL(process.env['JOBS_ORIGIN'] ?? 'https://jobs.kithena.com');
  // A company's pages carry its name and its logo, in the tab as on the page.
  return company === null
    ? {
        metadataBase,
        title: {
          default: t('app.layout.kithena_jobs', 'Kithena Jobs'),
          template: '%s · Kithena Jobs',
        },
        description: t(
          'app.layout.every_open_job_at_companies_that',
          'Every open job at companies that hire on Kithena. No account needed to apply.',
        ),
        icons: { icon: kithenaMarkDataUri },
      }
    : {
        metadataBase,
        title: {
          default: t('app.layout.careers_at', 'Careers at {{name}}', { name: company.name }),
          template: `%s · ${company.name}`,
        },
        description:
          company.about ??
          t('app.layout.open_jobs_at', 'Open jobs at {{name}}.', { name: company.name }),
        icons: { icon: company.logoUrl ?? kithenaMarkDataUri },
      };
}

/**
 * Kithena Jobs (REC-090): one header, the page, a short footer, nothing else.
 * On a company's pages (its careers page, a job, applying, a preview, its
 * scheduling, alerts, agency and candidate pages) the header and footer are
 * the company's: its logo and name, and the way back to its jobs. A
 * candidate applies to the company; Kithena is not the one hiring.
 */
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
  const company = await pageCompany();
  const language = requestLanguage();
  return (
    <html lang={language} className={dark ? 'dark' : undefined} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-dvh flex-col bg-canvas text-fg">
        <I18nProvider language={language} words={pageWords(language)}>
          <TooltipProvider>
            <header className="sticky top-0 z-20 border-b border-border bg-canvas">
              <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
                {company === null ? (
                  <>
                    <Link
                      href="/"
                      className="flex items-center gap-2 text-lg font-bold tracking-[-0.01em]"
                    >
                      <KithenaMark className="size-6 text-accent" />
                      {t('app.layout.kithena_jobs', 'Kithena Jobs')}
                    </Link>
                    <nav
                      aria-label={t('app.layout.site', 'Site')}
                      className="flex items-center gap-1 sm:gap-2"
                    >
                      <Button asChild variant="ghost" size="sm">
                        <Link href="/">{t('app.layout.jobs', 'Jobs')}</Link>
                      </Button>
                      <Button asChild variant="ghost" size="sm">
                        <Link href="/search">{t('app.layout.search', 'Search')}</Link>
                      </Button>
                    </nav>
                  </>
                ) : (
                  <>
                    <Link
                      href={`/${company.slug}`}
                      className="flex min-w-0 items-center gap-2.5 text-lg font-bold tracking-[-0.01em]"
                    >
                      <Avatar
                        name={company.name}
                        src={company.logoUrl ?? undefined}
                        shape="rounded"
                        fit="contain"
                        size="sm"
                        aria-hidden
                      />
                      <span className="truncate">{company.name}</span>
                    </Link>
                    <nav
                      aria-label={t('app.layout.site', 'Site')}
                      className="flex items-center gap-1 sm:gap-2"
                    >
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/${company.slug}`}>
                          {t('app.layout.all_jobs', 'All jobs')}
                        </Link>
                      </Button>
                    </nav>
                  </>
                )}
                <div className="ms-auto flex items-center gap-1 sm:gap-2">
                  <ThemeToggle />
                  {account !== null ? (
                    <AccountMenu
                      name={account.name}
                      email={account.email}
                      pictureUrl={account.pictureUrl}
                    />
                  ) : (
                    <Button asChild variant="primary" size="sm">
                      <Link href="/sign-in">{t('app.layout.sign_in', 'Sign in')}</Link>
                    </Button>
                  )}
                </div>
              </div>
            </header>
            <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 pb-24 sm:px-6 lg:pb-8">
              {children}
            </main>
            <footer className="border-t border-border">
              <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-fg-muted sm:px-6">
                {company === null ? (
                  <>
                    <span>
                      {t(
                        'app.layout.jobs_published_by_companies_that_hire',
                        'Jobs published by companies that hire on Kithena.',
                      )}
                    </span>
                    <span>
                      {t(
                        'app.layout.your_data_stays_with_the_company',
                        'Your data stays with the company you apply to.',
                      )}
                    </span>
                  </>
                ) : (
                  <>
                    <span>
                      {t('app.layout.careers_at', 'Careers at {{name}}', { name: company.name })}
                    </span>
                    <span>
                      {t(
                        'app.layout.what_you_send_goes_to_and',
                        'What you send goes to {{name}}, and stays with them.',
                        { name: company.name },
                      )}
                    </span>
                  </>
                )}
              </div>
            </footer>
          </TooltipProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
