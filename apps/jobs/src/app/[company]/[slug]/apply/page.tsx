import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';

import { job as readJob } from '../../../../lib/api';
import { ApplyForm } from './apply-form';

type Params = Promise<{ company: string; slug: string }>;
type Search = Promise<{ lang?: string; src?: string }>;

export const metadata: Metadata = { title: 'Apply', robots: { index: false } };

/** J4: the apply flow for one job, its form as the job defines it. */
export default async function Apply({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}): Promise<JSX.Element> {
  const { company, slug } = await params;
  const { lang, src } = await searchParams;
  const answer = await readJob(company, slug, lang);
  if (!answer.ok || answer.data.closed) notFound();
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <p className="text-sm text-fg-muted">{answer.data.company.name}</p>
      <h1 className="text-2xl font-bold">{`Apply: ${answer.data.title}`}</h1>
      <ApplyForm job={answer.data} source={src ?? null} />
    </div>
  );
}
