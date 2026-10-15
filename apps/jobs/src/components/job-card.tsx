import type { PublicListing } from '@kithena/contracts';
import { Avatar, Badge, Card } from '@reach/ui';
import Link from 'next/link';
import type { JSX } from 'react';

import { ago, hours, salary, where } from '../lib/format';

/** One job in a list: the search, the careers page, a closed job's neighbours. */
export function JobCard({
  job,
  showCompany = true,
}: {
  readonly job: PublicListing;
  readonly showCompany?: boolean;
}): JSX.Element {
  const pay = salary(job);
  return (
    <Card padded interactive className="relative flex items-start gap-4">
      <Avatar
        name={job.company.name}
        src={job.company.logoUrl ?? undefined}
        shape="rounded"
        size="lg"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h3 className="text-lg font-semibold">
          <Link href={`/${job.company.slug}/${job.slug}`} className="after:absolute after:inset-0">
            {job.title}
          </Link>
        </h3>
        <p className="text-sm text-fg-muted">
          {showCompany ? `${job.company.name} · ${where(job)}` : where(job)}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Badge size="sm">{`${job.contractType} · ${hours(job.hours)}`}</Badge>
          <Badge size="sm" tone={pay === null ? 'neutral' : 'success'}>
            {pay ?? 'Pay not shown'}
          </Badge>
        </div>
      </div>
      <span className="text-xs text-fg-muted">{ago(job.postedAt)}</span>
    </Card>
  );
}
