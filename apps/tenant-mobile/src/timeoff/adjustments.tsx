import {
  Alert,
  Badge,
  Button,
  Card,
  Combobox,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Icon,
  List,
  ListItem,
  NumberField,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Text,
  Textarea,
} from '@reach/ui-native';
import { Plus, Send } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Failed, Loading, Page } from '../frame';
import { useAct } from '../people/act';
import type { PeopleScreen } from '../people/routes';
import { useTimeOff } from './api';
import { todayHere } from './time';
import { amount, shortDate, signed } from './words';

interface Adjustment {
  readonly adjustmentId: string;
  readonly personId: string;
  readonly displayName: string;
  readonly leaveTypeName: string;
  readonly unit: 'day' | 'hour';
  readonly amount: string;
  readonly effectiveOn: string;
  readonly reason: string;
  readonly proposedAt: string;
  readonly status: 'pending' | 'approved' | 'declined';
  readonly note: string | null;
  readonly canDecide: boolean;
}

const STATUS = {
  pending: { label: 'Waiting for HR', tone: 'warning' },
  approved: { label: 'Added', tone: 'success' },
  declined: { label: 'Declined', tone: 'danger' },
} as const;

const unitOf = (unit: 'day' | 'hour', n: string): string =>
  unit === 'hour'
    ? `${signed(n)}h`
    : `${signed(n)} ${amount(n.replace('-', '')) === '1' ? 'day' : 'days'}`;

/**
 * Adding to or taking from someone's balance, saying why (PRD §7.1). HR's
 * counts at once; a manager's goes to HR to approve. The balance before and
 * after is shown as it is filled in, so nobody adjusts blind.
 */
export function TimeOffAdjust({
  navigation,
  route,
}: PeopleScreen<'TimeOffAdjust'>): React.JSX.Element {
  const { act, busy } = useAct('timeoff');
  const viewer = useTimeOff<{ hrAdmin: boolean }>('TimeOffViewer');
  const hr = viewer.load.status === 'ready' && viewer.load.data.hrAdmin;
  const today = todayHere();
  const week = (() => {
    const day = new Date(`${today}T00:00:00Z`).getUTCDay();
    const monday = new Date(`${today}T00:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - (day === 0 ? 6 : day - 1));
    const friday = new Date(monday);
    friday.setUTCDate(monday.getUTCDate() + 4);
    return { from: monday.toISOString().slice(0, 10), to: friday.toISOString().slice(0, 10) };
  })();
  // HR picks from the company; a manager from the people they approve for.
  const company = useTimeOff<{
    people: { personId: string; displayName: string; teamName: string | null }[];
  }>('TimeOffCalendarTimeline', { scope: 'company', ...week });
  const team = useTimeOff<{ people: { personId: string; displayName: string }[] }>(
    'TimeOffTeamRightNow',
  );
  const types = useTimeOff<{
    leaveTypes: { key: string; name: string; tracked: boolean; unit: 'day' | 'hour' }[];
  }>('TimeOffRequestPanel');
  const [personId, setPersonId] = useState<string | null>(route.params?.personId ?? null);
  const [leaveTypeKey, setLeaveTypeKey] = useState<string | null>(null);
  const [direction, setDirection] = useState<'add' | 'take'>('add');
  const [size, setSize] = useState(1);
  const [reason, setReason] = useState('');
  const [on, setOn] = useState<string | null>(today);

  const back = { label: 'Time off', onPress: navigation.goBack };
  const people =
    hr && company.load.status === 'ready'
      ? company.load.data.people.map((p) => ({
          value: p.personId,
          label: p.displayName,
          ...(p.teamName === null ? {} : { description: p.teamName }),
        }))
      : team.load.status === 'ready'
        ? team.load.data.people.map((p) => ({ value: p.personId, label: p.displayName }))
        : [];
  const tracked =
    types.load.status === 'ready' ? types.load.data.leaveTypes.filter((t) => t.tracked) : [];
  const chosen = tracked.find((t) => t.key === leaveTypeKey);
  const unit = chosen?.unit === 'hour' ? 'hours' : 'days';
  const delta = (direction === 'add' ? size : -size).toFixed(3);
  const ready =
    personId !== null && leaveTypeKey !== null && size > 0 && reason.trim() !== '' && on !== null;
  if (viewer.load.status === 'loading' || types.load.status === 'loading') {
    return (
      <Page title="Adjust a balance" back={back}>
        <Loading label="Loading" />
      </Page>
    );
  }
  return (
    <Page
      title="Adjust a balance"
      back={back}
      foot={
        <Button
          variant="primary"
          fullWidth
          startIcon={<Icon icon={hr ? Plus : Send} />}
          disabled={!ready}
          loading={busy === 'AdjustTimeOffBalance'}
          onPress={() => {
            void act<{ status: string }>(
              'AdjustTimeOffBalance',
              {
                input: {
                  personId,
                  leaveTypeKey,
                  amount: delta,
                  effectiveOn: on,
                  reason: reason.trim(),
                },
              },
              (done) => (done.status === 'pending' ? 'Sent to HR to approve' : 'Balance adjusted'),
            ).then((done) => {
              if (done !== null) navigation.goBack();
            });
          }}
        >
          {hr ? 'Adjust the balance' : 'Send to HR'}
        </Button>
      }
    >
      {hr ? null : (
        <Alert tone="info" title="HR approves this">
          It counts once HR has approved it, and you can follow it under Balance adjustments.
        </Alert>
      )}
      <Field required>
        <FieldLabel>Who</FieldLabel>
        <Combobox
          label="Who"
          options={people}
          value={personId}
          onChange={(v) => {
            setPersonId(typeof v === 'string' ? v : null);
          }}
          placeholder="Choose someone"
        />
      </Field>
      <Field required>
        <FieldLabel>Leave type</FieldLabel>
        <Select value={leaveTypeKey ?? ''} onValueChange={setLeaveTypeKey}>
          <SelectTrigger accessibilityLabel="Leave type">
            <SelectValue placeholder="Choose a leave type" />
          </SelectTrigger>
          <SelectContent>
            {tracked.map((t) => (
              <SelectItem key={t.key} value={t.key}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <SegmentedControl
        fullWidth
        value={direction}
        accessibilityLabel="Add or take away"
        onValueChange={(v) => {
          setDirection(v === 'take' ? 'take' : 'add');
        }}
      >
        <SegmentedControlItem value="add">Add</SegmentedControlItem>
        <SegmentedControlItem value="take">Take away</SegmentedControlItem>
      </SegmentedControl>
      <NumberField
        label={chosen?.unit === 'hour' ? 'Hours' : 'Days'}
        min={0.5}
        max={365}
        step={0.5}
        value={size}
        onChange={(v) => {
          setSize(v ?? 0);
        }}
      />
      {personId === null || leaveTypeKey === null ? null : (
        <BalanceChange personId={personId} leaveTypeKey={leaveTypeKey} delta={delta} unit={unit} />
      )}
      <Field required>
        <FieldLabel>Why</FieldLabel>
        <Textarea
          value={reason}
          onChange={setReason}
          maxLength={500}
          placeholder="Worked the offsite weekend"
          accessibilityLabel="Why"
        />
        <FieldDescription>Always needed. They see it beside the days.</FieldDescription>
      </Field>
      <DatePicker label="Counts from" value={on} onChange={setOn} />
    </Page>
  );
}

/** Their balance now, and after: read once a person and a leave type are chosen. */
function BalanceChange({
  personId,
  leaveTypeKey,
  delta,
  unit,
}: {
  personId: string;
  leaveTypeKey: string;
  delta: string;
  unit: string;
}): React.JSX.Element | null {
  const { load } = useTimeOff<{ balance: { left: string } }>('TimeOffBalance', {
    leaveTypeKey,
    personId,
  });
  if (load.status !== 'ready') return null;
  const left = Number(load.data.balance.left);
  return (
    <Card>
      <View className="flex-row items-center">
        <Text className="flex-1" tone="muted">
          Balance
        </Text>
        <Text weight="semibold" className="tabular-nums">
          {`${amount(left.toFixed(3))} → ${amount((left + Number(delta)).toFixed(3))} ${unit}`}
        </Text>
      </View>
    </Card>
  );
}

/**
 * Balance adjustments: HR's queue to approve or decline, and the last 30
 * days; a manager follows the ones they asked for.
 */
export function TimeOffAdjustments({
  navigation,
}: PeopleScreen<'TimeOffAdjustments'>): React.JSX.Element {
  const { load, reload } = useTimeOff<{ hr: boolean; items: Adjustment[] }>(
    'TimeOffBalanceAdjustments',
  );
  const { act, busy } = useAct('timeoff');
  const [declining, setDeclining] = useState<Adjustment | null>(null);
  const [note, setNote] = useState('');
  const back = { label: 'Time off', onPress: navigation.goBack };
  const decide = (a: Adjustment, approve: boolean, why: string | null): void => {
    void act(
      'DecideTimeOffBalanceAdjustment',
      { adjustmentId: a.adjustmentId, input: { approve, note: why } },
      approve ? `${a.displayName}’s balance adjusted` : 'Declined',
    ).then((done) => {
      if (done !== null) reload();
    });
  };
  return (
    <Page
      title="Balance adjustments"
      back={back}
      trailing={
        <Button
          size="sm"
          variant="ghost"
          startIcon={<Icon icon={Plus} />}
          accessibilityLabel="Adjust a balance"
          onPress={() => {
            navigation.navigate('TimeOffAdjust');
          }}
        />
      }
    >
      {load.status === 'error' ? (
        <Failed message={load.message} onRetry={reload} />
      ) : load.status === 'loading' ? (
        <Loading label="Loading adjustments" />
      ) : load.data.items.length === 0 ? (
        <Text tone="muted">
          {load.data.hr
            ? 'Nothing waiting, and nothing adjusted in the last 30 days.'
            : 'You have not asked for any adjustments in the last 30 days.'}
        </Text>
      ) : (
        <Stack gap={3}>
          {load.data.items.map((a) => (
            <Card key={a.adjustmentId}>
              <Stack gap={2}>
                <View className="flex-row items-center gap-2">
                  <Text variant="headline" className="flex-1">
                    {`${a.displayName} · ${unitOf(a.unit, a.amount)}`}
                  </Text>
                  <Badge size="sm" tone={STATUS[a.status].tone} dot>
                    {STATUS[a.status].label}
                  </Badge>
                </View>
                <Text variant="subhead">{`“${a.reason}”`}</Text>
                <Text variant="footnote" tone="muted">
                  {[a.leaveTypeName, `counts from ${shortDate(a.effectiveOn)}`, a.note]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                {a.canDecide ? (
                  <View className="flex-row gap-2">
                    <Button
                      className="flex-1"
                      onPress={() => {
                        setNote('');
                        setDeclining(a);
                      }}
                    >
                      Decline
                    </Button>
                    <Button
                      className="flex-1"
                      variant="primary"
                      loading={busy === 'DecideTimeOffBalanceAdjustment'}
                      onPress={() => {
                        decide(a, true, null);
                      }}
                    >
                      Approve
                    </Button>
                  </View>
                ) : null}
              </Stack>
            </Card>
          ))}
        </Stack>
      )}
      {declining === null ? null : (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) setDeclining(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{`Decline ${unitOf(declining.unit, declining.amount)} for ${declining.displayName}?`}</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <Textarea
                value={note}
                onChange={setNote}
                maxLength={500}
                placeholder="Why, for whoever asked (optional)"
                accessibilityLabel="Why it is declined"
              />
            </DialogBody>
            <DialogFooter>
              <Button
                onPress={() => {
                  setDeclining(null);
                }}
              >
                Keep it
              </Button>
              <Button
                variant="danger"
                onPress={() => {
                  decide(declining, false, note.trim() === '' ? null : note.trim());
                  setDeclining(null);
                }}
              >
                Decline
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <List>
        <ListItem
          description="Add or take away days, saying why"
          chevron
          onPress={() => {
            navigation.navigate('TimeOffAdjust');
          }}
        >
          Adjust a balance
        </ListItem>
      </List>
    </Page>
  );
}
