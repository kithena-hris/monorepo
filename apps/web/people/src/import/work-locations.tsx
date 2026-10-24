import {
  Alert,
  AssistantCard,
  Badge,
  Card,
  Combobox,
  DataTable,
  Field,
  FieldControl,
  FieldLabel,
  formatList,
  icons,
  Input,
  RadioCard,
  RadioGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@reach/ui';
import { useId, type JSX } from 'react';
import { t } from '../i18n';

/**
 * The work locations a file names, set up inside the import, right after
 * Map columns (the user: "Set up workplaces inline"). For each value the file
 * holds: map it to a work location here, add it as a new one with its name,
 * country and time zone, or leave it empty, the people it leaves listed by
 * name for HR. The choices go into the plan; the run applies them, an
 * administrator's only.
 */

export type PlaceChoice =
  | { readonly kind: 'map'; readonly locationId: string }
  | {
      readonly kind: 'add';
      readonly name: string;
      readonly country: string;
      readonly timeZone: string;
      readonly legalEntityId?: string;
    }
  | { readonly kind: 'leave' };

export interface WorkplaceValue {
  /** How the choice is keyed: the value however the file spells it. */
  readonly key: string;
  readonly value: string;
  readonly rows: number;
  /** Who, by name: the first twenty. */
  readonly people: readonly string[];
  readonly found: { readonly id: string; readonly name: string } | null;
  readonly suggestion: { readonly id: string; readonly name: string } | null;
  /** An id from another system: there is no name to add it by. */
  readonly looksLikeId: boolean;
  /** Prefilled from the file, ready to approve. */
  readonly proposed: PlaceChoice;
  /** What to check in the prefilled country and zone: the file disagrees with itself, or says nothing. */
  readonly note?: string | null;
}

export interface PlacesHere {
  readonly locations: readonly { readonly id: string; readonly name: string }[];
  readonly entities: readonly {
    readonly id: string;
    readonly name: string;
    readonly country: string;
    readonly timeZone: string;
  }[];
  readonly countries?: readonly { readonly code: string; readonly name: string }[];
}

export type PlaceChoices = Readonly<Record<string, PlaceChoice>>;
/** Every zone the browser knows, as Organisation's own picker lists them. */
const ZONES = [...new Set(['Etc/UTC', ...Intl.supportedValuesOf('timeZone')])].map((z) => ({
  value: z,
  label: z,
}));

/** What each value comes to: the counts in the side panel. */
function tally(workplaces: readonly WorkplaceValue[], choices: PlaceChoices) {
  const kind = (w: WorkplaceValue) => (choices[w.key] ?? w.proposed).kind;
  return {
    here: workplaces.filter((w) => w.found !== null && kind(w) === 'map').length,
    mapped: workplaces.filter((w) => w.found === null && kind(w) === 'map').length,
    added: workplaces.filter((w) => kind(w) === 'add').length,
    left: workplaces.filter((w) => kind(w) === 'leave').reduce((n, w) => n + w.rows, 0),
  };
}

export interface WorkLocationsStepProps {
  readonly workplaces: readonly WorkplaceValue[];
  readonly here: PlacesHere;
  readonly choices: PlaceChoices;
  readonly onChange: (key: string, choice: PlaceChoice) => void;
  /** HR without administrator rights: the suggestions, read-only. */
  readonly readOnly: boolean;
  readonly coarse: boolean;
}

/** "Work locations in this file": one card per value, and what comes of them. */
export function WorkLocationsStep({
  workplaces,
  here,
  choices,
  onChange,
  readOnly,
  coarse,
}: WorkLocationsStepProps): JSX.Element {
  const n = workplaces.length;
  const cards = workplaces.map((w) => (
    <WorkLocationCard
      key={w.key}
      workplace={w}
      here={here}
      choice={choices[w.key] ?? w.proposed}
      readOnly={readOnly}
      onChange={(choice) => {
        onChange(w.key, choice);
      }}
    />
  ));
  const intro = (
    <AssistantCard
      level={2}
      title={t(
        'import.work-locations.work_locations_in_this_file_heres',
        {
          one: '{{count}} work location in this file. Here’s how it maps.',
          other: '{{count}} work locations in this file. Here’s how each maps.',
        },
        { count: n },
      )}
    >
      <p className="text-sm text-fg-muted">
        {t(
          'import.work-locations.map_each_to_a_work_location',
          'Map each to a work location here, add it as a new one, or leave it empty: the people it leaves are listed for HR. Nothing is added until you approve the plan.',
        )}
      </p>
    </AssistantCard>
  );
  const note = readOnly ? (
    <Alert
      tone="info"
      title={t(
        'import.work-locations.an_administrator_sets_up_work_locations',
        'An administrator sets up work locations',
      )}
    >
      {t(
        'import.work-locations.these_are_the_suggestions_until_a',
        'These are the suggestions. Until a People administrator maps or adds them, the rows import without a work location and HR is given the list.',
      )}
    </Alert>
  ) : null;
  if (coarse) {
    return (
      <div className="flex flex-col gap-3">
        {intro}
        {note}
        {cards}
      </div>
    );
  }
  // At a desk, the content of Decide what's new's "Work locations" block:
  // one card per value, three to a row; its summary is the block's title line.
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {note}
      <div className="grid items-start gap-3 @3xl/page:grid-cols-2 @6xl/page:grid-cols-3">
        {cards}
      </div>
      <p className="text-sm text-fg-muted">
        {t(
          'import.work-locations.a_new_work_location_is_added',
          'A new work location is added in Settings › Organisation, with the name, country and time zone you give it, by the run that imports the file.',
        )}
      </p>
    </div>
  );
}

/** "3 in this file: 2 already here, 1 to add", for the block's title line. */
export function placesSummary(
  workplaces: readonly WorkplaceValue[],
  choices: PlaceChoices,
): string {
  const counts = tally(workplaces, choices);
  const parts = [
    counts.here + counts.mapped > 0
      ? t('import.work-locations.already_here', '{{value}} already here', {
          value: String(counts.here + counts.mapped),
        })
      : null,
    counts.added > 0
      ? t('import.work-locations.to_add', '{{added}} to add', { added: String(counts.added) })
      : null,
    counts.left > 0
      ? t(
          'import.work-locations.left_empty',
          { one: '{{count}} person left empty', other: '{{count}} people left empty' },
          { count: counts.left },
        )
      : null,
  ].filter((x) => x !== null);
  return t('import.work-locations.in_this_file', '{{length}} in this file{{value}}', {
    length: String(workplaces.length),
    value: parts.length === 0 ? '' : `: ${parts.join(', ')}`,
  });
}

/** Where a value ends up, in words, for the card's title. */
function targetOf(choice: PlaceChoice, here: PlacesHere): string {
  if (choice.kind === 'leave') return t('import.work-locations.left_empty_2', 'Left empty');
  if (choice.kind === 'add')
    return choice.name.trim() === ''
      ? t('import.work-locations.a_new_work_location', 'A new work location')
      : choice.name;
  return (
    here.locations.find((l) => l.id === choice.locationId)?.name ??
    t('import.work-locations.a_work_location_here', 'A work location here')
  );
}

function WorkLocationCard({
  workplace: w,
  here,
  choice,
  readOnly,
  onChange,
}: {
  readonly workplace: WorkplaceValue;
  readonly here: PlacesHere;
  readonly choice: PlaceChoice;
  readonly readOnly: boolean;
  readonly onChange: (choice: PlaceChoice) => void;
}): JSX.Element {
  const id = useId();
  const people = t(
    'import.work-locations.count_people',
    { one: '{{count}} person', other: '{{count}} people' },
    { count: w.rows },
  );
  const [entity] = here.entities;
  const added: Extract<PlaceChoice, { kind: 'add' }> =
    choice.kind === 'add'
      ? choice
      : w.proposed.kind === 'add'
        ? w.proposed
        : {
            kind: 'add',
            name: w.looksLikeId ? '' : w.value,
            country: entity?.country ?? '',
            timeZone: entity?.timeZone ?? '',
          };
  const mapTo =
    choice.kind === 'map'
      ? choice.locationId
      : (w.found?.id ?? w.suggestion?.id ?? here.locations[0]?.id ?? null);
  const badge =
    w.found !== null ? (
      <Badge tone="success" size="sm">
        {t('import.work-locations.already_here_2', 'Already here')}
      </Badge>
    ) : w.looksLikeId ? (
      <Badge tone="neutral" size="sm">
        {t('import.work-locations.an_id_from_another_system', 'An id from another system')}
      </Badge>
    ) : w.suggestion !== null ? (
      <Badge tone="assistant" size="sm">
        {t('import.work-locations.close_to', 'Close to')} {w.suggestion.name}
      </Badge>
    ) : (
      <Badge tone="info" size="sm">
        {t('import.work-locations.not_here_yet', 'Not here yet')}
      </Badge>
    );
  const suggested = (kind: PlaceChoice['kind']) =>
    w.proposed.kind === kind
      ? {
          badge: (
            <Badge tone="assistant" size="sm">
              {t('import.work-locations.suggested', 'Suggested')}
            </Badge>
          ),
        }
      : {};
  return (
    <Card padded aria-labelledby={`${id}-title`} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="min-w-0 font-mono text-xs break-all text-fg-subtle">{w.value}</span>
        <icons.forward aria-hidden className="size-3.5 shrink-0 text-fg-subtle" />
        <h3 id={`${id}-title`} className="min-w-32 flex-1 text-base font-bold">
          {targetOf(choice, here)}
        </h3>
        {badge}
      </div>
      <p className="text-sm text-fg-muted">
        {/* Left empty, the people are the table below: named once. */}
        {choice.kind === 'leave' || w.people.length === 0
          ? t('import.work-locations.in_the_file', '{{people}} in the file', { people })
          : w.rows > w.people.length
            ? t('import.work-locations.in_the_file_and_more', '{{people}} in the file: {{join}}', {
                people,
                join: formatList([
                  ...w.people,
                  t(
                    'import.work-locations.more_people',
                    { one: '{{count}} more', other: '{{count}} more' },
                    { count: w.rows - w.people.length },
                  ),
                ]),
              })
            : t('import.work-locations.in_the_file_2', '{{people}} in the file: {{join}}', {
                people,
                join: formatList(w.people, 'unit', 'short'),
              })}
      </p>
      <RadioGroup
        aria-label={t('import.work-locations.what_happens_to', 'What happens to “{{value}}”', {
          value: w.value,
        })}
        value={choice.kind}
        disabled={readOnly}
        onValueChange={(kind) => {
          if (kind === 'leave') onChange({ kind: 'leave' });
          else if (kind === 'add') onChange(added);
          else if (mapTo !== null) onChange({ kind: 'map', locationId: mapTo });
        }}
        className="flex flex-col gap-2"
      >
        <RadioCard
          value="map"
          disabled={here.locations.length === 0}
          impact={
            here.locations.length === 0
              ? t(
                  'import.work-locations.there_are_no_work_locations_here',
                  'There are no work locations here yet',
                )
              : t('import.work-locations.join_it', '{{people}} join it', { people })
          }
          {...suggested('map')}
        >
          {t('import.work-locations.map_it_to_a_work_location', 'Map it to a work location here')}
        </RadioCard>
        <RadioCard
          value="add"
          disabled={here.entities.length === 0}
          impact={
            here.entities.length === 0
              ? t(
                  'import.work-locations.there_is_no_legal_entity_to',
                  'There is no legal entity to add it to yet',
                )
              : t(
                  'import.work-locations.added_in_settings_organisation_by_the',
                  'Added in Settings › Organisation by the run',
                )
          }
          {...suggested('add')}
        >
          {t('import.work-locations.add_it_as_a_new_work', 'Add it as a new work location')}
        </RadioCard>
        <RadioCard
          value="leave"
          impact={t('import.work-locations.listed_for_hr', '{{people}} listed for HR', { people })}
          {...suggested('leave')}
        >
          {t('import.work-locations.leave_it_empty', 'Leave it empty')}
        </RadioCard>
      </RadioGroup>
      {choice.kind === 'map' ? (
        <Field>
          <FieldLabel>{t('import.work-locations.work_location', 'Work location')}</FieldLabel>
          <Select
            value={choice.locationId}
            disabled={readOnly}
            onValueChange={(locationId) => {
              onChange({ kind: 'map', locationId });
            }}
          >
            <FieldControl>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
            </FieldControl>
            <SelectContent>
              {here.locations.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.id === w.suggestion?.id
                    ? t('import.work-locations.suggested_2', '{{name}} (suggested)', {
                        name: l.name,
                      })
                    : l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}
      {choice.kind === 'add' && w.note ? (
        <Alert
          tone="warning"
          title={t('import.work-locations.check_where_it_is', 'Check where it is')}
        >
          {w.note}
        </Alert>
      ) : null}
      {choice.kind === 'add' ? (
        <NewLocationFields choice={choice} here={here} readOnly={readOnly} onChange={onChange} />
      ) : null}
      {choice.kind === 'leave' && w.people.length > 0 ? (
        <DataTable
          label={t(
            'import.work-locations.left_without_a_work_location',
            'Left without a work location: “{{value}}”',
            { value: w.value },
          )}
          rows={w.people.map((name, i) => ({ id: `${String(i)} ${name}`, name }))}
          columns={[
            { id: 'name', header: t('import.work-locations.name', 'Name'), cell: (r) => r.name },
          ]}
          rowId={(r) => r.id}
          dense
        />
      ) : null}
    </Card>
  );
}

/** The details a new work location needs, as Organisation asks for them. */
function NewLocationFields({
  choice,
  here,
  readOnly,
  onChange,
}: {
  readonly choice: Extract<PlaceChoice, { kind: 'add' }>;
  readonly here: PlacesHere;
  readonly readOnly: boolean;
  readonly onChange: (choice: PlaceChoice) => void;
}): JSX.Element {
  const set = (patch: Partial<Omit<Extract<PlaceChoice, { kind: 'add' }>, 'kind'>>): void => {
    onChange({ ...choice, ...patch });
  };
  const countries = here.countries ?? [];
  return (
    <div className="grid gap-4 border-t border-border pt-4 @2xl/page:grid-cols-2">
      <Field required invalid={choice.name.trim() === ''}>
        <FieldLabel>{t('import.work-locations.name', 'Name')}</FieldLabel>
        <FieldControl>
          <Input
            value={choice.name}
            disabled={readOnly}
            onChange={(e) => {
              set({ name: e.target.value });
            }}
          />
        </FieldControl>
      </Field>
      {here.entities.length > 1 ? (
        <Field>
          <FieldLabel>{t('import.work-locations.legal_entity', 'Legal entity')}</FieldLabel>
          <Select
            value={choice.legalEntityId ?? here.entities[0]?.id ?? ''}
            disabled={readOnly}
            onValueChange={(legalEntityId) => {
              set({ legalEntityId });
            }}
          >
            <FieldControl>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
            </FieldControl>
            <SelectContent>
              {here.entities.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}
      <Field required>
        <FieldLabel>{t('import.work-locations.country', 'Country')}</FieldLabel>
        <Select
          value={choice.country}
          disabled={readOnly}
          onValueChange={(country) => {
            set({ country });
          }}
        >
          <FieldControl>
            <SelectTrigger>
              <SelectValue
                placeholder={t('import.work-locations.choose_a_country', 'Choose a country')}
              />
            </SelectTrigger>
          </FieldControl>
          <SelectContent>
            {countries.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field required>
        <FieldLabel>{t('import.work-locations.time_zone', 'Time zone')}</FieldLabel>
        <FieldControl>
          <Combobox
            label={t('import.work-locations.time_zone', 'Time zone')}
            placeholder={t('import.work-locations.choose_a_time_zone', 'Choose a time zone')}
            searchPlaceholder={t('import.work-locations.search_time_zones', 'Search time zones')}
            options={
              // The file's zone, even where this browser lists it by another name (Asia/Calcutta).
              choice.timeZone === '' || ZONES.some((z) => z.value === choice.timeZone)
                ? ZONES
                : [{ value: choice.timeZone, label: choice.timeZone }, ...ZONES]
            }
            value={choice.timeZone === '' ? null : choice.timeZone}
            disabled={readOnly}
            onChange={(next) => {
              if (typeof next === 'string') set({ timeZone: next });
            }}
          />
        </FieldControl>
      </Field>
    </div>
  );
}

/** Whether every value can go into the plan: a new one needs a name, a country and a zone. */
export function placesReady(workplaces: readonly WorkplaceValue[], choices: PlaceChoices): boolean {
  return workplaces.every((w) => {
    const c = choices[w.key] ?? w.proposed;
    return c.kind !== 'add' || (c.name.trim() !== '' && c.country !== '' && c.timeZone !== '');
  });
}
