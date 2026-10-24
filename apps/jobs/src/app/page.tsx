import { Alert, Button, EmptyState, icons } from '@reach/ui';
import Link from 'next/link';
import type { JSX } from 'react';

import { JobCard } from '../components/job-card';
import { SearchBar } from '../components/search-bar';
import { search } from '../lib/api';
import { t } from '../lib/i18n';

/**
 * J1: the front page is every open job, newest first, under one search.
 * There is no empty landing page to get past: a candidate sees work on the
 * first viewport, and narrows it by keywords, a country, or a sentence.
 */
export default async function Home(): Promise<JSX.Element> {
  const answer = await search(new URLSearchParams({ sort: 'newest' }));
  const shortcuts: readonly [string, string][] = [
    ['Remote', '/search?workMode=remote'],
    ['Engineering', '/search?q=engineer'],
    ['Design', '/search?q=design'],
    ['Sales', '/search?q=sales'],
    [t('app.page.part_time', 'Part time'), '/search?hours=part_time'],
    ['Spain', '/search?country=ES'],
    ['Germany', '/search?country=DE'],
  ];
  return (
    <>
      <section className="-mx-4 bg-accent-subtle/60 px-4 py-14 sm:-mx-6 sm:px-6 sm:py-20">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-7">
          <h1 className="max-w-3xl text-4xl font-bold tracking-[-0.02em] text-balance animate-enter motion-reduce:animate-none sm:text-5xl lg:text-6xl">
            {t('app.page.work_at_companies_that_hire_on', 'Work at companies that hire on Kithena')}
          </h1>
          <p
            className="max-w-2xl text-lg text-fg-muted animate-enter motion-reduce:animate-none"
            style={{ animationDelay: '60ms' }}
          >
            {t(
              'app.page.every_open_job_from_every_company',
              'Every open job, from every company here. Search it, or describe the job you want and let the filters follow. No account needed to apply.',
            )}
          </p>
          <div
            className="w-full animate-enter motion-reduce:animate-none"
            style={{ animationDelay: '120ms' }}
          >
            <SearchBar size="lg" />
          </div>
          <nav
            aria-label={t('app.page.popular_searches', 'Popular searches')}
            className="flex flex-wrap gap-2 animate-enter motion-reduce:animate-none"
            style={{ animationDelay: '180ms' }}
          >
            {shortcuts.map(([label, href]) => (
              <Button key={label} asChild variant="secondary" size="sm">
                <Link href={href}>{label}</Link>
              </Button>
            ))}
          </nav>
        </div>
      </section>
      <section aria-label={t('app.page.open_jobs', 'Open jobs')} className="flex flex-col gap-3">
        {!answer.ok ? (
          <Alert tone="danger" title={t('app.page.the_jobs_did_not_load', 'The jobs did not load')}>
            {answer.message}
          </Alert>
        ) : answer.data.rows.length === 0 ? (
          <EmptyState
            icon={<icons.work aria-hidden />}
            title={t('app.page.no_open_jobs_right_now', 'No open jobs right now')}
            description={t(
              'app.page.companies_publish_here_as_they_hire',
              'Companies publish here as they hire. Set an alert on a company’s page to hear first.',
            )}
          />
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-xl font-bold tracking-[-0.01em]">
                {t(
                  'app.page.open_jobs',
                  { one: '{{count}} open job', other: '{{count}} open jobs' },
                  { count: answer.data.total },
                )}
              </h2>
              <Button asChild variant="link" size="sm">
                <Link href="/search?sort=salary">{t('app.page.by_salary', 'By salary')}</Link>
              </Button>
            </div>
            {answer.data.rows.map((job, i) => (
              <JobCard key={`${job.jobId}:${job.language}`} job={job} index={i} />
            ))}
            {answer.data.total > answer.data.rows.length ? (
              <div className="flex justify-center pt-2">
                <Button asChild variant="secondary">
                  <Link href="/search?sort=newest&page=2">
                    {t('app.page.more_jobs', 'More jobs')}
                  </Link>
                </Button>
              </div>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}
