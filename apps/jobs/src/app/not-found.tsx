import { Button, EmptyState, icons } from '@reach/ui';
import Link from 'next/link';
import type { JSX } from 'react';
import { t } from '../lib/i18n';

/** A job that closed, was taken down, or never was: say so, and point back at the search. */
export default function NotFound(): JSX.Element {
  return (
    <EmptyState
      icon={<icons.work aria-hidden />}
      title={t('app.not-found.this_job_is_no_longer_open', 'This job is no longer open')}
      description={t(
        'app.not-found.it_may_have_been_filled_or',
        'It may have been filled or taken down.',
      )}
      action={
        <Button asChild>
          <Link href="/search">{t('app.not-found.search_open_jobs', 'Search open jobs')}</Link>
        </Button>
      }
    />
  );
}
