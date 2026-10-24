import {
  Badge,
  Button,
  Calendar,
  Card,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Icon,
  List,
  ListItem,
  RadioCard,
  RadioGroup,
  SegmentedControl,
  SegmentedControlItem,
  Stack,
  Stat,
  Text,
  Timeline,
  TimelineItem,
  type DateRange,
  type TimelineItemProps,
} from '@reach/ui-native';
import {
  Calendar as CalendarIcon,
  Check,
  CircleCheck,
  Clock,
  Send,
  Wallet,
  X,
} from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { NoteNeeded } from '../documents/notes';
import { Failed, Loading, Page } from '../frame';
import { useAct } from '../people/act';
import type { PeopleScreen } from '../people/routes';
import { todayHere } from './time';
import { useTimeOff } from './api';
import { leaveIcon } from './icons';
import {
  addDays,
  amount,
  days,
  longSpan,
  nextWorkingDay,
  shortDate,
  spanLabel,
  statusOf,
} from './words';
import { t } from '../i18n';

interface Item {
  readonly requestId: string;
  /** Whose it is: on one request's own answer. */
  readonly personId?: string;
  readonly category: string;
  readonly leaveTypeKey: string;
  readonly leaveTypeName: string;
  readonly status: string;
  readonly requestedAt: string;
  readonly span: { from: string; to: string; startsHalfDay: boolean; endsHalfDay: boolean };
  readonly workingDays: string;
  readonly waitingOn: string | null;
  readonly displayName: string;
}

interface Detail {
  readonly request: Item;
  readonly mine: boolean;
  readonly canAnswer: boolean;
  readonly canCancel: boolean;
  readonly canChange: boolean;
  readonly chain: readonly string[];
  readonly step: number;
  readonly escalated: boolean;
  readonly note: string | null;
  /** A note is attached; its leave type asks for one it does not have yet (Documents MJ3). */
  readonly notePresent?: boolean;
  readonly noteNeeded?: boolean;
  readonly pendingChange: { from: string; to: string } | null;
  readonly proposals: readonly {
    index: number;
    spans: readonly { from: string; to: string }[];
    workingDays: string;
  }[];
  readonly proposalMessage: string | null;
}

const CATEGORY_ICON: Record<string, string> = {
  annual_leave: 'sun',
  sick_leave: 'thermometer',
  parental_leave: 'baby',
};
const ROLE: Record<string, string> = { manager: 'your manager', hr: 'HR' };
const role = (r: string | undefined): string => ROLE[r ?? ''] ?? 'an approver';
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The person's own requests: coming up, past and cancelled, each opening on its own. */
export function TimeOffRequests({
  navigation,
}: PeopleScreen<'TimeOffRequests'>): React.JSX.Element {
  const [tab, setTab] = useState<'upcoming' | 'past' | 'cancelled'>('upcoming');
  const { load, reload } = useTimeOff<{ items: Item[] }>('TimeOffMyRequests', { tab });
  return (
    <Page
      title={t('timeoff.requests.your_requests', 'Your requests')}
      back={{ label: t('timeoff.requests.time_off', 'Time off'), onPress: navigation.goBack }}
      trailing={
        <Button
          size="sm"
          variant="primary"
          onPress={() => {
            navigation.navigate('TimeOffRequest');
          }}
        >
          {t('timeoff.requests.request', 'Request')}
        </Button>
      }
    >
      <SegmentedControl
        fullWidth
        value={tab}
        accessibilityLabel={t('timeoff.requests.which_requests', 'Which requests')}
        onValueChange={(v) => {
          setTab(v === 'past' ? 'past' : v === 'cancelled' ? 'cancelled' : 'upcoming');
        }}
      >
        <SegmentedControlItem value="upcoming">
          {t('timeoff.requests.coming_up', 'Coming up')}
        </SegmentedControlItem>
        <SegmentedControlItem value="past">
          {t('timeoff.requests.past', 'Past')}
        </SegmentedControlItem>
        <SegmentedControlItem value="cancelled">
          {t('timeoff.requests.cancelled', 'Cancelled')}
        </SegmentedControlItem>
      </SegmentedControl>
      {load.status === 'error' ? (
        <Failed message={load.message} onRetry={reload} />
      ) : load.status === 'loading' ? (
        <Loading label={t('timeoff.requests.loading_your_requests', 'Loading your requests')} />
      ) : load.data.items.length === 0 ? (
        <EmptyState
          icon={CalendarIcon}
          title={t('timeoff.requests.nothing_here', 'Nothing here')}
          description={t(
            'timeoff.requests.requests_appear_here_once_they_are',
            'Requests appear here once they are sent.',
          )}
        />
      ) : (
        <List>
          {load.data.items.map((r) => {
            const status = statusOf(r.status);
            return (
              <ListItem
                key={r.requestId}
                icon={leaveIcon(CATEGORY_ICON[r.category])}
                description={days(r.workingDays)}
                trailing={
                  <Badge size="sm" tone={status.tone} dot>
                    {status.label}
                  </Badge>
                }
                onPress={() => {
                  navigation.navigate('TimeOffRequestDetail', { requestId: r.requestId });
                }}
              >
                {`${r.leaveTypeName} · ${spanLabel(r.span.from, r.span.to)}`}
              </ListItem>
            );
          })}
        </List>
      )}
    </Page>
  );
}

/** What happened and what happens next, from what Time Off knows. */
function steps(detail: Detail, today: string): (TimelineItemProps & { id: string })[] {
  const { request, chain, step } = detail;
  const s = request.status;
  const out: (TimelineItemProps & { id: string })[] = [
    {
      id: 'sent',
      title: t('timeoff.requests.sent', 'Sent'),
      tone: 'success',
      icon: Send,
      timestamp: shortDate(request.requestedAt.slice(0, 10)),
      children: t('timeoff.requests.you_asked_for', 'You asked for {{spanLabel}}.', {
        spanLabel: spanLabel(request.span.from, request.span.to),
      }),
    },
  ];
  const decided = ['approved', 'taken', 'change_pending'].includes(s) ? chain.length : step;
  chain.forEach((r, i) => {
    const id = `step${String(i)}`;
    if (i < decided)
      out.push({
        id,
        title: t('timeoff.requests.approved_by', 'Approved by {{role}}', { role: role(r) }),
        tone: 'success',
        icon: Check,
      });
    else if (i === step && s === 'declined')
      out.push({
        id,
        title: t('timeoff.requests.declined_by', 'Declined by {{role}}', { role: role(r) }),
        tone: 'danger',
        icon: X,
        children: t(
          'timeoff.requests.the_days_went_back_to_your',
          'The days went back to your balance.',
        ),
      });
    else if (i === step && s === 'pending')
      out.push({
        id,
        title: t('timeoff.requests.waiting_for', 'Waiting for {{role}}', { role: role(r) }),
        tone: 'warning',
        status: 'current',
        icon: Clock,
        children: detail.escalated
          ? t(
              'timeoff.requests.escalated_nobody_answered_in_time',
              'Escalated: nobody answered in time.',
            )
          : t(
              'timeoff.requests.the_days_are_booked_while_it',
              'The days are booked while it waits.',
            ),
      });
    else if (i > step && (s === 'pending' || s === 'counter_proposed'))
      out.push({
        id,
        title: t('timeoff.requests.then', 'Then {{role}}', { role: role(r) }),
        status: 'upcoming',
        icon: Check,
      });
  });
  if (s === 'counter_proposed')
    out.push({
      id: 'suggested',
      title: t('timeoff.requests.suggested_other_dates', '{{capital}} suggested other dates', {
        capital: capital(role(chain[step])),
      }),
      tone: 'info',
      status: 'current',
      icon: CalendarIcon,
      children: t(
        'timeoff.requests.take_one_or_keep_yours_and',
        'Take one, or keep yours and it goes back to them.',
      ),
    });
  if (s === 'change_pending' && detail.pendingChange !== null)
    out.push({
      id: 'change',
      title: t(
        'timeoff.requests.you_asked_to_move_it_to',
        'You asked to move it to {{spanLabel}}',
        { spanLabel: spanLabel(detail.pendingChange.from, detail.pendingChange.to) },
      ),
      tone: 'warning',
      status: 'current',
      icon: Clock,
      children: t(
        'timeoff.requests.your_old_dates_stay_booked_until',
        'Your old dates stay booked until the new ones are approved.',
      ),
    });
  if (s === 'cancelled' || s === 'withdrawn')
    out.push({
      id: 'cancelled',
      title:
        s === 'withdrawn'
          ? t('timeoff.requests.withdrawn', 'Withdrawn')
          : t('timeoff.requests.cancelled', 'Cancelled'),
      icon: X,
      children: t(
        'timeoff.requests.the_days_went_back_to_your',
        'The days went back to your balance.',
      ),
    });
  if (s === 'taken' || (s === 'approved' && request.span.to < today))
    out.push({
      id: 'taken',
      title: t('timeoff.requests.taken', 'Taken'),
      tone: 'success',
      icon: CircleCheck,
    });
  if (request.category === 'annual_leave' && !['declined', 'cancelled', 'withdrawn'].includes(s))
    out.push({
      id: 'pay',
      title: t('timeoff.requests.no_payroll_change', 'No payroll change'),
      status: 'upcoming',
      icon: Wallet,
      children: t(
        'timeoff.requests.paid_vacation_so_your_pay_stays',
        'Paid vacation, so your pay stays the same.',
      ),
    });
  return out;
}

/**
 * One request (design MT10): where it is, what happens next and what it does
 * to pay; other dates a manager suggested, each one tap to take; and moving,
 * shortening, withdrawing or cancelling it.
 */
export function TimeOffRequestDetail({
  navigation,
  route,
}: PeopleScreen<'TimeOffRequestDetail'>): React.JSX.Element {
  const { load, reload } = useTimeOff<Detail>('TimeOffRequest', {
    requestId: route.params.requestId,
  });
  const { act, busy } = useAct('timeoff');
  const [dialog, setDialog] = useState<'move' | 'shorten' | 'cancel' | null>(null);
  const today = todayHere();
  const back = { label: t('timeoff.requests.requests', 'Requests'), onPress: navigation.goBack };
  if (load.status !== 'ready') {
    return (
      <Page title={t('timeoff.requests.request', 'Request')} back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label={t('timeoff.requests.loading_the_request', 'Loading the request')} />
        )}
      </Page>
    );
  }
  const detail = load.data;
  const { request } = detail;
  const status = statusOf(request.status);
  const items = steps(detail, today);
  return (
    <Page title={spanLabel(request.span.from, request.span.to)} back={back}>
      <View className="flex-row items-center gap-2">
        <Text variant="title3" className="flex-1">
          {request.leaveTypeName}
        </Text>
        <Badge tone={status.tone} dot>
          {status.label}
        </Badge>
      </View>
      <View className="flex-row gap-2">
        <Stat
          className="flex-1"
          label={t('timeoff.requests.youre_off', 'You’re off')}
          icon={<Icon icon={leaveIcon(CATEGORY_ICON[request.category])} />}
          value={longSpan(request.span.from, request.span.to)}
          description={days(request.workingDays)}
        />
        <Stat
          className="flex-1"
          label={t('timeoff.requests.back_at_work', 'Back at work')}
          value={shortDate(nextWorkingDay(request.span.to))}
        />
      </View>
      {detail.canAnswer && detail.proposals.length > 0 ? (
        <Card>
          <Stack gap={2}>
            <Text variant="headline">
              {t('timeoff.requests.suggested_other_dates', '{{capital}} suggested other dates', {
                capital: capital(role(detail.chain[detail.step])),
              })}
            </Text>
            <Text variant="footnote" tone="muted">
              {t(
                'timeoff.requests.taking_one_approves_it_keeping_yours',
                'Taking one approves it. Keeping yours sends it back.',
              )}
            </Text>
            {detail.proposalMessage === null ? null : <Text>{detail.proposalMessage}</Text>}
            {detail.proposals.map((p) => (
              <Button
                key={p.index}
                variant="primary"
                loading={busy === 'AnswerSuggestedTimeOffDates'}
                onPress={() => {
                  void act(
                    'AnswerSuggestedTimeOffDates',
                    { requestId: request.requestId, input: { accept: p.index } },
                    t('timeoff.requests.dates_taken', 'Dates taken'),
                  ).then(reload);
                }}
              >
                {t('timeoff.requests.take', 'Take {{join}} · {{days}}', {
                  join: p.spans.map((r) => spanLabel(r.from, r.to)).join(' and '),
                  days: days(p.workingDays),
                })}
              </Button>
            ))}
            <Button
              variant="ghost"
              onPress={() => {
                void act(
                  'AnswerSuggestedTimeOffDates',
                  { requestId: request.requestId, input: { accept: null } },
                  t('timeoff.requests.kept_your_dates', 'Kept your dates'),
                ).then(reload);
              }}
            >
              {t('timeoff.requests.keep_my_dates', 'Keep my dates')}
            </Button>
          </Stack>
        </Card>
      ) : null}
      <Timeline>
        {items.map(({ id, ...item }, i) => (
          <TimelineItem key={id} {...item} last={i === items.length - 1} />
        ))}
      </Timeline>
      {detail.note === null ? null : <Text tone="muted">{detail.note}</Text>}
      {detail.noteNeeded === true ? (
        <NoteNeeded requestId={request.requestId} personId={request.personId} onDone={reload} />
      ) : detail.notePresent === true ? (
        <Text tone="muted">{t('timeoff.requests.a_note_is_attached', 'A note is attached.')}</Text>
      ) : null}
      {detail.canChange ? (
        <View className="flex-row gap-2">
          <Button
            className="flex-1"
            startIcon={<Icon icon={CalendarIcon} />}
            onPress={() => {
              setDialog('move');
            }}
          >
            {t('timeoff.requests.change_dates', 'Change dates')}
          </Button>
          {request.status === 'approved' ? (
            <Button
              className="flex-1"
              onPress={() => {
                setDialog('shorten');
              }}
            >
              {t('timeoff.requests.shorten', 'Shorten')}
            </Button>
          ) : null}
        </View>
      ) : null}
      {detail.canCancel ? (
        <Button
          variant="danger-soft"
          onPress={() => {
            setDialog('cancel');
          }}
        >
          {request.status === 'approved'
            ? t('timeoff.requests.cancel_request', 'Cancel request')
            : t('timeoff.requests.withdraw_request', 'Withdraw request')}
        </Button>
      ) : null}
      {dialog === null ? null : (
        <ChangeDialog
          detail={detail}
          kind={dialog}
          onClose={() => {
            setDialog(null);
          }}
          onDone={() => {
            setDialog(null);
            reload();
          }}
        />
      )}
    </Page>
  );
}

function ChangeDialog({
  detail,
  kind,
  onClose,
  onDone,
}: {
  detail: Detail;
  kind: 'move' | 'shorten' | 'cancel';
  onClose: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const { act, busy } = useAct('timeoff');
  const { request } = detail;
  const [range, setRange] = useState<DateRange>({ start: null, end: null });
  const [last, setLast] = useState<string | null>(null);
  const approved = request.status === 'approved';
  const label = spanLabel(request.span.from, request.span.to);
  const run = (operation: string, variables: Record<string, unknown>, done: string): void => {
    void act(operation, variables, done).then((r) => {
      if (r !== null) onDone();
    });
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {kind === 'cancel'
              ? approved
                ? t('timeoff.requests.cancel', 'Cancel {{label}}?', { label })
                : t('timeoff.requests.withdraw', 'Withdraw {{label}}?', { label })
              : kind === 'move'
                ? t('timeoff.requests.new_dates', 'New dates')
                : t('timeoff.requests.new_last_day', 'New last day')}
          </DialogTitle>
          <DialogDescription>
            {kind === 'cancel'
              ? t(
                  'timeoff.requests.the_days_go_back_to_your',
                  'The {{amount}} days go back to your balance.',
                  { amount: amount(request.workingDays) },
                )
              : kind === 'move'
                ? approved
                  ? t(
                      'timeoff.requests.your_old_dates_stay_booked_until',
                      'Your old dates stay booked until the new ones are approved.',
                    )
                  : t(
                      'timeoff.requests.it_goes_to_your_approver_again',
                      'It goes to your approver again with the new dates.',
                    )
                : t(
                    'timeoff.requests.the_days_after_it_go_back',
                    'The days after it go back to your balance.',
                  )}
          </DialogDescription>
        </DialogHeader>
        {kind === 'move' ? (
          <DialogBody>
            <Calendar
              mode="range"
              label={t('timeoff.requests.new_dates', 'New dates')}
              selected={range}
              onSelect={setRange}
            />
          </DialogBody>
        ) : kind === 'shorten' ? (
          <DialogBody>
            <DatePicker
              label={t('timeoff.requests.last_day', 'Last day')}
              size="sm"
              value={last}
              onChange={setLast}
              min={request.span.from}
              max={request.span.to}
            />
          </DialogBody>
        ) : null}
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            {t('timeoff.requests.keep_it', 'Keep it')}
          </Button>
          <Button
            className="flex-1"
            variant={kind === 'cancel' ? 'danger' : 'primary'}
            loading={busy !== null}
            disabled={
              kind === 'move'
                ? range.start === null || range.end === null
                : kind === 'shorten'
                  ? last === null
                  : false
            }
            onPress={() => {
              if (kind === 'cancel')
                run(
                  'CancelTimeOffRequest',
                  { requestId: request.requestId },
                  approved ? 'Cancelled' : 'Withdrawn',
                );
              else if (kind === 'move' && range.start !== null && range.end !== null)
                run(
                  'ChangeTimeOffRequest',
                  {
                    requestId: request.requestId,
                    input: {
                      span: {
                        from: range.start,
                        to: range.end,
                        startsHalfDay: false,
                        endsHalfDay: false,
                      },
                    },
                  },
                  t('timeoff.requests.change_sent', 'Change sent'),
                );
              else if (kind === 'shorten' && last !== null)
                run(
                  'ShortenTimeOffRequest',
                  { requestId: request.requestId, input: { to: last } },
                  'Shortened',
                );
            }}
          >
            {kind === 'cancel'
              ? approved
                ? t('timeoff.requests.cancel_request', 'Cancel request')
                : t('timeoff.requests.withdraw_2', 'Withdraw')
              : kind === 'move'
                ? t('timeoff.requests.send_the_change', 'Send the change')
                : t('timeoff.requests.shorten', 'Shorten')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Change or cancel, in one centred modal (design v3 T4): each choice says
 * what happens to the balance before it is chosen. Moving opens the
 * calendar in the same modal.
 */
export function ChangeOrCancel({
  requestId,
  left,
  onClose,
  onDone,
}: {
  requestId: string;
  /** What the balance holds now, to say what each choice leaves. */
  left: string | null;
  onClose: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const { load } = useTimeOff<Detail>('TimeOffRequest', { requestId });
  const { act, busy } = useAct('timeoff');
  const [choice, setChoice] = useState<'move' | 'shorten' | 'cancel'>('cancel');
  const [range, setRange] = useState<DateRange>({ start: null, end: null });
  if (load.status !== 'ready') {
    return (
      <Dialog
        open
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
      >
        <DialogContent>
          <DialogBody>
            {load.status === 'error' ? (
              <Text tone="muted">{load.message}</Text>
            ) : (
              <Loading label={t('timeoff.requests.loading_the_request', 'Loading the request')} />
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
    );
  }
  const { request } = load.data;
  const approved = request.status === 'approved';
  const span = spanLabel(request.span.from, request.span.to);
  const one = request.span.from === request.span.to;
  const lastKept = one ? null : addDays(request.span.to, -1);
  const after = (back: number): string | null =>
    left === null ? null : `${amount(String(Number(left) + back))} days left after`;
  const approver = load.data.chain[0] ?? 'your approver';
  const run = (operation: string, variables: Record<string, unknown>, done: string): void => {
    void act(operation, variables, done).then((r) => {
      if (r !== null) onDone();
    });
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`${span} · ${request.leaveTypeName}`}</DialogTitle>
          <DialogDescription>{statusOf(request.status).label}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <RadioGroup
            accessibilityLabel={t('timeoff.requests.what_to_do', 'What to do')}
            value={choice}
            onValueChange={(v) => {
              setChoice(v === 'move' ? 'move' : v === 'shorten' ? 'shorten' : 'cancel');
            }}
          >
            {load.data.canChange ? (
              <RadioCard
                value="move"
                description={t(
                  'timeoff.requests.is_asked_again',
                  '{{approver}} is asked again.{{value}}',
                  { approver, value: approved ? ' These dates stay booked until then.' : '' },
                )}
              >
                {t('timeoff.requests.move_the_dates', 'Move the dates')}
              </RadioCard>
            ) : null}
            {load.data.canChange && lastKept !== null ? (
              <RadioCard
                value="shorten"
                description={t(
                  'timeoff.requests.keep_until_and_give_back',
                  'Keep until {{shortDate}} and give back {{shortDate2}}.',
                  { shortDate: shortDate(lastKept), shortDate2: shortDate(request.span.to) },
                )}
                {...(after(1) === null ? {} : { impact: after(1) ?? '' })}
              >
                {t('timeoff.requests.shorten_it', 'Shorten it')}
              </RadioCard>
            ) : null}
            {load.data.canCancel ? (
              <RadioCard
                value="cancel"
                description={t(
                  'timeoff.requests.back_to_your_balance_straight_away',
                  '{{value}} back to your balance straight away.',
                  { value: one ? 'The day goes' : 'The days go' },
                )}
                {...(after(Number(request.workingDays)) === null
                  ? {}
                  : { impact: after(Number(request.workingDays)) ?? '' })}
              >
                {approved
                  ? t('timeoff.requests.cancel_it', 'Cancel it')
                  : t('timeoff.requests.withdraw_it', 'Withdraw it')}
              </RadioCard>
            ) : null}
          </RadioGroup>
          {choice === 'move' ? (
            <Calendar
              mode="range"
              label={t('timeoff.requests.new_dates', 'New dates')}
              selected={range}
              onSelect={setRange}
            />
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            {t('timeoff.requests.keep_it', 'Keep it')}
          </Button>
          <Button
            className="flex-1"
            variant={choice === 'cancel' ? 'danger' : 'primary'}
            loading={busy !== null}
            disabled={choice === 'move' && (range.start === null || range.end === null)}
            onPress={() => {
              if (choice === 'cancel')
                run('CancelTimeOffRequest', { requestId }, approved ? 'Cancelled' : 'Withdrawn');
              else if (choice === 'shorten' && lastKept !== null)
                run('ShortenTimeOffRequest', { requestId, input: { to: lastKept } }, 'Shortened');
              else if (range.start !== null && range.end !== null)
                run(
                  'ChangeTimeOffRequest',
                  {
                    requestId,
                    input: {
                      span: {
                        from: range.start,
                        to: range.end,
                        startsHalfDay: false,
                        endsHalfDay: false,
                      },
                    },
                  },
                  t('timeoff.requests.change_sent', 'Change sent'),
                );
            }}
          >
            {choice === 'cancel'
              ? approved
                ? t('timeoff.requests.cancel_time_off', 'Cancel time off')
                : t('timeoff.requests.withdraw_2', 'Withdraw')
              : choice === 'shorten'
                ? t('timeoff.requests.shorten', 'Shorten')
                : t('timeoff.requests.send_the_change', 'Send the change')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
