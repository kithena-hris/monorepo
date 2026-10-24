import {
  Alert,
  Button,
  CopyField,
  List,
  ListItem,
  PageHeader,
  SegmentedControl,
  SegmentedControlItem,
  Skeleton,
  icons,
} from '@reach/ui';
import { useState, useTransition, type JSX } from 'react';

import { Loaded, type Loadable } from '../load';
import type { Bridge } from '../overview/overview';
import { bridgeDays, relativeDay, shortDate } from '../words';
import { t } from '../i18n';

/**
 * Holidays where you work (MT21, PRD §10.2): the public holidays the
 * caller's work location observes in a year — national, regional and city
 * layers already resolved by Time Off, a holiday moved off a weekend saying
 * so — with the day that turns one into four, and "Add to my calendar",
 * which issues the caller's own iCalendar feed (their time off and these).
 */

export interface HolidaysData {
  readonly year: number;
  readonly locationKey: string | null;
  readonly holidays: readonly {
    readonly date: string;
    readonly name: string;
    /** `national`, `regional` or `city`, or the layer's key. */
    readonly layer: string;
    readonly movedFrom: string | null;
  }[];
  /** The year's bridge days still ahead, as Time Off found them (TOF-085). */
  readonly bridges: readonly Pick<Bridge, 'from' | 'to' | 'away' | 'holidays'>[];
  readonly today: string;
}

export type Feed =
  { readonly ok: true; readonly url: string } | { readonly ok: false; readonly message: string };

export interface HolidaysProps {
  readonly load: Loadable<HolidaysData>;
  /** Another year: the host goes to its address. */
  readonly onNavigate?: ((href: string) => void) | undefined;
  /** Issue the caller's feed and answer with its address. */
  readonly onSubscribe?: (() => Promise<Feed>) | undefined;
}

export function Holidays({ load, onNavigate, onSubscribe }: HolidaysProps): JSX.Element {
  if (load.status === 'loading') return <HolidaysSkeleton />;
  return (
    <div className="flex flex-col gap-6">
      {load.status === 'error' ? (
        <PageHeader title={t('holidays.holidays.holidays', 'Holidays')} />
      ) : null}
      <Loaded load={load} what={t('holidays.holidays.the_holidays', 'the holidays')}>
        {(data) => <Ready data={data} onNavigate={onNavigate} onSubscribe={onSubscribe} />}
      </Loaded>
    </div>
  );
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function Ready({
  data,
  onNavigate,
  onSubscribe,
}: { readonly data: HolidaysData } & Omit<HolidaysProps, 'load'>): JSX.Element {
  const thisYear = Number(data.today.slice(0, 4));
  const layers = [...new Set(data.holidays.map((h) => h.layer))];
  return (
    <>
      <PageHeader
        title={t('holidays.holidays.holidays_in', 'Holidays in {{year}}', {
          year: String(data.year),
        })}
        description={
          data.locationKey === null
            ? t(
                'holidays.holidays.no_work_location_is_on_your',
                'No work location is on your record, so no public holidays apply.',
              )
            : t('holidays.holidays.holidays_2', '{{capital}} · {{join}} holidays', {
                capital: capital(data.locationKey),
                join: layers.join(', '),
              })
        }
      />
      <div className="flex max-w-2xl flex-col gap-5">
        <SegmentedControl
          aria-label={t('holidays.holidays.year', 'Year')}
          fullWidth
          value={String(data.year)}
          onValueChange={(year) => {
            onNavigate?.(`/time-off/holidays/${year}`);
          }}
        >
          {[thisYear, thisYear + 1].map((y) => (
            <SegmentedControlItem key={y} value={String(y)}>
              {String(y)}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        {data.holidays.length === 0 ? (
          <p className="text-sm text-fg-muted">
            {t(
              'holidays.holidays.no_public_holidays_on_your_calendar',
              'No public holidays on your calendar this year.',
            )}
          </p>
        ) : (
          <List>
            {data.holidays.map((h) => {
              const bridge = data.bridges.find((b) => b.holidays[0]?.date === h.date);
              const note =
                bridge !== undefined
                  ? t(
                      'holidays.holidays.take_days_off',
                      'Take {{bridgeDays}} → {{days}} days off',
                      { bridgeDays: bridgeDays(bridge), days: String(bridge.away.days) },
                    )
                  : h.movedFrom !== null
                    ? t('holidays.holidays.moved_from', 'Moved from {{movedFrom}}', {
                        movedFrom: shortDate(h.movedFrom),
                      })
                    : h.date >= data.today
                      ? relativeDay(data.today, h.date)
                      : t('holidays.holidays.passed', 'Passed');
              return (
                <ListItem
                  key={h.date}
                  icon={<icons.flagged />}
                  iconTone="neutral"
                  description={t('holidays.holidays.text', '{{date}} · {{note}}', {
                    date: shortDate(h.date),
                    note,
                  })}
                >
                  {h.name}
                </ListItem>
              );
            })}
          </List>
        )}
        <Subscribe onSubscribe={onSubscribe} />
      </div>
    </>
  );
}

function Subscribe({ onSubscribe }: Pick<HolidaysProps, 'onSubscribe'>): JSX.Element {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [pending, start] = useTransition();
  if (feed?.ok === true) {
    return (
      <div className="flex flex-col gap-3">
        <CopyField
          label={t('holidays.holidays.copy_the_feed_address', 'Copy the feed address')}
          value={feed.url}
        />
        <p className="text-sm text-fg-muted">
          {t(
            'holidays.holidays.subscribe_to_it_in_your_calendar',
            'Subscribe to it in your calendar app: your time off and these holidays, kept up to date.',
          )}
        </p>
        <Button asChild startIcon={<icons.calendar aria-hidden />}>
          <a href={feed.url.replace(/^https?:/, 'webcal:')}>
            {t('holidays.holidays.open_in_my_calendar', 'Open in my calendar')}
          </a>
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <Button
        fullWidth
        startIcon={<icons.calendar aria-hidden />}
        disabled={onSubscribe === undefined}
        loading={pending}
        onClick={() => {
          if (onSubscribe === undefined) return;
          start(async () => {
            setFeed(await onSubscribe());
          });
        }}
      >
        {t('holidays.holidays.add_to_my_calendar', 'Add to my calendar')}
      </Button>
      {feed?.ok === false ? (
        <Alert tone="danger" title={t('holidays.holidays.no_calendar_feed', 'No calendar feed')}>
          {feed.message}
        </Alert>
      ) : null}
    </div>
  );
}

/** The page while it loads, in its shape: the years, the list, the button. */
function HolidaysSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('holidays.holidays.holidays', 'Holidays')} description={' '} />
      <div role="status" className="flex max-w-2xl flex-col gap-5">
        <span className="sr-only">
          {t('holidays.holidays.loading_the_holidays', 'Loading the holidays')}
        </span>
        <Skeleton className="h-9 rounded-full" />
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <Skeleton key={n} className="h-16 rounded-md" />
        ))}
        <Skeleton className="h-10 rounded-full" />
      </div>
    </div>
  );
}
