import {
  Alert,
  Button,
  Checkbox,
  EmptyState,
  Field,
  FieldControl,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  icons,
} from '@reach/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { JSX } from 'react';

import { JobCard } from '../../components/job-card';
import { SearchBar } from '../../components/search-bar';
import { search } from '../../lib/api';
import { queryOf, type Search } from '../../lib/query';
import { t } from '../../lib/i18n';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Search;
}): Promise<Metadata> {
  const q = queryOf(await searchParams).get('q');
  return {
    title:
      q === null
        ? t('app.search.page.search_jobs', 'Search jobs')
        : t('app.search.page.jobs', '{{q}} jobs', { q }),
    robots: { index: false },
  };
}

const MODES = (): readonly [string, string][] => [
  ['remote', t('app.search.page.remote', 'Remote')],
  ['hybrid', t('app.search.page.hybrid', 'Hybrid')],
  ['onsite', t('app.search.page.on_site', 'On site')],
];

function Choose({
  name,
  label,
  value,
  options,
}: {
  readonly name: string;
  readonly label: string;
  readonly value: string | null;
  readonly options: readonly [string, string][];
}): JSX.Element {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Select name={name} defaultValue={value ?? 'any'}>
        <FieldControl>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
        </FieldControl>
        <SelectContent>
          {options.map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/**
 * J2: results, server-rendered; every filter is in the address, so every page
 * is bookmarkable. When nothing matches every word, the closest jobs are
 * shown instead of nothing, and the page says so.
 */
export default async function Results({
  searchParams,
}: {
  searchParams: Search;
}): Promise<JSX.Element> {
  const query = queryOf(await searchParams);
  const said = query.get('said') ?? '';
  query.delete('said');
  const answer = await search(query);
  const modes = new Set((query.get('workMode') ?? '').split(','));
  const page = Number(query.get('page') ?? '1');
  const q = query.get('q') ?? '';
  const at = (n: number) => {
    const next = new URLSearchParams(query);
    next.set('page', String(n));
    return `/search?${next.toString()}`;
  };
  return (
    <>
      <SearchBar q={q} country={query.get('country') ?? ''} said={said} />
      {said === '' ? null : (
        <p className="flex items-center gap-2 text-sm text-fg-muted">
          <icons.assistant aria-hidden className="size-4 text-accent-fg" />
          {t(
            'app.search.page.understood',
            'Understood: {{said}}. The filters are in the address; change any of them.',
            { said },
          )}
        </p>
      )}
      <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <form
          action="/search"
          method="get"
          aria-label={t('app.search.page.filters', 'Filters')}
          className="flex flex-col gap-4"
        >
          {(['q', 'country'] as const).map((k) =>
            query.get(k) === null ? null : (
              <input key={k} type="hidden" name={k} value={query.get(k) ?? ''} />
            ),
          )}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold">
              {t('app.search.page.work_mode', 'Work mode')}
            </legend>
            {MODES().map(([v, l]) => (
              <div key={v} className="flex items-center gap-2">
                <Checkbox
                  id={`mode-${v}`}
                  name="workMode"
                  value={v}
                  defaultChecked={modes.has(v)}
                />
                <label htmlFor={`mode-${v}`}>{l}</label>
              </div>
            ))}
          </fieldset>
          <Choose
            name="hours"
            label={t('app.search.page.hours', 'Hours')}
            value={query.get('hours')}
            options={[
              ['any', t('app.search.page.any', 'Any')],
              ['full_time', t('app.search.page.full_time', 'Full time')],
              ['part_time', t('app.search.page.part_time', 'Part time')],
            ]}
          />
          <Choose
            name="postedWithinDays"
            label={t('app.search.page.posted', 'Posted')}
            value={query.get('postedWithinDays')}
            options={[
              ['any', t('app.search.page.any_time', 'Any time')],
              ['1', t('app.search.page.today', 'Today')],
              ['7', t('app.search.page.this_week', 'This week')],
              ['30', t('app.search.page.this_month', 'This month')],
            ]}
          />
          <Field>
            <FieldLabel>{t('app.search.page.company', 'Company')}</FieldLabel>
            <FieldControl>
              <Input
                name="company"
                defaultValue={query.get('company') ?? ''}
                placeholder={t('app.search.page.acme', 'acme')}
              />
            </FieldControl>
          </Field>
          <Choose
            name="sort"
            label={t('app.search.page.sort', 'Sort')}
            value={query.get('sort')}
            options={[
              ['any', 'Relevance'],
              ['newest', 'Newest'],
              ['salary', 'Salary'],
            ]}
          />
          <Button type="submit" variant="secondary">
            {t('app.search.page.apply_filters', 'Apply filters')}
          </Button>
        </form>
        <section
          aria-label={t('app.search.page.results', 'Results')}
          className="flex min-w-0 flex-col gap-3"
        >
          {!answer.ok ? (
            <Alert
              tone="danger"
              title={t('app.search.page.the_search_did_not_run', 'The search did not run')}
            >
              {answer.message}
            </Alert>
          ) : answer.data.rows.length === 0 ? (
            answer.data.nearby !== undefined && answer.data.nearby.length > 0 ? (
              <>
                <Alert
                  tone="info"
                  icon={<icons.assistant aria-hidden />}
                  title={t(
                    'app.search.page.nothing_matches_exactly',
                    'Nothing matches “{{q}}” exactly',
                    { q },
                  )}
                >
                  {said === ''
                    ? t(
                        'app.search.page.these_are_the_closest',
                        'These are the closest to what you asked for: they share the skills or the field, so one may fit better than its title suggests.',
                      )
                    : t(
                        'app.search.page.these_are_the_closest_to_said',
                        'These are the closest to what you asked for ({{said}}): they share the skills or the field, so one may fit better than its title suggests.',
                        { said: said.replace(/\.$/u, '') },
                      )}
                </Alert>
                {answer.data.nearby.map((job, i) => (
                  <JobCard key={`${job.jobId}:${job.language}`} job={job} index={i} />
                ))}
              </>
            ) : (
              <EmptyState
                icon={<icons.search aria-hidden />}
                title={t('app.search.page.no_jobs_match', 'No jobs match')}
                description={t(
                  'app.search.page.try_fewer_filters_another_word_or',
                  'Try fewer filters, another word, or describe what you want and let the AI set the filters.',
                )}
                action={
                  <Button asChild variant="secondary">
                    <Link href="/">{t('app.search.page.every_open_job', 'Every open job')}</Link>
                  </Button>
                }
              />
            )
          ) : (
            <>
              <h2 className="font-semibold">
                {t(
                  'app.search.page.jobs',
                  { one: '{{count}} job', other: '{{count}} jobs' },
                  { count: answer.data.total },
                )}
              </h2>
              {answer.data.rows.map((job, i) => (
                <JobCard key={`${job.jobId}:${job.language}`} job={job} index={i} />
              ))}
              <nav
                aria-label={t('app.search.page.pages', 'Pages')}
                className="flex justify-center gap-2"
              >
                {page > 1 ? (
                  <Button asChild variant="secondary">
                    <Link href={at(page - 1)}>
                      {t('app.search.page.previous_page', 'Previous page')}
                    </Link>
                  </Button>
                ) : null}
                {page * 20 < answer.data.total ? (
                  <Button asChild variant="secondary">
                    <Link href={at(page + 1)}>{t('app.search.page.next_page', 'Next page')}</Link>
                  </Button>
                ) : null}
              </nav>
            </>
          )}
        </section>
      </div>
    </>
  );
}
