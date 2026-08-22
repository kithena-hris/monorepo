import { Alert, Badge, Button, KithenaMark } from '@reach/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';

import { callIdentity } from '../lib/identity';
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
  admins: number;
  pendingInvites: number;
}

export default async function Companies(): Promise<JSX.Element> {
  const operator = await currentOperator();
  // Fail closed. This is the only surface that crosses tenants and it is served
  // from a plan with no deployment protection, so this check is the whole of
  // what stands between the internet and every customer's account list.
  if (!operator) redirect('/sign-in');

  const { body } = await callIdentity('/api/internal/admin/tenants');
  const tenants = (body as { tenants?: Row[] } | null)?.tenants ?? [];

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <KithenaMark className="size-6 text-accent" />
            Companies
          </h1>
          <p className="text-fg-muted mt-1 text-sm">Signed in as {operator.email}</p>
        </div>
        <Button asChild>
          <Link href="/companies/new">Add a company</Link>
        </Button>
      </header>

      {tenants.length === 0 ? (
        <Alert tone="info" title="No companies yet">
          Adding one creates the tenant and invites its first administrators. Nobody is given a
          credential — each is sent their own link and enrols themselves.
        </Alert>
      ) : (
        <ul className="divide-border divide-y">
          {tenants.map((tenant) => (
            <li key={tenant.id}>
              {/*
                The whole row is the link, rather than the name inside it. A
                4px target beside a 700px row is the difference between
                clicking a company and clicking nothing, and it matters more
                for a pointer that is not a mouse.

                `focus-visible` rather than `focus`: the ring is for somebody
                arriving by keyboard, and showing it on every mouse click reads
                as a rendering fault.
              */}
              <Link
                href={`/companies/${tenant.id}`}
                className="hover:bg-surface focus-visible:outline-border-focus -mx-3 flex items-center justify-between gap-4 rounded-md px-3 py-4 transition focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{tenant.displayName}</p>
                  <p className="text-fg-muted truncate text-sm">
                    <code>{tenant.slug}</code>.app.kithena.com
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-sm">
                  <span className="text-fg-muted">
                    {tenant.admins} active
                    {tenant.pendingInvites > 0 ? `, ${String(tenant.pendingInvites)} invited` : ''}
                  </span>
                  <Badge tone={tenant.status === 'active' ? 'success' : 'warning'}>
                    {tenant.status}
                  </Badge>
                  <span aria-hidden className="text-fg-subtle">
                    →
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
