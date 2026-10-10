import type { JSX, ReactNode } from 'react';

import { AppShell } from '../../components/app-shell';
import { QueryProvider } from '../../lib/query';
import { signedIn } from '../../lib/signed-in';
import { EMPTY_PEEK } from '../../lib/inbox/peek';
import { inboxPeek } from '../../lib/inbox/server';
import { slotsOf } from '../../lib/slots';

/**
 * The signed-in shell, once, around every screen inside it.
 *
 * A layout rather than each page rendering `AppShell` itself: a page is
 * remounted whenever its segment changes (`/people/a` to `/people/b` is a new
 * `[[...path]]`), and a shell inside the page went with it — the sidebar, the
 * top corner and the tab bar were thrown away and drawn again on every click,
 * which is what a navigation looked like: a blink. A layout persists across
 * the pages under it, so moving between them swaps the content and nothing
 * else.
 *
 * Rendered with the first page of a visit and again after every write, whose
 * answer carries the page drawn again (`changed` in `lib/people.ts`), so a
 * count in the sidebar is fresh after anything that changes it.
 */
export default async function SignedInLayout({
  children,
}: {
  children: ReactNode;
}): Promise<JSX.Element> {
  const { person, entitlements, company, logoUrl, shell, sidebarCollapsed, shortcuts } =
    await signedIn();
  // The Inbox's counts and first rows, started now and not waited for: the
  // bell and the red number stream in after the page (INB-036).
  const inbox = inboxPeek().catch(() => EMPTY_PEEK);
  // What the company's remotes draw in the chrome: Time Off's clock (TOF-059).
  const slots = await slotsOf(shell);
  return (
    // When this was drawn: a new value after a write drops the browser's kept reads.
    <QueryProvider drawn={Date.now()}>
      <AppShell
        person={person}
        companyName={company}
        logoUrl={logoUrl}
        entitlements={entitlements}
        shell={shell}
        sidebarCollapsed={sidebarCollapsed}
        shortcuts={shortcuts}
        slots={slots}
        inbox={inbox}
      >
        {children}
      </AppShell>
    </QueryProvider>
  );
}
