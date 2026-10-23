'use client';

import {
  Alert,
  AvatarGroup,
  Avatar,
  Button,
  Field,
  FieldControl,
  FieldLabel,
  Input,
  KeyValues,
  List,
  ListItem,
  Stat,
  Stepper,
  icons,
} from '@reach/ui';
import {
  TimeOffApprovalDetail,
  TimeOffDecidedDetail,
  TimeOffExpiringDetail,
  TimeOffHolidaysDetail,
  TimeOffRequestDetail,
} from '@kithena/contracts';
import { useState, type JSX } from 'react';

import { decideTimeOff, nudgeTimeOff, withdrawTimeOff } from '../../app/(app)/inbox/actions';
import { Actions, type BodyProps } from './pane';
import { ConfirmDialog } from './dialogs';
import { days, firstName, shortDay, spanLong, weekdays, when } from './format';
import { t } from '../../lib/t';

/**
 * Time Off's kinds in the detail pane (INB-010 to INB-013): an approval to
 * decide in place, your own request with its steps, a decision, days about to
 * expire, a holiday calendar.
 */

/** The dates, big, with what they cost (G1's date card). */
function Dates({
  from,
  to,
  workingDays,
  leaveTypeName,
  extra,
}: {
  readonly from: string;
  readonly to: string;
  readonly workingDays: string;
  readonly leaveTypeName: string;
  readonly extra?: string;
}): JSX.Element {
  return (
    <Stat
      inset
      label={t('components.inbox.detail-timeoff.dates', 'Dates')}
      icon={<icons.leave aria-hidden />}
      value={spanLong(from, to)}
      description={[weekdays(from, to), days(workingDays), leaveTypeName, extra]
        .filter((x) => x !== undefined)
        .join(' · ')}
    />
  );
}

/** G1, M:F2: decide here, with who else is out that week and what is left after. */
function Approval({ item, act }: BodyProps): JSX.Element {
  const parsed = TimeOffApprovalDetail.safeParse(item.detail);
  const [note, setNote] = useState('');
  if (!parsed.success) return <Missing />;
  const d = parsed.data;
  const who = firstName(d.personName);
  const decide = (decision: 'approve' | 'decline'): void => {
    act.run(() => decideTimeOff(d.requestId, decision, note.trim() === '' ? null : note.trim()), {
      title: decision === 'approve' ? `Approved ${who}’s time off` : `Declined ${who}’s time off`,
      description: `${who} gets an update`,
      next: true,
    });
  };
  return (
    <div
      className="flex flex-col gap-4"
      onKeyDown={(e) => {
        if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key === 'a') decide('approve');
        if (e.key === 'r') decide('decline');
      }}
    >
      <Dates from={d.from} to={d.to} workingDays={d.workingDays} leaveTypeName={d.leaveTypeName} />
      {d.week.length === 0 ? null : (
        <section
          aria-label={t('components.inbox.detail-timeoff.who_else_is_out', 'Who else is out')}
          className="flex flex-col gap-2"
        >
          <h3 className="text-sm font-semibold text-fg-muted">
            {t('components.inbox.detail-timeoff.that_week', '{{value}} that week{{value2}}', {
              value: d.teamName ?? 'The team',
              value2:
                d.alreadyOut === null
                  ? ''
                  : ` · ${String(d.alreadyOut.out)} of ${String(d.alreadyOut.of)} already out`,
            })}
          </h3>
          <List aria-label={t('components.inbox.detail-timeoff.each_day', 'Each day')}>
            {d.week.map((day) => (
              <ListItem
                key={day.date}
                description={
                  day.out.length === 0
                    ? t('components.inbox.detail-timeoff.nobody_else_out', 'Nobody else out')
                    : day.out.join(', ')
                }
                trailing={
                  day.out.length === 0 ? undefined : (
                    <AvatarGroup size="xs" max={3}>
                      {day.out.map((n) => (
                        <Avatar key={n} name={n} />
                      ))}
                    </AvatarGroup>
                  )
                }
              >
                {new Date(`${day.date}T12:00:00Z`).toLocaleDateString('en-GB', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  timeZone: 'UTC',
                })}
              </ListItem>
            ))}
          </List>
        </section>
      )}
      <KeyValues
        items={[
          ...(d.balanceAfter === null
            ? []
            : [
                {
                  label: t(
                    'components.inbox.detail-timeoff.has_left_after_this',
                    '{{who}} has left after this',
                    { who },
                  ),
                  value:
                    d.allowance === null
                      ? days(d.balanceAfter)
                      : `${days(d.balanceAfter)} of ${d.allowance}`,
                },
              ]),
          ...(d.firstAsk === null
            ? []
            : [
                {
                  label: t('components.inbox.detail-timeoff.asked_first_for', 'Asked first for'),
                  value: d.firstAsk,
                },
              ]),
          ...(d.note === null
            ? []
            : [
                {
                  label: t('components.inbox.detail-timeoff.s_note', '{{who}}’s note', { who }),
                  value: `“${d.note}”`,
                },
              ]),
        ]}
      />
      {item.lane === 'task' ? (
        <>
          <Field>
            <FieldLabel>
              {t('components.inbox.detail-timeoff.note_to', 'Note to {{who}}', { who })}
            </FieldLabel>
            <FieldControl>
              <Input
                placeholder={t('components.inbox.detail-timeoff.optional', 'Optional')}
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                }}
              />
            </FieldControl>
          </Field>
          <Actions>
            <Button
              variant="primary"
              startIcon={<icons.approve aria-hidden />}
              shortcut="A"
              loading={act.pending}
              onClick={() => {
                decide('approve');
              }}
            >
              {t('components.inbox.detail-timeoff.approve', 'Approve')}
            </Button>
            <Button
              shortcut="R"
              onClick={() => {
                decide('decline');
              }}
            >
              {t('components.inbox.detail-timeoff.decline', 'Decline')}
            </Button>
            <Button asChild variant="ghost" size="sm">
              <a href={item.link}>
                {t('components.inbox.detail-timeoff.open_in_time_off', 'Open in Time off')}
              </a>
            </Button>
          </Actions>
        </>
      ) : null}
    </div>
  );
}

/** E3, M:D2: your request, who has it, and Nudge once after 48 hours. */
function Request({ item, now, zone, act }: BodyProps): JSX.Element {
  const parsed = TimeOffRequestDetail.safeParse(item.detail);
  const [withdrawing, setWithdrawing] = useState(false);
  if (!parsed.success) return <Missing />;
  const d = parsed.data;
  const holder = firstName(d.holder?.name) || 'them';
  const current = d.steps.findIndex((s) => s.state === 'current');
  const canNudge = d.nudge !== null && !d.nudge.used && now >= d.nudge.from;
  return (
    <div className="flex flex-col gap-4">
      <Dates from={d.from} to={d.to} workingDays={d.workingDays} leaveTypeName={d.leaveTypeName} />
      <Stepper
        label={t('components.inbox.detail-timeoff.where_it_is', 'Where it is')}
        orientation="vertical"
        size="sm"
        current={current === -1 ? d.steps.length : current}
        steps={d.steps.map((s, i) => ({
          id: String(i),
          label: s.label,
          ...(s.note === null ? {} : { description: s.note }),
          status: s.state === 'done' ? 'complete' : s.state === 'current' ? 'current' : 'upcoming',
        }))}
      />
      <KeyValues
        items={[
          ...(d.holder === null
            ? []
            : [
                {
                  label: t('components.inbox.detail-timeoff.with', 'With'),
                  value:
                    d.holder.covering === null
                      ? d.holder.name
                      : `${d.holder.name}, covering for ${d.holder.covering}`,
                },
              ]),
          ...(d.balanceAfter === null
            ? []
            : [
                {
                  label: t('components.inbox.detail-timeoff.left_after_this', 'Left after this'),
                  value:
                    d.allowance === null
                      ? days(d.balanceAfter)
                      : `${days(d.balanceAfter)} of ${d.allowance}`,
                },
              ]),
          ...(d.instead === null
            ? []
            : [
                {
                  label: t('components.inbox.detail-timeoff.instead_of', 'Instead of'),
                  value: d.instead,
                },
              ]),
        ]}
      />
      {item.lane === 'request' ? (
        <Actions
          hint={
            d.nudge === null
              ? undefined
              : d.nudge.used
                ? t('components.inbox.detail-timeoff.you_nudged', 'You nudged {{holder}}', {
                    holder,
                  })
                : canNudge
                  ? t('components.inbox.detail-timeoff.nudge_once', 'Nudge once')
                  : t(
                      'components.inbox.detail-timeoff.you_can_nudge_after_48_hours',
                      'You can nudge after 48 hours, from {{from}}',
                      { from: when(d.nudge.from, zone) },
                    )
          }
        >
          <Button
            startIcon={<icons.notifications aria-hidden />}
            disabled={!canNudge}
            loading={act.pending}
            onClick={() => {
              act.run(() => nudgeTimeOff(d.requestId), { title: `${holder} was nudged` });
            }}
          >
            {t('components.inbox.detail-timeoff.nudge', 'Nudge {{holder}}', { holder })}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setWithdrawing(true);
            }}
          >
            {t('components.inbox.detail-timeoff.withdraw', 'Withdraw')}
          </Button>
        </Actions>
      ) : null}
      {withdrawing ? (
        <ConfirmDialog
          title={t(
            'components.inbox.detail-timeoff.withdraw_your_time_off_request',
            'Withdraw your time-off request?',
          )}
          description={t(
            'components.inbox.detail-timeoff.stops_seeing_it_you_can_ask',
            '{{holder}} stops seeing it. You can ask again any time.',
            { holder },
          )}
          confirm="Withdraw"
          cancel="Keep it"
          onClose={() => {
            setWithdrawing(false);
          }}
          onConfirm={() => {
            setWithdrawing(false);
            act.run(() => withdrawTimeOff(d.requestId), {
              title: 'Withdrawn',
              description: 'It moves to Done',
            });
          }}
        />
      ) : null}
    </div>
  );
}

/** D1, D4, M:C2, M:C4: what was decided, and a way on from a decline. */
function Decided({ item }: BodyProps): JSX.Element {
  const parsed = TimeOffDecidedDetail.safeParse(item.detail);
  if (!parsed.success) return <Missing />;
  const d = parsed.data;
  const by = firstName(d.by) || t('components.inbox.detail-timeoff.your_approver', 'Your approver');
  return (
    <div className="flex flex-col gap-4">
      <Dates
        from={d.from}
        to={d.to}
        workingDays={d.workingDays}
        leaveTypeName={d.leaveTypeName}
        {...(d.approved
          ? {}
          : { extra: t('components.inbox.detail-timeoff.declined', 'Declined') })}
      />
      <KeyValues
        items={[
          ...(d.leftThisYear === null
            ? []
            : [
                {
                  label: t('components.inbox.detail-timeoff.left_this_year', 'Left this year'),
                  value:
                    d.allowance === null
                      ? days(d.leftThisYear)
                      : `${days(d.leftThisYear)} of ${d.allowance}`,
                },
              ]),
          ...(d.note === null
            ? []
            : [
                {
                  label: t('components.inbox.detail-timeoff.s_note_2', '{{by}}’s note', { by }),
                  value: `“${d.note}”`,
                },
              ]),
        ]}
      />
      {d.followUp === null ? null : (
        <List
          aria-label={t(
            'components.inbox.detail-timeoff.what_you_asked_for_instead',
            'What you asked for instead',
          )}
        >
          <ListItem
            asChild
            icon={<icons.leave aria-hidden />}
            description={
              d.followUp.holder === null
                ? undefined
                : t('components.inbox.detail-timeoff.with_2', 'With {{holder}}', {
                    holder: d.followUp.holder,
                  })
            }
            chevron
          >
            <a href={`/time-off/requests/${d.followUp.requestId}`}>
              {t(
                'components.inbox.detail-timeoff.you_asked_for_instead',
                'You asked for {{label}} instead',
                { label: d.followUp.label },
              )}
            </a>
          </ListItem>
        </List>
      )}
      <Actions>
        {d.approved || d.followUp !== null ? (
          <Button asChild startIcon={<icons.externalLink aria-hidden />}>
            <a href={item.link}>
              {t('components.inbox.detail-timeoff.open_in_time_off', 'Open in Time off')}
            </a>
          </Button>
        ) : (
          <Button asChild startIcon={<icons.add aria-hidden />}>
            <a href={`/time-off/request?from=${d.from}&to=${d.to}`}>
              {t('components.inbox.detail-timeoff.request_other_dates', 'Request other dates')}
            </a>
          </Button>
        )}
      </Actions>
    </div>
  );
}

/** C9: days that do not carry over. */
function Expiring({ item }: BodyProps): JSX.Element {
  const parsed = TimeOffExpiringDetail.safeParse(item.detail);
  if (!parsed.success) return <Missing />;
  const d = parsed.data;
  return (
    <div className="flex flex-col gap-4">
      <KeyValues
        items={[
          { label: d.leaveTypeName, value: days(d.days) },
          {
            label: t('components.inbox.detail-timeoff.use_them_by', 'Use them by'),
            value: shortDay(d.by),
          },
        ]}
      />
      <Actions>
        <Button asChild variant="primary" startIcon={<icons.add aria-hidden />}>
          <a href={`/time-off/request?type=${d.leaveTypeKey}`}>
            {t('components.inbox.detail-timeoff.plan_time_off', 'Plan time off')}
          </a>
        </Button>
      </Actions>
    </div>
  );
}

/** D6: a holiday calendar published. */
function Holidays({ item }: BodyProps): JSX.Element {
  const parsed = TimeOffHolidaysDetail.safeParse(item.detail);
  if (!parsed.success) return <Missing />;
  const d = parsed.data;
  return (
    <div className="flex flex-col gap-4">
      <KeyValues
        items={[
          {
            label: t('components.inbox.detail-timeoff.calendar', 'Calendar'),
            value: `${d.calendar} · ${String(d.year)}`,
          },
          {
            label: t('components.inbox.detail-timeoff.public_holidays', 'Public holidays'),
            value: String(d.count),
          },
          ...(d.first === null
            ? []
            : [
                {
                  label: t('components.inbox.detail-timeoff.first_one', 'First one'),
                  value: `${shortDay(d.first.date)} · ${d.first.name}`,
                },
              ]),
        ]}
      />
      <Actions>
        <Button asChild startIcon={<icons.externalLink aria-hidden />}>
          <a href={item.link}>
            {t('components.inbox.detail-timeoff.open_in_time_off', 'Open in Time off')}
          </a>
        </Button>
      </Actions>
    </div>
  );
}

function Missing(): JSX.Element {
  return (
    <Alert
      tone="warning"
      title={t(
        'components.inbox.detail-timeoff.this_cant_be_shown_here',
        'This can’t be shown here',
      )}
    >
      {t(
        'components.inbox.detail-timeoff.open_it_in_time_off_instead',
        'Open it in Time off instead.',
      )}
    </Alert>
  );
}

export function TimeOffBody(props: BodyProps): JSX.Element {
  switch (props.item.kind) {
    case 'timeoff.approval':
      return <Approval {...props} />;
    case 'timeoff.request':
      return props.item.lane === 'done' ? <Decided {...props} /> : <Request {...props} />;
    case 'timeoff.decided':
      return <Decided {...props} />;
    case 'timeoff.expiring':
      return <Expiring {...props} />;
    case 'timeoff.holidays':
      return <Holidays {...props} />;
    default:
      return (
        <Actions>
          <Button asChild>
            <a href={props.item.link}>
              {t('components.inbox.detail-timeoff.open_in_time_off', 'Open in Time off')}
            </a>
          </Button>
        </Actions>
      );
  }
}
