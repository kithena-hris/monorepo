import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';

import { JobAd } from '../../../components/job-ad';
import { JobAssistant } from '../../../components/job-assistant';
import { job as readJob } from '../../../lib/api';
import { jobPosting, ldJson, plain } from '../../../lib/structured';
import { t } from '../../../lib/i18n';

type Params = Promise<{ company: string; slug: string }>;
type Search = Promise<{ lang?: string }>;

const origin = () => process.env['JOBS_ORIGIN'] ?? 'https://jobs.kithena.com';

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}): Promise<Metadata> {
  const { company, slug } = await params;
  const answer = await readJob(company, slug, (await searchParams).lang);
  if (!answer.ok)
    return {
      title: t('app.[company].[slug].page.job_not_found', 'Job not found'),
      robots: { index: false },
    };
  const j = answer.data;
  return {
    title: t('app.[company].[slug].page.at', '{{title}} at {{name}}', {
      title: j.title,
      name: j.company.name,
    }),
    description: plain(j.html).slice(0, 160),
    alternates: { canonical: `/${company}/${slug}` },
    robots: { index: !j.closed },
  };
}

/**
 * J3: a job. The ad is the HTML Recruiting rendered from the editor's
 * document through its allow-list (`domain/ad/render.ts`); it is shown as
 * that, and carries JobPosting data for Google for Jobs. A closed job or one
 * taken down is not found, which search engines drop.
 */
export default async function JobPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}): Promise<JSX.Element> {
  const { company, slug } = await params;
  const answer = await readJob(company, slug, (await searchParams).lang);
  if (!answer.ok || answer.data.closed) notFound();
  const j = answer.data;
  const url = `${origin()}/${company}/${slug}`;
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: ldJson(jobPosting(j, url)) }}
      />
      <JobAd
        job={j}
        company={company}
        slug={slug}
        assistant={<JobAssistant company={company} slug={slug} />}
      />
    </>
  );
}
