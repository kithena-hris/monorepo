import { EmptyState, PageHeader, icons } from '@reach/ui';
import type { JSX } from 'react';

import { AccountSheet, AppShell, NoticeList } from '../../components/app-shell';
import { signedIn } from '../../lib/signed-in';

/**
 * Inbox (M12): what the bell holds, as a phone's tab. Approvals to decide and
 * details to add, each opening where it is done: the same list the bell shows
 * at a desk, so the two never disagree.
 */
export default async function Inbox(): Promise<JSX.Element> {
  const { person, entitlements, company, logoUrl, shell } = await signedIn();
  return (
    <AppShell
      person={person}
      companyName={company}
      logoUrl={logoUrl}
      entitlements={entitlements}
      shell={shell}
    >
      <div className="flex flex-col gap-5">
        <PageHeader
          title="Inbox"
          description="Things to do, from every module you use."
          actions={<AccountSheet person={person} />}
        />
        {shell.notices.length === 0 ? (
          <EmptyState
            icon={<icons.inbox />}
            title="Nothing to do"
            description="Approvals and details you are asked for land here."
          />
        ) : (
          <div className="flex flex-col gap-2">
            <NoticeList shell={shell} />
          </div>
        )}
      </div>
    </AppShell>
  );
}
