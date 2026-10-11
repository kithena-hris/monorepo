import {
  Alert,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Icon,
  List,
  ListItem,
  Progress,
  Stat,
  Text,
} from '@reach/ui-native';
import { Hourglass } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';

import { Failed, Loading, Page } from '../frame';
import type { PeopleScreen } from '../people/routes';
import { todayHere } from './time';
import { useTimeOff } from './api';
import { leaveIcon } from './icons';
import { amount, monthName, shortDate, signed } from './words';

export interface Balance {
  readonly leaveTypeKey: string;
  readonly name: string;
  readonly unit: 'day' | 'hour';
  readonly colorToken: string;
  readonly icon: string;
  readonly left: string;
  readonly used: string;
  readonly booked: string;
  readonly allowance: string;
  readonly yearly: string | null;
}

interface Entry {
  readonly entryId: string;
  readonly kind: string;
  readonly amount: string;
  readonly unit: 'day' | 'hour';
  readonly effectiveOn: string;
  readonly occurredAt: string;
  readonly reason: string | null;
  readonly requestId: string | null;
  readonly supersedes: string | null;
}

/** What an entry is, in a person's words. */
function what(e: Entry): string {
  const year = Number(e.effectiveOn.slice(0, 4));
  const label: Record<string, string> = {
    grant: `Allowance for ${String(year)}`,
    accrual: `Earned in ${monthName(e.effectiveOn)}`,
    carry_over: `Carried over from ${String(year - 1)}`,
    expiry: 'Lost, not used in time',
    booking: 'Booked',
    taken: 'Taken',
    release: 'Given back',
    borrow: `Borrowed from ${String(year + 1)}`,
    adjustment: 'Corrected by HR',
    comp_earned: 'Overtime banked',
  };
  const said = label[e.kind] ?? e.kind;
  return e.supersedes === null || e.kind === 'adjustment' ? said : `${said} (corrected)`;
}

/**
 * Where the days went (design MT20): the balance, then every entry in its
 * ledger, newest first, so "why do I have 11.5?" has a one-screen answer.
 * A booking opens its request.
 */
export function TimeOffBalance({
  navigation,
  route,
}: PeopleScreen<'TimeOffBalance'>): React.JSX.Element {
  const { load, reload } = useTimeOff<{ balance: Balance; entries: Entry[] }>('TimeOffBalance', {
    leaveTypeKey: route.params.leaveTypeKey,
  });
  const back = { label: 'Time off', onPress: navigation.goBack };
  if (load.status !== 'ready') {
    return (
      <Page title={route.params.name} back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label="Loading the balance" />
        )}
      </Page>
    );
  }
  const { balance, entries } = load.data;
  const hours = balance.unit === 'hour';
  const corrected = new Set(entries.flatMap((e) => (e.supersedes === null ? [] : [e.supersedes])));
  const lines = entries
    .filter((e) => !corrected.has(e.entryId))
    .slice()
    .reverse();
  const expiring = entries.filter((e) => e.kind === 'expiry' && e.effectiveOn > todayHere());
  return (
    <Page title={balance.name} back={back}>
      <Stat
        label={balance.name}
        icon={<Icon icon={leaveIcon(balance.icon)} />}
        value={hours ? `${amount(balance.left)}h` : amount(balance.left)}
        unit={hours ? 'banked' : 'days left'}
        {...(balance.yearly === null
          ? {}
          : {
              chart: (
                <Progress
                  label={`${amount(balance.used)} used, ${amount(balance.booked)} booked`}
                  value={Number(balance.used) + Number(balance.booked)}
                  max={Number(balance.yearly)}
                />
              ),
              description: `${amount(balance.used)} used · ${amount(balance.booked)} booked · ${amount(balance.yearly)} a year`,
            })}
      />
      {expiring.map((e) => (
        <Alert key={e.entryId} tone="warning" icon={Hourglass}>
          {`${amount(e.amount.replace('-', ''))} ${hours ? 'hours' : 'days'} will be lost on ${shortDate(e.effectiveOn)} unless you book them.`}
        </Alert>
      ))}
      <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
        Every change
      </Text>
      {lines.length === 0 ? (
        <Text tone="muted">Nothing has changed this balance yet.</Text>
      ) : (
        <List>
          {lines.map((e) => {
            const recorded = e.occurredAt.slice(0, 10);
            const requestId = e.requestId;
            return (
              <ListItem
                key={e.entryId}
                description={[
                  shortDate(e.effectiveOn),
                  recorded === e.effectiveOn ? null : `recorded ${shortDate(recorded)}`,
                  e.reason,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                trailing={
                  <Text className="tabular-nums">{`${signed(e.amount)}${e.unit === 'hour' ? 'h' : ''}`}</Text>
                }
                {...(requestId === null
                  ? {}
                  : {
                      onPress: () => {
                        navigation.navigate('TimeOffRequestDetail', { requestId });
                      },
                    })}
              >
                {what(e)}
              </ListItem>
            );
          })}
        </List>
      )}
    </Page>
  );
}

/**
 * Where the days went, in a centred modal (design v3 T6): a plain ledger,
 * oldest first, and what is left at its foot. Details on the balance opens it.
 */
export function BalanceDialog({
  leaveTypeKey,
  name,
  onClose,
}: {
  leaveTypeKey: string;
  name: string;
  onClose: () => void;
}): React.JSX.Element {
  const { load, reload } = useTimeOff<{ balance: Balance; entries: Entry[] }>('TimeOffBalance', {
    leaveTypeKey,
  });
  let body: React.ReactNode;
  let foot: React.ReactNode = null;
  let about: string | null = null;
  if (load.status === 'error') body = <Failed message={load.message} onRetry={reload} />;
  else if (load.status === 'loading') body = <Loading label="Loading the balance" />;
  else {
    const { balance, entries } = load.data;
    const hours = balance.unit === 'hour';
    const corrected = new Set(entries.flatMap((e) => (e.supersedes === null ? [] : [e.supersedes])));
    const lines = entries.filter((e) => !corrected.has(e.entryId));
    about =
      balance.yearly === null ? null : `${amount(balance.yearly)} ${hours ? 'hours' : 'days'} this year.`;
    body = (
      <ScrollView style={{ flexGrow: 0, maxHeight: 400 }}>
        {lines.length === 0 ? (
          <Text tone="muted">Nothing has changed this balance yet.</Text>
        ) : (
          lines.map((e, i) => (
            <View
              key={e.entryId}
              className={`flex-row items-center gap-3 py-3 ${i < lines.length - 1 ? 'border-b border-border' : ''}`}
            >
              <View className="flex-1 gap-0.5">
                <Text weight="semibold">{what(e)}</Text>
                <Text variant="footnote" tone="muted">
                  {[shortDate(e.effectiveOn), e.reason].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Text
                weight="bold"
                tone={e.amount.startsWith('-') ? 'default' : 'success'}
                className="tabular-nums"
              >{`${signed(e.amount)}${hours ? 'h' : ''}`}</Text>
            </View>
          ))
        )}
      </ScrollView>
    );
    foot = (
      <View className="flex-1 flex-row items-baseline justify-between">
        <Text weight="semibold">Left</Text>
        <Text variant="title2" weight="bold" className="tabular-nums">
          {hours ? `${amount(balance.left)}h` : `${amount(balance.left)} days`}
        </Text>
      </View>
    );
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Where your ${name.toLowerCase()} went`}</DialogTitle>
          {about === null ? null : <DialogDescription>{about}</DialogDescription>}
        </DialogHeader>
        <DialogBody>{body}</DialogBody>
        {foot === null ? null : <DialogFooter>{foot}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
