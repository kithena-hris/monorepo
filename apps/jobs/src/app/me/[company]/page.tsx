import type { Metadata } from 'next';
import type { JSX } from 'react';

import { CandidateHome } from './candidate-home';

export const metadata: Metadata = { title: 'Your applications', robots: { index: false } };

/** J6, J7: the candidate's own page. The token is in the fragment, so all of it is the browser's. */
export default async function Me({
  params,
}: {
  params: Promise<{ company: string }>;
}): Promise<JSX.Element> {
  return <CandidateHome company={(await params).company} />;
}
