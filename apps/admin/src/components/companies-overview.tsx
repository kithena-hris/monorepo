'use client';

import { countryRules } from '@kithena/contracts';
import {
  AutoGrid,
  Avatar,
  Badge,
  BarChart,
  DataTable,
  type DataColumn,
  DonutChart,
  PageSection,
  Sparkline,
  Stack,
  Stat,
  Tabs,
  TabsList,
  TabsTrigger,
  icons,
  usePages,
  type ChartPoint,
} from '@reach/ui';
import Link from 'next/link';
import { useMemo, useState, type JSX } from 'react';

const OrganisationIcon = icons.organisation;
const GlobeIcon = icons.location;
const BlockedIcon = icons.blocked;
const SuccessIcon = icons.success;

export interface CompanyRow {
  id: string;
  slug: string;
  displayName: string;
  status: string;
  createdAt: string;
  logoUrl: string | null;
  addressCountry: string | null;
  admins: number;
  pendingInvites: number;
}

/**
 * The companies list, and what the rows add up to.
 *
 * A client component because the charts are, and because the filter above the
 * table is a tab rather than a round trip: the rows are already here, so asking
 * the server again to show a subset of what the browser is holding would be
 * slower and no more correct.
 *
 * Everything drawn here is computed from the rows on this page. Nothing is a
 * cross-tenant `count(*)` or a stored metric, because the registry deliberately
 * has neither — see the note on the list endpoint. The captions say so rather
 * than letting a partial number read as a total.
 */
export function CompaniesOverview({
  rows: first,
  next,
  onMore,
  hostSuffix,
}: {
  readonly rows: readonly CompanyRow[];
  /** Where the next page starts; null when these are all of them. */
  readonly next: string | null;
  /** The next page from a cursor, as the list nears its end: the server's. */
  readonly onMore: (
    cursor: string,
  ) => Promise<{ readonly items: readonly CompanyRow[]; readonly next: string | null } | null>;
  readonly hostSuffix: string;
}): JSX.Element {
  const [tab, setTab] = useState<'all' | 'active' | 'awaiting' | 'unreachable'>('all');
  // Infinite: older companies load as the table nears its end.
  const pages = usePages(first, next, onMore);
  const rows = pages.items;
  const partial = pages.loadMore !== undefined;

  const stats = useMemo(() => summarise(rows), [rows]);
  const columns = useMemo(() => companyColumns(hostSuffix), [hostSuffix]);

  const filtered = useMemo(() => {
    if (tab === 'active') return rows.filter((row) => row.status === 'active');
    if (tab === 'awaiting') return rows.filter((row) => row.pendingInvites > 0);
    if (tab === 'unreachable') return rows.filter((row) => row.admins === 0);
    return rows;
  }, [rows, tab]);

  const scope = partial ? ' on this page' : '';

  return (
    <Stack gap={8}>
      {/*
        Company-level, every one of them. These used to count people — how many
        administrators exist, how many invitations are outstanding — which is
        the wrong altitude for a screen about the customer base: it answered
        "how is enrolment going" on a page whose subject is "who are our
        customers". The number of people at a company belongs on that company's
        own page, and is on it.

        `Companies nobody can reach` is the exception that proves it: it counts
        companies, not accounts. A tenant with no administrator is a customer
        who cannot use what they bought, which is the one thing on this screen
        worth acting on today.
      */}
      <AutoGrid minItemWidth="13rem" gap={4}>
        <Stat
          label={`Companies${scope}`}
          value={rows.length}
          icon={<OrganisationIcon aria-hidden />}
          chart={
            stats.cumulative.length > 1 ? (
              <Sparkline data={stats.cumulative} label="Companies over time" area showLastPoint />
            ) : undefined
          }
          {...(stats.addedThisMonth > 0
            ? {
                delta: `+${String(stats.addedThisMonth)}`,
                deltaLabel: 'this month',
                direction: 'up' as const,
                sentiment: 'positive' as const,
              }
            : {})}
        />
        <Stat label="Active" value={stats.active} icon={<SuccessIcon aria-hidden />} />
        <Stat
          label="Countries"
          value={stats.countries.length}
          icon={<GlobeIcon aria-hidden />}
          {...(stats.leader === null
            ? {}
            : // Only when one country actually leads. On a four-way tie the
              // first row of a sorted list is not "most of them", it is
              // whichever name sorted first — which is a caption that invents a
              // finding out of alphabetical order.
              { delta: stats.leader.label, deltaLabel: `${String(stats.leader.value)} of them` })}
        />
        <Stat
          label="Nobody can reach"
          value={stats.unreachable}
          icon={<BlockedIcon aria-hidden />}
          {...(stats.unreachable > 0
            ? {
                // `Stat` only colours a delta, so a sentiment with nothing to
                // colour is a sentiment nobody sees.
                delta: `${String(Math.round((stats.unreachable / rows.length) * 100))}%`,
                deltaLabel: 'of those listed',
                sentiment: 'negative' as const,
              }
            : {})}
        />
      </AutoGrid>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <PageSection
          title="Companies added"
          description={`By month, from the companies listed${scope}.`}
          surface
        >
          <BarChart data={stats.byMonth} label="Companies added by month" height={180} showValues />
        </PageSection>

        <PageSection
          title="Where they are"
          description={`By registered country, from the companies listed${scope}.`}
          surface
        >
          {stats.countries.length === 0 ? (
            <p className="text-fg-muted text-sm">
              No company on this page has an address recorded.
            </p>
          ) : (
            <DonutChart
              label="Companies by country"
              size={190}
              data={stats.countries}
              center={
                <span className="flex flex-col items-center">
                  <span className="text-lg font-semibold">{stats.countries.length}</span>
                  <span className="text-fg-muted text-xs">
                    {stats.countries.length === 1 ? 'country' : 'countries'}
                  </span>
                </span>
              }
            />
          )}
        </PageSection>
      </div>

      <PageSection
        title="All companies"
        description={
          partial
            ? 'Newest first. Everything above counts the companies listed here, not every company.'
            : 'Newest first.'
        }
      >
        {/*
          A filter, not a navigation: every row is already in the browser, so a
          tab that re-asked the server would be slower and no more correct. The
          counts are in the labels because a tab that turns out to be empty is
          a click nobody wanted to spend.
        */}
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as typeof tab);
          }}
          className="mb-4"
        >
          <TabsList aria-label="Filter companies">
            {(
              [
                ['all', 'All', rows.length],
                ['active', 'Active', stats.active],
                ['awaiting', 'Awaiting enrolment', stats.companiesAwaiting],
                ['unreachable', 'Nobody can reach', stats.unreachable],
              ] as const
            ).map(([id, label, count]) => (
              <TabsTrigger key={id} value={id}>
                {label}
                <span className="text-fg-subtle ml-1.5 text-xs">{count}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <DataTable<CompanyRow>
          label="Companies"
          rows={filtered}
          rowId={companyId}
          describeRow={companyName}
          stickyHeader
          containerClassName="max-h-[70dvh] min-h-64"
          {...(pages.loadMore === undefined ? {} : { onEndReached: pages.loadMore })}
          loadingMore={pages.loading}
          empty="No company listed matches that."
          columns={columns}
        />
      </PageSection>
    </Stack>
  );
}

const companyId = (c: CompanyRow): string => c.id;
const companyName = (c: CompanyRow): string => c.displayName;

/** The list: who they are, who can reach them, and since when. */
function companyColumns(hostSuffix: string): readonly DataColumn<CompanyRow>[] {
  return [
    {
      id: 'company',
      header: 'Company',
      sortBy: (c) => c.displayName,
      cell: (c) => (
        <span className="flex items-center gap-3">
          <Avatar
            size="md"
            shape="rounded"
            fit="contain"
            src={c.logoUrl ?? undefined}
            name={c.displayName}
          />
          <span className="flex min-w-0 flex-col">
            <Link href={`/companies/${c.id}`} className="truncate font-medium">
              {c.displayName}
            </Link>
            <code className="text-fg-muted truncate text-xs">
              {c.slug}.{hostSuffix}
            </code>
          </span>
        </span>
      ),
    },
    {
      id: 'employees',
      header: 'Employees',
      sortBy: (c) => c.admins,
      cell: (c) => (
        <span className="text-sm">
          {c.admins} active
          {c.pendingInvites > 0 ? (
            <span className="text-fg-muted">
              {', '}
              {c.pendingInvites} invited
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cardTrailing: true,
      sortBy: (c) => c.status,
      cell: (c) => (
        <Badge dot tone={c.status === 'active' ? 'success' : 'warning'}>
          {c.status}
        </Badge>
      ),
    },
    {
      id: 'added',
      header: 'Added',
      numeric: true,
      sortBy: (c) => c.createdAt,
      cell: (c) => (
        <time dateTime={c.createdAt} className="text-fg-muted text-sm">
          {formatDate(c.createdAt)}
        </time>
      ),
    },
  ];
}

/** The date an operator reads, not the timestamp the database stores. */
function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Six months back, always six columns.
 *
 * A chart drawn only from the months that happen to contain a company is a
 * chart whose x-axis changes shape as customers arrive, and two of them side by
 * side would not be comparable. Empty months are zeroes, which is the honest
 * answer to "how many did we add in June".
 */
function summarise(rows: readonly CompanyRow[]): {
  active: number;
  unreachable: number;
  countries: { label: string; value: number }[];
  /** The one country with more companies than any other, or null on a tie. */
  leader: { label: string; value: number } | null;
  companiesAwaiting: number;
  addedThisMonth: number;
  byMonth: ChartPoint[];
  cumulative: ChartPoint[];
} {
  const now = new Date();
  const months: { key: string; label: string }[] = [];
  for (let back = 5; back >= 0; back -= 1) {
    const at = new Date(now.getFullYear(), now.getMonth() - back, 1);
    months.push({
      key: `${String(at.getFullYear())}-${String(at.getMonth())}`,
      label: at.toLocaleDateString('en-GB', { month: 'short' }),
    });
  }

  const counts = new Map(months.map((month) => [month.key, 0]));
  let before = 0;
  for (const row of rows) {
    const at = new Date(row.createdAt);
    const key = `${String(at.getFullYear())}-${String(at.getMonth())}`;
    const seen = counts.get(key);
    if (seen === undefined) {
      // Older than the window. It still belongs in the cumulative line's
      // starting height, or the line would claim the registry began six months
      // ago.
      if (at < new Date(now.getFullYear(), now.getMonth() - 5, 1)) before += 1;
    } else {
      counts.set(key, seen + 1);
    }
  }

  const byMonth = months.map((month) => ({
    label: month.label,
    value: counts.get(month.key) ?? 0,
  }));

  const countries = byCountry(rows);

  let running = before;
  const cumulative = byMonth.map((point) => {
    running += point.value;
    return { label: point.label, value: running };
  });

  return {
    active: rows.filter((row) => row.status === 'active').length,
    // A company, not a headcount: nobody at all can sign in there, so whatever
    // they bought, they cannot use it.
    unreachable: rows.filter((row) => row.admins === 0).length,
    countries,
    leader:
      countries.length > 0 && (countries[1]?.value ?? 0) < (countries[0]?.value ?? 0)
        ? (countries[0] ?? null)
        : null,
    companiesAwaiting: rows.filter((row) => row.pendingInvites > 0).length,
    addedThisMonth: byMonth.at(-1)?.value ?? 0,
    byMonth,
    cumulative,
  };
}

/**
 * Companies per country, biggest first, with the tail collapsed.
 *
 * Five slices and an "Other", because a donut with fourteen wedges is a
 * colour-matching puzzle rather than a chart. Companies with no address
 * recorded are left out entirely rather than counted as unknown: a slice
 * labelled "unknown" competes with the real answers for the reader's attention
 * and tells them nothing.
 */
function byCountry(rows: readonly CompanyRow[]): { label: string; value: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.addressCountry === null || row.addressCountry === '') continue;
    // The name, not the code. `GB` is a fine thing to store and a poor thing to
    // put in a chart legend somebody reads at a glance.
    const code = row.addressCountry.toUpperCase();
    const name = countryRules(code)?.name ?? code;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const ranked = [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));

  if (ranked.length <= 6) return ranked;
  const head = ranked.slice(0, 5);
  const tail = ranked.slice(5).reduce((total, entry) => total + entry.value, 0);
  return [...head, { label: 'Other', value: tail }];
}
