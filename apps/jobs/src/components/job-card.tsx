import type { PublicListing } from '@kithena/contracts';
import { Avatar, Badge, Card } from '@reach/ui';
import Link from 'next/link';
import type { JSX } from 'react';

import { ago, hours, salary, where } from '../lib/format';

const MODE: Readonly<Record<string, string>> = {
  onsite: 'On site',
  hybrid: 'Hybrid',
  remote: 'Remote',
};

/**
 * One job in a list: the search, the front page, the careers page, a closed
 * job's neighbours. The title is the link; the facts under it are the ones a
 * card is scanned for, and the pay is the loudest of them. Rows enter in
 * order, once, and then hold still.
 */
export function JobCard({
  job,
  showCompany = true,
  index = 0,
}: {
  readonly job: PublicListing;
  readonly showCompany?: boolean;
  /** Its place in the list, for the entrance. */
  readonly index?: number;
}): JSX.Element {
  const pay = salary(job);
  return (
    <Card
      padded
      interactive
      className="relative flex items-start gap-4 animate-enter motion-reduce:animate-none"
      style={{ animationDelay: `${String(Math.min(index, 8) * 40)}ms` }}
    >
      <Avatar
        name={job.company.name}
        src={job.company.logoUrl ?? undefined}
        shape="rounded"
        fit={job.company.logoUrl === null ? 'cover' : 'contain'}
        size="lg"
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h3 className="text-lg font-semibold leading-snug tracking-[-0.01em]">
          <Link href={`/${job.company.slug}/${job.slug}`} className="after:absolute after:inset-0">
            {job.title}
          </Link>
        </h3>
        <p className="text-sm text-fg-muted">
          {showCompany ? `${job.company.name} · ${where(job)}` : where(job)}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {pay === null ? null : (
            <Badge size="sm" tone="success" variant="solid">
              {pay}
            </Badge>
          )}
          <Badge size="sm">{`${job.contractType} · ${hours(job.hours)}`}</Badge>
          <Badge size="sm" variant="outline">
            {MODE[job.workMode] ?? job.workMode}
          </Badge>
          {job.department === null ? null : (
            <Badge size="sm" variant="outline">
              {job.department}
            </Badge>
          )}
        </div>
      </div>
      <span className="shrink-0 text-xs text-fg-muted tabular-nums">{ago(job.postedAt)}</span>
    </Card>
  );
}
