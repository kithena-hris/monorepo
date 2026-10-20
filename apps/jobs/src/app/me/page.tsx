import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';

import { applicationsOf, me } from '../../lib/account';
import { AccountHome } from './account-home';

export const metadata: Metadata = { title: 'Your applications', robots: { index: false } };

/**
 * The candidate's home (PRD §10.5, extended): every application across every
 * company, each company's own page behind its own token, the CV library and
 * the account itself. Rendered on the server with the session cookie; the
 * page then acts on each company directly.
 */
export default async function Me(): Promise<JSX.Element> {
  const home = await me();
  if (home === null) redirect('/sign-in?next=/me');
  const pages = await applicationsOf(home);
  return <AccountHome home={home} pages={pages} />;
}
