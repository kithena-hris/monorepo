'use client';

import { RecruitingChooseTimeDetail } from '@kithena/contracts';
import { Alert, Button, KeyValues, RadioCard, RadioGroup } from '@reach/ui';
import { useState, type JSX } from 'react';

import { askCandidateForMoreTimes, bookCandidateTime } from '../../app/(app)/inbox/actions';
import { Actions, type BodyProps } from './pane';

/**
 * Recruiting's items in the Inbox. One is acted on here: the times a
 * candidate gave through a scheduling link (`recruiting.choose-time`), one of
 * which is booked with the where and agenda chosen when the link was sent;
 * or none, and the candidate is asked for others. Everything else opens in
 * Recruiting.
 */

const DAY = (zone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: zone,
  });
const HOUR = (zone: string) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: zone });

function ChooseTime({ item, act, zone }: BodyProps): JSX.Element {
  const parsed = RecruitingChooseTimeDetail.safeParse(item.detail);
  const [time, setTime] = useState('');
  if (!parsed.success)
    return (
      <Alert tone="warning" title="This can’t be shown here">
        Open it in Recruiting instead.
      </Alert>
    );
  const d = parsed.data;
  const day = DAY(zone);
  const hour = HOUR(zone);
  const days = new Map<string, string[]>();
  for (const t of [...d.times].toSorted()) {
    const key = day.format(new Date(t));
    days.set(key, [...(days.get(key) ?? []), t]);
  }
  const first = d.candidate.split(' ')[0] ?? d.candidate;
  return (
    <div className="flex flex-col gap-5">
      <KeyValues
        layout="aligned"
        labelWidth="6rem"
        items={[
          { label: 'Candidate', value: d.candidate },
          { label: 'Role', value: d.job },
          { label: 'Interview', value: `${d.interview} · ${String(d.minutes)} min` },
          { label: 'Where', value: d.where ?? 'Google Meet, made when you book' },
          ...(d.agenda === null ? [] : [{ label: 'Agenda', value: d.agenda }]),
        ]}
      />
      <RadioGroup aria-label="The times the candidate gave" value={time} onValueChange={setTime}>
        {[...days.entries()].map(([label, times]) => (
          <section key={label} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-fg-muted">{label}</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {times.map((t) => (
                <RadioCard key={t} value={t}>
                  {`${hour.format(new Date(t))} – ${hour.format(new Date(Date.parse(t) + d.minutes * 60_000))}`}
                </RadioCard>
              ))}
            </div>
          </section>
        ))}
      </RadioGroup>
      <Actions hint={`Times in ${zone}`}>
        <Button
          disabled={time === ''}
          onClick={() => {
            act.run(() => bookCandidateTime(d.applicationId, d.askId, time), {
              title: `Booked: ${first}, ${day.format(new Date(time))} at ${hour.format(new Date(time))}`,
              description: `${first} has the invitation with the meeting link`,
              next: true,
            });
          }}
        >
          Book and send the invitation
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            act.run(() => askCandidateForMoreTimes(d.applicationId, d.askId), {
              title: `Asked ${first} for more times`,
              description: 'These are left out of the new link',
              next: true,
            });
          }}
        >
          None works: ask for more times
        </Button>
      </Actions>
    </div>
  );
}

export function RecruitingBody(props: BodyProps): JSX.Element {
  if (props.item.kind === 'recruiting.choose-time' && props.item.lane === 'task')
    return <ChooseTime {...props} />;
  return (
    <Actions>
      <Button asChild>
        <a href={props.item.link}>Open in Recruiting</a>
      </Button>
    </Actions>
  );
}
