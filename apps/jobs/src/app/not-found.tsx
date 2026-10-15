import { Button, EmptyState, icons } from '@reach/ui';
import Link from 'next/link';
import type { JSX } from 'react';

/** A job that closed, was taken down, or never was: say so, and point back at the search. */
export default function NotFound(): JSX.Element {
  return (
    <EmptyState
      icon={<icons.work aria-hidden />}
      title="This job is no longer open"
      description="It may have been filled or taken down."
      action={
        <Button asChild>
          <Link href="/search">Search open jobs</Link>
        </Button>
      }
    />
  );
}
