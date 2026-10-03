import { Avatar, Badge, List, ListItem, PageHeader, Skeleton } from '@reach/ui';
import type { JSX } from 'react';

import { Loaded, type Loadable } from '../load';
import { nextWorkingDay, shortDate, spanLabel } from '../words';

/**
 * HR's parental cases (TOF-099c): every plan a parent has sent, those
 * waiting for HR first, each opening its case (T11). A draft is the
 * parent's own and never here. One list at every width.
 */

export interface ParentalCasesData {
  readonly cases: readonly {
    readonly planId: string;
    readonly personId: string;
    readonly displayName: string;
    readonly teamName: string | null;
    readonly status: 'submitted' | 'approved';
    readonly sentAt: string | null;
    readonly from: string | null;
    readonly to: string | null;
  }[];
}

export interface ParentalCasesProps {
  readonly load: Loadable<ParentalCasesData>;
}

const TITLE = 'Parental leave';

export function ParentalCases({ load }: ParentalCasesProps): JSX.Element {
  if (load.status === 'loading') return <ParentalCasesSkeleton />;
  return (
    <div className="flex flex-col gap-6">
      {load.status === 'error' ? <PageHeader title={TITLE} /> : null}
      <Loaded load={load} what="the parental cases">
        {(data) => <Ready data={data} />}
      </Loaded>
    </div>
  );
}

function Ready({ data }: { readonly data: ParentalCasesData }): JSX.Element {
  const waiting = data.cases.filter((c) => c.status === 'submitted').length;
  return (
    <>
      <PageHeader
        title={TITLE}
        description={
          data.cases.length === 0
            ? 'Plans parents send come here'
            : `${String(waiting)} waiting for you · ${String(data.cases.length - waiting)} approved`
        }
      />
      {data.cases.length === 0 ? (
        <p className="text-sm text-fg-muted">Nobody has sent a parental leave plan yet.</p>
      ) : (
        <List navigable aria-label="Parental leave plans">
          {data.cases.map((c) => (
            <ListItem
              key={c.planId}
              asChild
              leading={<Avatar name={c.displayName} />}
              description={[
                c.teamName,
                c.from === null || c.to === null
                  ? null
                  : `${spanLabel(c.from, c.to)}, back ${shortDate(nextWorkingDay(c.to))}`,
              ]
                .filter(Boolean)
                .join(' · ')}
              meta={c.sentAt === null ? undefined : `Sent ${shortDate(c.sentAt.slice(0, 10))}`}
              trailing={
                c.status === 'submitted' ? (
                  <Badge size="sm" tone="warning" dot>
                    Waiting for you
                  </Badge>
                ) : (
                  <Badge size="sm" tone="success">
                    Approved
                  </Badge>
                )
              }
              chevron
            >
              <a href={`/time-off/parental/cases/${c.planId}`}>{c.displayName}</a>
            </ListItem>
          ))}
        </List>
      )}
    </>
  );
}

/** The list while it loads: the header, then its rows at their height. */
export function ParentalCasesSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={TITLE} description={' '} />
      <div role="status" className="flex flex-col gap-px overflow-hidden rounded-[1.125rem]">
        <span className="sr-only">Loading the parental cases</span>
        {[0, 1, 2, 3].map((n) => (
          <Skeleton key={n} className="h-[4.5rem] rounded-none" />
        ))}
      </div>
    </div>
  );
}
