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

interface Option {
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

interface Described {
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
  const back = { label: 'Time off', onPress: navigation.goBack };
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
    <Page title="Suggestions" back={back}>
      <SearchField
        value={typed}
        onValueChange={setTyped}
        onSearch={(value) => {
          setAsked(value.trim() === '' ? {} : { sentence: value.trim() });
        }}
        placeholder="A week off in October next to a holiday"
        label="Describe the time off"
      />
      {load.status === 'error' ? (
        <Failed message={load.message} onRetry={reload} />
      ) : load.status === 'loading' ? (
        <Loading label="Finding dates" />
      ) : (
        <>
          <View className="flex-row items-center gap-2">
            <AssistantMark size={16} />
            <Text variant="footnote" weight="semibold" tone="muted">
              {load.data.understood.ai ? 'Understood as' : 'Looking for'}
            </Text>
          </View>
          <Select
            value={load.data.understood.leaveTypeKey ?? ''}
            onValueChange={(leaveTypeKey) => {
              set({ leaveTypeKey });
            }}
          >
            <SelectTrigger size="sm" accessibilityLabel="Type">
              <SelectValue placeholder="Type" />
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
                {`${String(n)} ${n === 1 ? 'day' : 'days'}`}
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
              Next three months
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
                accessibilityLabel="Next to a holiday"
                onCheckedChange={(nextToHoliday) => {
                  set({ nextToHoliday });
                }}
              />
            }
          >
            Next to a holiday
          </ListItem>
          <ListItem
            listitem={false}
            trailing={
              <Switch
                checked={load.data.understood.avoidShort}
                accessibilityLabel="Avoid days the team is short"
                onCheckedChange={(avoidShort) => {
                  set({ avoidShort });
                }}
              />
            }
          >
            Avoid days the team is short
          </ListItem>
          {load.data.options.length === 0 ? (
            <Text tone="muted">Nothing fits that. Change a choice above.</Text>
          ) : (
            load.data.options.map((o, i) => (
              <Card key={`${o.from}${o.to}`}>
                <Stack gap={2}>
                  <View className="flex-row items-center gap-2">
                    <Text variant="headline" className="flex-1">
                      {`${spanLabel(o.from, o.to)} · ${String(o.used)} ${o.used === 1 ? 'day' : 'days'} → ${String(o.away.days)} off`}
                    </Text>
                    {i === 0 ? (
                      <Badge size="sm" tone="accent">
                        Best
                      </Badge>
                    ) : null}
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
                  <Button
                    size="sm"
                    variant={i === 0 ? 'primary' : 'secondary'}
                    onPress={() => {
                      navigation.navigate('TimeOffRequest', {
                        ...(load.data.understood.leaveTypeKey === null
                          ? {}
                          : { leaveTypeKey: load.data.understood.leaveTypeKey }),
                        from: o.from,
                        to: o.to,
                      });
                    }}
                  >
                    Choose these dates
                  </Button>
                </Stack>
              </Card>
            ))
          )}
        </>
      )}
    </Page>
  );
}
