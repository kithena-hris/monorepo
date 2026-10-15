import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  RichTextContent,
} from '@reach/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';

import { JobAssistant } from '../../../components/job-assistant';
import { job as readJob } from '../../../lib/api';
import { hours, salary, where } from '../../../lib/format';
import { jobPosting, ldJson, plain } from '../../../lib/structured';

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
  if (!answer.ok) return { title: 'Job not found', robots: { index: false } };
  const j = answer.data;
  return {
    title: `${j.title} at ${j.company.name}`,
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
  const pay = salary(j);
  const url = `${origin()}/${company}/${slug}`;
  return (
    <article className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: ldJson(jobPosting(j, url)) }}
      />
      <div className="flex min-w-0 flex-col gap-6">
        <Link href={`/${j.company.slug}`} className="flex items-center gap-3 hover:underline">
          <Avatar
            name={j.company.name}
            src={j.company.logoUrl ?? undefined}
            shape="rounded"
            size="xl"
          />
          <span className="font-semibold">{j.company.name}</span>
        </Link>
        <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">{j.title}</h1>
        <div className="flex flex-wrap gap-2">
          <Badge>{where(j)}</Badge>
          <Badge>{j.contractType}</Badge>
          <Badge>{hours(j.hours)}</Badge>
          {pay === null ? null : <Badge tone="success">{pay}</Badge>}
        </div>
        {j.otherLanguages.length === 0 ? null : (
          <nav aria-label="Languages" className="flex gap-2">
            {[j.language, ...j.otherLanguages].map((l) => (
              <Button
                key={l}
                asChild
                size="sm"
                variant={l === j.language ? 'primary' : 'secondary'}
              >
                <Link href={`/${company}/${slug}?lang=${l}`} lang={l}>
                  {l.toUpperCase()}
                </Link>
              </Button>
            ))}
          </nav>
        )}
        {/* Rendered by Recruiting's allow-list from the editor's document before it was stored. */}
        <RichTextContent sanitisedHtml={j.html} className="max-w-prose" />
        {j.benefits.length === 0 ? null : (
          <section className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold">What we offer</h2>
            <ul className="ml-5 list-disc">
              {j.benefits.map((b) => (
                <li key={b.name}>
                  {b.description === null ? b.name : `${b.name}: ${b.description}`}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <aside className="flex flex-col gap-4">
        <Card padded className="flex flex-col gap-3">
          <Button asChild size="lg">
            <Link href={`/${company}/${slug}/apply?lang=${j.language}`}>Apply now</Link>
          </Button>
          <p className="text-sm text-fg-muted">No account needed. Your CV fills most of it.</p>
        </Card>
        {j.process.length === 0 ? null : (
          <Card>
            <CardHeader>
              <CardTitle level={2}>How we hire</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-2">
                {j.process.map((s, i) => (
                  <li key={s} className="flex items-center gap-2">
                    <Badge size="sm">{String(i + 1)}</Badge>
                    {s}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        )}
        <p className="text-xs text-fg-muted">
          {`Posted ${new Date(j.postedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}${
            j.validThrough === null
              ? ''
              : ` · open until ${new Date(j.validThrough).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
          }`}
        </p>
        <JobAssistant company={company} slug={slug} />
      </aside>
    </article>
  );
}
