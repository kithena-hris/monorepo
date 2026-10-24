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
import { t } from '../i18n';

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
    grant: t('timeoff.balance.allowance_for', 'Allowance for {{String}}', { String: String(year) }),
    accrual: t('timeoff.balance.earned_in', 'Earned in {{monthName}}', {
      monthName: monthName(e.effectiveOn),
    }),
    carry_over: t('timeoff.balance.carried_over_from', 'Carried over from {{String}}', {
      String: String(year - 1),
    }),
    expiry: t('timeoff.balance.lost_not_used_in_time', 'Lost, not used in time'),
    booking: 'Booked',
    taken: 'Taken',
    release: t('timeoff.balance.given_back', 'Given back'),
    borrow: t('timeoff.balance.borrowed_from', 'Borrowed from {{String}}', {
      String: String(year + 1),
    }),
    adjustment: t('timeoff.balance.corrected_by_hr', 'Corrected by HR'),
    comp_earned: t('timeoff.balance.overtime_banked', 'Overtime banked'),
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
  const back = { label: t('timeoff.balance.time_off', 'Time off'), onPress: navigation.goBack };
  if (load.status !== 'ready') {
    return (
      <Page title={route.params.name} back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label={t('timeoff.balance.loading_the_balance', 'Loading the balance')} />
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
                  label={t('timeoff.balance.used_booked', '{{amount}} used, {{amount2}} booked', {
                    amount: amount(balance.used),
                    amount2: amount(balance.booked),
                  })}
                  value={Number(balance.used) + Number(balance.booked)}
                  max={Number(balance.yearly)}
                />
              ),
              description: t(
                'timeoff.balance.used_booked_a_year',
                '{{amount}} used · {{amount2}} booked · {{amount3}} a year',
                {
                  amount: amount(balance.used),
                  amount2: amount(balance.booked),
                  amount3: amount(balance.yearly),
                },
              ),
            })}
      />
      {expiring.map((e) => (
        <Alert key={e.entryId} tone="warning" icon={Hourglass}>
          {t(
            'timeoff.balance.will_be_lost_on_unless_you',
            '{{amount}} {{value}} will be lost on {{shortDate}} unless you book them.',
            {
              amount: amount(e.amount.replace('-', '')),
              value: hours ? 'hours' : 'days',
              shortDate: shortDate(e.effectiveOn),
            },
          )}
        </Alert>
      ))}
      <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
        {t('timeoff.balance.every_change', 'Every change')}
      </Text>
      {lines.length === 0 ? (
        <Text tone="muted">
          {t(
            'timeoff.balance.nothing_has_changed_this_balance_yet',
            'Nothing has changed this balance yet.',
          )}
        </Text>
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
  else if (load.status === 'loading')
    body = <Loading label={t('timeoff.balance.loading_the_balance', 'Loading the balance')} />;
  else {
    const { balance, entries } = load.data;
    const hours = balance.unit === 'hour';
    const corrected = new Set(
      entries.flatMap((e) => (e.supersedes === null ? [] : [e.supersedes])),
    );
    const lines = entries.filter((e) => !corrected.has(e.entryId));
    about =
      balance.yearly === null
        ? null
        : `${amount(balance.yearly)} ${hours ? 'hours' : 'days'} this year.`;
    body = (
      <ScrollView style={{ flexGrow: 0, maxHeight: 400 }}>
        {lines.length === 0 ? (
          <Text tone="muted">
            {t(
              'timeoff.balance.nothing_has_changed_this_balance_yet',
              'Nothing has changed this balance yet.',
            )}
          </Text>
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
        <Text weight="semibold">{t('timeoff.balance.left', 'Left')}</Text>
        <Text variant="title2" weight="bold" className="tabular-nums">
          {hours
            ? `${amount(balance.left)}h`
            : t('timeoff.balance.days', '{{amount}} days', { amount: amount(balance.left) })}
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
          <DialogTitle>
            {t('timeoff.balance.where_your_went', 'Where your {{toLowerCase}} went', {
              toLowerCase: name.toLowerCase(),
            })}
          </DialogTitle>
          {about === null ? null : <DialogDescription>{about}</DialogDescription>}
        </DialogHeader>
        <DialogBody>{body}</DialogBody>
        {foot === null ? null : <DialogFooter>{foot}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
