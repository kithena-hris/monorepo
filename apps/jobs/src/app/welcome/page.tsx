import type { Metadata } from 'next';
import type { JSX } from 'react';

import { Welcome } from './welcome';
import { t } from '../../lib/i18n';

export const metadata: Metadata = {
  get title(): string {
    return t('app.welcome.page.welcome', 'Welcome');
  },
  robots: { index: false },
};

/** O5: the new hire's page before day one. The token stays in the fragment. */
export default function WelcomePage(): JSX.Element {
  return <Welcome />;
}
