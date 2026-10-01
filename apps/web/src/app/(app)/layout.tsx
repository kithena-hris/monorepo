import type { JSX, ReactNode } from 'react';

import { AppShell } from '../../components/app-shell';
import { signedIn } from '../../lib/signed-in';

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
  return (
    <AppShell
      person={person}
      companyName={company}
      logoUrl={logoUrl}
      entitlements={entitlements}
      shell={shell}
      sidebarCollapsed={sidebarCollapsed}
      shortcuts={shortcuts}
    >
      {children}
    </AppShell>
  );
}
