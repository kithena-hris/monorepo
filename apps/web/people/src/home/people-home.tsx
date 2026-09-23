import { PageHeader } from '@reach/ui';
import type { JSX } from 'react';

/**
 * The People remote's first screen, and deliberately nothing more.
 *
 * It exists to prove the remote loads at runtime and ships alone. It takes no
 * data because there is none to show yet; when there is, it arrives as props
 * from the shell — a remote never fetches and never touches the session.
 */
export function PeopleHome(): JSX.Element {
  return <PageHeader title="People" description="The directory is on its way." />;
}
