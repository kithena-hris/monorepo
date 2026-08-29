import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
  PageSection,
  Stack,
} from '@reach/ui';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';

import { AppShell } from '../components/app-shell';
import { currentTenant } from '../lib/branding';
import { currentPerson, displayName } from '../lib/session';

/**
 * The first screen a person sees at their company.
 *
 * Starter, and honest about it: the areas in the sidebar are the modules in
 * `ModuleKey`, and only this one is built. They are listed and disabled rather
 * than hidden, because a sidebar that grows an item per release teaches nobody
 * where anything lives.
 *
 * Nothing here reads a module's data. `apps/web` is one of four transports and
 * this page renders the shell; the day Time Off lands, it fetches through the
 * router like everything else.
 */
export default async function Home(): Promise<JSX.Element> {
  const person = await currentPerson();
  const tenant = await currentTenant();

  /*
   * Straight to this company's own sign-in page, which is on this hostname.
   *
   * Not a central one. The passkey ceremony is legal here — `app.kithena.com`
   * is a registrable suffix of `acme.app.kithena.com` — so the whole sign-in
   * happens on the origin the cookie belongs to, and nobody is sent somewhere
   * that has to hand a session back.
   */
  if (person === null) redirect('/login');

  const name = displayName(person.workEmail);
  /*
   * The slug, not a display name.
   *
   * `proxy.ts` writes `x-tenant-id` and `x-tenant-slug` and nothing else, and
   * it is the one file that decides what a request is allowed to claim about
   * which company it belongs to — every inbound copy is deleted before any
   * branch that can return early. Adding a third header there to carry a
   * prettier label means adding a third thing to sanitise, on the file where
   * getting it wrong is one tenant reading another's data.
   *
   * The slug is what the person typed to get here and what is in their address
   * bar, so it is not a bad label. A real display name arrives with the tenant
   * registry read, which is a change to that file made deliberately.
   */
  // The name they chose, falling back to the label in the address bar. Both are
  // things the person already knows this company by.
  const company = tenant?.branding.displayName ?? tenant?.slug ?? 'your company';
  return (
    <AppShell
      person={{ name, email: person.workEmail }}
      companyName={company}
      logoUrl={tenant?.branding.logoUrl ?? null}
    >
      <PageHeader title={`Hello, ${name}`} description={`Your ${company} account is set up.`} />

      <PageSection>
        <Stack gap={4}>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Nothing needs you yet</CardTitle>
                <CardDescription>
                  Requests, documents and approvals will appear here as each module is switched on.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {/* `accent`, not `neutral`. How somebody signed in is a fact
                  about their account rather than a warning, and the accent is
                  the tenant's own — so the one badge on the starter dashboard
                  carries the theme instead of sitting grey beside a themed
                  sidebar. */}
              <Badge tone="accent">
                Signed in with {person.amr.includes('swk') ? 'a passkey' : person.amr.join(', ')}
              </Badge>
            </CardContent>
          </Card>
        </Stack>
      </PageSection>
    </AppShell>
  );
}
