import {
  Alert,
  Badge,
  Button,
  List,
  ListItem,
  PageHeader,
  PageSection,
  SegmentedControl,
  SegmentedControlItem,
  Skeleton,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import { HolidayCalendar, type Layer } from './holiday-calendar';
import { PackNotice, Toggle, placeName, shortDate, type Pack } from './shared';

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
  /** The calendar open in its dialog (`?calendar=`), `new` for one being added. */
  readonly calendar?: string | null;
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
  /** Another state in the address: a calendar's dialog open or closed. */
  readonly onAsk?: (patch: Readonly<Record<string, string | null>>) => void;
  readonly onSaveCalendar?: (key: string, layer: Omit<Layer, 'key'>) => Promise<Outcome>;
  readonly onRemoveCalendar?: (key: string) => Promise<Outcome>;
  /** The calendars a location keeps, most general first. */
  readonly onAssign?: (locationKey: string, layerKeys: readonly string[]) => Promise<Outcome>;
}

const LEVELS: Record<Layer['level'], number> = { national: 0, regional: 1, city: 2 };
const LEVEL_NAME: Record<Layer['level'], string> = {
  national: 'National',
  regional: 'Regional',
  city: 'City',
};

/** The calendars a location keeps, ticked, saved with their own button (TOF-099a). */
function Keeps({
  location,
  layers,
  onAssign,
}: {
  readonly location: HolidaySettingsData['locations'][number];
  readonly layers: HolidaySettingsData['layers'];
  readonly onAssign: NonNullable<HolidaySettingsProps['onAssign']>;
}): JSX.Element {
  const [keys, setKeys] = useState<readonly string[]>(location.layerKeys);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const ordered = layers.toSorted((a, b) => LEVELS[a.level] - LEVELS[b.level]);
  const changed = keys.toSorted().join() !== location.layerKeys.toSorted().join();
  return (
    <PageSection title={`Calendars ${placeName(location.locationKey)} keeps`} surface>
      <div className="flex flex-col gap-3">
        {ordered.map((l) => (
          <Toggle
            key={l.key}
            kind="checkbox"
            label={l.name}
            description={LEVEL_NAME[l.level]}
            checked={keys.includes(l.key)}
            onChange={(on) => {
              setKeys(on ? [...keys, l.key] : keys.filter((k) => k !== l.key));
            }}
          />
        ))}
        {refused === null ? null : (
          <Alert tone="danger" title="Not saved">
            {refused}
          </Alert>
        )}
        <div>
          <Button
            size="sm"
            variant="primary"
            disabled={!changed}
            loading={busy}
            loadingLabel="Saving"
            onClick={() => {
              setBusy(true);
              setRefused(null);
              // Most general first, as the layers resolve.
              const next = ordered.map((l) => l.key).filter((k) => keys.includes(k));
              void onAssign(location.locationKey, next).then((outcome) => {
                setBusy(false);
                if (!outcome.ok) setRefused(outcome.message);
              });
            }}
          >
            Save calendars
          </Button>
        </div>
      </div>
    </PageSection>
  );
}

const TITLE = 'Holidays';
const DESCRIPTION =
  'Each person gets the holidays for the place they work. A holiday on a weekend follows the regional rules.';
const page = '@container/holidays flex flex-col gap-6';
const columns =
  'flex flex-col gap-6 @min-[48rem]/holidays:grid @min-[48rem]/holidays:grid-cols-[17rem_minmax(0,1fr)] @min-[48rem]/holidays:items-start';

export function HolidaySettings(props: HolidaySettingsProps): JSX.Element {
  const { load } = props;
  if (load.status === 'loading') return <HolidaySettingsSkeleton />;
  return (
    <div className={page}>
      {load.status === 'error' ? <PageHeader title={TITLE} description={DESCRIPTION} /> : null}
      <Loaded load={load} what="the holiday calendars">
        {(data) => <Ready {...props} data={data} />}
      </Loaded>
    </div>
  );
}

function Ready({
  data,
  onYear,
  onAsk,
  onSaveCalendar,
  onRemoveCalendar,
  onAssign,
}: HolidaySettingsProps & { readonly data: HolidaySettingsData }): JSX.Element {
  const here = (calendar: string): string =>
    `/settings/time-off/holidays/${String(data.year)}?${data.location === null ? '' : `location=${encodeURIComponent(data.location)}&`}calendar=${encodeURIComponent(calendar)}`;
  const editing =
    data.calendar === 'new'
      ? null
      : (data.layers.find((l) => l.key === data.calendar) ?? undefined);
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
          <>
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
            {onSaveCalendar === undefined ? null : (
              <Button asChild variant="primary" startIcon={<icons.add aria-hidden />}>
                <a href={here('new')}>Add calendar</a>
              </Button>
            )}
          </>
        }
      />
      {data.calendar === null ||
      data.calendar === undefined ||
      editing === undefined ||
      onSaveCalendar === undefined ? null : (
        <HolidayCalendar
          layer={editing}
          year={data.year}
          onSave={onSaveCalendar}
          {...(onRemoveCalendar === undefined ? {} : { onRemove: onRemoveCalendar })}
          onClose={() => onAsk?.({ calendar: null })}
        />
      )}
      <PackNotice packs={data.packs} />
      {chosen === undefined ? (
        <p className="text-sm text-fg-muted">
          Nobody has a work location yet, so no calendar applies to anyone.
        </p>
      ) : (
        <div className={columns}>
          <div className="flex min-w-0 flex-col gap-6">
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
            {onAssign === undefined ? null : (
              <Keeps
                key={`${chosen.locationKey} ${chosen.layerKeys.join()}`}
                location={chosen}
                layers={data.layers}
                onAssign={onAssign}
              />
            )}
            {onSaveCalendar === undefined ? null : (
              <List navigable aria-label="Calendars">
                {data.layers.map((l) => (
                  <ListItem
                    key={l.key}
                    asChild
                    description={`${LEVEL_NAME[l.level]} · ${String(
                      l.holidays.filter((h) => h.date.startsWith(String(data.year))).length,
                    )} days in ${String(data.year)}`}
                    chevron
                  >
                    <a href={here(l.key)}>{l.name}</a>
                  </ListItem>
                ))}
              </List>
            )}
          </div>
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
        <div className="flex min-w-0 flex-col gap-6">
          <Skeleton className="h-60 rounded-lg" />
          <Skeleton className="h-72 rounded-lg" />
          <Skeleton className="h-80 rounded-lg" />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Skeleton className="h-11 w-64 rounded-md" />
          <Skeleton className="h-[42rem] rounded-lg" />
        </div>
      </div>
    </div>
  );
}
