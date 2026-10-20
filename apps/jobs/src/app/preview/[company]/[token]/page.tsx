import { Alert } from '@reach/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';

import { JobAd } from '../../../../components/job-ad';
import { preview as readPreview } from '../../../../lib/api';

export const metadata: Metadata = { title: 'Preview', robots: { index: false, follow: false } };

/**
 * R7: a job as it will look here, for the team that is writing it. Behind a
 * token the job's screen hands out for a day; never indexed, and nobody can
 * apply from it.
 */
export default async function PreviewPage({
  params,
}: {
  params: Promise<{ company: string; token: string }>;
}): Promise<JSX.Element> {
  const { company, token } = await params;
  const answer = await readPreview(company, token);
  if (!answer.ok) notFound();
  const j = answer.data;
  return (
    <>
      <Alert tone="info" title="A preview" className="-mb-2">
        This is how the ad will look on Kithena Jobs. It is not published, and this link is the
        team’s for a day.
      </Alert>
      <JobAd job={j} company={company} slug={j.slug} preview />
    </>
  );
}
