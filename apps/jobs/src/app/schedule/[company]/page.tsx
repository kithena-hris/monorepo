import type { Metadata } from 'next';
import type { JSX } from 'react';

import { PickTime } from './pick-time';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = {
  get title(): string {
    return t('app.schedule.[company].page.pick_a_time', 'Pick a time');
  },
  robots: { index: false },
};

/** J6b: self-scheduling from the link in the invitation; the token stays in the fragment. */
export default async function Schedule({
  params,
}: {
  params: Promise<{ company: string }>;
}): Promise<JSX.Element> {
  return <PickTime company={(await params).company} />;
}
