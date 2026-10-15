import type { Metadata } from 'next';
import type { JSX } from 'react';

import { AgencyPortal } from './agency-portal';

export const metadata: Metadata = { title: 'Agency portal', robots: { index: false } };

/** J9: an agency submits candidates and follows its own; signed in by an emailed code. */
export default async function Agency({
  params,
}: {
  params: Promise<{ company: string }>;
}): Promise<JSX.Element> {
  return <AgencyPortal company={(await params).company} />;
}
