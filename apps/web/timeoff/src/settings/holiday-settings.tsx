import {
  Badge,
  List,
  ListItem,
  PageHeader,
  PageSection,
  SegmentedControl,
  SegmentedControlItem,
  Skeleton,
} from '@reach/ui';
import type { JSX } from 'react';

import { Loaded, type Loadable } from '../load';
import { PackNotice, placeName, shortDate, type Pack } from './shared';

/**
 * Holiday calendars (T36 without the assistant's draft, TOF-083): each work
 * location and the layers it keeps, national, regional and city, and the
 * year they make for it (PRD §10.2). The year is in the address
 * (`/settings/time-off/holidays/2027`), the location in `?location=`.
 *
 * At a desk the locations sit beside the year's days; under 48rem of the
 * page's own width the days follow the locations.
 */

export interface HolidaySettingsData {
  readonly year: number;
  /** The year it is now, for the switch between this year and the next. */
  readonly thisYear: number;
  /** The address's location; the first otherwise. */
  readonly location: string | null;
  readonly packs: readonly Pack[];
  readonly layers: readonly {
    readonly key: string;
    readonly name: string;
    readonly level: 'national' | 'regional' | 'city';
    readonly weekendRule: 'move_to_monday' | 'none';
    readonly holidays: readonly { readonly date: string; readonly name: string }[];
  }[];
  readonly locations: readonly {
    readonly locationKey: string;
    readonly layerKeys: readonly string[];
    readonly holidays: readonly {
      readonly date: string;
      readonly name: string;
      readonly layer: string;
      readonly movedFrom: string | null;
    }[];
  }[];
}

export interface HolidaySettingsProps {
  readonly load: Loadable<HolidaySettingsData>;
  /** Another year's calendars. */
  readonly onYear?: (year: number) => void;
}

const TITLE = 'Holidays';
const DESCRIPTION =
  'Each person gets the holidays for the place they work. A holiday on a weekend follows the regional rules.';
const page = '@container/holidays flex flex-col gap-6';
const columns =
  'flex flex-col gap-6 @min-[48rem]/holidays:grid @min-[48rem]/holidays:grid-cols-[17rem_minmax(0,1fr)] @min-[48rem]/holidays:items-start';

export function HolidaySettings({ load, onYear }: HolidaySettingsProps): JSX.Element {
  if (load.status === 'loading') return <HolidaySettingsSkeleton />;
  return (
    <div className={page}>
      {load.status === 'error' ? <PageHeader title={TITLE} description={DESCRIPTION} /> : null}
      <Loaded load={load} what="the holiday calendars">
        {(data) => <Ready data={data} onYear={onYear} />}
      </Loaded>
    </div>
  );
}

function Ready({
  data,
  onYear,
}: {
  readonly data: HolidaySettingsData;
  readonly onYear: HolidaySettingsProps['onYear'];
}): JSX.Element {
  const years = [...new Set([data.thisYear, data.thisYear + 1, data.year])].toSorted();
  const layerName = new Map(data.layers.map((l) => [l.key, l.name]));
  const layersOf = (keys: readonly string[]): string =>
    keys.map((k) => layerName.get(k) ?? k).join(' + ');
  const chosen = data.locations.find((l) => l.locationKey === data.location) ?? data.locations[0];
  return (
    <>
      <PageHeader
        title={TITLE}
        description={DESCRIPTION}
        actions={
          <SegmentedControl
            aria-label="Year"
            size="sm"
            value={String(data.year)}
            onValueChange={(year) => {
              if (year !== '') onYear?.(Number(year));
            }}
          >
            {years.map((y) => (
              <SegmentedControlItem key={y} value={String(y)}>
                {String(y)}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        }
      />
      <PackNotice packs={data.packs} />
      {chosen === undefined ? (
        <p className="text-sm text-fg-muted">
          Nobody has a work location yet, so no calendar applies to anyone.
        </p>
      ) : (
        <div className={columns}>
          <List navigable aria-label="Work locations">
            {data.locations.map((l) => {
              const current = l.locationKey === chosen.locationKey;
              return (
                <ListItem
                  key={l.locationKey}
                  asChild
                  selected={current}
                  description={layersOf(l.layerKeys)}
                  meta={`${String(l.holidays.length)} days`}
                >
                  <a
                    href={`/settings/time-off/holidays/${String(data.year)}?location=${encodeURIComponent(l.locationKey)}`}
                    aria-current={current ? 'page' : undefined}
                  >
                    {placeName(l.locationKey)}
                  </a>
                </ListItem>
              );
            })}
          </List>
          <PageSection
            title={`${placeName(chosen.locationKey)} in ${String(data.year)}`}
            description={layersOf(chosen.layerKeys)}
          >
            {chosen.holidays.length === 0 ? (
              <p className="text-sm text-fg-muted">
                {`No holidays for ${String(data.year)} yet. Each year’s calendars are published in the autumn before it.`}
              </p>
            ) : (
              <List aria-label={`Holidays in ${placeName(chosen.locationKey)}`}>
                {chosen.holidays.map((h) => (
                  <ListItem
                    key={`${h.date} ${h.name}`}
                    description={
                      h.movedFrom === null
                        ? shortDate(h.date)
                        : `${shortDate(h.date)}, moved from ${shortDate(h.movedFrom)}`
                    }
                    trailing={
                      <Badge size="sm" variant="outline">
                        {layerName.get(h.layer) ?? h.layer}
                      </Badge>
                    }
                  >
                    {h.name}
                  </ListItem>
                ))}
              </List>
            )}
          </PageSection>
        </div>
      )}
    </>
  );
}

/** The page while it loads: the year switch's row, the locations and a year's days. */
export function HolidaySettingsSkeleton(): JSX.Element {
  return (
    <div className={page}>
      <PageHeader
        title={TITLE}
        description={DESCRIPTION}
        actions={<Skeleton className="h-8 w-28 rounded-full" />}
      />
      <div role="status" className={columns}>
        <span className="sr-only">Loading holidays</span>
        <Skeleton className="h-60 rounded-lg" />
        <div className="flex min-w-0 flex-col gap-4">
          <Skeleton className="h-11 w-64 rounded-md" />
          <Skeleton className="h-[42rem] rounded-lg" />
        </div>
      </div>
    </div>
  );
}
