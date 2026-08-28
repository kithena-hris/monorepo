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
import { headers } from 'next/headers';
import type { JSX } from 'react';

import { AppShell } from '../components/app-shell';
import { SignedOut } from '../components/signed-out';
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
  if (person === null) return <SignedOut />;

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
  const company = (await headers()).get('x-tenant-slug') ?? 'your company';

  return (
    <AppShell person={{ name, email: person.workEmail }} companyName={company}>
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
              <Badge tone="neutral">
                Signed in with {person.amr.includes('swk') ? 'a passkey' : person.amr.join(', ')}
              </Badge>
            </CardContent>
          </Card>
        </Stack>
      </PageSection>
    </AppShell>
  );
}
