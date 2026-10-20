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

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Search;
}): Promise<Metadata> {
  const q = queryOf(await searchParams).get('q');
  return { title: q === null ? 'Search jobs' : `${q} jobs`, robots: { index: false } };
}

const MODES: readonly [string, string][] = [
  ['remote', 'Remote'],
  ['hybrid', 'Hybrid'],
  ['onsite', 'On site'],
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
          {`Understood: ${said}. The filters are in the address; change any of them.`}
        </p>
      )}
      <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <form action="/search" method="get" aria-label="Filters" className="flex flex-col gap-4">
          {(['q', 'country'] as const).map((k) =>
            query.get(k) === null ? null : (
              <input key={k} type="hidden" name={k} value={query.get(k) ?? ''} />
            ),
          )}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold">Work mode</legend>
            {MODES.map(([v, l]) => (
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
            label="Hours"
            value={query.get('hours')}
            options={[
              ['any', 'Any'],
              ['full_time', 'Full time'],
              ['part_time', 'Part time'],
            ]}
          />
          <Choose
            name="postedWithinDays"
            label="Posted"
            value={query.get('postedWithinDays')}
            options={[
              ['any', 'Any time'],
              ['1', 'Today'],
              ['7', 'This week'],
              ['30', 'This month'],
            ]}
          />
          <Field>
            <FieldLabel>Company</FieldLabel>
            <FieldControl>
              <Input name="company" defaultValue={query.get('company') ?? ''} placeholder="acme" />
            </FieldControl>
          </Field>
          <Choose
            name="sort"
            label="Sort"
            value={query.get('sort')}
            options={[
              ['any', 'Relevance'],
              ['newest', 'Newest'],
              ['salary', 'Salary'],
            ]}
          />
          <Button type="submit" variant="secondary">
            Apply filters
          </Button>
        </form>
        <section aria-label="Results" className="flex min-w-0 flex-col gap-3">
          {!answer.ok ? (
            <Alert tone="danger" title="The search did not run">
              {answer.message}
            </Alert>
          ) : answer.data.rows.length === 0 ? (
            answer.data.nearby !== undefined && answer.data.nearby.length > 0 ? (
              <>
                <Alert
                  tone="info"
                  icon={<icons.assistant aria-hidden />}
                  title={`Nothing matches “${q}” exactly`}
                >
                  {`These are the closest to what you asked for${said === '' ? '' : ` (${said.replace(/\.$/u, '')})`}: they share the skills or the field, so one may fit better than its title suggests.`}
                </Alert>
                {answer.data.nearby.map((job, i) => (
                  <JobCard key={`${job.jobId}:${job.language}`} job={job} index={i} />
                ))}
              </>
            ) : (
              <EmptyState
                icon={<icons.search aria-hidden />}
                title="No jobs match"
                description="Try fewer filters, another word, or describe what you want and let the AI set the filters."
                action={
                  <Button asChild variant="secondary">
                    <Link href="/">Every open job</Link>
                  </Button>
                }
              />
            )
          ) : (
            <>
              <h2 className="font-semibold">{`${answer.data.total.toLocaleString('en-GB')} job${answer.data.total === 1 ? '' : 's'}`}</h2>
              {answer.data.rows.map((job, i) => (
                <JobCard key={`${job.jobId}:${job.language}`} job={job} index={i} />
              ))}
              <nav aria-label="Pages" className="flex justify-center gap-2">
                {page > 1 ? (
                  <Button asChild variant="secondary">
                    <Link href={at(page - 1)}>Previous page</Link>
                  </Button>
                ) : null}
                {page * 20 < answer.data.total ? (
                  <Button asChild variant="secondary">
                    <Link href={at(page + 1)}>Next page</Link>
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
