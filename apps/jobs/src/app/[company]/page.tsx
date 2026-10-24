import { Avatar, EmptyState, icons } from '@reach/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';

import { JobAlert } from '../../components/job-alert';
import { JobCard } from '../../components/job-card';
import { company as readCompany } from '../../lib/api';
import { t } from '../../lib/i18n';

type Params = Promise<{ company: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const answer = await readCompany((await params).company);
  return answer.ok
    ? {
        title: t('app.[company].page.jobs_at', 'Jobs at {{name}}', {
          name: answer.data.company.name,
        }),
        description: answer.data.company.about ?? undefined,
      }
    : {
        title: t('app.[company].page.company_not_found', 'Company not found'),
        robots: { index: false },
      };
}

/** J10: a company's careers page, every open job of theirs whether or not it is on the shared search. */
export default async function CareersPage({ params }: { params: Params }): Promise<JSX.Element> {
  const slug = (await params).company;
  const answer = await readCompany(slug);
  if (!answer.ok) notFound();
  const { company, jobs } = answer.data;
  return (
    <>
      <section className="flex flex-col gap-4 py-8">
        <div className="flex items-center gap-3">
          <Avatar
            name={company.name}
            src={company.logoUrl ?? undefined}
            shape="rounded"
            size="2xl"
          />
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            {t('app.[company].page.jobs_at', 'Jobs at {{name}}', { name: company.name })}
          </h1>
        </div>
        {company.about === null ? null : (
          <p className="max-w-prose text-lg text-fg-muted">{company.about}</p>
        )}
      </section>
      <section
        aria-label={t('app.[company].page.open_jobs', 'Open jobs')}
        className="flex flex-col gap-3"
      >
        <h2 className="font-semibold">
          {t(
            'app.[company].page.open_jobs',
            { one: '{{count}} open job', other: '{{count}} open jobs' },
            { count: jobs.length },
          )}
        </h2>
        {jobs.length === 0 ? (
          <EmptyState
            icon={<icons.work aria-hidden />}
            title={t('app.[company].page.no_open_jobs_right_now', 'No open jobs right now')}
          />
        ) : (
          jobs.map((j) => <JobCard key={`${j.jobId}:${j.language}`} job={j} showCompany={false} />)
        )}
      </section>
      <JobAlert company={slug} name={company.name} />
    </>
  );
}
