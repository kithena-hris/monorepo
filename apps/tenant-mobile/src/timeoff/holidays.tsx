import {
  Button,
  CopyField,
  EmptyState,
  Icon,
  List,
  ListItem,
  SegmentedControl,
  SegmentedControlItem,
  Text,
} from '@reach/ui-native';
import { CalendarPlus, MapPin, PartyPopper } from 'lucide-react-native';
import { useState } from 'react';
import { Linking } from 'react-native';

import { Failed, Loading, Page } from '../frame';
import { useSigned } from '../people/api';
import type { PeopleScreen } from '../people/routes';
import { calendarFeed, useTimeOff } from './api';
import { todayHere } from './time';
import type { Bridge } from './today';
import { bridgeDays, relativeDay, shortDate } from './words';

interface HolidaysData {
  readonly year: number;
  readonly locationKey: string | null;
  readonly holidays: readonly {
    date: string;
    name: string;
    layer: string;
    movedFrom: string | null;
  }[];
  readonly bridges: readonly Bridge[];
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Holidays where you work (design MT21): this year's and next, national,
 * regional and city already resolved, the day that turns one into four, and
 * Add to my calendar — your own feed, your time off and these holidays.
 */
export function TimeOffHolidays({
  navigation,
}: PeopleScreen<'TimeOffHolidays'>): React.JSX.Element {
  const signed = useSigned();
  const thisYear = new Date().getUTCFullYear();
  const [year, setYear] = useState(thisYear);
  const { load, reload } = useTimeOff<HolidaysData>('TimeOffHolidays', { year });
  const [feed, setFeed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const today = todayHere();
  const back = { label: 'Time off', onPress: navigation.goBack };
  return (
    <Page title="Holidays" back={back}>
      <SegmentedControl
        fullWidth
        value={String(year)}
        accessibilityLabel="Year"
        onValueChange={(y) => {
          setYear(Number(y));
        }}
      >
        <SegmentedControlItem value={String(thisYear)}>{String(thisYear)}</SegmentedControlItem>
        <SegmentedControlItem value={String(thisYear + 1)}>
          {String(thisYear + 1)}
        </SegmentedControlItem>
      </SegmentedControl>
      {load.status === 'error' ? (
        <Failed message={load.message} onRetry={reload} />
      ) : load.status === 'loading' ? (
        <Loading label="Loading the holidays" />
      ) : (
        <>
          <ListItem listitem={false} icon={MapPin}>
            {load.data.locationKey === null
              ? 'No work location is on your record, so no public holidays apply.'
              : `${capital(load.data.locationKey)} · ${[...new Set(load.data.holidays.map((h) => h.layer))].join(', ')}`}
          </ListItem>
          {load.data.holidays.length === 0 ? (
            <EmptyState
              icon={PartyPopper}
              title="No public holidays"
              description="None apply where you work this year."
            />
          ) : (
            <List>
              {load.data.holidays.map((h) => {
                const bridge = load.data.bridges.find((b) => b.holidays[0]?.date === h.date);
                const note =
                  bridge !== undefined
                    ? `Take ${bridgeDays(bridge)} → ${String(bridge.away.days)} days off`
                    : h.movedFrom !== null
                      ? `Moved from ${shortDate(h.movedFrom)}`
                      : h.date >= today
                        ? relativeDay(today, h.date)
                        : 'Passed';
                return (
                  <ListItem
                    key={h.date}
                    icon={PartyPopper}
                    description={`${shortDate(h.date)} · ${note}`}
                  >
                    {h.name}
                  </ListItem>
                );
              })}
            </List>
          )}
        </>
      )}
      {feed === null ? (
        <Button
          fullWidth
          startIcon={<Icon icon={CalendarPlus} />}
          loading={busy}
          onPress={() => {
            setBusy(true);
            void calendarFeed(signed, 'me').then((answer) => {
              setBusy(false);
              if (!answer.ok) return;
              setFeed(answer.data.url);
              void Linking.openURL(answer.data.url.replace(/^https?:/, 'webcal:'));
            });
          }}
        >
          Add to my calendar
        </Button>
      ) : (
        <>
          <CopyField value={feed} label="Copy the feed address" mono />
          <Text variant="footnote" tone="muted">
            Your time off and these holidays, kept up to date in your calendar app.
          </Text>
        </>
      )}
    </Page>
  );
}
