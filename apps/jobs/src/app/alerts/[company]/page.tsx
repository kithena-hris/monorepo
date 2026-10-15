import type { Metadata } from 'next';
import type { JSX } from 'react';

import { AlertLink } from './alert-link';

export const metadata: Metadata = { title: 'Job alert', robots: { index: false } };

/** J11: the link in an alert email confirms it or ends it; the token stays in the fragment. */
export default async function AlertPage({
  params,
}: {
  params: Promise<{ company: string }>;
}): Promise<JSX.Element> {
  return <AlertLink company={(await params).company} />;
}
