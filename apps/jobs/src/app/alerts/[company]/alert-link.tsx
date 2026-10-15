'use client';

import { Alert, EmptyState, Spinner, icons } from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';

import { publicApi, tokenFromHash } from '../../../lib/browser-api';

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
  if (state === 'working') return <Spinner label="One moment" />;
  if (state === 'broken')
    return <Alert tone="warning" title="This link has expired or was already used" />;
  return (
    <EmptyState
      icon={<icons.success aria-hidden />}
      title={state === 'confirmed' ? 'Your alert is on' : 'Your alert is off'}
      description={
        state === 'confirmed'
          ? 'New jobs that match arrive by email. Every email has a link to stop them.'
          : 'You will get no more emails from this alert.'
      }
    />
  );
}
