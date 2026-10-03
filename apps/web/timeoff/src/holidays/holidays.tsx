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
import { relativeDay, shortDate } from '../words';

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
  /** The days off that bridge a holiday to a weekend, from the shell (`timeoff-views.ts`). */
  readonly bridges: readonly {
    readonly take: string;
    readonly holiday: string;
    readonly days: number;
  }[];
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
      {load.status === 'error' ? <PageHeader title="Holidays" /> : null}
      <Loaded load={load} what="the holidays">
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
        title={`Holidays in ${String(data.year)}`}
        description={
          data.locationKey === null
            ? 'No work location is on your record, so no public holidays apply.'
            : `${capital(data.locationKey)} · ${layers.join(', ')} holidays`
        }
      />
      <div className="flex max-w-2xl flex-col gap-5">
        <SegmentedControl
          aria-label="Year"
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
          <p className="text-sm text-fg-muted">No public holidays on your calendar this year.</p>
        ) : (
          <List>
            {data.holidays.map((h) => {
              const bridge = data.bridges.find((b) => b.holiday === h.name);
              const note =
                bridge !== undefined
                  ? `Take ${shortDate(bridge.take)} → ${String(bridge.days)} days off`
                  : h.movedFrom !== null
                    ? `Moved from ${shortDate(h.movedFrom)}`
                    : h.date >= data.today
                      ? relativeDay(data.today, h.date)
                      : 'Passed';
              return (
                <ListItem
                  key={h.date}
                  icon={<icons.flagged />}
                  iconTone="neutral"
                  description={`${shortDate(h.date)} · ${note}`}
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
        <CopyField label="Copy the feed address" value={feed.url} />
        <p className="text-sm text-fg-muted">
          Subscribe to it in your calendar app: your time off and these holidays, kept up to date.
        </p>
        <Button asChild startIcon={<icons.calendar aria-hidden />}>
          <a href={feed.url.replace(/^https?:/, 'webcal:')}>Open in my calendar</a>
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
        Add to my calendar
      </Button>
      {feed?.ok === false ? (
        <Alert tone="danger" title="No calendar feed">
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
      <PageHeader title="Holidays" description={' '} />
      <div role="status" className="flex max-w-2xl flex-col gap-5">
        <span className="sr-only">Loading the holidays</span>
        <Skeleton className="h-9 rounded-full" />
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <Skeleton key={n} className="h-16 rounded-md" />
        ))}
        <Skeleton className="h-10 rounded-full" />
      </div>
    </div>
  );
}
