import { PageHeader } from '@reach/ui';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';

import { AccountSheet, AppShell } from '../../../components/app-shell';
import { PeopleMenu } from '../../../components/people-nav';
import { signedIn } from '../../../lib/signed-in';

/**
 * People as a phone's tab (M1): the sidebar's People menu as a page of rows,
 * with the same groups and counts, under a search of the directory. Reached
 * from the tab bar; at a desk the same places are the sidebar's menu.
 */
export default async function PeopleMenuPage(): Promise<JSX.Element> {
  const { person, entitlements, company, logoUrl, shell } = await signedIn();
  if (!entitlements.includes('module.people')) notFound();
  return (
    <AppShell
      person={person}
      companyName={company}
      logoUrl={logoUrl}
      entitlements={entitlements}
      shell={shell}
    >
      <div className="flex flex-col gap-5">
        <PageHeader title="People" actions={<AccountSheet person={person} />} />
        <PeopleMenu sections={shell.sections} route={null} counts={shell.counts} />
      </div>
    </AppShell>
  );
}
