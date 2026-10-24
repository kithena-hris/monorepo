import {
  Alert,
  AssistantMark,
  Avatar,
  Badge,
  Button,
  Calendar,
  Card,
  Combobox,
  DatePicker,
  type DateRange,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldLabel,
  Icon,
  List,
  ListItem,
  RadioCard,
  RadioGroup,
  SegmentedControl,
  SegmentedControlItem,
  Stack,
  Switch,
  Text,
  Textarea,
  TimelineChart,
} from '@reach/ui-native';
import { dateFormat } from '@reach/ui-native/words';
import {
  Check,
  CheckCheck,
  Eye,
  Inbox as InboxIcon,
  Sparkles,
  UserRoundCog,
  X,
} from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Failed, Loading, Page } from '../frame';
import { useAct } from '../people/act';
import type { PeopleScreen } from '../people/routes';
import { useTimeOff } from './api';
import { todayHere } from './time';
import { addDays, amount, asDate, days, shortDate, spanLabel, statusOf } from './words';
import { t } from '../i18n';

interface Item {
  readonly requestId: string;
  readonly personId: string;
  readonly displayName: string;
  readonly leaveTypeKey: string;
  readonly leaveTypeName: string;
  readonly category: string;
  readonly status: string;
  readonly span: { from: string; to: string; startsHalfDay: boolean; endsHalfDay: boolean };
  readonly workingDays: string;
  readonly requestedAt: string;
}

interface Reason {
  readonly rule: string;
  readonly amount: string | null;
  readonly days: readonly string[];
}

interface Approvals {
  readonly tab: string;
  readonly clear: readonly Item[];
  readonly lookCloser: readonly { item: Item; reason: Reason }[];
  readonly items: readonly Item[];
  readonly why: readonly { requestId: string; text: { text: string; ai: boolean } }[];
  readonly next: string | null;
}

/** Why a request is in Look closer, in a manager's words. */
function closer(r: Reason): string {
  switch (r.rule) {
    case 'below_zero':
      return `Goes ${amount(r.amount ?? '0')} days below zero`;
    case 'over_banked':
      return `${amount(r.amount ?? '0')} hours more than banked`;
    case 'below_minimum':
      return r.days.length === 0
        ? 'Team below its minimum'
        : `Team below its minimum on ${r.days.map(shortDate).join(', ')}`;
    case 'protected_period':
      return 'In a protected period';
    case 'sick_over_threshold':
      return `${amount(r.amount ?? '0')} sick days, past the threshold`;
    default:
      return r.rule;
  }
}

/**
 * Approvals (design MT15): waiting for you in the same two groups as on the
 * web — clear to approve, a single tap for all of them, and look closer, one
 * at a time — then what is coming up and what you decided.
 */
export function TimeOffApprovals({
  navigation,
}: PeopleScreen<'TimeOffApprovals'>): React.JSX.Element {
  const [tab, setTab] = useState<'waiting' | 'coming_up' | 'decided'>('waiting');
  const { load, reload } = useTimeOff<Approvals>('TimeOffApprovals', { tab });
  const { act, busy } = useAct('timeoff');
  const open = (item: Item): void => {
    navigation.navigate('TimeOffDecision', { requestId: item.requestId, name: item.displayName });
  };
  const row = (item: Item, why?: string): React.JSX.Element => (
    <ListItem
      key={item.requestId}
      leading={<Avatar name={item.displayName} size={40} />}
      description={[`${item.leaveTypeName} · ${spanLabel(item.span.from, item.span.to)}`, why]
        .filter(Boolean)
        .join('\n')}
      chevron
      onPress={() => {
        open(item);
      }}
    >
      {item.displayName}
    </ListItem>
  );
  return (
    <Page
      title={t('timeoff.approvals.time_off_to_approve', 'Time off to approve')}
      back={{ label: t('timeoff.approvals.back', 'Back'), onPress: navigation.goBack }}
      trailing={
        <Button
          size="sm"
          variant="ghost"
          startIcon={<Icon icon={UserRoundCog} />}
          accessibilityLabel={t(
            'timeoff.approvals.who_approves_while_you_are_away',
            'Who approves while you are away',
          )}
          onPress={() => {
            navigation.navigate('TimeOffDelegation');
          }}
        />
      }
    >
      <SegmentedControl
        fullWidth
        value={tab}
        accessibilityLabel={t('timeoff.approvals.which_requests', 'Which requests')}
        onValueChange={(v) => {
          setTab(v === 'coming_up' ? 'coming_up' : v === 'decided' ? 'decided' : 'waiting');
        }}
      >
        <SegmentedControlItem value="waiting">
          {t('timeoff.approvals.to_do', 'To do')}
        </SegmentedControlItem>
        <SegmentedControlItem value="coming_up">
          {t('timeoff.approvals.coming_up', 'Coming up')}
        </SegmentedControlItem>
        <SegmentedControlItem value="decided">
          {t('timeoff.approvals.decided', 'Decided')}
        </SegmentedControlItem>
      </SegmentedControl>
      {load.status === 'error' ? (
        <Failed message={load.message} onRetry={reload} />
      ) : load.status === 'loading' ? (
        <Loading label={t('timeoff.approvals.loading_the_requests', 'Loading the requests')} />
      ) : tab === 'waiting' ? (
        load.data.clear.length === 0 && load.data.lookCloser.length === 0 ? (
          <EmptyState
            icon={InboxIcon}
            title={t('timeoff.approvals.nothing_waiting', 'Nothing waiting')}
            description={t(
              'timeoff.approvals.new_requests_from_your_team_come',
              'New requests from your team come here, sorted into what is clear and what needs a look.',
            )}
          />
        ) : (
          <>
            {load.data.clear.length === 0 ? null : (
              <>
                <View className="flex-row items-center gap-2 px-1">
                  <Icon icon={Sparkles} size={14} />
                  <Text variant="footnote" weight="semibold" className="flex-1">
                    {t('timeoff.approvals.clear_to_approve', 'Clear to approve · {{String}}', {
                      String: String(load.data.clear.length),
                    })}
                  </Text>
                  <Button
                    size="sm"
                    variant="primary"
                    startIcon={<Icon icon={CheckCheck} />}
                    loading={busy === 'ApproveTimeOffRequests'}
                    onPress={() => {
                      void act<{ refused: unknown[] }>(
                        'ApproveTimeOffRequests',
                        { input: { requestIds: load.data.clear.map((i) => i.requestId) } },
                        (d) =>
                          d.refused.length === 0
                            ? 'Approved'
                            : t(
                                'timeoff.approvals.need_a_closer_look_and',
                                {
                                  one: '{{count}} needs a closer look and was not approved',
                                  other: '{{count}} need a closer look and were not approved',
                                },
                                { count: d.refused.length },
                              ),
                      ).then(reload);
                    }}
                  >
                    {t('timeoff.approvals.approve', 'Approve {{String}}', {
                      String: String(load.data.clear.length),
                    })}
                  </Button>
                </View>
                <List>
                  {load.data.clear.map((i) =>
                    row(i, load.data.why.find((w) => w.requestId === i.requestId)?.text.text),
                  )}
                </List>
              </>
            )}
            {load.data.lookCloser.length === 0 ? null : (
              <>
                <View className="flex-row items-center gap-2 px-1">
                  <Icon icon={Eye} size={14} />
                  <Text variant="footnote" weight="semibold">
                    {t('timeoff.approvals.look_closer', 'Look closer · {{String}}', {
                      String: String(load.data.lookCloser.length),
                    })}
                  </Text>
                </View>
                <List>{load.data.lookCloser.map((l) => row(l.item, closer(l.reason)))}</List>
              </>
            )}
          </>
        )
      ) : load.data.items.length === 0 ? (
        <EmptyState
          icon={InboxIcon}
          title={
            tab === 'coming_up'
              ? t(
                  'timeoff.approvals.nothing_approved_is_coming_up',
                  'Nothing approved is coming up',
                )
              : t('timeoff.approvals.nothing_decided_yet', 'Nothing decided yet')
          }
          description={t(
            'timeoff.approvals.requests_you_approve_show_up_here',
            'Requests you approve show up here.',
          )}
        />
      ) : (
        <List>
          {load.data.items.map((i) => {
            const status = statusOf(i.status);
            return (
              <ListItem
                key={i.requestId}
                leading={<Avatar name={i.displayName} size={40} />}
                description={`${i.leaveTypeName} · ${spanLabel(i.span.from, i.span.to)} · ${days(i.workingDays)}`}
                trailing={
                  <Badge size="sm" tone={status.tone}>
                    {status.label}
                  </Badge>
                }
              >
                {i.displayName}
              </ListItem>
            );
          })}
        </List>
      )}
    </Page>
  );
}

interface Alternative {
  readonly kind: string;
  readonly affects: string;
  readonly spans: readonly { from: string; to: string }[];
  readonly swapped: { out: readonly string[]; in: readonly string[] } | null;
  readonly teammate: { personId: string; displayName: string } | null;
  readonly message: { text: string; ai: boolean } | null;
}

interface Decision {
  readonly request: Item;
  readonly member: {
    personId: string;
    displayName: string;
    firstName: string;
    teamKey: string | null;
  };
  readonly balance: { before: string; after: string } | null;
  readonly belowMinimum: readonly { date: string; in: number; of: number; required: number }[];
  readonly triage: { group: string; reason: Reason | null };
  readonly othersOff: readonly {
    personId: string;
    displayName: string;
    leaveTypeKey: string | null;
    span: { from: string; to: string };
  }[];
  readonly canDecide: boolean;
  readonly lastTaken: { from: string; to: string } | null;
  readonly alternatives: readonly Alternative[];
  readonly whatToKnow: { text: string; ai: boolean };
  readonly clash: { text: string; ai: boolean } | null;
}

const mondayOf = (date: string): string => {
  const day = asDate(date).getUTCDay();
  return addDays(date, day === 0 ? -6 : 1 - day);
};

/**
 * Deciding on the go (design MT16): the request, the balance before and
 * after, the team that week, what to know, and a suggested swap the
 * requester can take in one tap — Decline, Suggest, Approve in thumb reach.
 */
export function TimeOffDecision({
  navigation,
  route,
}: PeopleScreen<'TimeOffDecision'>): React.JSX.Element {
  const { load, reload } = useTimeOff<Decision>('TimeOffRequestDecision', {
    requestId: route.params.requestId,
  });
  const { act, busy } = useAct('timeoff');
  const [suggesting, setSuggesting] = useState(false);
  const back = { label: t('timeoff.approvals.approvals', 'Approvals'), onPress: navigation.goBack };
  if (load.status !== 'ready') {
    return (
      <Page title={route.params.name} back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label={t('timeoff.approvals.loading_the_request', 'Loading the request')} />
        )}
      </Page>
    );
  }
  const d = load.data;
  const r = d.request;
  const monday = mondayOf(r.span.from);
  const swap = d.alternatives.find((a) => a.affects === 'requester' && a.spans.length > 0);
  const decide = (decision: 'approve' | 'decline'): void => {
    void act(
      'DecideTimeOffRequest',
      { requestId: r.requestId, input: { decision } },
      decision === 'approve' ? 'Approved' : 'Declined',
    ).then((done) => {
      if (done !== null) navigation.goBack();
    });
  };
  return (
    <Page
      title={route.params.name}
      back={back}
      {...(d.canDecide
        ? {
            foot: (
              <>
                <Button
                  startIcon={<Icon icon={X} />}
                  accessibilityLabel={t('timeoff.approvals.decline', 'Decline')}
                  loading={busy === 'DecideTimeOffRequest'}
                  onPress={() => {
                    decide('decline');
                  }}
                />
                <Button
                  className="flex-1"
                  onPress={() => {
                    setSuggesting(true);
                  }}
                >
                  {swap === undefined
                    ? t('timeoff.approvals.suggest_dates', 'Suggest dates')
                    : t('timeoff.approvals.suggest_swap', 'Suggest swap')}
                </Button>
                <Button
                  className="flex-1"
                  variant="primary"
                  startIcon={<Icon icon={Check} />}
                  loading={busy === 'DecideTimeOffRequest'}
                  onPress={() => {
                    decide('approve');
                  }}
                >
                  {t('timeoff.approvals.approve_2', 'Approve')}
                </Button>
              </>
            ),
          }
        : {})}
    >
      <ListItem
        listitem={false}
        leading={<Avatar name={r.displayName} size={48} />}
        description={`${spanLabel(r.span.from, r.span.to)} · ${days(r.workingDays)}${d.balance === null ? '' : ` · ${amount(d.balance.before)} → ${amount(d.balance.after)} left`}`}
      >
        {r.leaveTypeName}
      </ListItem>
      {d.lastTaken === null ? null : (
        <Text variant="footnote" tone="muted">
          {t('timeoff.approvals.last_time_off', 'Last time off: {{spanLabel}}', {
            spanLabel: spanLabel(d.lastTaken.from, d.lastTaken.to),
          })}
        </Text>
      )}
      <TimelineChart
        label={t('timeoff.approvals.the_team_that_week', 'The team that week')}
        domain={{ start: monday, end: addDays(monday, 4) }}
        unit="day"
        today={todayHere()}
        shadeWeekends={false}
        labelWidth={96}
        rows={[
          {
            label: r.displayName,
            items: [
              {
                id: 'asked',
                label: r.leaveTypeName,
                start: r.span.from,
                end: r.span.to,
                tone: 'accent',
                tentative: true,
              },
            ],
          },
          ...d.othersOff.map((o) => ({
            label: o.displayName,
            items: [
              {
                id: `${o.personId}${o.span.from}`,
                label: t('timeoff.approvals.off', 'Off'),
                start: o.span.from,
                end: o.span.to,
                tone: 'neutral' as const,
              },
            ],
          })),
        ]}
      />
      {d.belowMinimum.map((c) => (
        <Alert
          key={c.date}
          tone="warning"
          title={t('timeoff.approvals.of_in', '{{shortDate}}: {{String}} of {{String2}} in', {
            shortDate: shortDate(c.date),
            String: String(c.in),
            String2: String(c.of),
          })}
        >
          {t(
            'timeoff.approvals.the_team_asks_for_at_least',
            'The team asks for at least {{String}}.',
            { String: String(c.required) },
          )}
        </Alert>
      ))}
      <Card>
        <Stack gap={2}>
          <View className="flex-row items-center gap-2">
            <AssistantMark size={20} />
            <Text variant="headline" className="flex-1">
              {t('timeoff.approvals.what_to_know', 'What to know')}
            </Text>
            {d.whatToKnow.ai ? <Badge size="sm">{t('timeoff.approvals.ai', 'AI')}</Badge> : null}
          </View>
          {d.triage.reason === null ? null : (
            <Text weight="semibold">{closer(d.triage.reason)}</Text>
          )}
          {d.clash === null ? null : <Text>{d.clash.text}</Text>}
          <Text>{d.whatToKnow.text}</Text>
        </Stack>
      </Card>
      {swap === undefined ? null : (
        <Text variant="subhead">
          {t(
            'timeoff.approvals.suggest_can_accept_in_one_tap',
            'Suggest: {{value}}. {{firstName}} can accept in one tap.',
            {
              value:
                swap.swapped === null
                  ? spanLabel(swap.spans[0]?.from ?? '', swap.spans.at(-1)?.to ?? '')
                  : `swap ${swap.swapped.out.map(shortDate).join(', ')} for ${swap.swapped.in.map(shortDate).join(', ')}`,
              firstName: d.member.firstName,
            },
          )}
        </Text>
      )}
      {suggesting ? (
        <SuggestDialog
          requestId={r.requestId}
          name={d.member.firstName}
          swap={swap}
          onClose={() => {
            setSuggesting(false);
          }}
          onSent={() => {
            setSuggesting(false);
            navigation.goBack();
          }}
        />
      ) : null}
    </Page>
  );
}

/** Other dates, to take in one tap: the domain's swap, or dates the manager picks. */
function SuggestDialog({
  requestId,
  name,
  swap,
  onClose,
  onSent,
}: {
  requestId: string;
  name: string;
  swap: Alternative | undefined;
  onClose: () => void;
  onSent: () => void;
}): React.JSX.Element {
  const { act, busy } = useAct('timeoff');
  const [own, setOwn] = useState(swap === undefined);
  const [range, setRange] = useState<DateRange>({ start: null, end: null });
  const [message, setMessage] = useState(swap?.message?.text ?? '');
  const spans = own
    ? range.start === null || range.end === null
      ? []
      : [{ from: range.start, to: range.end }]
    : (swap?.spans ?? []);
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
            {t('timeoff.approvals.suggest_dates_to', 'Suggest dates to {{name}}', { name })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'timeoff.approvals.they_can_take_them_in_one',
              'They can take them in one tap, or keep theirs and it comes back to you.',
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {swap === undefined ? null : (
            <SegmentedControl
              fullWidth
              size="sm"
              value={own ? 'own' : 'swap'}
              accessibilityLabel={t('timeoff.approvals.which_dates', 'Which dates')}
              onValueChange={(v) => {
                setOwn(v === 'own');
              }}
            >
              <SegmentedControlItem value="swap">
                {t('timeoff.approvals.the_swap', 'The swap')}
              </SegmentedControlItem>
              <SegmentedControlItem value="own">
                {t('timeoff.approvals.other_dates', 'Other dates')}
              </SegmentedControlItem>
            </SegmentedControl>
          )}
          {own ? (
            <Calendar
              mode="range"
              label={t('timeoff.approvals.dates_to_suggest', 'Dates to suggest')}
              selected={range}
              onSelect={setRange}
            />
          ) : (
            <Text weight="semibold">
              {(swap?.spans ?? []).map((s) => spanLabel(s.from, s.to)).join(' and ')}
            </Text>
          )}
          <Field>
            <FieldLabel>{t('timeoff.approvals.message_optional', 'Message (optional)')}</FieldLabel>
            <Textarea value={message} onChange={setMessage} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            {t('timeoff.approvals.cancel', 'Cancel')}
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            disabled={spans.length === 0}
            loading={busy === 'SuggestTimeOffDates'}
            onPress={() => {
              void act(
                'SuggestTimeOffDates',
                {
                  requestId,
                  input: {
                    proposals: [{ spans }],
                    message: message.trim() === '' ? null : message.trim(),
                  },
                },
                'Suggested',
              ).then((done) => {
                if (done !== null) onSent();
              });
            }}
          >
            {t('timeoff.approvals.send', 'Send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface Delegation {
  readonly approverId: string;
  readonly candidates: readonly { personId: string; displayName: string }[];
  readonly delegation: {
    delegateId: string;
    delegateName: string;
    automatic: boolean;
    salaryRelated: boolean;
    range: { from: string; to: string } | null;
  } | null;
  readonly coveringFor: readonly {
    approverId: string;
    approverName: string;
    automatic: boolean;
    range: { from: string; to: string } | null;
  }[];
  readonly escalatesTo: { personId: string; displayName: string } | null;
}

/** Who approves while you are away, from when to when, and who you cover for. */
export function TimeOffDelegation({
  navigation,
}: PeopleScreen<'TimeOffDelegation'>): React.JSX.Element {
  const { load, reload } = useTimeOff<Delegation>('TimeOffDelegation');
  const { act, busy } = useAct('timeoff');
  const [delegate, setDelegate] = useState<string | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [automatic, setAutomatic] = useState(false);
  const [salary, setSalary] = useState(false);
  const back = { label: t('timeoff.approvals.approvals', 'Approvals'), onPress: navigation.goBack };
  if (load.status !== 'ready') {
    return (
      <Page title={t('timeoff.approvals.while_youre_away', 'While you’re away')} back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label={t('timeoff.approvals.loading', 'Loading')} />
        )}
      </Page>
    );
  }
  const d = load.data;
  return (
    <Page title={t('timeoff.approvals.while_youre_away', 'While you’re away')} back={back}>
      {d.delegation === null ? (
        <>
          <Text tone="muted">
            {t(
              'timeoff.approvals.somebody_approves_for_you_while_you',
              'Somebody approves for you while you are away; every decision says it was on your behalf.',
            )}
          </Text>
          <Field>
            <FieldLabel>
              {t('timeoff.approvals.who_approves_for_you', 'Who approves for you')}
            </FieldLabel>
            <Combobox
              label={t('timeoff.approvals.who_approves_for_you', 'Who approves for you')}
              size="sm"
              options={d.candidates.map((c) => ({ value: c.personId, label: c.displayName }))}
              value={delegate}
              onChange={(v) => {
                setDelegate(typeof v === 'string' ? v : null);
              }}
            />
          </Field>
          <ListItem
            listitem={false}
            description={t(
              'timeoff.approvals.whenever_you_are_off_without_setting',
              'Whenever you are off, without setting dates.',
            )}
            trailing={
              <Switch
                checked={automatic}
                accessibilityLabel={t(
                  'timeoff.approvals.automatically_while_im_off',
                  'Automatically while I’m off',
                )}
                onCheckedChange={setAutomatic}
              />
            }
          >
            {t('timeoff.approvals.automatically_while_im_off', 'Automatically while I’m off')}
          </ListItem>
          {automatic ? null : (
            <View className="flex-row gap-2">
              <View className="flex-1">
                <DatePicker
                  label={t('timeoff.approvals.from', 'From')}
                  size="sm"
                  value={from}
                  onChange={setFrom}
                />
              </View>
              <View className="flex-1">
                <DatePicker
                  label={t('timeoff.approvals.to', 'To')}
                  size="sm"
                  value={to}
                  onChange={setTo}
                />
              </View>
            </View>
          )}
          <ListItem
            listitem={false}
            description={t(
              'timeoff.approvals.overtime_paid_out_and_comp_time',
              'Overtime paid out and comp time: decisions that touch pay.',
            )}
            trailing={
              <Switch
                checked={salary}
                accessibilityLabel={t(
                  'timeoff.approvals.include_decisions_that_touch_pay',
                  'Include decisions that touch pay',
                )}
                onCheckedChange={setSalary}
              />
            }
          >
            {t(
              'timeoff.approvals.include_decisions_that_touch_pay',
              'Include decisions that touch pay',
            )}
          </ListItem>
          <Button
            variant="primary"
            disabled={delegate === null || (!automatic && (from === null || to === null))}
            loading={busy === 'SetTimeOffDelegation'}
            onPress={() => {
              if (delegate === null) return;
              void act(
                'SetTimeOffDelegation',
                {
                  approverId: d.approverId,
                  input: {
                    delegateId: delegate,
                    range: automatic || from === null || to === null ? null : { from, to },
                    automatic,
                    salaryRelated: salary,
                  },
                },
                'Delegated',
              ).then(reload);
            }}
          >
            {t('timeoff.approvals.delegate', 'Delegate')}
          </Button>
        </>
      ) : (
        <Card>
          <Stack gap={2}>
            <Text variant="headline">
              {t('timeoff.approvals.approves_for_you', '{{delegateName}} approves for you', {
                delegateName: d.delegation.delegateName,
              })}
            </Text>
            <Text tone="muted">
              {[
                d.delegation.automatic
                  ? t('timeoff.approvals.whenever_you_are_off', 'Whenever you are off')
                  : d.delegation.range === null
                    ? null
                    : spanLabel(d.delegation.range.from, d.delegation.range.to),
                d.delegation.salaryRelated ? 'including pay' : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            <Button
              variant="danger-soft"
              loading={busy === 'RemoveTimeOffDelegation'}
              onPress={() => {
                void act(
                  'RemoveTimeOffDelegation',
                  { approverId: d.approverId },
                  t('timeoff.approvals.delegation_ended', 'Delegation ended'),
                ).then(reload);
              }}
            >
              {t('timeoff.approvals.end_it', 'End it')}
            </Button>
          </Stack>
        </Card>
      )}
      {d.escalatesTo === null ? null : (
        <Text variant="footnote" tone="muted">
          {t(
            'timeoff.approvals.anything_nobody_answers_in_time_goes',
            'Anything nobody answers in time goes to {{displayName}}.',
            { displayName: d.escalatesTo.displayName },
          )}
        </Text>
      )}
      {d.coveringFor.length === 0 ? null : (
        <>
          <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
            {t('timeoff.approvals.you_approve_for', 'You approve for')}
          </Text>
          <List>
            {d.coveringFor.map((c) => (
              <ListItem
                key={c.approverId}
                leading={<Avatar name={c.approverName} size={36} />}
                description={
                  c.automatic
                    ? t('timeoff.approvals.whenever_they_are_off', 'Whenever they are off')
                    : c.range === null
                      ? ''
                      : spanLabel(c.range.from, c.range.to)
                }
              >
                {c.approverName}
              </ListItem>
            ))}
          </List>
        </>
      )}
    </Page>
  );
}

const dayName = dateFormat({
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/**
 * Solving a clash (design v3 T9): instead of a bare decline, the ways to keep
 * the team in, each with its cost spelled out. Time Off works out the swaps;
 * the requester takes one in a tap. Approving anyway stays a choice.
 */
export function ClashDialog({
  requestId,
  onClose,
  onDone,
}: {
  requestId: string;
  onClose: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const { load } = useTimeOff<Decision>('TimeOffRequestDecision', { requestId });
  const { act, busy } = useAct('timeoff');
  const [choice, setChoice] = useState<string>('0');
  if (load.status !== 'ready')
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
              <Loading
                label={t('timeoff.approvals.working_out_the_options', 'Working out the options')}
              />
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
    );
  const d = load.data;
  const short = d.belowMinimum[0];
  const ways = d.alternatives.filter((a) => a.affects === 'requester' && a.spans.length > 0);
  const name = d.member.firstName;
  const words = (a: Alternative): string =>
    a.swapped === null
      ? `Suggest ${a.spans.map((s) => spanLabel(s.from, s.to)).join(' and ')}`
      : t('timeoff.approvals.ask_to_swap_for', 'Ask {{name}} to swap {{join}} for {{join2}}', {
          name,
          join: a.swapped.out.map((x) => dayName.format(asDate(x))).join(', '),
          join2: a.swapped.in.map((x) => dayName.format(asDate(x))).join(', '),
        });
  const picked = choice === 'approve' ? null : ways[Number(choice)];
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
            {short === undefined
              ? `${name}’s ${spanLabel(d.request.span.from, d.request.span.to)}`
              : t('timeoff.approvals.would_be_short', '{{format}} would be short', {
                  format: dayName.format(asDate(short.date)),
                })}
          </DialogTitle>
          {short === undefined ? null : (
            <DialogDescription>
              {t(
                'timeoff.approvals.to_decide_the_team_asks_for',
                '{{value}} to decide. The team asks for at least {{String}} in.',
                {
                  value: ways.length === 0 ? 'One way' : `${String(ways.length + 1)} ways`,
                  String: String(short.required),
                },
              )}
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogBody>
          <RadioGroup
            accessibilityLabel={t('timeoff.approvals.what_to_do', 'What to do')}
            value={choice}
            onValueChange={setChoice}
          >
            {ways.map((a, i) => (
              <RadioCard
                key={`${a.kind}${String(i)}`}
                value={String(i)}
                {...(i === 0
                  ? {
                      badge: (
                        <Badge size="sm" tone="accent" icon={Sparkles}>
                          {t('timeoff.approvals.suggested', 'Suggested')}
                        </Badge>
                      ),
                    }
                  : {})}
                {...(a.message === null ? {} : { description: a.message.text })}
                impact={
                  a.swapped === null
                    ? `${days(String(a.spans.reduce((n, s) => n + (Date.parse(s.to) - Date.parse(s.from)) / 86_400_000 + 1, 0)))} instead`
                    : 'Keeps the team at its minimum'
                }
              >
                {words(a)}
              </RadioCard>
            ))}
            <RadioCard
              value="approve"
              description={
                short === undefined
                  ? t('timeoff.approvals.as_asked', '{{days}} as asked.', {
                      days: days(d.request.workingDays),
                    })
                  : t('timeoff.approvals.of_in_on', '{{String}} of {{String2}} in on {{format}}.', {
                      String: String(short.in),
                      String2: String(short.of),
                      format: dayName.format(asDate(short.date)),
                    })
              }
              {...(short === undefined
                ? {}
                : { impact: t('timeoff.approvals.below_the_minimum', 'Below the minimum') })}
            >
              {t('timeoff.approvals.approve_anyway', 'Approve anyway')}
            </RadioCard>
          </RadioGroup>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            {t('timeoff.approvals.cancel', 'Cancel')}
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            loading={busy !== null}
            onPress={() => {
              if (picked === undefined || picked === null) {
                void act(
                  'DecideTimeOffRequest',
                  { requestId, input: { decision: 'approve' } },
                  'Approved',
                ).then((done) => {
                  if (done !== null) onDone();
                });
                return;
              }
              void act(
                'SuggestTimeOffDates',
                {
                  requestId,
                  input: {
                    proposals: [{ spans: picked.spans }],
                    message: picked.message?.text ?? null,
                  },
                },
                t('timeoff.approvals.sent_to', 'Sent to {{name}}', { name }),
              ).then((done) => {
                if (done !== null) onDone();
              });
            }}
          >
            {picked === undefined || picked === null
              ? t('timeoff.approvals.approve_2', 'Approve')
              : t('timeoff.approvals.send_to', 'Send to {{name}}', { name })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
