'use client';

import {
  RecruitingApprovalDetail,
  RecruitingChooseTimeDetail,
  RecruitingScorecardDetail,
} from '@kithena/contracts';
import {
  Alert,
  Button,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  KeyValues,
  locale,
  RadioCard,
  RadioGroup,
  SegmentedControl,
  SegmentedControlItem,
  Spinner,
  Textarea,
} from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';

import { recruitingAct } from '../../app/(app)/recruiting/actions';

import {
  askCandidateForMoreTimes,
  bookCandidateTime,
  decideRecruitingApproval,
  submitScorecard,
} from '../../app/(app)/inbox/actions';
import { NoteDialog } from './dialogs';
import { Actions, type BodyProps, OpenHere } from './pane';
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

const money = (m: { amountMinor: number; currency: string }): string =>
  new Intl.NumberFormat(locale(), { style: 'currency', currency: m.currency }).format(
    m.amountMinor / 100,
  );

const longDay = (date: string): string =>
  new Intl.DateTimeFormat(locale(), { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );

/**
 * A requisition or an offer to approve, decided here: what it asks for, what
 * changed since it was last approved, and Approve, or Reject with a reason.
 */
function Approval({ item, act }: BodyProps): JSX.Element {
  const parsed = RecruitingApprovalDetail.safeParse(item.detail);
  const [rejecting, setRejecting] = useState(false);
  if (!parsed.success)
    return (
      <Actions>
        <OpenHere href={item.link}>
          {tr('components.inbox.detail-recruiting.open_in_recruiting', 'Open in Recruiting')}
        </OpenHere>
      </Actions>
    );
  const d = parsed.data;
  const id = d.kind === 'requisition' ? d.requisitionId : d.offerId;
  const per =
    d.kind === 'offer'
      ? d.frequency === 'year'
        ? tr('components.inbox.detail-recruiting.a_year', 'a year')
        : d.frequency === 'month'
          ? tr('components.inbox.detail-recruiting.a_month', 'a month')
          : tr('components.inbox.detail-recruiting.an_hour', 'an hour')
      : '';
  const facts =
    d.kind === 'requisition'
      ? [
          {
            label: tr('components.inbox.detail-recruiting.openings', 'Openings'),
            value: String(d.openings),
          },
          ...(d.targetStart === null
            ? []
            : [
                {
                  label: tr('components.inbox.detail-recruiting.target_start', 'Target start'),
                  value: longDay(d.targetStart),
                },
              ]),
          ...(d.budget === null
            ? []
            : [
                {
                  label: tr('components.inbox.detail-recruiting.budget', 'Budget'),
                  value: `${money(d.budget.from)} – ${money(d.budget.to)}`,
                },
              ]),
          ...(d.justification.trim() === ''
            ? []
            : [
                {
                  label: tr('components.inbox.detail-recruiting.why', 'Why'),
                  value: d.justification,
                },
              ]),
        ]
      : [
          {
            label: tr('components.inbox.detail-recruiting.candidate', 'Candidate'),
            value: d.candidate,
          },
          { label: tr('components.inbox.detail-recruiting.role', 'Role'), value: d.job },
          {
            label: tr('components.inbox.detail-recruiting.base_pay', 'Base pay'),
            value: `${money(d.base)} ${per}`,
          },
          ...(d.variableTarget === null
            ? []
            : [
                {
                  label: tr(
                    'components.inbox.detail-recruiting.variable_target',
                    'Variable target',
                  ),
                  value: money(d.variableTarget),
                },
              ]),
          ...(d.signOn === null
            ? []
            : [
                {
                  label: tr('components.inbox.detail-recruiting.sign_on', 'Sign-on'),
                  value: money(d.signOn),
                },
              ]),
          {
            label: tr('components.inbox.detail-recruiting.starts', 'Starts'),
            value: longDay(d.startDate),
          },
        ];
  const decide = (decision: 'approved' | 'rejected', comment: string | null): void => {
    act.run(() => decideRecruitingApproval(d.kind, id, decision, comment), {
      title:
        decision === 'approved'
          ? tr('components.inbox.detail-recruiting.approved', 'Approved')
          : tr('components.inbox.detail-recruiting.rejected', 'Rejected'),
      next: true,
    });
  };
  return (
    <div className="flex flex-col gap-5">
      <KeyValues layout="aligned" labelWidth="8rem" items={facts} />
      {d.changes.length === 0 ? null : (
        <KeyValues
          layout="aligned"
          labelWidth="8rem"
          items={d.changes.map((c) => ({
            label: c.field,
            value: tr('components.inbox.detail-recruiting.changed', '{{from}} → {{to}}', {
              from: c.from,
              to: c.to,
            }),
          }))}
        />
      )}
      <Actions
        hint={
          d.steps > 1
            ? tr('components.inbox.detail-recruiting.step_of', 'Step {{step}} of {{steps}}', {
                step: d.step,
                steps: d.steps,
              })
            : undefined
        }
      >
        <Button
          variant="primary"
          disabled={act.pending}
          onClick={() => {
            decide('approved', null);
          }}
        >
          {tr('components.inbox.detail-recruiting.approve', 'Approve')}
        </Button>
        <Button
          variant="secondary"
          disabled={act.pending}
          onClick={() => {
            setRejecting(true);
          }}
        >
          {tr('components.inbox.detail-recruiting.reject', 'Reject…')}
        </Button>
      </Actions>
      {rejecting ? (
        <NoteDialog
          title={
            d.kind === 'requisition'
              ? tr(
                  'components.inbox.detail-recruiting.reject_the_requisition',
                  'Reject the requisition?',
                )
              : tr('components.inbox.detail-recruiting.reject_the_offer', 'Reject the offer?')
          }
          description={tr(
            'components.inbox.detail-recruiting.whoever_asked_sees_why',
            'Whoever asked for it sees your reason.',
          )}
          label={tr('components.inbox.detail-recruiting.reason', 'Reason')}
          confirm={tr('components.inbox.detail-recruiting.reject_it', 'Reject it')}
          onClose={() => {
            setRejecting(false);
          }}
          onConfirm={(note) => {
            setRejecting(false);
            decide('rejected', note);
          }}
        />
      ) : null}
    </div>
  );
}

interface Drafted {
  readonly title: string;
  readonly body: string;
  readonly toConfirm: readonly string[];
}

/**
 * An accepted offer's contract, written and sent from here: drafted from the
 * accepted terms, read and changed in place, then sent to sign (the
 * candidate first, then the company). The contract page keeps the AI chat
 * and the preview for anything more.
 */
function CreateContract({ item, act }: BodyProps): JSX.Element {
  const offerId = item.id.replace(/^recruiting:create-contract:/u, '');
  const [draft, setDraft] = useState<Drafted | null | 'failed'>(null);
  const [body, setBody] = useState('');
  useEffect(() => {
    let live = true;
    void recruitingAct('DraftContract', { offerId }).then((done) => {
      if (!live) return;
      if (!done.ok) {
        setDraft('failed');
        return;
      }
      const d = done.data as Drafted;
      setDraft(d);
      setBody(d.body);
    });
    return () => {
      live = false;
    };
  }, [offerId]);
  const open = (
    <OpenHere href={item.link} variant="secondary">
      {tr('components.inbox.detail-recruiting.open_the_contract_page', 'Open the contract page')}
    </OpenHere>
  );
  if (draft === null)
    return (
      <div className="flex items-center gap-3 text-fg-muted">
        <Spinner />
        {tr(
          'components.inbox.detail-recruiting.drafting_the_contract',
          'Drafting the contract from the accepted terms…',
        )}
      </div>
    );
  if (draft === 'failed') return <Actions>{open}</Actions>;
  const unconfirmed = /\[\[TO CONFIRM:/u.test(body);
  return (
    <div className="flex flex-col gap-5">
      {item.summary === null ? null : <p className="text-base text-fg-muted">{item.summary}</p>}
      {draft.toConfirm.length === 0 && !unconfirmed ? null : (
        <Alert
          tone="warning"
          title={tr(
            'components.inbox.detail-recruiting.confirm_before_sending',
            'Confirm before sending',
          )}
        >
          {draft.toConfirm.length > 0
            ? draft.toConfirm.join(' · ')
            : tr(
                'components.inbox.detail-recruiting.replace_to_confirm',
                'Replace each [[TO CONFIRM: …]] in the text.',
              )}
        </Alert>
      )}
      <Field>
        <FieldLabel>{draft.title}</FieldLabel>
        <FieldControl>
          <Textarea
            autoResize
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
            }}
          />
        </FieldControl>
      </Field>
      <Actions>
        <Button
          variant="primary"
          disabled={unconfirmed || body.trim() === '' || act.pending}
          onClick={() => {
            act.run(
              async () => {
                const sent = await recruitingAct('SendContract', {
                  offerId,
                  title: draft.title,
                  body,
                });
                return sent.ok ? { ok: true } : { ok: false, message: sent.message };
              },
              {
                title: tr('components.inbox.detail-recruiting.sent_to_sign', 'Sent to sign'),
                description: tr(
                  'components.inbox.detail-recruiting.candidate_signs_first',
                  'The candidate signs first, then you for the company.',
                ),
                next: true,
              },
            );
          }}
        >
          {tr('components.inbox.detail-recruiting.send_to_sign', 'Send to sign')}
        </Button>
        {open}
      </Actions>
    </div>
  );
}

const RECOMMENDATIONS = ['strong_no', 'no', 'yes', 'strong_yes'] as const;

/** 1 to 4 with labelled anchors and no midpoint, as the scorecard on the interview page. */
function Scale({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: number | null;
  readonly onChange: (v: number) => void;
}): JSX.Element {
  const anchors = [
    tr('components.inbox.detail-recruiting.strong_no', 'Strong no'),
    tr('components.inbox.detail-recruiting.no', 'No'),
    tr('components.inbox.detail-recruiting.yes', 'Yes'),
    tr('components.inbox.detail-recruiting.strong_yes', 'Strong yes'),
  ];
  return (
    <SegmentedControl
      aria-label={label}
      value={value === null ? '' : String(value)}
      onValueChange={(v) => {
        if (v !== '') onChange(Number(v));
      }}
      className="w-full"
    >
      {anchors.map((a, i) => (
        <SegmentedControlItem key={a} value={String(i + 1)}>
          {`${String(i + 1)} · ${a}`}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}

/**
 * A scorecard owed, filled in and submitted here: each competency 1 to 4,
 * the overall recommendation and notes. Before the interview has begun it
 * cannot be submitted; the interview page keeps a draft.
 */
function Scorecard({ item, act, now }: BodyProps): JSX.Element {
  const parsed = RecruitingScorecardDetail.safeParse(item.detail);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [recommendation, setRecommendation] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  if (!parsed.success)
    return (
      <Actions>
        <OpenHere href={item.link}>
          {tr('components.inbox.detail-recruiting.open_in_recruiting', 'Open in Recruiting')}
        </OpenHere>
      </Actions>
    );
  const d = parsed.data;
  const begun = Date.parse(d.startsAt) <= Date.parse(now);
  const rated = d.competencies.every((c) => ratings[c.key] !== undefined);
  const chosen = recommendation === null ? undefined : RECOMMENDATIONS[recommendation - 1];
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
            value: d.interview,
          },
        ]}
      />
      {d.competencies.map((c) => (
        <Field key={c.key}>
          <FieldLabel>{c.name}</FieldLabel>
          {c.description === '' ? null : <FieldDescription>{c.description}</FieldDescription>}
          <Scale
            label={c.name}
            value={ratings[c.key] ?? null}
            onChange={(v) => {
              setRatings({ ...ratings, [c.key]: v });
            }}
          />
        </Field>
      ))}
      <Field>
        <FieldLabel>
          {tr(
            'components.inbox.detail-recruiting.overall_recommendation',
            'Overall recommendation',
          )}
        </FieldLabel>
        <Scale
          label={tr(
            'components.inbox.detail-recruiting.overall_recommendation',
            'Overall recommendation',
          )}
          value={recommendation}
          onChange={setRecommendation}
        />
      </Field>
      <Field>
        <FieldLabel>{tr('components.inbox.detail-recruiting.notes', 'Notes')}</FieldLabel>
        <FieldControl>
          <Textarea
            autoResize
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
            }}
            placeholder={tr(
              'components.inbox.detail-recruiting.what_you_saw_and_heard',
              'What you saw and heard',
            )}
          />
        </FieldControl>
      </Field>
      <Actions
        hint={
          begun
            ? undefined
            : tr(
                'components.inbox.detail-recruiting.submit_once_begun',
                'You can submit it once the interview has begun.',
              )
        }
      >
        <Button
          variant="primary"
          disabled={!begun || !rated || chosen === undefined || act.pending}
          onClick={() => {
            if (chosen === undefined) return;
            act.run(
              () => submitScorecard(d.interviewId, ratings, chosen, notes === '' ? null : notes),
              {
                title: tr(
                  'components.inbox.detail-recruiting.scorecard_submitted',
                  'Scorecard submitted',
                ),
                next: true,
              },
            );
          }}
        >
          {tr('components.inbox.detail-recruiting.submit_scorecard', 'Submit scorecard')}
        </Button>
      </Actions>
    </div>
  );
}

export function RecruitingBody(props: BodyProps): JSX.Element {
  if (props.item.kind === 'recruiting.choose-time' && props.item.lane === 'task')
    return <ChooseTime {...props} />;
  if (
    props.item.kind === 'recruiting.requisition-approval' ||
    props.item.kind === 'recruiting.offer-approval'
  )
    return <Approval {...props} />;
  if (props.item.kind === 'recruiting.scorecard') return <Scorecard {...props} />;
  if (props.item.kind === 'recruiting.create-contract') return <CreateContract {...props} />;
  return (
    <Actions>
      <OpenHere href={props.item.link}>
        {tr('components.inbox.detail-recruiting.open_in_recruiting', 'Open in Recruiting')}
      </OpenHere>
    </Actions>
  );
}
