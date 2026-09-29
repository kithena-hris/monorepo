import { PageHeader } from '@reach/ui';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';

import { AccountSheet, AppShell } from '../../../components/app-shell';
import { PeopleMenu } from '../../../components/people-nav';
import { signedIn } from '../../../lib/signed-in';

/**
 * People as a phone's tab (MV1): People's six sections as rows, each with
 * what it holds and its count, under a search of the directory. Reached from
 * the tab bar; at a desk the same places are listed under People in the
 * sidebar.
 */
export default async function PeopleMenuPage(): Promise<JSX.Element> {
  const { person, entitlements, company, logoUrl, shell, sidebarCollapsed } = await signedIn();
  if (!entitlements.includes('module.people')) notFound();
  return (
    <AppShell
      person={person}
      companyName={company}
      logoUrl={logoUrl}
      entitlements={entitlements}
      shell={shell}
      sidebarCollapsed={sidebarCollapsed}
    >
      <div className="flex flex-col gap-5">
        <PageHeader title="People" actions={<AccountSheet person={person} />} />
        <PeopleMenu sections={shell.sections} route={null} counts={shell.counts} />
      </div>
    </AppShell>
  );
}
