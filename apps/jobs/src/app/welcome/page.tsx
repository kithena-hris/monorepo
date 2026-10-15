import type { Metadata } from 'next';
import type { JSX } from 'react';

import { Welcome } from './welcome';

export const metadata: Metadata = { title: 'Welcome', robots: { index: false } };

/** O5: the new hire's page before day one. The token stays in the fragment. */
export default function WelcomePage(): JSX.Element {
  return <Welcome />;
}
