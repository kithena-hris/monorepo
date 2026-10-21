import type { PublicJob } from '@kithena/contracts';
import {
  Avatar,
  Badge,
  Button,
  IconList,
  IconListItem,
  KeyValues,
  RichTextContent,
  Timeline,
  TimelineItem,
  icons,
} from '@reach/ui';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

import { countryName, hours as hoursOf, salary as salaryOf, where } from '../lib/format';
import { StickyTitle } from './sticky-title';

/**
 * A job as Kithena Jobs shows it (J3, R7): the page a candidate reads and the
 * one a recruiter previews are the same component, so what the team sees is
 * what will be published.
 *
 * The first viewport is the offer itself: the company, the title at display
 * size, and the four facts a candidate decides on (where, how, what kind of
 * contract, what it pays) before a word of the ad. Then the ad reads as an
 * article beside a rail that keeps the facts and the apply button in reach;
 * on a phone the rail folds under the title and the apply button stays at
 * the thumb. One entrance, staggered down the hero, and nothing else moves.
 */

const SENIORITY: Readonly<Record<string, string>> = {
  entry: 'Entry level',
  mid: 'Mid level',
  senior: 'Senior',
  lead: 'Lead',
  executive: 'Executive',
};
const MODE: Readonly<Record<string, string>> = {
  onsite: 'On site',
  hybrid: 'Hybrid',
  remote: 'Remote',
};
const LANGUAGE: Readonly<Record<string, string>> = {
  en: 'English',
  es: 'Spanish',
  de: 'German',
  hi: 'Hindi',
};

const BENEFIT_ICON: Readonly<Record<string, keyof typeof icons>> = {
  health: 'health',
  pension: 'payment',
  meal: 'break',
  transport: 'travel',
  childcare: 'parental',
  learning: 'review',
  equipment: 'system',
  wellbeing: 'health',
  mobility: 'travel',
  equity: 'analytics',
  bonus: 'payment',
  extra_holiday: 'vacation',
  insurance: 'agreement',
  flexible_pay: 'payroll',
  relocation: 'transfer',
};

const day = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });

/** One line in the hero: a glyph and a fact, entered in order. */
function Fact({
  icon,
  children,
  index,
}: {
  readonly icon: ReactNode;
  readonly children: ReactNode;
  readonly index: number;
}): JSX.Element {
  return (
    <li
      className="flex items-center gap-2 animate-enter motion-reduce:animate-none [&_svg]:size-[18px] [&_svg]:text-accent-fg"
      style={{ animationDelay: `${String(120 + index * 60)}ms` }}
    >
      <span aria-hidden>{icon}</span>
      <span>{children}</span>
    </li>
  );
}

export function JobAd({
  job,
  company,
  slug,
  preview = false,
  assistant,
}: {
  readonly job: PublicJob;
  readonly company: string;
  readonly slug: string;
  /** The team's look at an ad before it is published: the apply button is a note, not a link. */
  readonly preview?: boolean;
  /** The job assistant, when the page has one (never on a preview). */
  readonly assistant?: ReactNode;
}): JSX.Element {
  const pay = salaryOf(job);
  const applyHref = `/${company}/${slug}/apply?lang=${job.language}`;
  const place = job.places[0];
  const facts = [
    { label: 'Location', value: where(job) },
    { label: 'Work mode', value: MODE[job.workMode] ?? job.workMode },
    { label: 'Contract', value: job.contractType },
    { label: 'Hours', value: hoursOf(job.hours) },
    ...(job.seniority === null
      ? []
      : [{ label: 'Level', value: SENIORITY[job.seniority] ?? job.seniority }]),
    ...(job.department === null ? [] : [{ label: 'Team', value: job.department }]),
    ...(place === undefined ? [] : [{ label: 'Country', value: countryName(place.country) }]),
    { label: 'Ad language', value: LANGUAGE[job.language] ?? job.language.toUpperCase() },
    { label: 'Posted', value: day(job.postedAt) },
    ...(job.validThrough === null ? [] : [{ label: 'Open until', value: day(job.validThrough) }]),
  ];
  const apply = preview ? (
    <Button size="lg" disabled className="w-full">
      Apply now
    </Button>
  ) : (
    <Button asChild size="lg" className="w-full">
      <Link href={applyHref}>Apply now</Link>
    </Button>
  );
  return (
    <article className="-mx-4 flex flex-col sm:-mx-6">
      {/* The hero: company, title, the facts a decision needs, in that order. */}
      <header className="bg-accent-subtle/60 px-4 pt-10 pb-12 sm:px-6 sm:pt-14 sm:pb-16">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          <Link
            href={`/${job.company.slug}`}
            className="flex w-fit items-center gap-3 rounded-full pe-3 animate-enter motion-reduce:animate-none hover:underline"
          >
            <Avatar
              name={job.company.name}
              src={job.company.logoUrl ?? undefined}
              shape="rounded"
              fit={job.company.logoUrl === null ? 'cover' : 'contain'}
              size="lg"
            />
            <span className="font-semibold">{job.company.name}</span>
          </Link>
          <h1
            className="max-w-4xl text-4xl font-bold tracking-[-0.02em] text-balance animate-enter motion-reduce:animate-none sm:text-5xl lg:text-6xl"
            style={{ animationDelay: '60ms' }}
          >
            {job.title}
          </h1>
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-base text-fg" aria-label="At a glance">
            <Fact index={0} icon={<icons.location aria-hidden />}>
              {where(job)}
            </Fact>
            <Fact index={1} icon={<icons.agreement aria-hidden />}>
              {`${job.contractType} · ${hoursOf(job.hours)}`}
            </Fact>
            {pay === null ? null : (
              <Fact index={2} icon={<icons.payment aria-hidden />}>
                <span className="font-semibold">{pay}</span>
              </Fact>
            )}
            {job.seniority === null ? null : (
              <Fact index={3} icon={<icons.goal aria-hidden />}>
                {SENIORITY[job.seniority] ?? job.seniority}
              </Fact>
            )}
          </ul>
          {job.otherLanguages.length === 0 ? null : (
            <nav aria-label="Read in" className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-fg-muted">Read in</span>
              {[job.language, ...job.otherLanguages].map((l) => (
                <Button
                  key={l}
                  asChild
                  size="xs"
                  variant={l === job.language ? 'primary' : 'secondary'}
                >
                  <Link href={`/${company}/${slug}?lang=${l}`} lang={l}>
                    {LANGUAGE[l] ?? l.toUpperCase()}
                  </Link>
                </Button>
              ))}
            </nav>
          )}
        </div>
      </header>
      <StickyTitle
        title={job.title}
        company={job.company.name}
        applyHref={preview ? null : applyHref}
      />

      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-14">
        {/* The ad, read as an article. */}
        <div className="flex min-w-0 flex-col gap-10">
          {job.nycNotice ? (
            <p className="rounded-lg bg-surface-sunken px-4 py-3 text-sm text-fg-muted">
              This employer uses an automated tool in New York City to help assess applications (NYC
              Local Law 144). You may ask for an alternative process.
            </p>
          ) : null}
          <RichTextContent sanitisedHtml={job.html} className="job-ad" />
          {job.benefits.length === 0 ? null : (
            <section className="flex flex-col gap-4">
              <h2 className="text-2xl font-bold tracking-[-0.01em]">What we offer</h2>
              <IconList className="grid gap-x-8 sm:grid-cols-2">
                {job.benefits.map((b) => {
                  const Icon = icons[BENEFIT_ICON[b.category] ?? 'starred'];
                  return (
                    <IconListItem
                      key={`${b.category}:${b.name}`}
                      icon={<Icon aria-hidden />}
                      tone="accent"
                      {...(b.description === null ? {} : { description: b.description })}
                    >
                      {b.name}
                    </IconListItem>
                  );
                })}
              </IconList>
            </section>
          )}
          {job.process.length === 0 ? null : (
            <section className="flex flex-col gap-4">
              <h2 className="text-2xl font-bold tracking-[-0.01em]">How we hire</h2>
              <Timeline>
                {job.process.map((step, i) => (
                  <TimelineItem
                    key={step}
                    title={step}
                    tone={i === 0 ? 'accent' : 'neutral'}
                    icon={<Badge size="sm">{String(i + 1)}</Badge>}
                  />
                ))}
              </Timeline>
            </section>
          )}
        </div>

        {/* The rail: what it pays and the way in, in reach while reading. */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
          <div className="flex flex-col gap-5 rounded-2xl bg-surface p-6 shadow-md">
            {pay === null ? (
              <p className="text-lg font-semibold text-fg-muted">Pay not shown</p>
            ) : (
              <div className="flex flex-col">
                <span className="text-sm text-fg-muted">Pays</span>
                <span className="text-2xl font-bold tracking-[-0.01em]">{pay}</span>
              </div>
            )}
            {apply}
            <p className="text-sm text-fg-muted">
              {preview
                ? 'A preview: nobody can apply from here.'
                : 'No account needed. Your CV fills most of the form.'}
            </p>
            <KeyValues items={facts} layout="aligned" labelWidth="7rem" className="text-sm" />
          </div>
          {assistant}
        </aside>
      </div>

      {/* On a phone the way in stays at the thumb. */}
      {preview ? null : (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-canvas/95 p-3 backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-6xl items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {pay ?? job.title}
            </span>
            <Button asChild size="md">
              <Link href={applyHref}>Apply now</Link>
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}
