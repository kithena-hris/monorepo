import type { PublicJob } from '@kithena/contracts';
import {
  Avatar,
  Badge,
  Button,
  IconTile,
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
import { t } from '../lib/i18n';

/** The rail's Apply now, which the bars watch so only one is ever on screen. */
const APPLY_ID = 'apply-now';

/**
 * A job as Kithena Jobs shows it (J3, R7): the page a candidate reads and the
 * one a recruiter previews are the same component, so what the team sees is
 * what will be published.
 *
 * The first viewport is the offer itself: the company, the title at display
 * size, and the four facts a candidate decides on (where, how, what kind of
 * contract, what it pays) before a word of the ad. Then the ad reads as an
 * article beside a rail with the facts and the apply button; once that
 * button scrolls away a bar keeps the title and Apply now at the top, and on
 * a phone at the thumb. One entrance, staggered down the hero, and nothing else moves.
 */

const SENIORITY = (): Readonly<Record<string, string>> => ({
  entry: t('components.job-ad.entry_level', 'Entry level'),
  mid: t('components.job-ad.mid_level', 'Mid level'),
  senior: t('components.job-ad.senior', 'Senior'),
  lead: t('components.job-ad.lead', 'Lead'),
  executive: t('components.job-ad.executive', 'Executive'),
});
const MODE = (): Readonly<Record<string, string>> => ({
  onsite: t('components.job-ad.on_site', 'On site'),
  hybrid: t('components.job-ad.hybrid', 'Hybrid'),
  remote: t('components.job-ad.remote', 'Remote'),
});
const LANGUAGE = (): Readonly<Record<string, string>> => ({
  en: t('components.job-ad.english', 'English'),
  es: t('components.job-ad.spanish', 'Spanish'),
  de: t('components.job-ad.german', 'German'),
  hi: t('components.job-ad.hindi', 'Hindi'),
});

const BENEFIT_ICON: Readonly<Record<string, string>> = {
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

type Glyph = (typeof icons)['starred'];

/** A category's icon: the one Recruiting names, else the old fixed map, else a star. */
const iconOf = (name: string | undefined): Glyph =>
  (icons as unknown as Readonly<Record<string, Glyph | undefined>>)[name ?? ''] ?? icons.starred;

/** The benefits by category, in the order the categories first appear. */
function benefitGroups(benefits: PublicJob['benefits']): {
  key: string;
  name: string;
  icon: string;
  benefits: PublicJob['benefits'];
}[] {
  const groups = new Map<
    string,
    { key: string; name: string; icon: string; benefits: PublicJob['benefits'] }
  >();
  for (const b of benefits) {
    const held = groups.get(b.category);
    if (held !== undefined) held.benefits = [...held.benefits, b];
    else
      groups.set(b.category, {
        key: b.category,
        name:
          b.categoryName ?? b.category.replaceAll('_', ' ').replace(/^./u, (c) => c.toUpperCase()),
        icon: b.icon ?? BENEFIT_ICON[b.category] ?? 'starred',
        benefits: [b],
      });
  }
  return [...groups.values()];
}

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
    { label: t('components.job-ad.location', 'Location'), value: where(job) },
    {
      label: t('components.job-ad.work_mode', 'Work mode'),
      value: MODE()[job.workMode] ?? job.workMode,
    },
    { label: t('components.job-ad.contract', 'Contract'), value: job.contractType },
    { label: t('components.job-ad.hours', 'Hours'), value: hoursOf(job.hours) },
    ...(job.seniority === null
      ? []
      : [
          {
            label: t('components.job-ad.level', 'Level'),
            value: SENIORITY()[job.seniority] ?? job.seniority,
          },
        ]),
    ...(job.department === null
      ? []
      : [{ label: t('components.job-ad.team', 'Team'), value: job.department }]),
    ...(place === undefined
      ? []
      : [{ label: t('components.job-ad.country', 'Country'), value: countryName(place.country) }]),
    {
      label: t('components.job-ad.ad_language', 'Ad language'),
      value: LANGUAGE()[job.language] ?? job.language.toUpperCase(),
    },
    { label: t('components.job-ad.posted', 'Posted'), value: day(job.postedAt) },
    ...(job.validThrough === null
      ? []
      : [{ label: t('components.job-ad.open_until', 'Open until'), value: day(job.validThrough) }]),
  ];
  const apply = preview ? (
    <Button id={APPLY_ID} variant="primary" size="lg" disabled className="w-full">
      {t('components.job-ad.apply_now', 'Apply now')}
    </Button>
  ) : (
    <Button asChild variant="primary" size="lg" className="w-full">
      <Link id={APPLY_ID} href={applyHref}>
        {t('components.job-ad.apply_now', 'Apply now')}
      </Link>
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
          <ul
            className="flex flex-wrap gap-x-6 gap-y-2 text-base text-fg"
            aria-label={t('components.job-ad.at_a_glance', 'At a glance')}
          >
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
                {SENIORITY()[job.seniority] ?? job.seniority}
              </Fact>
            )}
          </ul>
          {job.otherLanguages.length === 0 ? null : (
            <nav
              aria-label={t('components.job-ad.read_in', 'Read in')}
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              <span className="text-fg-muted">{t('components.job-ad.read_in', 'Read in')}</span>
              {[job.language, ...job.otherLanguages].map((l) => (
                <Button
                  key={l}
                  asChild
                  size="xs"
                  variant={l === job.language ? 'primary' : 'secondary'}
                >
                  <Link href={`/${company}/${slug}?lang=${l}`} lang={l}>
                    {LANGUAGE()[l] ?? l.toUpperCase()}
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
        thumb={pay ?? job.title}
        watch={APPLY_ID}
      />

      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-14">
        {/* The ad, read as an article. */}
        <div className="flex min-w-0 flex-col gap-10">
          {job.nycNotice ? (
            <p className="rounded-lg bg-surface-sunken px-4 py-3 text-sm text-fg-muted">
              {t(
                'components.job-ad.this_employer_uses_an_automated_tool',
                'This employer uses an automated tool in New York City to help assess applications (NYC Local Law 144). You may ask for an alternative process.',
              )}
            </p>
          ) : null}
          <RichTextContent sanitisedHtml={job.html} className="job-ad" />
          {job.benefits.length === 0 ? null : (
            <section className="flex flex-col gap-6">
              <h2 className="text-2xl font-bold tracking-[-0.01em]">
                {t('components.job-ad.what_we_offer', 'What we offer')}
              </h2>
              {/* By category, each led by its icon and name; every benefit a name and a line. */}
              <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
                {benefitGroups(job.benefits).map((g) => {
                  const Icon = iconOf(g.icon);
                  return (
                    <section key={g.key} className="flex flex-col gap-3">
                      <div className="flex items-center gap-3">
                        <IconTile tone="accent" size="lg">
                          <Icon />
                        </IconTile>
                        <h3 className="text-lg font-semibold">{g.name}</h3>
                      </div>
                      {/* Only the category carries a mark; its benefits read as words under its name. */}
                      <ul className="flex flex-col gap-3 ps-13">
                        {g.benefits.map((b) => (
                          <li key={b.name} className="flex flex-col gap-0.5">
                            <span className="font-medium text-fg">{b.name}</span>
                            {b.description === null ? null : (
                              <span className="text-sm text-pretty text-fg-muted">
                                {b.description}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            </section>
          )}
          {job.process.length === 0 ? null : (
            <section className="flex flex-col gap-4">
              <h2 className="text-2xl font-bold tracking-[-0.01em]">
                {t('components.job-ad.how_we_hire', 'How we hire')}
              </h2>
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
        <aside className="flex flex-col gap-4 lg:self-start">
          <div className="flex flex-col gap-5 rounded-2xl bg-surface p-6 shadow-md">
            {pay === null ? (
              <p className="text-lg font-semibold text-fg-muted">
                {t('components.job-ad.pay_not_shown', 'Pay not shown')}
              </p>
            ) : (
              <div className="flex flex-col">
                <span className="text-sm text-fg-muted">{t('components.job-ad.pays', 'Pays')}</span>
                <span className="text-2xl font-bold tracking-[-0.01em]">{pay}</span>
              </div>
            )}
            {apply}
            <p className="text-sm text-fg-muted">
              {preview
                ? t(
                    'components.job-ad.a_preview_nobody_can_apply_from',
                    'A preview: nobody can apply from here.',
                  )
                : t(
                    'components.job-ad.no_account_needed_your_cv_fills',
                    'No account needed. Your CV fills most of the form.',
                  )}
            </p>
            <KeyValues items={facts} layout="aligned" labelWidth="7rem" className="text-sm" />
          </div>
          {assistant}
        </aside>
      </div>
    </article>
  );
}
