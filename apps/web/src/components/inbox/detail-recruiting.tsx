'use client';

import { RecruitingChooseTimeDetail } from '@kithena/contracts';
import { Alert, Button, KeyValues, locale, RadioCard, RadioGroup } from '@reach/ui';
import { useState, type JSX } from 'react';

import { askCandidateForMoreTimes, bookCandidateTime } from '../../app/(app)/inbox/actions';
import { Actions, type BodyProps } from './pane';
import { t as tr } from '../../lib/t';

/**
 * Recruiting's items in the Inbox. One is acted on here: the times a
 * candidate gave through a scheduling link (`recruiting.choose-time`), one of
 * which is booked with the where and agenda chosen when the link was sent;
 * or none, and the candidate is asked for others. An accepted offer's task
 * opens its contract. Everything else opens in Recruiting.
 */

const DAY = (zone: string) =>
  new Intl.DateTimeFormat(locale(), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: zone,
  });
const HOUR = (zone: string) =>
  new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit', timeZone: zone });

function ChooseTime({ item, act, zone }: BodyProps): JSX.Element {
  const parsed = RecruitingChooseTimeDetail.safeParse(item.detail);
  const [time, setTime] = useState('');
  if (!parsed.success)
    return (
      <Alert
        tone="warning"
        title={tr(
          'components.inbox.detail-recruiting.this_cant_be_shown_here',
          'This can’t be shown here',
        )}
      >
        {tr(
          'components.inbox.detail-recruiting.open_it_in_recruiting_instead',
          'Open it in Recruiting instead.',
        )}
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
          {
            label: tr('components.inbox.detail-recruiting.candidate', 'Candidate'),
            value: d.candidate,
          },
          { label: tr('components.inbox.detail-recruiting.role', 'Role'), value: d.job },
          {
            label: tr('components.inbox.detail-recruiting.interview', 'Interview'),
            value: `${d.interview} · ${String(d.minutes)} min`,
          },
          {
            label: tr('components.inbox.detail-recruiting.where', 'Where'),
            value: d.where ?? 'Google Meet, made when you book',
          },
          ...(d.agenda === null
            ? []
            : [
                {
                  label: tr('components.inbox.detail-recruiting.agenda', 'Agenda'),
                  value: d.agenda,
                },
              ]),
        ]}
      />
      <RadioGroup
        aria-label={tr(
          'components.inbox.detail-recruiting.the_times_the_candidate_gave',
          'The times the candidate gave',
        )}
        value={time}
        onValueChange={setTime}
      >
        {[...days.entries()].map(([label, times]) => (
          <section key={label} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-fg-muted">{label}</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {times.map((t) => (
                <RadioCard key={t} value={t}>
                  {tr('components.inbox.detail-recruiting.text', '{{format}} – {{format2}}', {
                    format: hour.format(new Date(t)),
                    format2: hour.format(new Date(Date.parse(t) + d.minutes * 60_000)),
                  })}
                </RadioCard>
              ))}
            </div>
          </section>
        ))}
      </RadioGroup>
      <Actions
        hint={tr('components.inbox.detail-recruiting.times_in', 'Times in {{zone}}', { zone })}
      >
        <Button
          disabled={time === ''}
          onClick={() => {
            act.run(() => bookCandidateTime(d.applicationId, d.askId, time), {
              title: tr(
                'components.inbox.detail-recruiting.booked_first_day_at_hour',
                'Booked: {{first}}, {{day}} at {{hour}}',
                {
                  first,
                  day: day.format(new Date(time)),
                  hour: hour.format(new Date(time)),
                },
              ),
              description: tr(
                'components.inbox.detail-recruiting.first_has_the_invitation',
                '{{first}} has the invitation with the meeting link',
                { first },
              ),
              next: true,
            });
          }}
        >
          {tr(
            'components.inbox.detail-recruiting.book_and_send_the_invitation',
            'Book and send the invitation',
          )}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            act.run(() => askCandidateForMoreTimes(d.applicationId, d.askId), {
              title: tr(
                'components.inbox.detail-recruiting.asked_first_for_more_times',
                'Asked {{first}} for more times',
                { first },
              ),
              description: tr(
                'components.inbox.detail-recruiting.these_are_left_out_of_the_new',
                'These are left out of the new link',
              ),
              next: true,
            });
          }}
        >
          {tr(
            'components.inbox.detail-recruiting.none_works_ask_for_more_times',
            'None works: ask for more times',
          )}
        </Button>
      </Actions>
    </div>
  );
}

export function RecruitingBody(props: BodyProps): JSX.Element {
  if (props.item.kind === 'recruiting.choose-time' && props.item.lane === 'task')
    return <ChooseTime {...props} />;
  if (props.item.kind === 'recruiting.create-contract')
    return (
      <div className="flex flex-col gap-5">
        {props.item.summary === null ? null : (
          <p className="text-base text-fg-muted">{props.item.summary}</p>
        )}
        <Actions>
          <Button asChild variant="primary">
            <a href={props.item.link}>
              {tr('components.inbox.detail-recruiting.create_the_contract', 'Create the contract')}
            </a>
          </Button>
        </Actions>
      </div>
    );
  return (
    <Actions>
      <Button asChild>
        <a href={props.item.link}>
          {tr('components.inbox.detail-recruiting.open_in_recruiting', 'Open in Recruiting')}
        </a>
      </Button>
    </Actions>
  );
}
