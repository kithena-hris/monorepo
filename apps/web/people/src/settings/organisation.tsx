import {
  Alert,
  Badge,
  Button,
  Combobox,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  NumberField,
  PageHeader,
  PageSection,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  type IsoDate,
} from '@reach/ui';
import { useState, type JSX, type ReactNode } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';

/**
 * Legal entities, locations, employee numbering and the company's settings
 * (PEO-119; PRD §6.8, §9.4).
 *
 * Every "today" in People is read on these calendars, so this is where a
 * People administrator says whose day it is. Anybody in the tenant reads the
 * screen; only a People administrator is offered the controls, and People
 * refuses anybody else whatever a screen offers.
 */

export interface LegalEntity {
  readonly id: string;
  readonly name: string;
  readonly country: string;
  readonly timeZone: string;
  readonly archived: boolean;
}

export interface Place {
  readonly id: string;
  readonly legalEntityId: string;
  readonly name: string;
  readonly country: string;
  /** The zone in force today. */
  readonly timeZone: string;
  readonly zones: readonly { readonly effectiveFrom: string; readonly timeZone: string }[];
  readonly archived: boolean;
}

export interface Numbering {
  readonly legalEntityId: string;
  readonly prefix: string;
  readonly digits: number;
  readonly nextValue: number;
}

/** A statutory retention floor and its legal review (PEO-126). Law, the same for every tenant. */
export interface RetentionFloor {
  readonly floor: string;
  readonly months: number;
  readonly status: 'unreviewed' | 'reviewed';
  readonly reviewedBy: string | null;
  readonly reviewedOn: string | null;
}

/** A pay band for one grade and currency from a day, in minor units (PEO-078). */
export interface PayBand {
  readonly id: string;
  readonly grade: string;
  readonly currency: string;
  readonly minimumMinor: string;
  readonly midpointMinor: string;
  readonly maximumMinor: string;
  readonly effectiveFrom: string;
  readonly recordedAt: string;
  readonly supersedes: string | null;
}

export interface PayBandInput {
  grade: string;
  currency: string;
  minimumMinor: string;
  midpointMinor: string;
  maximumMinor: string;
  effectiveFrom: string;
}

export interface OrganisationState {
  readonly canManage: boolean;
  /** HR's and finance's, who both edit them; null or absent for anybody else. */
  readonly payBands?: readonly PayBand[] | null;
  readonly settings: {
    readonly defaultTimeZone: string;
    readonly cohortMinimum: number;
    readonly slug: string | null;
    readonly displayName: string | null;
  };
  readonly legalEntities: readonly LegalEntity[];
  readonly locations: readonly Place[];
  readonly numberings: readonly Numbering[];
  readonly countries: readonly { readonly code: string; readonly name: string }[];
  readonly timeZones: readonly string[];
  readonly retentionFloors: readonly RetentionFloor[];
}

export interface OrganisationProps {
  readonly load: Loadable<OrganisationState>;
  readonly onUpdateSettings: (patch: {
    defaultTimeZone?: string;
    cohortMinimum?: number;
  }) => Promise<Outcome>;
  readonly onCreateEntity: (input: {
    name: string;
    country: string;
    timeZone: string;
  }) => Promise<Outcome>;
  readonly onUpdateEntity: (
    id: string,
    patch: { name?: string; timeZone?: string; archived?: boolean },
  ) => Promise<Outcome>;
  readonly onCreateLocation: (input: {
    legalEntityId: string;
    name: string;
    country: string;
    timeZone: string;
    effectiveFrom?: string;
  }) => Promise<Outcome>;
  readonly onUpdateLocation: (
    id: string,
    patch: { name?: string; archived?: boolean },
  ) => Promise<Outcome>;
  readonly onChangeZone: (id: string, timeZone: string, effectiveFrom: string) => Promise<Outcome>;
  readonly onSetNumbering: (
    legalEntityId: string,
    scheme: { prefix: string; digits: number; start: number },
  ) => Promise<Outcome>;
  readonly onSetPayBand?: (band: PayBandInput) => Promise<Outcome>;
}

/** Today where a zone is: a location's zone change is in force once its day has begun there. */
export function todayIn(zone: string, at: Date = new Date()): IsoDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** `ES-` and 5 from 42 write `ES-00042`, and grow past the width rather than wrap. */
export const numberOf = (prefix: string, digits: number, value: number): string =>
  `${prefix}${String(value).padStart(digits, '0')}`;

export function Organisation(props: OrganisationProps): JSX.Element {
  return (
    <Loaded load={props.load} what="the organisation settings">
      {(state) => <Settings {...props} state={state} />}
    </Loaded>
  );
}

type Editing =
  | { readonly kind: 'entity'; readonly entity: LegalEntity | null }
  | { readonly kind: 'location'; readonly location: Place | null }
  | { readonly kind: 'zone'; readonly location: Place }
  | { readonly kind: 'numbering'; readonly entity: LegalEntity };

function Settings(props: OrganisationProps & { readonly state: OrganisationState }): JSX.Element {
  const { state } = props;
  const [editing, setEditing] = useState<Editing | null>(null);
  const close = (): void => {
    setEditing(null);
  };
  return (
    <Stack gap={6}>
      <PageHeader
        title="Organisation"
        description="Legal entities, locations and their time zones, employee numbering and the company’s settings. Every “today” in People is read on these calendars."
      />
      {state.canManage ? null : (
        <Alert tone="info">Only a People administrator can change these.</Alert>
      )}
      <Tabs defaultValue="entities">
        <TabsList aria-label="Organisation settings">
          <TabsTrigger value="entities">Legal entities</TabsTrigger>
          <TabsTrigger value="locations">Locations</TabsTrigger>
          <TabsTrigger value="numbering">Employee numbering</TabsTrigger>
          <TabsTrigger value="company">Company</TabsTrigger>
          {state.payBands == null ? null : <TabsTrigger value="pay">Pay bands</TabsTrigger>}
        </TabsList>
        <TabsContent value="entities">
          <Entities state={state} onEdit={setEditing} onUpdate={props.onUpdateEntity} />
        </TabsContent>
        <TabsContent value="locations">
          <Locations state={state} onEdit={setEditing} onUpdate={props.onUpdateLocation} />
        </TabsContent>
        <TabsContent value="numbering">
          <Numberings state={state} onEdit={setEditing} />
        </TabsContent>
        <TabsContent value="company">
          <Stack gap={6}>
            <Company state={state} onSave={props.onUpdateSettings} />
            <RetentionFloors floors={state.retentionFloors} />
          </Stack>
        </TabsContent>
        {state.payBands == null ? null : (
          <TabsContent value="pay">
            <PayBands bands={state.payBands} onSet={props.onSetPayBand} />
          </TabsContent>
        )}
      </Tabs>
      {editing === null ? null : (
        <EditDialog editing={editing} state={state} props={props} onClose={close} />
      )}
    </Stack>
  );
}

const countryName = (state: OrganisationState, code: string): string =>
  state.countries.find((c) => c.code === code)?.name ?? code;

/** Archive or restore at once: nothing is lost either way, so there is nothing to confirm. */
function ArchiveButton({
  name,
  archived,
  onToggle,
}: {
  readonly name: string;
  readonly archived: boolean;
  readonly onToggle: () => Promise<Outcome>;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        size="sm"
        loading={busy}
        loadingLabel="Saving"
        aria-label={`${archived ? 'Restore' : 'Archive'} ${name}`}
        onClick={() => {
          setBusy(true);
          setRefused(null);
          void onToggle().then((outcome) => {
            setBusy(false);
            if (!outcome.ok) setRefused(outcome.message);
          });
        }}
      >
        {archived ? 'Restore' : 'Archive'}
      </Button>
      {refused === null ? null : <span className="text-danger-fg text-xs">{refused}</span>}
    </span>
  );
}

function Entities({
  state,
  onEdit,
  onUpdate,
}: {
  readonly state: OrganisationState;
  readonly onEdit: (editing: Editing) => void;
  readonly onUpdate: OrganisationProps['onUpdateEntity'];
}): JSX.Element {
  return (
    <Stack gap={4}>
      {state.canManage ? (
        <div>
          <Button
            variant="primary"
            onClick={() => {
              onEdit({ kind: 'entity', entity: null });
            }}
          >
            Add legal entity
          </Button>
        </div>
      ) : null}
      {state.legalEntities.length === 0 ? (
        <EmptyState
          title="No legal entities yet"
          description="The company’s first one comes from the back office; add others here."
        />
      ) : (
        <Table aria-label="Legal entities">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Time zone</TableHead>
              {state.canManage ? <TableHead>Change</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.legalEntities.map((entity) => (
              <TableRow key={entity.id}>
                <TableCell>
                  <span className="font-medium">{entity.name}</span>{' '}
                  {entity.archived ? <Badge tone="neutral">Archived</Badge> : null}
                </TableCell>
                <TableCell>{countryName(state, entity.country)}</TableCell>
                <TableCell>{entity.timeZone}</TableCell>
                {state.canManage ? (
                  <TableCell>
                    <span className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        aria-label={`Edit ${entity.name}`}
                        onClick={() => {
                          onEdit({ kind: 'entity', entity });
                        }}
                      >
                        Edit
                      </Button>
                      <ArchiveButton
                        name={entity.name}
                        archived={entity.archived}
                        onToggle={() => onUpdate(entity.id, { archived: !entity.archived })}
                      />
                    </span>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Stack>
  );
}

function Locations({
  state,
  onEdit,
  onUpdate,
}: {
  readonly state: OrganisationState;
  readonly onEdit: (editing: Editing) => void;
  readonly onUpdate: OrganisationProps['onUpdateLocation'];
}): JSX.Element {
  const entityName = (id: string): string =>
    state.legalEntities.find((e) => e.id === id)?.name ?? '—';
  const live = state.legalEntities.some((e) => !e.archived);
  return (
    <Stack gap={4}>
      {state.canManage ? (
        <div>
          <Button
            variant="primary"
            disabled={!live}
            onClick={() => {
              onEdit({ kind: 'location', location: null });
            }}
          >
            Add location
          </Button>
        </div>
      ) : null}
      {state.locations.length === 0 ? (
        <EmptyState
          title="No locations yet"
          description="A location’s time zone decides the day of everybody who works there."
        />
      ) : (
        <Table aria-label="Locations">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Legal entity</TableHead>
              <TableHead>Time zone</TableHead>
              {state.canManage ? <TableHead>Change</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.locations.map((place) => {
              const later = place.zones.filter(
                (z) => z.effectiveFrom > todayIn(z.timeZone) && z.timeZone !== place.timeZone,
              );
              return (
                <TableRow key={place.id}>
                  <TableCell>
                    <span className="font-medium">{place.name}</span>{' '}
                    {place.archived ? <Badge tone="neutral">Archived</Badge> : null}
                    <span className="block text-fg-muted text-sm">
                      {countryName(state, place.country)}
                    </span>
                  </TableCell>
                  <TableCell>{entityName(place.legalEntityId)}</TableCell>
                  <TableCell>
                    {place.timeZone}
                    {later.map((z) => (
                      <span key={z.effectiveFrom} className="block text-fg-muted text-sm">
                        {z.timeZone} from {z.effectiveFrom}
                      </span>
                    ))}
                  </TableCell>
                  {state.canManage ? (
                    <TableCell>
                      <span className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          aria-label={`Rename ${place.name}`}
                          onClick={() => {
                            onEdit({ kind: 'location', location: place });
                          }}
                        >
                          Rename
                        </Button>
                        <Button
                          size="sm"
                          aria-label={`Change the time zone of ${place.name}`}
                          onClick={() => {
                            onEdit({ kind: 'zone', location: place });
                          }}
                        >
                          Change time zone
                        </Button>
                        <ArchiveButton
                          name={place.name}
                          archived={place.archived}
                          onToggle={() => onUpdate(place.id, { archived: !place.archived })}
                        />
                      </span>
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Stack>
  );
}

function Numberings({
  state,
  onEdit,
}: {
  readonly state: OrganisationState;
  readonly onEdit: (editing: Editing) => void;
}): JSX.Element {
  const entities = state.legalEntities.filter((e) => !e.archived);
  if (entities.length === 0) {
    return (
      <EmptyState
        title="No legal entities to number"
        description="Employee numbers are per legal entity."
      />
    );
  }
  return (
    <Table aria-label="Employee numbering">
      <TableHeader>
        <TableRow>
          <TableHead>Legal entity</TableHead>
          <TableHead>Next number</TableHead>
          {state.canManage ? <TableHead>Change</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {entities.map((entity) => {
          const scheme = state.numberings.find((n) => n.legalEntityId === entity.id);
          return (
            <TableRow key={entity.id}>
              <TableCell>{entity.name}</TableCell>
              <TableCell>
                {scheme === undefined
                  ? 'Does not number its people'
                  : numberOf(scheme.prefix, scheme.digits, scheme.nextValue)}
              </TableCell>
              {state.canManage ? (
                <TableCell>
                  <Button
                    size="sm"
                    aria-label={`Set the numbering of ${entity.name}`}
                    onClick={() => {
                      onEdit({ kind: 'numbering', entity });
                    }}
                  >
                    {scheme === undefined ? 'Start numbering' : 'Change'}
                  </Button>
                </TableCell>
              ) : null}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** A zone out of every IANA zone: too many for a `Select`, so typed into. */
function ZonePicker({
  state,
  label,
  value,
  onChange,
  description,
  invalid = false,
  disabled = false,
}: {
  readonly state: OrganisationState;
  readonly label: string;
  readonly value: string;
  readonly onChange: (zone: string) => void;
  readonly description?: ReactNode;
  readonly invalid?: boolean;
  readonly disabled?: boolean;
}): JSX.Element {
  return (
    <Field required invalid={invalid}>
      <FieldLabel>{label}</FieldLabel>
      <FieldControl>
        <Combobox
          label={label}
          placeholder="Choose a time zone"
          searchPlaceholder="Search time zones"
          options={state.timeZones.map((z) => ({ value: z, label: z }))}
          value={value === '' ? null : value}
          disabled={disabled}
          onChange={(next) => {
            onChange(typeof next === 'string' ? next : '');
          }}
        />
      </FieldControl>
      {description === undefined ? null : <FieldDescription>{description}</FieldDescription>}
      <FieldError>Choose a time zone.</FieldError>
    </Field>
  );
}

function CountryPicker({
  state,
  value,
  onChange,
  invalid,
}: {
  readonly state: OrganisationState;
  readonly value: string;
  readonly onChange: (country: string) => void;
  readonly invalid: boolean;
}): JSX.Element {
  return (
    <Field required invalid={invalid}>
      <FieldLabel>Country</FieldLabel>
      <Select value={value} onValueChange={onChange}>
        <FieldControl>
          <SelectTrigger>
            <SelectValue placeholder="Choose a country" />
          </SelectTrigger>
        </FieldControl>
        <SelectContent>
          {state.countries.map((c) => (
            <SelectItem key={c.code} value={c.code}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldError>Choose a country.</FieldError>
    </Field>
  );
}

/** One form in a dialog: whatever People refuses is shown as it was worded, and nothing closes. */
function EditDialog({
  editing,
  state,
  props,
  onClose,
}: {
  readonly editing: Editing;
  readonly state: OrganisationState;
  readonly props: OrganisationProps;
  readonly onClose: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  const entity = editing.kind === 'entity' ? editing.entity : null;
  const place = editing.kind === 'location' || editing.kind === 'zone' ? editing.location : null;
  const scheme =
    editing.kind === 'numbering'
      ? state.numberings.find((n) => n.legalEntityId === editing.entity.id)
      : undefined;
  const firstEntity = state.legalEntities.find((e) => !e.archived);

  const [name, setName] = useState(entity?.name ?? place?.name ?? '');
  const [country, setCountry] = useState(entity?.country ?? firstEntity?.country ?? '');
  const [zone, setZone] = useState(
    editing.kind === 'zone' ? '' : (entity?.timeZone ?? firstEntity?.timeZone ?? ''),
  );
  const [legalEntityId, setLegalEntityId] = useState(firstEntity?.id ?? '');
  const [from, setFrom] = useState<IsoDate | null>(null);
  const [prefix, setPrefix] = useState(scheme?.prefix ?? '');
  const [digits, setDigits] = useState<number | null>(scheme?.digits ?? 5);
  const [start, setStart] = useState<number | null>(scheme?.nextValue ?? 1);

  const renaming = editing.kind === 'location' && place !== null;
  const needsName = editing.kind === 'entity' || editing.kind === 'location';
  const needsPlace =
    editing.kind === 'entity' ? entity === null : editing.kind === 'location' && !renaming;
  const needsZone = editing.kind === 'entity' || editing.kind === 'zone' || needsPlace;
  const problems = {
    name: needsName && name.trim() === '',
    country: needsPlace && country === '',
    zone: needsZone && zone === '',
    prefix: editing.kind === 'numbering' && !/^[A-Za-z0-9-]{0,10}$/.test(prefix),
    digits: editing.kind === 'numbering' && (digits === null || digits < 1 || digits > 12),
    start:
      editing.kind === 'numbering' && (start === null || start < 1 || !Number.isInteger(start)),
  };
  const invalid = Object.values(problems).some(Boolean);
  // A zone change is in force once its day has begun where the zone is.
  const effectiveFrom = from ?? (zone === '' ? null : todayIn(zone));

  const title =
    editing.kind === 'entity'
      ? entity === null
        ? 'Add a legal entity'
        : `Edit ${entity.name}`
      : editing.kind === 'location'
        ? place === null
          ? 'Add a location'
          : `Rename ${place.name}`
        : editing.kind === 'zone'
          ? `Change the time zone of ${editing.location.name}`
          : `Employee numbers in ${editing.entity.name}`;

  const submit = (): Promise<Outcome> => {
    switch (editing.kind) {
      case 'entity':
        return entity === null
          ? props.onCreateEntity({ name: name.trim(), country, timeZone: zone })
          : props.onUpdateEntity(entity.id, {
              ...(name.trim() === entity.name ? {} : { name: name.trim() }),
              ...(zone === entity.timeZone ? {} : { timeZone: zone }),
            });
      case 'location':
        return place === null
          ? props.onCreateLocation({
              legalEntityId,
              name: name.trim(),
              country,
              timeZone: zone,
              ...(from === null ? {} : { effectiveFrom: from }),
            })
          : props.onUpdateLocation(place.id, { name: name.trim() });
      case 'zone':
        return props.onChangeZone(editing.location.id, zone, effectiveFrom ?? '');
      case 'numbering':
        return props.onSetNumbering(editing.entity.id, {
          prefix,
          digits: digits ?? 1,
          start: start ?? 1,
        });
    }
  };

  const body: ReactNode[] = [];
  if (editing.kind === 'location' && place === null) {
    body.push(
      <Field key="entity" required>
        <FieldLabel>Legal entity</FieldLabel>
        <Select value={legalEntityId} onValueChange={setLegalEntityId}>
          <FieldControl>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
          </FieldControl>
          <SelectContent>
            {state.legalEntities
              .filter((e) => !e.archived)
              .map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </Field>,
    );
  }
  if (needsName) {
    body.push(
      <Field key="name" required invalid={shown && problems.name}>
        <FieldLabel>Name</FieldLabel>
        <FieldControl>
          <Input
            value={name}
            maxLength={200}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </FieldControl>
        <FieldError>A name is needed.</FieldError>
      </Field>,
    );
  }
  if (needsPlace) {
    body.push(
      <CountryPicker
        key="country"
        state={state}
        value={country}
        onChange={setCountry}
        invalid={shown && problems.country}
      />,
    );
  }
  if (needsZone) {
    body.push(
      <ZonePicker
        key="zone"
        state={state}
        label={editing.kind === 'zone' ? 'New time zone' : 'Time zone'}
        value={zone}
        onChange={setZone}
        invalid={shown && problems.zone}
      />,
    );
  }
  if (editing.kind === 'zone' || (editing.kind === 'location' && place === null)) {
    body.push(
      <div key="from" className="flex flex-col gap-1.5">
        <DatePicker
          label="From"
          value={editing.kind === 'zone' ? effectiveFrom : from}
          onChange={setFrom}
        />
        <p className="text-fg-muted text-xs">
          {editing.kind === 'zone'
            ? 'In force from the start of this day in the new zone. The same day again corrects an earlier change.'
            : 'Leave empty for today.'}
        </p>
      </div>,
    );
  }
  if (editing.kind === 'numbering') {
    body.push(
      <Field key="prefix" invalid={shown && problems.prefix}>
        <FieldLabel>Prefix</FieldLabel>
        <FieldControl>
          <Input
            value={prefix}
            maxLength={10}
            onChange={(e) => {
              setPrefix(e.target.value);
            }}
          />
        </FieldControl>
        <FieldDescription>Up to ten letters, digits or hyphens. May be empty.</FieldDescription>
        <FieldError>Letters, digits and hyphens only.</FieldError>
      </Field>,
      <NumberField
        key="digits"
        label="Digits"
        value={digits}
        min={1}
        max={12}
        invalid={shown && problems.digits}
        hint="Numbers are zero-padded to this width, and grow past it rather than wrap."
        onChange={setDigits}
      />,
      <NumberField
        key="start"
        label="Next number"
        value={start}
        min={scheme?.nextValue ?? 1}
        invalid={shown && problems.start}
        hint="Never moves back below a number already handed out."
        onChange={setStart}
      />,
      <p key="preview" className="text-sm">
        The next person hired here is{' '}
        <span className="font-medium">{numberOf(prefix, digits ?? 1, start ?? 1)}</span>.
      </p>,
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Kept with who changed it and when.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Stack gap={4}>
            {body}
            {refused === null ? null : (
              <Alert tone="danger" title="Not saved">
                {refused}
              </Alert>
            )}
          </Stack>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            loadingLabel="Saving"
            onClick={() => {
              setShown(true);
              if (invalid) return;
              setBusy(true);
              setRefused(null);
              void submit().then((outcome) => {
                setBusy(false);
                if (outcome.ok) onClose();
                else setRefused(outcome.message);
              });
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A currency's minor unit, as Intl knows it: 2 for EUR, 0 for JPY. */
const minorDigits = (currency: string): number | null => {
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? null
    );
  } catch {
    return null;
  }
};

/** `"55000.5"` EUR → `"5500050"`, by moving digits: never through a float. Null for anything else. */
export function toMinorDigits(amount: string, currency: string): string | null {
  const places = minorDigits(currency);
  if (places === null) return null;
  const match = /^(\d{1,15})(?:\.(\d+))?$/.exec(amount.replaceAll(',', '').trim());
  if (!match) return null;
  const [, whole = '', fraction = ''] = match;
  if (fraction.length > places) return null;
  const digits = `${whole}${fraction.padEnd(places, '0')}`.replace(/^0+/, '');
  return digits === '' ? null : digits;
}

/** `"5500050"` EUR → `"55,000.50 EUR"` for reading; the value itself stays digits. */
function bandAmount(minor: string, currency: string): string {
  const places = minorDigits(currency) ?? 2;
  const padded = minor.padStart(places + 1, '0');
  const whole = places === 0 ? padded : padded.slice(0, -places);
  const fraction = places === 0 ? '' : `.${padded.slice(-places)}`;
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction} ${currency}`;
}

/**
 * Pay bands (PEO-078): minimum, midpoint and maximum per grade and currency,
 * from a day. HR and finance see and edit them; People decides who may, and
 * records who did. Saving a day already recorded corrects it.
 */
function PayBands({
  bands,
  onSet,
}: {
  readonly bands: readonly PayBand[];
  readonly onSet: OrganisationProps['onSetPayBand'];
}): JSX.Element {
  const [editing, setEditing] = useState<PayBand | 'new' | null>(null);
  return (
    <Stack gap={4}>
      <p className="text-sm text-fg-muted">
        Compa-ratio on the analytics screen is salary over the midpoint of the band in force for
        that grade and currency. A band change from a later day leaves the earlier one in history.
      </p>
      {onSet === undefined ? null : (
        <div>
          <Button
            variant="primary"
            onClick={() => {
              setEditing('new');
            }}
          >
            Add pay band
          </Button>
        </div>
      )}
      {bands.length === 0 ? (
        <EmptyState
          title="No pay bands yet"
          description="Add one per grade and currency to see compa-ratio."
        />
      ) : (
        <Table aria-label="Pay bands">
          <TableHeader>
            <TableRow>
              <TableHead>Grade</TableHead>
              <TableHead>From</TableHead>
              <TableHead numeric>Minimum</TableHead>
              <TableHead numeric>Midpoint</TableHead>
              <TableHead numeric>Maximum</TableHead>
              {onSet === undefined ? null : <TableHead>Change</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {bands.map((band) => (
              <TableRow key={band.id}>
                <TableCell>
                  <span className="font-medium">{band.grade}</span>{' '}
                  {band.supersedes === null ? null : <Badge tone="neutral">Corrected</Badge>}
                </TableCell>
                <TableCell>{band.effectiveFrom}</TableCell>
                <TableCell numeric>{bandAmount(band.minimumMinor, band.currency)}</TableCell>
                <TableCell numeric>{bandAmount(band.midpointMinor, band.currency)}</TableCell>
                <TableCell numeric>{bandAmount(band.maximumMinor, band.currency)}</TableCell>
                {onSet === undefined ? null : (
                  <TableCell>
                    <Button
                      size="sm"
                      aria-label={`Correct ${band.grade} ${band.currency} from ${band.effectiveFrom}`}
                      onClick={() => {
                        setEditing(band);
                      }}
                    >
                      Correct
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {editing === null || onSet === undefined ? null : (
        <PayBandDialog
          band={editing === 'new' ? null : editing}
          onSet={onSet}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
    </Stack>
  );
}

function PayBandDialog({
  band,
  onSet,
  onClose,
}: {
  readonly band: PayBand | null;
  readonly onSet: NonNullable<OrganisationProps['onSetPayBand']>;
  readonly onClose: () => void;
}): JSX.Element {
  const major = (minor: string | undefined, currency: string) =>
    minor === undefined
      ? ''
      : (bandAmount(minor, currency).split(' ')[0]?.replaceAll(',', '') ?? '');
  const [grade, setGrade] = useState(band?.grade ?? '');
  const [currency, setCurrency] = useState(band?.currency ?? '');
  const [amounts, setAmounts] = useState({
    minimum: major(band?.minimumMinor, band?.currency ?? 'EUR'),
    midpoint: major(band?.midpointMinor, band?.currency ?? 'EUR'),
    maximum: major(band?.maximumMinor, band?.currency ?? 'EUR'),
  });
  const [from, setFrom] = useState<IsoDate | null>(band?.effectiveFrom ?? null);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  const minor = {
    minimum: toMinorDigits(amounts.minimum, currency),
    midpoint: toMinorDigits(amounts.midpoint, currency),
    maximum: toMinorDigits(amounts.maximum, currency),
  };
  const problems = {
    grade: grade.trim() === '',
    currency: !/^[A-Z]{3}$/.test(currency) || minorDigits(currency) === null,
    minimum: minor.minimum === null,
    midpoint: minor.midpoint === null,
    maximum: minor.maximum === null,
    from: from === null,
  };
  const invalid = Object.values(problems).some(Boolean);
  const amountField = (key: 'minimum' | 'midpoint' | 'maximum', label: string) => (
    <Field key={key} required invalid={shown && problems[key]}>
      <FieldLabel>{label}</FieldLabel>
      <FieldControl>
        <Input
          inputMode="decimal"
          value={amounts[key]}
          onChange={(e) => {
            setAmounts((a) => ({ ...a, [key]: e.target.value }));
          }}
        />
      </FieldControl>
      <FieldError>
        An amount in {currency === '' ? 'the currency' : currency}, above zero.
      </FieldError>
    </Field>
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {band === null ? 'Add a pay band' : `Correct ${band.grade}, ${band.currency}`}
          </DialogTitle>
          <DialogDescription>
            Kept with who changed it and when. The same grade, currency and day again corrects it.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Stack gap={4}>
            <Field required invalid={shown && problems.grade}>
              <FieldLabel>Grade</FieldLabel>
              <FieldControl>
                <Input
                  value={grade}
                  maxLength={64}
                  readOnly={band !== null}
                  onChange={(e) => {
                    setGrade(e.target.value);
                  }}
                />
              </FieldControl>
              <FieldDescription>As the grade field stores it on a profile.</FieldDescription>
              <FieldError>A grade is needed.</FieldError>
            </Field>
            <Field required invalid={shown && problems.currency}>
              <FieldLabel>Currency</FieldLabel>
              <FieldControl>
                <Input
                  value={currency}
                  maxLength={3}
                  readOnly={band !== null}
                  onChange={(e) => {
                    setCurrency(e.target.value.toUpperCase());
                  }}
                />
              </FieldControl>
              <FieldError>A three-letter currency code, such as EUR.</FieldError>
            </Field>
            {amountField('minimum', 'Minimum')}
            {amountField('midpoint', 'Midpoint')}
            {amountField('maximum', 'Maximum')}
            <DatePicker label="From" value={from} onChange={setFrom} />
            {refused === null ? null : (
              <Alert tone="danger" title="Not saved">
                {refused}
              </Alert>
            )}
          </Stack>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            loadingLabel="Saving"
            onClick={() => {
              setShown(true);
              if (invalid || from === null) return;
              setBusy(true);
              setRefused(null);
              void onSet({
                grade: grade.trim(),
                currency,
                minimumMinor: minor.minimum ?? '',
                midpointMinor: minor.midpoint ?? '',
                maximumMinor: minor.maximum ?? '',
                effectiveFrom: from,
              }).then((outcome) => {
                setBusy(false);
                if (outcome.ok) onClose();
                else setRefused(outcome.message);
              });
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The minimum is raised, never lowered: People refuses a lower one, and so does its database. */
function Company({
  state,
  onSave,
}: {
  readonly state: OrganisationState;
  readonly onSave: OrganisationProps['onUpdateSettings'];
}): JSX.Element {
  const { settings } = state;
  const [zone, setZone] = useState(settings.defaultTimeZone);
  const [minimum, setMinimum] = useState<number | null>(settings.cohortMinimum);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const lowered = minimum === null || minimum < settings.cohortMinimum;
  const changed = zone !== settings.defaultTimeZone || minimum !== settings.cohortMinimum;

  return (
    <form
      aria-label="Company settings"
      onSubmit={(event) => {
        event.preventDefault();
        if (lowered || !changed) return;
        setBusy(true);
        setOutcome(null);
        void onSave({
          ...(zone === settings.defaultTimeZone ? {} : { defaultTimeZone: zone }),
          ...(minimum === settings.cohortMinimum ? {} : { cohortMinimum: minimum }),
        }).then((result) => {
          setBusy(false);
          setOutcome(result);
        });
      }}
    >
      <Stack gap={4}>
        <Field>
          <FieldLabel>Company</FieldLabel>
          <FieldControl>
            <Input readOnly value={settings.displayName ?? 'Not known yet'} />
          </FieldControl>
          <FieldDescription>
            {settings.slug === null
              ? 'Named by the back office.'
              : `Signs in at ${settings.slug}. Named by the back office, and changed there.`}
          </FieldDescription>
        </Field>
        <ZonePicker
          state={state}
          label="Default time zone"
          value={zone}
          onChange={setZone}
          disabled={!state.canManage}
          description="The day of anybody with no location or legal entity, and of every figure about the whole company."
        />
        {state.canManage ? (
          <NumberField
            label="Smallest group analytics will describe"
            value={minimum}
            min={settings.cohortMinimum}
            step={1}
            invalid={lowered}
            hint={`Raise it to protect smaller groups. It cannot go below ${String(settings.cohortMinimum)}.`}
            onChange={setMinimum}
          />
        ) : (
          <Field>
            <FieldLabel>Smallest group analytics will describe</FieldLabel>
            <FieldControl>
              <Input readOnly value={String(settings.cohortMinimum)} />
            </FieldControl>
          </Field>
        )}
        {outcome === null ? null : outcome.ok ? (
          <Alert tone="success">Saved.</Alert>
        ) : (
          <Alert tone="danger" title="Not saved">
            {outcome.message}
          </Alert>
        )}
        {state.canManage ? (
          <div>
            <Button
              type="submit"
              variant="primary"
              disabled={!changed || lowered}
              loading={busy}
              loadingLabel="Saving"
            >
              Save
            </Button>
          </div>
        ) : null}
      </Stack>
    </form>
  );
}

const FLOOR_NAMES: Readonly<Record<string, string>> = {
  'es-labour': 'Spain, labour records',
  'de-labour': 'Germany, labour records',
  'eu-payroll': 'EU, payroll and tax records',
};

/**
 * The statutory floors a leaver's record is kept for, and whether counsel has
 * reviewed each (PEO-126). Read-only here: a floor is law, and marking one
 * reviewed is an operator's action, never a tenant's.
 */
function RetentionFloors({ floors }: { readonly floors: readonly RetentionFloor[] }): JSX.Element {
  const pending = floors.some((f) => f.status === 'unreviewed');
  return (
    <PageSection
      title="Statutory retention"
      description="The least time the law keeps a leaver’s records. A longer retention policy on a field wins; a shorter one does not."
    >
      <Stack gap={4}>
        {pending ? (
          <Alert tone="warning" title="Pending legal review">
            These periods have not yet been confirmed by counsel. Nothing is erased automatically
            under a period pending review; HR can still erase one person’s record by hand, with a
            stated reason.
          </Alert>
        ) : null}
        <Table aria-label="Statutory retention floors">
          <TableHeader>
            <TableRow>
              <TableHead>Records</TableHead>
              <TableHead>Kept after leaving</TableHead>
              <TableHead>Legal review</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {floors.map((f) => (
              <TableRow key={f.floor}>
                <TableCell>{FLOOR_NAMES[f.floor] ?? f.floor}</TableCell>
                <TableCell>{`${String(f.months)} months`}</TableCell>
                <TableCell>
                  {f.status === 'reviewed' ? (
                    <Badge tone="success">
                      {`Reviewed by ${f.reviewedBy ?? 'counsel'}${f.reviewedOn === null ? '' : ` on ${f.reviewedOn}`}`}
                    </Badge>
                  ) : (
                    <Badge tone="warning">Pending legal review</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Stack>
    </PageSection>
  );
}
