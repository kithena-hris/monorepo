'use client';

import { Alert, EmptyState, Spinner, icons } from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';

import { publicApi, tokenFromHash } from '../../../lib/browser-api';
import { t } from '../../../lib/i18n';

export function AlertLink({ company }: { readonly company: string }): JSX.Element {
  const [state, setState] = useState<'working' | 'confirmed' | 'stopped' | 'broken'>('working');
  useEffect(() => {
    const [action, token = ''] = tokenFromHash().split('.', 2);
    if ((action !== 'confirm' && action !== 'stop') || token === '') {
      setState('broken');
      return;
    }
    void publicApi(company, `/alerts/${action}`, { method: 'POST', body: { token } }).then(
      (done) => {
        setState(done.ok ? (action === 'confirm' ? 'confirmed' : 'stopped') : 'broken');
      },
    );
  }, [company]);
  if (state === 'working')
    return <Spinner label={t('app.alerts.[company].alert-link.one_moment', 'One moment')} />;
  if (state === 'broken')
    return (
      <Alert
        tone="warning"
        title={t(
          'app.alerts.[company].alert-link.this_link_has_expired_or_was',
          'This link has expired or was already used',
        )}
      />
    );
  return (
    <EmptyState
      icon={<icons.success aria-hidden />}
      title={
        state === 'confirmed'
          ? t('app.alerts.[company].alert-link.your_alert_is_on', 'Your alert is on')
          : t('app.alerts.[company].alert-link.your_alert_is_off', 'Your alert is off')
      }
      description={
        state === 'confirmed'
          ? t(
              'app.alerts.[company].alert-link.new_jobs_that_match_arrive_by',
              'New jobs that match arrive by email. Every email has a link to stop them.',
            )
          : t(
              'app.alerts.[company].alert-link.you_will_get_no_more_emails',
              'You will get no more emails from this alert.',
            )
      }
    />
  );
}
