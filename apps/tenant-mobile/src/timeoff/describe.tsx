import {
  AssistantMark,
  Badge,
  Button,
  Card,
  Chip,
  SearchField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Switch,
  Text,
  ListItem,
} from '@reach/ui-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Failed, Loading, Page } from '../frame';
import type { PeopleScreen } from '../people/routes';
import { useTimeOff } from './api';
import { amount, spanLabel } from './words';
import { t as tr } from '../i18n';

export interface Option {
  readonly from: string;
  readonly to: string;
  readonly used: number;
  readonly away: { readonly from: string; readonly to: string; readonly days: number };
  readonly holidays: readonly { readonly date: string; readonly name: string }[];
  readonly short: readonly { date: string; in: number; of: number; required: number }[];
  readonly fewest: { readonly in: number; readonly of: number } | null;
  readonly fits: boolean;
  readonly leftAfter: string | null;
  readonly line: { readonly text: string; readonly ai: boolean };
}

export interface Described {
  readonly sentence: string | null;
  readonly understood: {
    readonly leaveTypeKey: string | null;
    readonly leaveTypeName: string | null;
    readonly days: number;
    readonly month: string | null;
    readonly nextToHoliday: boolean;
    readonly avoidShort: boolean;
    readonly ai: boolean;
  };
  readonly leaveTypes: readonly { readonly key: string; readonly name: string }[];
  readonly left: string | null;
  readonly options: readonly Option[];
}

interface Asked {
  sentence?: string;
  leaveTypeKey?: string;
  days?: number;
  month?: string;
  nextToHoliday?: boolean;
  avoidShort?: boolean;
}

const LENGTHS = [1, 2, 3, 4, 5, 10, 15];
const monthLabel = (m: string): string =>
  new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${m}-01T00:00:00Z`),
  );

/** One set of dates Time Off found: what they cost, what they get, and how the team fares. */
export function SuggestionCard({
  option: o,
  best,
  onChoose,
  onMore,
}: {
  option: Option;
  best: boolean;
  onChoose: () => void;
  /** Handing the suggestion to the planner, for more than one tap can say. */
  onMore?: () => void;
}): React.JSX.Element {
  return (
    <Card>
      <Stack gap={2}>
        <View className="flex-row items-center gap-2">
          <Text variant="headline" className="flex-1">
            {tr(
              'timeoff.describe.off',
              {
                one: '{{spanLabel}} · {{count}} day → {{String2}} off',
                other: '{{spanLabel}} · {{count}} days → {{String2}} off',
              },
              { count: o.used, spanLabel: spanLabel(o.from, o.to), String2: String(o.away.days) },
            )}
          </Text>
          {best ? (
            <Badge size="sm" tone="accent">
              {tr('timeoff.describe.best', 'Best')}
            </Badge>
          ) : null}
          {o.line.ai ? <Badge size="sm">{tr('timeoff.describe.ai', 'AI')}</Badge> : null}
        </View>
        <Text variant="subhead">{o.line.text}</Text>
        <Text variant="footnote" tone="muted">
          {[
            o.leftAfter === null ? null : `${amount(o.leftAfter)} left after`,
            o.fewest === null
              ? null
              : `at least ${String(o.fewest.in)} of ${String(o.fewest.of)} in`,
            o.fits ? null : 'past your balance',
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        <View className="flex-row gap-2">
          <Button size="sm" variant={best ? 'primary' : 'secondary'} onPress={onChoose}>
            {tr('timeoff.describe.choose_these_dates', 'Choose these dates')}
          </Button>
          {onMore === undefined ? null : (
            <Button size="sm" variant="ghost" onPress={onMore}>
              {tr('timeoff.describe.plan_with_kithena', 'Plan with Kithena')}
            </Button>
          )}
        </View>
      </Stack>
    </Card>
  );
}

/**
 * Describe it instead (design MT8): a sentence, what it was understood as as
 * chips that can be changed, then the dates Time Off found, ranked by value
 * and team coverage. Nothing is sent: choosing dates opens the request with them.
 */
export function TimeOffDescribe({
  navigation,
  route,
}: PeopleScreen<'TimeOffDescribe'>): React.JSX.Element {
  const [typed, setTyped] = useState(route.params?.sentence ?? '');
  const [asked, setAsked] = useState<Asked>(
    route.params?.sentence === undefined ? {} : { sentence: route.params.sentence },
  );
  const { load, reload } = useTimeOff<Described>('TimeOffDescribe', { ...asked });
  const back = { label: tr('timeoff.describe.time_off', 'Time off'), onPress: navigation.goBack };
  const set = (patch: Asked): void => {
    setAsked((a) => ({ ...a, ...patch }));
  };
  const nextMonths = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + i);
    return d.toISOString().slice(0, 7);
  });
  return (
    <Page title={tr('timeoff.describe.suggestions', 'Suggestions')} back={back}>
      <SearchField
        value={typed}
        onValueChange={setTyped}
        onSearch={(value) => {
          setAsked(value.trim() === '' ? {} : { sentence: value.trim() });
        }}
        placeholder={tr(
          'timeoff.describe.a_week_off_in_october_next',
          'A week off in October next to a holiday',
        )}
        label={tr('timeoff.describe.describe_the_time_off', 'Describe the time off')}
      />
      {load.status === 'error' ? (
        <Failed message={load.message} onRetry={reload} />
      ) : load.status === 'loading' ? (
        <Loading label={tr('timeoff.describe.finding_dates', 'Finding dates')} />
      ) : (
        <>
          <View className="flex-row items-center gap-2">
            <AssistantMark size={16} />
            <Text variant="footnote" weight="semibold" tone="muted">
              {load.data.understood.ai
                ? tr('timeoff.describe.understood_as', 'Understood as')
                : tr('timeoff.describe.looking_for', 'Looking for')}
            </Text>
          </View>
          <Select
            value={load.data.understood.leaveTypeKey ?? ''}
            onValueChange={(leaveTypeKey) => {
              set({ leaveTypeKey });
            }}
          >
            <SelectTrigger size="sm" accessibilityLabel={tr('timeoff.describe.type', 'Type')}>
              <SelectValue placeholder={tr('timeoff.describe.type', 'Type')} />
            </SelectTrigger>
            <SelectContent>
              {load.data.leaveTypes.map((t) => (
                <SelectItem key={t.key} value={t.key}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <View className="flex-row flex-wrap gap-2">
            {LENGTHS.map((n) => (
              <Chip
                key={n}
                selected={load.data.understood.days === n}
                onPress={() => {
                  set({ days: n });
                }}
              >
                {tr(
                  'timeoff.describe.days',
                  { one: '{{count}} day', other: '{{count}} days' },
                  { count: n },
                )}
              </Chip>
            ))}
          </View>
          <View className="flex-row flex-wrap gap-2">
            <Chip
              selected={load.data.understood.month === null}
              onPress={() => {
                set({ month: '' });
              }}
            >
              {tr('timeoff.describe.next_three_months', 'Next three months')}
            </Chip>
            {nextMonths.map((m) => (
              <Chip
                key={m}
                selected={load.data.understood.month === m}
                onPress={() => {
                  set({ month: m });
                }}
              >
                {monthLabel(m)}
              </Chip>
            ))}
          </View>
          <ListItem
            listitem={false}
            trailing={
              <Switch
                checked={load.data.understood.nextToHoliday}
                accessibilityLabel={tr('timeoff.describe.next_to_a_holiday', 'Next to a holiday')}
                onCheckedChange={(nextToHoliday) => {
                  set({ nextToHoliday });
                }}
              />
            }
          >
            {tr('timeoff.describe.next_to_a_holiday', 'Next to a holiday')}
          </ListItem>
          <ListItem
            listitem={false}
            trailing={
              <Switch
                checked={load.data.understood.avoidShort}
                accessibilityLabel={tr(
                  'timeoff.describe.avoid_days_the_team_is_short',
                  'Avoid days the team is short',
                )}
                onCheckedChange={(avoidShort) => {
                  set({ avoidShort });
                }}
              />
            }
          >
            {tr('timeoff.describe.avoid_days_the_team_is_short', 'Avoid days the team is short')}
          </ListItem>
          {load.data.options.length === 0 ? (
            <Text tone="muted">
              {tr(
                'timeoff.describe.nothing_fits_that_change_a_choice',
                'Nothing fits that. Change a choice above.',
              )}
            </Text>
          ) : (
            load.data.options.map((o, i) => (
              <SuggestionCard
                key={`${o.from}${o.to}`}
                option={o}
                best={i === 0}
                onChoose={() => {
                  navigation.navigate('TimeOffRequest', {
                    ...(load.data.understood.leaveTypeKey === null
                      ? {}
                      : { leaveTypeKey: load.data.understood.leaveTypeKey }),
                    from: o.from,
                    to: o.to,
                  });
                }}
              />
            ))
          )}
        </>
      )}
    </Page>
  );
}
