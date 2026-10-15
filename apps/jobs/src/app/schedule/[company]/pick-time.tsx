'use client';

import { Alert, Button, Chip, ChipRow, EmptyState, Spinner, icons } from '@reach/ui';
import { useEffect, useState, useTransition, type JSX } from 'react';

import { publicApi, tokenFromHash } from '../../../lib/browser-api';

interface Slots {
  readonly slots: readonly string[];
  readonly minutes: number;
  readonly title: string;
}

/** Slots that suit every interviewer, in the candidate's own time zone. */
export function PickTime({ company }: { readonly company: string }): JSX.Element {
  const [token, setToken] = useState('');
  const [data, setData] = useState<Slots | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState(false);
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
  if (booked)
    return (
      <EmptyState
        icon={<icons.success aria-hidden />}
        title="Booked"
        description="The invitation is on its way, with the link or the address."
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
  const byDay = new Map<string, string[]>();
  for (const s of data.slots) {
    const d = new Date(s).toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    byDay.set(d, [...(byDay.get(d) ?? []), s]);
  }
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <h1 className="text-2xl font-bold">Pick a time</h1>
      <p className="text-fg-muted">{`${data.title} · ${String(data.minutes)} min · ${zone} (your time)`}</p>
      {error === null ? null : (
        <Alert tone="danger" title="That did not go through">
          {error}
        </Alert>
      )}
      {byDay.size === 0 ? (
        <EmptyState
          icon={<icons.calendar aria-hidden />}
          title="No times left"
          description="Reply to the invitation and the recruiter will find one."
        />
      ) : null}
      {[...byDay].map(([d, slots]) => (
        <section key={d} className="flex flex-col gap-2">
          <h2 className="font-semibold">{d}</h2>
          <ChipRow aria-label={`Times on ${d}`}>
            {slots.map((s) => (
              <Chip
                key={s}
                selected={chosen === s}
                onClick={() => {
                  setChosen(s);
                }}
              >
                {new Date(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </Chip>
            ))}
          </ChipRow>
        </section>
      ))}
      <Button
        disabled={chosen === null}
        loading={pending}
        onClick={() => {
          start(async () => {
            const done = await publicApi(company, '/schedule', {
              method: 'POST',
              body: { startsAt: chosen },
              token,
            });
            if (!done.ok) setError(done.message);
            else setBooked(true);
          });
        }}
      >
        Book this time
      </Button>
      <p className="text-xs text-fg-muted">You can reschedule or cancel from the same link.</p>
    </div>
  );
}
