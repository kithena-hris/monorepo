'use client';

import { Alert, Badge, Button, EmptyState, SlotPicker, Spinner, icons } from '@reach/ui';
import { useEffect, useState, useTransition, type JSX } from 'react';

import { publicApi, tokenFromHash } from '../../../lib/browser-api';

interface Slots {
  readonly slots: readonly string[];
  readonly minutes: number;
  readonly title: string;
  readonly holidays: readonly { readonly date: string; readonly name: string }[];
  /** Ten, or every free time when there are fewer. */
  readonly wanted: number;
  /** The recruiter who shared the link, and the interviewers: the times fit all their calendars. */
  readonly organiser: string | null;
  readonly interviewers: readonly string[];
  /** The times given through this link already: they open picked, to change. */
  readonly chosen: readonly string[];
  /** How many times given before the team could not make, and left out now. */
  readonly excluded: number;
  /** An interview already booked for this step. */
  readonly booked: string | null;
}

const LONG = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * The link in the invitation: ten times that suit the candidate, from the
 * slots that fit the recruiter and every interviewer, in the candidate's own
 * zone. Given before, they open picked: take some off, add others, send
 * again, and the new times replace the old. The team books one and the
 * invitation comes with the meeting link and the agenda.
 */
export function PickTime({ company }: { readonly company: string }): JSX.Element {
  const [token, setToken] = useState('');
  const [data, setData] = useState<Slots | null>(null);
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<readonly string[] | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    const t = tokenFromHash();
    setToken(t);
    if (t === '') setError('Open this page from the link in your invitation.');
    else
      void publicApi<Slots>(company, '/schedule', { token: t }).then((a) => {
        if (!a.ok) {
          setError(a.message);
          return;
        }
        setData(a.data);
        setChosen(a.data.chosen);
      });
  }, [company]);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (sent !== null)
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 py-10 text-center animate-enter motion-reduce:animate-none">
        <EmptyState
          icon={<icons.success aria-hidden />}
          title={
            data?.chosen.length === 0
              ? 'Your times are with the team'
              : 'Your new times are with the team'
          }
          description="They will confirm one by email, with the meeting link and what it is about. The email has a link back here if your plans change."
        />
        <div className="flex flex-wrap justify-center gap-1.5">
          {sent.map((t) => (
            <Badge key={t} size="sm" variant="soft" tone="accent">
              {LONG.format(new Date(t))}
            </Badge>
          ))}
        </div>
      </div>
    );
  if (error !== null && data === null)
    return (
      <Alert tone="warning" title="We can’t show times">
        {error}
      </Alert>
    );
  if (data === null) return <Spinner label="Loading times" />;
  const today = new Date().toISOString().slice(0, 10);
  const changing = data.chosen.length > 0;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-[-0.01em]">
          {changing ? 'Change your times' : 'When suits you?'}
        </h1>
        <p className="text-fg-muted">{`${data.title} · ${String(data.minutes)} min · times in ${zone}, your time. Pick ${String(data.wanted)}; the team books one and sends the invitation.`}</p>
        {data.organiser === null && data.interviewers.length === 0 ? null : (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <icons.people aria-hidden className="size-4 text-fg-muted" />
            {`Every time below is free for ${[data.organiser, ...data.interviewers]
              .filter((n): n is string => n !== null)
              .join(', ')
              .replace(
                /, ([^,]*)$/u,
                ' and $1',
              )}: their working hours, holidays and meetings are already left out.`}
          </p>
        )}
      </header>
      {data.booked === null ? null : (
        <Alert tone="info" title={`Booked for ${LONG.format(new Date(data.booked))}`}>
          Give new times here and the team moves it to one of them; until then, that time stands.
        </Alert>
      )}
      {data.excluded === 0 ? null : (
        <Alert tone="warning" title="The team could not make your earlier times">
          {`Those ${String(data.excluded)} are left out now. Please choose others.`}
        </Alert>
      )}
      {changing ? (
        <Alert tone="neutral" title="Your times so far are picked below">
          Take off any that no longer work and add others; sending replaces what you gave before.
        </Alert>
      ) : null}
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
          max={data.wanted}
          today={today}
          minutes={data.minutes}
          unavailable={Object.fromEntries(data.holidays.map((h) => [h.date, h.name]))}
        />
      )}
      <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-3 border-t border-border bg-canvas/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <span className="text-sm text-fg-muted tabular-nums">{`${String(chosen.length)} of ${String(data.wanted)} picked`}</span>
        <Button
          disabled={chosen.length !== data.wanted || data.wanted === 0}
          loading={pending}
          onClick={() => {
            start(async () => {
              const done = await publicApi(company, '/schedule', {
                method: 'POST',
                body: { times: chosen, timeZone: zone },
                token,
              });
              if (!done.ok) setError(done.message);
              else setSent([...chosen].toSorted());
            });
          }}
        >
          {changing ? 'Send my new times' : `Send my ${String(data.wanted)} times`}
        </Button>
      </div>
    </div>
  );
}
