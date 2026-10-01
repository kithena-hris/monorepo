import type { JSX } from 'react';

import { Inbox } from '../../../components/inbox';
import { signedIn } from '../../../lib/signed-in';

/** The inbox, from the shell's data as this request reads it (`components/inbox.tsx`). */
export default async function InboxPage(): Promise<JSX.Element> {
  const { person, shell } = await signedIn();
  return <Inbox shell={shell} person={person} />;
}
