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
  SegmentedControl,
  SegmentedControlItem,
  Stack,
  Switch,
  Text,
  Textarea,
  TimelineChart,
  type DateRange,
} from '@reach/ui-native';
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
      title="Time off to approve"
      back={{ label: 'Back', onPress: navigation.goBack }}
      trailing={
        <Button
          size="sm"
          variant="ghost"
          startIcon={<Icon icon={UserRoundCog} />}
          accessibilityLabel="Who approves while you are away"
          onPress={() => {
            navigation.navigate('TimeOffDelegation');
          }}
        />
      }
    >
      <SegmentedControl
        fullWidth
        value={tab}
        accessibilityLabel="Which requests"
        onValueChange={(v) => {
          setTab(v === 'coming_up' ? 'coming_up' : v === 'decided' ? 'decided' : 'waiting');
        }}
      >
        <SegmentedControlItem value="waiting">To do</SegmentedControlItem>
        <SegmentedControlItem value="coming_up">Coming up</SegmentedControlItem>
        <SegmentedControlItem value="decided">Decided</SegmentedControlItem>
      </SegmentedControl>
      {load.status === 'error' ? (
        <Failed message={load.message} onRetry={reload} />
      ) : load.status === 'loading' ? (
        <Loading label="Loading the requests" />
      ) : tab === 'waiting' ? (
        load.data.clear.length === 0 && load.data.lookCloser.length === 0 ? (
          <EmptyState
            icon={InboxIcon}
            title="Nothing waiting"
            description="New requests from your team come here, sorted into what is clear and what needs a look."
          />
        ) : (
          <>
            {load.data.clear.length === 0 ? null : (
              <>
                <View className="flex-row items-center gap-2 px-1">
                  <Icon icon={Sparkles} size={14} />
                  <Text variant="footnote" weight="semibold" className="flex-1">
                    {`Clear to approve · ${String(load.data.clear.length)}`}
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
                            : `${String(d.refused.length)} ${d.refused.length === 1 ? 'needs' : 'need'} a closer look and ${d.refused.length === 1 ? 'was' : 'were'} not approved`,
                      ).then(reload);
                    }}
                  >
                    {`Approve ${String(load.data.clear.length)}`}
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
                    {`Look closer · ${String(load.data.lookCloser.length)}`}
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
          title={tab === 'coming_up' ? 'Nothing approved is coming up' : 'Nothing decided yet'}
          description="Requests you approve show up here."
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
  const back = { label: 'Approvals', onPress: navigation.goBack };
  if (load.status !== 'ready') {
    return (
      <Page title={route.params.name} back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label="Loading the request" />
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
                  accessibilityLabel="Decline"
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
                  {swap === undefined ? 'Suggest dates' : 'Suggest swap'}
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
                  Approve
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
        <Text
          variant="footnote"
          tone="muted"
        >{`Last time off: ${spanLabel(d.lastTaken.from, d.lastTaken.to)}`}</Text>
      )}
      <TimelineChart
        label="The team that week"
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
                label: 'Off',
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
          title={`${shortDate(c.date)}: ${String(c.in)} of ${String(c.of)} in`}
        >
          {`The team asks for at least ${String(c.required)}.`}
        </Alert>
      ))}
      <Card>
        <Stack gap={2}>
          <View className="flex-row items-center gap-2">
            <AssistantMark size={20} />
            <Text variant="headline" className="flex-1">
              What to know
            </Text>
            {d.whatToKnow.ai ? <Badge size="sm">AI</Badge> : null}
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
          {`Suggest: ${swap.swapped === null ? spanLabel(swap.spans[0]?.from ?? '', swap.spans.at(-1)?.to ?? '') : `swap ${swap.swapped.out.map(shortDate).join(', ')} for ${swap.swapped.in.map(shortDate).join(', ')}`}. ${d.member.firstName} can accept in one tap.`}
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
          <DialogTitle>{`Suggest dates to ${name}`}</DialogTitle>
          <DialogDescription>
            They can take them in one tap, or keep theirs and it comes back to you.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {swap === undefined ? null : (
            <SegmentedControl
              fullWidth
              size="sm"
              value={own ? 'own' : 'swap'}
              accessibilityLabel="Which dates"
              onValueChange={(v) => {
                setOwn(v === 'own');
              }}
            >
              <SegmentedControlItem value="swap">The swap</SegmentedControlItem>
              <SegmentedControlItem value="own">Other dates</SegmentedControlItem>
            </SegmentedControl>
          )}
          {own ? (
            <Calendar mode="range" label="Dates to suggest" selected={range} onSelect={setRange} />
          ) : (
            <Text weight="semibold">
              {(swap?.spans ?? []).map((s) => spanLabel(s.from, s.to)).join(' and ')}
            </Text>
          )}
          <Field>
            <FieldLabel>Message (optional)</FieldLabel>
            <Textarea value={message} onChange={setMessage} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            Cancel
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
            Send
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
  const back = { label: 'Approvals', onPress: navigation.goBack };
  if (load.status !== 'ready') {
    return (
      <Page title="While you’re away" back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label="Loading" />
        )}
      </Page>
    );
  }
  const d = load.data;
  return (
    <Page title="While you’re away" back={back}>
      {d.delegation === null ? (
        <>
          <Text tone="muted">
            Somebody approves for you while you are away; every decision says it was on your behalf.
          </Text>
          <Field>
            <FieldLabel>Who approves for you</FieldLabel>
            <Combobox
              label="Who approves for you"
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
            description="Whenever you are off, without setting dates."
            trailing={
              <Switch
                checked={automatic}
                accessibilityLabel="Automatically while I’m off"
                onCheckedChange={setAutomatic}
              />
            }
          >
            Automatically while I’m off
          </ListItem>
          {automatic ? null : (
            <View className="flex-row gap-2">
              <View className="flex-1">
                <DatePicker label="From" size="sm" value={from} onChange={setFrom} />
              </View>
              <View className="flex-1">
                <DatePicker label="To" size="sm" value={to} onChange={setTo} />
              </View>
            </View>
          )}
          <ListItem
            listitem={false}
            description="Overtime paid out and comp time: decisions that touch pay."
            trailing={
              <Switch
                checked={salary}
                accessibilityLabel="Include decisions that touch pay"
                onCheckedChange={setSalary}
              />
            }
          >
            Include decisions that touch pay
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
            Delegate
          </Button>
        </>
      ) : (
        <Card>
          <Stack gap={2}>
            <Text variant="headline">{`${d.delegation.delegateName} approves for you`}</Text>
            <Text tone="muted">
              {[
                d.delegation.automatic
                  ? 'Whenever you are off'
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
                  'Delegation ended',
                ).then(reload);
              }}
            >
              End it
            </Button>
          </Stack>
        </Card>
      )}
      {d.escalatesTo === null ? null : (
        <Text
          variant="footnote"
          tone="muted"
        >{`Anything nobody answers in time goes to ${d.escalatesTo.displayName}.`}</Text>
      )}
      {d.coveringFor.length === 0 ? null : (
        <>
          <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
            You approve for
          </Text>
          <List>
            {d.coveringFor.map((c) => (
              <ListItem
                key={c.approverId}
                leading={<Avatar name={c.approverName} size={36} />}
                description={
                  c.automatic
                    ? 'Whenever they are off'
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
