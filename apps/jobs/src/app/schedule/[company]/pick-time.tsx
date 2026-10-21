'use client';

import { Alert, Button, EmptyState, SlotPicker, Spinner, icons } from '@reach/ui';
import { useEffect, useState, useTransition, type JSX } from 'react';

import { publicApi, tokenFromHash } from '../../../lib/browser-api';

interface Slots {
  readonly slots: readonly string[];
  readonly minutes: number;
  readonly title: string;
}

/**
 * The link in the invitation: up to ten times that suit the candidate, from
 * the slots that fit every interviewer, in the candidate's own zone. The
 * team books one and the invitation comes with the link and the agenda.
 */
export function PickTime({ company }: { readonly company: string }): JSX.Element {
  const [token, setToken] = useState('');
  const [data, setData] = useState<Slots | null>(null);
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  useEffect(() => {
    const t = tokenFromHash();
    setToken(t);
    if (t === '') setError('Open this page from the link in your invitation.');
    else
      void publicApi<Slots>(company, '/schedule', { token: t }).then((a) => {
        if (a.ok) setData(a.data);
        else setError(a.message);
      });
  }, [company]);
  if (sent)
    return (
      <EmptyState
        icon={<icons.success aria-hidden />}
        title="Sent"
        description="The team will confirm one of your times by email, with the link or the address."
      />
    );
  if (error !== null && data === null)
    return (
      <Alert tone="warning" title="We can’t show times">
        {error}
      </Alert>
    );
  if (data === null) return <Spinner label="Loading times" />;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <h1 className="text-2xl font-bold">When suits you?</h1>
      <p className="text-fg-muted">{`${data.title} · ${String(data.minutes)} min · ${zone} (your time). Pick up to ten times; the team books one.`}</p>
      {error === null ? null : (
        <Alert tone="danger" title="That did not go through">
          {error}
        </Alert>
      )}
      {data.slots.length === 0 ? (
        <EmptyState
          icon={<icons.calendar aria-hidden />}
          title="No times left"
          description="Reply to the invitation and the recruiter will find one."
        />
      ) : (
        <SlotPicker
          label="Times that suit you"
          slots={data.slots}
          value={chosen}
          onChange={setChosen}
          max={10}
          today={today}
          minutes={data.minutes}
        />
      )}
      <Button
        disabled={chosen.length === 0}
        loading={pending}
        onClick={() => {
          start(async () => {
            const done = await publicApi(company, '/schedule', {
              method: 'POST',
              body: { times: chosen },
              token,
            });
            if (!done.ok) setError(done.message);
            else setSent(true);
          });
        }}
      >
        {`Send ${String(chosen.length)} time${chosen.length === 1 ? '' : 's'}`}
      </Button>
    </div>
  );
}
