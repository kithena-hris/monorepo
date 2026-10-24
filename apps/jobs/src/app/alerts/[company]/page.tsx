import type { Metadata } from 'next';
import type { JSX } from 'react';

import { AlertLink } from './alert-link';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = {
  get title(): string {
    return t('app.alerts.[company].page.job_alert', 'Job alert');
  },
  robots: { index: false },
};

/** J11: the link in an alert email confirms it or ends it; the token stays in the fragment. */
export default async function AlertPage({
  params,
}: {
  params: Promise<{ company: string }>;
}): Promise<JSX.Element> {
  return <AlertLink company={(await params).company} />;
}
