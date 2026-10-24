import type { Metadata } from 'next';
import type { JSX } from 'react';

import { CandidateHome } from './candidate-home';
import { me } from '../../../lib/account';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = {
  get title(): string {
    return t('app.me.[company].page.your_applications', 'Your applications');
  },
  robots: { index: false },
};

/**
 * J6, J7: the candidate's own page. Opened from an email's link with the
 * token in the fragment, or signed in to Kithena Jobs, whose session holds a
 * token for each company. An offer or a contract (`?offer=`, `?contract=`)
 * needs one of the two: without either, the browser is sent to sign in and
 * straight back here.
 */
export default async function Me({
  params,
  searchParams,
}: {
  params: Promise<{ company: string }>;
  searchParams: Promise<{ offer?: string; contract?: string }>;
}): Promise<JSX.Element> {
  const { company } = await params;
  const { offer } = await searchParams;
  const home = await me();
  return (
    <CandidateHome
      company={company}
      sessionToken={home?.companies.find((c) => c.slug === company)?.token ?? null}
      openOffer={offer ?? null}
    />
  );
}
