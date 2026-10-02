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
  Input,
  KeyValues,
  PageSection,
  RadioCard,
  RadioGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  icons,
} from '@reach/ui';
import { useId, type JSX } from 'react';

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
  readonly proposed: PlaceChoice;
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

const plural = (n: number, one: string, many: string): string =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

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
  const counts = tally(workplaces, choices);
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
      title={
        n === 1
          ? '1 work location in this file. Here’s how it maps.'
          : `${String(n)} work locations in this file. Here’s how each maps.`
      }
    >
      <p className="text-sm text-fg-muted">
        Map each to a work location here, add it as a new one, or leave it empty: the people it
        leaves are listed for HR. Nothing is added until you approve the plan.
      </p>
    </AssistantCard>
  );
  const note = readOnly ? (
    <Alert tone="info" title="An administrator sets up work locations">
      These are the suggestions. Until a People administrator maps or adds them, the rows import
      without a work location and HR is given the list.
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
  return (
    <div className="grid items-start gap-4 @4xl/page:grid-cols-[minmax(0,1fr)_21.25rem]">
      <div className="flex min-w-0 flex-col gap-3">
        {intro}
        {note}
        {cards}
      </div>
      <div className="flex flex-col gap-3.5">
        <PageSection surface title="From this file">
          <KeyValues
            items={[
              { label: 'Work locations named', value: n },
              { label: 'Already here', value: counts.here },
              { label: 'Mapped to one here', value: counts.mapped },
              { label: 'Added', value: counts.added },
              { label: 'People left empty', value: counts.left },
            ]}
          />
        </PageSection>
        <Alert tone="info" title="Added in Settings › Organisation">
          A new work location is added there with the name, country and time zone you give it, by
          the run that imports the file.
        </Alert>
      </div>
    </div>
  );
}

/** Where a value ends up, in words, for the card's title. */
function targetOf(choice: PlaceChoice, here: PlacesHere): string {
  if (choice.kind === 'leave') return 'Left empty';
  if (choice.kind === 'add') return choice.name.trim() === '' ? 'A new work location' : choice.name;
  return here.locations.find((l) => l.id === choice.locationId)?.name ?? 'A work location here';
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
  const people = plural(w.rows, 'person', 'people');
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
        Already here
      </Badge>
    ) : w.looksLikeId ? (
      <Badge tone="neutral" size="sm">
        An id from another system
      </Badge>
    ) : w.suggestion !== null ? (
      <Badge tone="assistant" size="sm">
        Close to {w.suggestion.name}
      </Badge>
    ) : (
      <Badge tone="info" size="sm">
        Not here yet
      </Badge>
    );
  const suggested = (kind: PlaceChoice['kind']) =>
    w.proposed.kind === kind
      ? {
          badge: (
            <Badge tone="assistant" size="sm">
              Suggested
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
          ? `${people} in the file`
          : `${people} in the file: ${w.people.join(', ')}${
              w.rows > w.people.length ? ` and ${String(w.rows - w.people.length)} more` : ''
            }`}
      </p>
      <RadioGroup
        aria-label={`What happens to “${w.value}”`}
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
              ? 'There are no work locations here yet'
              : `${people} join it`
          }
          {...suggested('map')}
        >
          Map it to a work location here
        </RadioCard>
        <RadioCard
          value="add"
          disabled={here.entities.length === 0}
          impact={
            here.entities.length === 0
              ? 'There is no legal entity to add it to yet'
              : 'Added in Settings › Organisation by the run'
          }
          {...suggested('add')}
        >
          Add it as a new work location
        </RadioCard>
        <RadioCard value="leave" impact={`${people} listed for HR`} {...suggested('leave')}>
          Leave it empty
        </RadioCard>
      </RadioGroup>
      {choice.kind === 'map' ? (
        <Field>
          <FieldLabel>Work location</FieldLabel>
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
                  {l.id === w.suggestion?.id ? `${l.name} (suggested)` : l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}
      {choice.kind === 'add' ? (
        <NewLocationFields choice={choice} here={here} readOnly={readOnly} onChange={onChange} />
      ) : null}
      {choice.kind === 'leave' && w.people.length > 0 ? (
        <DataTable
          label={`Left without a work location: “${w.value}”`}
          rows={w.people.map((name, i) => ({ id: `${String(i)} ${name}`, name }))}
          columns={[{ id: 'name', header: 'Name', cell: (r) => r.name }]}
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
        <FieldLabel>Name</FieldLabel>
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
          <FieldLabel>Legal entity</FieldLabel>
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
        <FieldLabel>Country</FieldLabel>
        <Select
          value={choice.country}
          disabled={readOnly}
          onValueChange={(country) => {
            set({ country });
          }}
        >
          <FieldControl>
            <SelectTrigger>
              <SelectValue placeholder="Choose a country" />
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
        <FieldLabel>Time zone</FieldLabel>
        <FieldControl>
          <Combobox
            label="Time zone"
            placeholder="Choose a time zone"
            searchPlaceholder="Search time zones"
            options={ZONES}
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
