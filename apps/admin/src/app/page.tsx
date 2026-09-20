import { Button, Container, EmptyState, PageHeader, Badge } from '@reach/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';

import { CompaniesOverview, type CompanyRow } from '../components/companies-overview';
import { readIdentity } from '../lib/identity';
import { tenantHostSuffix } from '../lib/tenant-host';
import { currentOperator } from '../lib/session';

/**
 * Every company, and who can reach each one.
 *
 * Reads `platform.*` and nothing else. An employee count would mean querying
 * `people.*`, and a back-office that does that stops working the day a customer
 * runs Time Off alone against Workday. Counts arrive as a projection built from
 * events, when there are events to build one from — which is also why every
 * number on this screen is derived from the rows themselves rather than asked
 * for separately.
 */
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
    ) as Promise<{ tenants?: CompanyRow[]; nextCursor?: string | null } | null>,
  ]);

  // Fail closed. This is the only surface that crosses tenants and it is served
  // from a plan with no deployment protection, so this check is the whole of
  // what stands between the internet and every customer's account list.
  if (!operator) redirect('/sign-in');

  const tenants = page?.tenants ?? [];
  const nextCursor = page?.nextCursor ?? null;

  return (
    <Container size="lg" className="py-10 sm:py-12">
      <PageHeader
        title="Companies"
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
          <Button asChild variant="primary">
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
            <Button asChild variant="primary">
              <Link href="/companies/new">Add a company</Link>
            </Button>
          }
        />
      ) : (
        <div className="mt-8">
          {/*
            The suffix is handed down rather than read in the browser:
            `TENANT_HOST_SUFFIX` is a server value and would be `undefined`
            there, which is how a hostname ends up rendering as `acme.undefined`.
          */}
          <CompaniesOverview
            rows={tenants}
            hostSuffix={tenantHostSuffix()}
            partial={nextCursor !== null}
          />
        </div>
      )}

      {nextCursor === null ? null : (
        <nav className="mt-8 flex justify-center" aria-label="More companies">
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
    </Container>
  );
}
