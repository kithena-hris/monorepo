import { redirect } from 'next/navigation';
import type { JSX } from 'react';

import { AccountSheet } from '../../components/app-shell';
import { HomeDashboard } from '../../components/home-dashboard';
import { HomeInbox } from '../../components/inbox/home-card';
import { EMPTY_PEEK } from '../../lib/inbox/peek';
import { inboxPeek } from '../../lib/inbox/server';
import { PeopleHome } from '../../components/people-area';
import { accessToken } from '../../lib/people';
import { currentPerson, displayName } from '../../lib/session';

/**
 * The first screen a person sees at their company: Home.
 *
 * With People, People draws it (design B1, B2): "Hi", what needs them, and
 * for HR what needs HR, its overview folded in here so Home and People ›
 * Overview are no longer two pages answering one question. The shell renders
 * it on the server, with the account a phone's title bar carries beside it.
 * Without People, or with a People that offers no Home, the shell's own
 * greeting and an honest "nothing needs you yet".
 */
export default async function Home(): Promise<JSX.Element> {
  const [person] = await Promise.all([currentPerson(), accessToken()]);

  /*
   * Straight to this company's own sign-in page, which is on this hostname.
   *
   * Not a central one. The passkey ceremony is legal here — `app.kithena.com`
   * is a registrable suffix of `acme.app.kithena.com` — so the whole sign-in
   * happens on the origin the cookie belongs to, and nobody is sent somewhere
   * that has to hand a session back.
   */
  if (person === null) redirect('/login');

  /*
   * What to call them: the name they chose, then their legal given name, then
   * a guess from their address.
   */
  const greeting = person.name?.preferred ?? person.name?.given ?? displayName(person.workEmail);
  const name =
    person.name === null
      ? displayName(person.workEmail)
      : `${person.name.given} ${person.name.family}`;
  const account = <AccountSheet person={{ name, email: person.workEmail }} />;
  // Home's To do is the Inbox's first rows (B1), streamed in after the page.
  const toDo = <HomeInbox inbox={inboxPeek().catch(() => EMPTY_PEEK)} />;
  const people = person.entitlements.includes('module.people') ? await PeopleHome(toDo) : null;
  if (people === null) return <HomeDashboard greeting={greeting} account={account} toDo={toDo} />;
  return (
    <div className="relative">
      {/* A phone's title bar: the account beside Home's own title. */}
      <span className="absolute end-0 top-0 z-10 flex @3xl/page:hidden">{account}</span>
      {people}
    </div>
  );
}
