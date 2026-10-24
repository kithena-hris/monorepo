'use client';

import { Alert, Badge, Button, EmptyState, SlotPicker, Spinner, icons } from '@reach/ui';
import { useEffect, useState, useTransition, type JSX } from 'react';

import { publicApi, tokenFromHash } from '../../../lib/browser-api';
import { t as tr } from '../../../lib/i18n';
import { formatList, locale } from '@reach/ui/intl';

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
  /** Times someone else has, or the team ruled out: shown greyed out, never chosen. */
  readonly taken?: readonly string[];
}

const LONG = (): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat(locale(), {
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
    if (t === '')
      setError(
        tr(
          'app.schedule.[company].pick-time.open_this_page_from_the_link',
          'Open this page from the link in your invitation.',
        ),
      );
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
              ? tr(
                  'app.schedule.[company].pick-time.your_times_are_with_the_team',
                  'Your times are with the team',
                )
              : tr(
                  'app.schedule.[company].pick-time.your_new_times_are_with_the',
                  'Your new times are with the team',
                )
          }
          description={tr(
            'app.schedule.[company].pick-time.they_will_confirm_one_by_email',
            'They will confirm one by email, with the meeting link and what it is about. The email has a link back here if your plans change.',
          )}
        />
        <div className="flex flex-wrap justify-center gap-1.5">
          {sent.map((t) => (
            <Badge key={t} size="sm" variant="soft" tone="accent">
              {LONG().format(new Date(t))}
            </Badge>
          ))}
        </div>
      </div>
    );
  if (error !== null && data === null)
    return (
      <Alert
        tone="warning"
        title={tr('app.schedule.[company].pick-time.we_cant_show_times', 'We can’t show times')}
      >
        {error}
      </Alert>
    );
  if (data === null)
    return (
      <Spinner label={tr('app.schedule.[company].pick-time.loading_times', 'Loading times')} />
    );
  const today = new Date().toISOString().slice(0, 10);
  const changing = data.chosen.length > 0;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-[-0.01em]">
          {changing
            ? tr('app.schedule.[company].pick-time.change_your_times', 'Change your times')
            : tr('app.schedule.[company].pick-time.when_suits_you', 'When suits you?')}
        </h1>
        <p className="text-fg-muted">
          {tr(
            'app.schedule.[company].pick-time.pick_times_intro',
            {
              one: '{{title}} · {{minutes}} min · times in {{zone}}, your time. Pick {{count}}; the team books it and sends the invitation.',
              other:
                '{{title}} · {{minutes}} min · times in {{zone}}, your time. Pick {{count}}; the team books one and sends the invitation.',
            },
            { title: data.title, minutes: data.minutes, zone, count: data.wanted },
          )}
        </p>
        {data.organiser === null && data.interviewers.length === 0 ? null : (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <icons.people aria-hidden className="size-4 text-fg-muted" />
            {tr(
              'app.schedule.[company].pick-time.times_fit_everyone',
              'The times below fit {{replace}}: their working hours, holidays and meetings are checked. A greyed-out time is already taken.',
              {
                replace: formatList(
                  [data.organiser, ...data.interviewers].filter((n): n is string => n !== null),
                ),
              },
            )}
          </p>
        )}
      </header>
      {data.booked === null ? null : (
        <Alert
          tone="info"
          title={tr('app.schedule.[company].pick-time.booked_for', 'Booked for {{format}}', {
            format: LONG().format(new Date(data.booked)),
          })}
        >
          {tr(
            'app.schedule.[company].pick-time.give_new_times_here_and_the',
            'Give new times here and the team moves it to one of them; until then, that time stands.',
          )}
        </Alert>
      )}
      {data.excluded === 0 ? null : (
        <Alert
          tone="warning"
          title={tr(
            'app.schedule.[company].pick-time.the_team_could_not_make_your',
            'The team could not make your earlier times',
          )}
        >
          {tr(
            'app.schedule.[company].pick-time.those_are_greyed_out_now',
            {
              one: 'That time is greyed out now. Please choose others.',
              other: 'Those {{count}} times are greyed out now. Please choose others.',
            },
            { count: data.excluded },
          )}
        </Alert>
      )}
      {changing ? (
        <Alert
          tone="neutral"
          title={tr(
            'app.schedule.[company].pick-time.your_times_so_far_are_picked',
            'Your times so far are picked below',
          )}
        >
          {tr(
            'app.schedule.[company].pick-time.take_off_any_that_no_longer',
            'Take off any that no longer work and add others; sending replaces what you gave before.',
          )}
        </Alert>
      ) : null}
      {error === null ? null : (
        <Alert
          tone="danger"
          title={tr(
            'app.schedule.[company].pick-time.that_did_not_go_through',
            'That did not go through',
          )}
        >
          {error}
        </Alert>
      )}
      {data.slots.length === 0 ? (
        <EmptyState
          icon={<icons.calendar aria-hidden />}
          title={tr('app.schedule.[company].pick-time.no_times_left', 'No times left')}
          description={tr(
            'app.schedule.[company].pick-time.reply_to_the_invitation_and_the',
            'Reply to the invitation and the recruiter will find one.',
          )}
        />
      ) : (
        <SlotPicker
          label={tr('app.schedule.[company].pick-time.times_that_suit_you', 'Times that suit you')}
          slots={data.slots}
          value={chosen}
          onChange={setChosen}
          max={data.wanted}
          today={today}
          minutes={data.minutes}
          taken={data.taken ?? []}
          unavailable={Object.fromEntries(data.holidays.map((h) => [h.date, h.name]))}
        />
      )}
      <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-3 border-t border-border bg-canvas/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <span className="text-sm text-fg-muted tabular-nums">
          {tr('app.schedule.[company].pick-time.of_picked', '{{String}} of {{String2}} picked', {
            String: String(chosen.length),
            String2: String(data.wanted),
          })}
        </span>
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
          {changing
            ? tr('app.schedule.[company].pick-time.send_my_new_times', 'Send my new times')
            : tr('app.schedule.[company].pick-time.send_my_times', 'Send my {{String}} times', {
                String: String(data.wanted),
              })}
        </Button>
      </div>
    </div>
  );
}
