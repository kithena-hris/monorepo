import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';

import { me } from '../../../lib/account';
import { CvWriter } from './cv-writer';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = {
  get title(): string {
    return t('app.me.cv.page.write_your_cv', 'Write your CV');
  },
  robots: { index: false },
};

/** A CV from scratch: the candidate says what they have done, the AI lays it out, they edit every line, and it joins their library as a PDF. */
export default async function WriteCv(): Promise<JSX.Element> {
  const home = await me();
  if (home === null) redirect('/sign-in?next=/me/cv');
  return <CvWriter name={home.name} email={home.email} />;
}
