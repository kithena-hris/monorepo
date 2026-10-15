import type { Metadata } from 'next';
import type { JSX } from 'react';

import { RefereeForm } from './referee-form';

export const metadata: Metadata = { title: 'A reference', robots: { index: false } };

/** J12: a referee answers, without an account; the token stays in the fragment. */
export default async function Reference({
  params,
}: {
  params: Promise<{ company: string }>;
}): Promise<JSX.Element> {
  return <RefereeForm company={(await params).company} />;
}
