import {
  AutoGrid,
  Badge,
  Button,
  Container,
  EmptyState,
  KithenaMark,
  PageHeader,
  PageSection,
  Stack,
  Stat,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Avatar,
} from '@reach/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';

import { readIdentity } from '../lib/identity';
import { tenantHost } from '../lib/tenant-host';
import { currentOperator } from '../lib/session';

/**
 * Every company, and who can reach each one.
 *
 * Reads `platform.*` and nothing else. An employee count would mean querying
 * `people.*`, and a back-office that does that stops working the day a customer
 * runs Time Off alone against Workday. Counts arrive as a projection built from
 * events, when there are events to build one from.
 */
interface Row {
  id: string;
  slug: string;
  displayName: string;
  status: string;
  createdAt: string;
  logoUrl: string | null;
  admins: number;
  pendingInvites: number;
}

export default async function Companies({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}): Promise<JSX.Element> {
  const { cursor } = await searchParams;

  /*
   * Both reads at once.
   *
   * They were sequential, and each is a round trip to a separate deployment:
   * the session check finished before the list was even asked for, so the page
   * cost two cold starts end to end for two questions that do not depend on
   * each other. The guard still decides whether anything renders — starting the
   * list early only wastes a query when the answer is "not signed in", and
   * nothing from it reaches the page in that case.
   */
  const [operator, page] = await Promise.all([
    currentOperator(),
    readIdentity(
      `/api/internal/admin/tenants?limit=50${cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
    ) as Promise<{ tenants?: Row[]; nextCursor?: string | null } | null>,
  ]);

  // Fail closed. This is the only surface that crosses tenants and it is served
  // from a plan with no deployment protection, so this check is the whole of
  // what stands between the internet and every customer's account list.
  if (!operator) redirect('/sign-in');

  const tenants = page?.tenants ?? [];
  const nextCursor = page?.nextCursor ?? null;

  const active = tenants.filter((tenant) => tenant.status === 'active').length;
  const administrators = tenants.reduce((total, tenant) => total + tenant.admins, 0);
  const awaiting = tenants.reduce((total, tenant) => total + tenant.pendingInvites, 0);

  return (
    <Container size="lg" className="py-10 sm:py-12">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <KithenaMark className="text-accent size-6" />
            Companies
          </span>
        }
        description={`Signed in as ${operator.email}`}
        meta={
          tenants.length === 0 ? null : (
            <Badge tone="neutral">
              {tenants.length}
              {nextCursor === null ? '' : '+'}
            </Badge>
          )
        }
        actions={
          <Button asChild>
            <Link href="/companies/new">Add a company</Link>
          </Button>
        }
      />

      {tenants.length === 0 ? (
        <EmptyState
          className="mt-10"
          title="No companies yet"
          description="Adding one creates the tenant and invites its first administrators. Nobody is given a credential — each is sent their own link and enrols themselves."
          action={
            <Button asChild>
              <Link href="/companies/new">Add a company</Link>
            </Button>
          }
        />
      ) : (
        <Stack gap={8} className="mt-8">
          {/*
            Four numbers an operator otherwise counts by eye. They are computed
            from the rows on this page rather than asked of the database,
            because a cross-tenant `count(*)` is exactly the query the registry
            avoids — and the caption says so rather than letting a partial
            number read as a total.
          */}
          <AutoGrid minItemWidth="11rem" gap={4}>
            <Stat label="Companies" value={tenants.length} />
            <Stat label="Active" value={active} />
            <Stat label="Administrators" value={administrators} />
            <Stat
              label="Awaiting enrolment"
              value={awaiting}
              sentiment={awaiting > 0 ? 'negative' : 'neutral'}
            />
          </AutoGrid>

          <PageSection
            title="All companies"
            description={
              nextCursor === null
                ? 'Newest first.'
                : 'Newest first. The counts above cover the companies listed here, not every company.'
            }
          >
            <Table aria-label="Companies">
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>People</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Added</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenants.map((tenant) => (
                  <TableRow key={tenant.id} interactive className="relative">
                    <TableCell>
                      <span className="flex items-center gap-3">
                        <Avatar
                          size="md"
                          shape="rounded"
                          fit="contain"
                          src={tenant.logoUrl ?? undefined}
                          name={tenant.displayName}
                        />
                        <span className="flex min-w-0 flex-col">
                          {/*
                            One real link, stretched over the whole row by a
                            pseudo-element. A 4px target beside a 700px row is
                            the difference between clicking a company and
                            clicking nothing — and doing it this way keeps the
                            row a row for a screen reader, which a nest of
                            links inside table cells would not.
                          */}
                          <Link
                            href={`/companies/${tenant.id}`}
                            className="focus-visible:outline-border-focus truncate font-medium after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
                          >
                            {tenant.displayName}
                          </Link>
                          <code className="text-fg-muted truncate text-xs">
                            {tenantHost(tenant.slug)}
                          </code>
                        </span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">
                        {tenant.admins} active
                        {tenant.pendingInvites > 0 ? (
                          <span className="text-fg-muted">
                            {', '}
                            {tenant.pendingInvites} invited
                          </span>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge dot tone={tenant.status === 'active' ? 'success' : 'warning'}>
                        {tenant.status}
                      </Badge>
                    </TableCell>
                    <TableCell numeric>
                      <time dateTime={tenant.createdAt} className="text-fg-muted text-sm">
                        {formatDate(tenant.createdAt)}
                      </time>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </PageSection>

          {nextCursor === null ? null : (
            <nav className="flex justify-center" aria-label="More companies">
              {/*
                A cursor, not a page number. The list is ordered by creation and
                only grows, so `?page=7` names a different set of companies each
                time somebody is added — and the last page of an OFFSET query is
                the slowest, which is the one a long list is read from.
              */}
              <Button asChild variant="secondary">
                <Link href={`/?cursor=${encodeURIComponent(nextCursor)}`}>Show more</Link>
              </Button>
            </nav>
          )}
        </Stack>
      )}
    </Container>
  );
}

/** The date an operator reads, not the timestamp the database stores. */
function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
