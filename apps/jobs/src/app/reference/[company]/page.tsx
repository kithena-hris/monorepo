import type { Metadata } from 'next';
import type { JSX } from 'react';

import { RefereeForm } from './referee-form';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = {
  get title(): string {
    return t('app.reference.[company].page.a_reference', 'A reference');
  },
  robots: { index: false },
};

/** J12: a referee answers, without an account; the token stays in the fragment. */
export default async function Reference({
  params,
}: {
  params: Promise<{ company: string }>;
}): Promise<JSX.Element> {
  return <RefereeForm company={(await params).company} />;
}
