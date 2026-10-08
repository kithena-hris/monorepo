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

import { Failed, Loading, Page } from '../frame';
import { useAct } from '../people/act';
import type { PeopleScreen } from '../people/routes';
import { todayHere } from './time';
import { useTimeOff } from './api';
import { leaveIcon } from './icons';
import { amount, days, longSpan, nextWorkingDay, shortDate, spanLabel, statusOf } from './words';

interface Item {
  readonly requestId: string;
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
      title="Your requests"
      back={{ label: 'Time off', onPress: navigation.goBack }}
      trailing={
        <Button
          size="sm"
          variant="primary"
          onPress={() => {
            navigation.navigate('TimeOffRequest');
          }}
        >
          Request
        </Button>
      }
    >
      <SegmentedControl
        fullWidth
        value={tab}
        accessibilityLabel="Which requests"
        onValueChange={(v) => {
          setTab(v === 'past' ? 'past' : v === 'cancelled' ? 'cancelled' : 'upcoming');
        }}
      >
        <SegmentedControlItem value="upcoming">Coming up</SegmentedControlItem>
        <SegmentedControlItem value="past">Past</SegmentedControlItem>
        <SegmentedControlItem value="cancelled">Cancelled</SegmentedControlItem>
      </SegmentedControl>
      {load.status === 'error' ? (
        <Failed message={load.message} onRetry={reload} />
      ) : load.status === 'loading' ? (
        <Loading label="Loading your requests" />
      ) : load.data.items.length === 0 ? (
        <EmptyState
          icon={CalendarIcon}
          title="Nothing here"
          description="Requests appear here once they are sent."
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
      title: 'Sent',
      tone: 'success',
      icon: Send,
      timestamp: shortDate(request.requestedAt.slice(0, 10)),
      children: `You asked for ${spanLabel(request.span.from, request.span.to)}.`,
    },
  ];
  const decided = ['approved', 'taken', 'change_pending'].includes(s) ? chain.length : step;
  chain.forEach((r, i) => {
    const id = `step${String(i)}`;
    if (i < decided)
      out.push({ id, title: `Approved by ${role(r)}`, tone: 'success', icon: Check });
    else if (i === step && s === 'declined')
      out.push({
        id,
        title: `Declined by ${role(r)}`,
        tone: 'danger',
        icon: X,
        children: 'The days went back to your balance.',
      });
    else if (i === step && s === 'pending')
      out.push({
        id,
        title: `Waiting for ${role(r)}`,
        tone: 'warning',
        status: 'current',
        icon: Clock,
        children: detail.escalated
          ? 'Escalated: nobody answered in time.'
          : 'The days are booked while it waits.',
      });
    else if (i > step && (s === 'pending' || s === 'counter_proposed'))
      out.push({ id, title: `Then ${role(r)}`, status: 'upcoming', icon: Check });
  });
  if (s === 'counter_proposed')
    out.push({
      id: 'suggested',
      title: `${capital(role(chain[step]))} suggested other dates`,
      tone: 'info',
      status: 'current',
      icon: CalendarIcon,
      children: 'Take one, or keep yours and it goes back to them.',
    });
  if (s === 'change_pending' && detail.pendingChange !== null)
    out.push({
      id: 'change',
      title: `You asked to move it to ${spanLabel(detail.pendingChange.from, detail.pendingChange.to)}`,
      tone: 'warning',
      status: 'current',
      icon: Clock,
      children: 'Your old dates stay booked until the new ones are approved.',
    });
  if (s === 'cancelled' || s === 'withdrawn')
    out.push({
      id: 'cancelled',
      title: s === 'withdrawn' ? 'Withdrawn' : 'Cancelled',
      icon: X,
      children: 'The days went back to your balance.',
    });
  if (s === 'taken' || (s === 'approved' && request.span.to < today))
    out.push({ id: 'taken', title: 'Taken', tone: 'success', icon: CircleCheck });
  if (request.category === 'annual_leave' && !['declined', 'cancelled', 'withdrawn'].includes(s))
    out.push({
      id: 'pay',
      title: 'No payroll change',
      status: 'upcoming',
      icon: Wallet,
      children: 'Paid vacation, so your pay stays the same.',
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
  const back = { label: 'Requests', onPress: navigation.goBack };
  if (load.status !== 'ready') {
    return (
      <Page title="Request" back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label="Loading the request" />
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
          label="You’re off"
          icon={<Icon icon={leaveIcon(CATEGORY_ICON[request.category])} />}
          value={longSpan(request.span.from, request.span.to)}
          description={days(request.workingDays)}
        />
        <Stat
          className="flex-1"
          label="Back at work"
          value={shortDate(nextWorkingDay(request.span.to))}
        />
      </View>
      {detail.canAnswer && detail.proposals.length > 0 ? (
        <Card>
          <Stack gap={2}>
            <Text variant="headline">{`${capital(role(detail.chain[detail.step]))} suggested other dates`}</Text>
            <Text variant="footnote" tone="muted">
              Taking one approves it. Keeping yours sends it back.
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
                    'Dates taken',
                  ).then(reload);
                }}
              >
                {`Take ${p.spans.map((r) => spanLabel(r.from, r.to)).join(' and ')} · ${days(p.workingDays)}`}
              </Button>
            ))}
            <Button
              variant="ghost"
              onPress={() => {
                void act(
                  'AnswerSuggestedTimeOffDates',
                  { requestId: request.requestId, input: { accept: null } },
                  'Kept your dates',
                ).then(reload);
              }}
            >
              Keep my dates
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
      {detail.canChange ? (
        <View className="flex-row gap-2">
          <Button
            className="flex-1"
            startIcon={<Icon icon={CalendarIcon} />}
            onPress={() => {
              setDialog('move');
            }}
          >
            Change dates
          </Button>
          {request.status === 'approved' ? (
            <Button
              className="flex-1"
              onPress={() => {
                setDialog('shorten');
              }}
            >
              Shorten
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
          {request.status === 'approved' ? 'Cancel request' : 'Withdraw request'}
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
                ? `Cancel ${label}?`
                : `Withdraw ${label}?`
              : kind === 'move'
                ? 'New dates'
                : 'New last day'}
          </DialogTitle>
          <DialogDescription>
            {kind === 'cancel'
              ? `The ${amount(request.workingDays)} days go back to your balance.`
              : kind === 'move'
                ? approved
                  ? 'Your old dates stay booked until the new ones are approved.'
                  : 'It goes to your approver again with the new dates.'
                : 'The days after it go back to your balance.'}
          </DialogDescription>
        </DialogHeader>
        {kind === 'move' ? (
          <DialogBody>
            <Calendar mode="range" label="New dates" selected={range} onSelect={setRange} />
          </DialogBody>
        ) : kind === 'shorten' ? (
          <DialogBody>
            <DatePicker
              label="Last day"
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
            Keep it
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
                  'Change sent',
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
                ? 'Cancel request'
                : 'Withdraw'
              : kind === 'move'
                ? 'Send the change'
                : 'Shorten'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
