import { PageHeader } from '@reach/ui';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';

import { AccountSheet } from '../../../../components/app-shell';
import { PeopleMenu } from '../../../../components/people-nav';
import { people } from '../../../../lib/people';
import { signedIn } from '../../../../lib/signed-in';

/**
 * People as a phone's tab (MV1): People's six sections as rows, each with
 * what it holds and its count, under a search of the directory. Reached from
 * the tab bar; at a desk the same places are listed under People in the
 * sidebar. The search says how many people it covers, a count People gives
 * for this page alone; refused or unreachable, it just says "Search people".
 */
export default async function PeopleMenuPage(): Promise<JSX.Element> {
  const [{ person, entitlements, shell }, headcount] = await Promise.all([
    signedIn(),
    people<number>('Headcount'),
  ]);
  if (!entitlements.includes('module.people')) notFound();
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="People" actions={<AccountSheet person={person} />} touchBarActions />
      <PeopleMenu
        sections={shell.sections}
        route={null}
        counts={shell.counts}
        total={headcount.ok ? headcount.data : null}
      />
    </div>
  );
}
