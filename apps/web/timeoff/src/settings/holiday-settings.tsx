import {
  Alert,
  AssistantCard,
  Badge,
  Button,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  List,
  ListItem,
  PageHeader,
  PageSection,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Textarea,
  icons,
} from '@reach/ui';
import { useState, useTransition, type JSX } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import { PackNotice, placeName, shortDate, type Pack } from './shared';

/**
 * Holiday calendars (T36, TOF-083, TOF-112): each work location and the
 * layers it keeps, national, regional and city, and the year they make for it
 * (PRD §10.2). The year is in the address (`/settings/time-off/holidays/2027`),
 * the location in `?location=`.
 *
 * The assistant's draft: HR pastes the official list for a calendar, and Time
 * Off drafts the year from it, marking the days not confirmed yet (`?draft=`
 * and `?source=` in the address, so Time Off reads it again). Nothing is
 * saved by the draft. HR saves the confirmed days to the calendar, added to
 * what it already holds; the unconfirmed ones stay with HR.
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
  /** A year drafted from a list HR supplied, when the address asks for one (TOF-112). */
  readonly draft?: HolidayDraft | null;
  /** Why the draft could not be made, when Time Off refused it. */
  readonly draftProblem?: string | null;
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

export interface HolidayDraft {
  readonly layerKey: string;
  readonly layerName: string;
  readonly year: number;
  readonly days: readonly {
    readonly date: string;
    readonly name: string;
    readonly confirmed: boolean;
    readonly known: boolean;
  }[];
  readonly skipped: readonly string[];
  readonly summary: { readonly text: string; readonly ai: boolean };
  /** A model said which lines are confirmed. */
  readonly ai: boolean;
}

export interface HolidayLayerInput {
  readonly name: string;
  readonly level: 'national' | 'regional' | 'city';
  readonly weekendRule: 'move_to_monday' | 'none';
  readonly holidays: readonly { readonly date: string; readonly name: string }[];
}

export interface HolidaySettingsProps {
  readonly load: Loadable<HolidaySettingsData>;
  /** Another year's calendars. */
  readonly onYear?: (year: number) => void;
  /** Draft the year from a list (`null` for neither: start again). */
  readonly onDraft?: (draft: { readonly layerKey: string; readonly source: string } | null) => void;
  /** Save a calendar whole, as HR: the draft's confirmed days added to what it holds. */
  readonly onSaveLayer?: (key: string, layer: HolidayLayerInput) => Promise<Outcome>;
}

const TITLE = 'Holidays';
const DESCRIPTION =
  'Each person gets the holidays for the place they work. A holiday on a weekend follows the regional rules.';
const page = '@container/holidays flex flex-col gap-6';
const columns =
  'flex flex-col gap-6 @min-[48rem]/holidays:grid @min-[48rem]/holidays:grid-cols-[17rem_minmax(0,1fr)] @min-[48rem]/holidays:items-start';

export function HolidaySettings({
  load,
  onYear,
  onDraft,
  onSaveLayer,
}: HolidaySettingsProps): JSX.Element {
  if (load.status === 'loading') return <HolidaySettingsSkeleton />;
  return (
    <div className={page}>
      {load.status === 'error' ? <PageHeader title={TITLE} description={DESCRIPTION} /> : null}
      <Loaded load={load} what="the holiday calendars">
        {(data) => (
          <Ready data={data} onYear={onYear} onDraft={onDraft} onSaveLayer={onSaveLayer} />
        )}
      </Loaded>
    </div>
  );
}

function Ready({
  data,
  onYear,
  onDraft,
  onSaveLayer,
}: {
  readonly data: HolidaySettingsData;
  readonly onYear: HolidaySettingsProps['onYear'];
  readonly onDraft: HolidaySettingsProps['onDraft'];
  readonly onSaveLayer: HolidaySettingsProps['onSaveLayer'];
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
      {data.layers.length === 0 ? null : (
        <DraftCard data={data} onDraft={onDraft} onSaveLayer={onSaveLayer} />
      )}
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

/**
 * T36's assistant card (TOF-112): paste the list HR has for one calendar and
 * Time Off drafts the year from it; then the draft, the days not confirmed
 * yet marked, and HR's own Save, which adds only the confirmed days.
 */
function DraftCard({
  data,
  onDraft,
  onSaveLayer,
}: {
  readonly data: HolidaySettingsData;
  readonly onDraft: HolidaySettingsProps['onDraft'];
  readonly onSaveLayer: HolidaySettingsProps['onSaveLayer'];
}): JSX.Element {
  const draft = data.draft ?? null;
  const [layerKey, setLayerKey] = useState(draft?.layerKey ?? data.layers[0]?.key ?? '');
  const [source, setSource] = useState('');
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const year = String(data.year);
  if (draft === null) {
    return (
      <AssistantCard
        level={2}
        title={`Draft ${year} from a list`}
        note="Nothing is saved until you save it. Days not confirmed yet stay with you."
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (source.trim() !== '') onDraft?.({ layerKey, source: source.trim() });
          }}
        >
          <Field>
            <FieldLabel>Calendar</FieldLabel>
            <Select value={layerKey} onValueChange={setLayerKey}>
              <FieldControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                {data.layers.map((l) => (
                  <SelectItem key={l.key} value={l.key}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>The official list</FieldLabel>
            <FieldControl>
              <Textarea
                rows={4}
                maxLength={4000}
                value={source}
                placeholder="Paste the bulletin or a list, one holiday per line."
                onChange={(event) => {
                  setSource(event.target.value);
                }}
              />
            </FieldControl>
            <FieldDescription>
              From the bulletin or a dataset you are licensed to use.
            </FieldDescription>
          </Field>
          {data.draftProblem == null ? null : (
            <Alert tone="danger" title="No draft">
              {data.draftProblem}
            </Alert>
          )}
          <Button
            type="submit"
            className="self-start"
            startIcon={<icons.assistant aria-hidden />}
            disabled={source.trim() === '' || layerKey === ''}
          >
            {`Draft ${year}`}
          </Button>
        </form>
      </AssistantCard>
    );
  }
  const layer = data.layers.find((l) => l.key === draft.layerKey);
  const confirmed = draft.days.filter((d) => d.confirmed && !d.known);
  const toConfirm = draft.days.filter((d) => !d.confirmed).length;
  const save = (): void => {
    if (onSaveLayer === undefined || layer === undefined || confirmed.length === 0) return;
    setSaid(null);
    start(async () => {
      const outcome = await onSaveLayer(layer.key, {
        name: layer.name,
        level: layer.level,
        weekendRule: layer.weekendRule,
        holidays: [
          ...layer.holidays,
          ...confirmed.map((d) => ({ date: d.date, name: d.name })),
        ].toSorted((a, b) => a.date.localeCompare(b.date)),
      });
      setSaid(
        outcome.ok
          ? { ok: true, text: `Saved to ${layer.name}` }
          : { ok: false, text: outcome.message },
      );
    });
  };
  return (
    <AssistantCard
      level={2}
      title={`${String(draft.year)} is ready to review`}
      action={
        draft.ai || draft.summary.ai ? (
          <Badge tone="assistant" size="sm">
            AI
          </Badge>
        ) : undefined
      }
      note="Drafted from the list you supplied. It is never published by itself."
    >
      <p className="text-sm text-fg-muted">{draft.summary.text}</p>
      <List aria-label={`${draft.layerName} in ${String(draft.year)}, drafted`}>
        {draft.days.map((d) => (
          <ListItem
            key={d.date}
            description={shortDate(d.date)}
            trailing={
              d.known ? (
                <Badge size="sm" variant="outline">
                  Already on the calendar
                </Badge>
              ) : d.confirmed ? undefined : (
                <Badge size="sm" tone="warning">
                  To confirm
                </Badge>
              )
            }
          >
            {d.name}
          </ListItem>
        ))}
      </List>
      {draft.skipped.length === 0 ? null : (
        <p className="text-xs text-fg-subtle">{`Not read: ${draft.skipped.join(' · ')}`}</p>
      )}
      {said === null ? null : (
        <Alert tone={said.ok ? 'success' : 'danger'} title={said.ok ? said.text : 'Nothing saved'}>
          {said.ok ? undefined : said.text}
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={
            onSaveLayer === undefined || confirmed.length === 0 || pending || said?.ok === true
          }
          loading={pending}
          onClick={save}
        >
          {`Save ${String(confirmed.length)} confirmed ${confirmed.length === 1 ? 'day' : 'days'} to ${draft.layerName}`}
        </Button>
        <Button
          onClick={() => {
            onDraft?.(null);
          }}
        >
          Start again
        </Button>
      </div>
      {toConfirm === 0 ? null : (
        <p className="text-sm text-fg-muted">
          {`${String(toConfirm)} ${toConfirm === 1 ? 'day is' : 'days are'} left for you to confirm and add.`}
        </p>
      )}
    </AssistantCard>
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
