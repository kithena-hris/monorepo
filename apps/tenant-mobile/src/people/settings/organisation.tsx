import {
  Alert,
  Badge,
  Button,
  Card,
  CardTitle,
  ChipGroup,
  ChipGroupItem,
  Combobox,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Icon,
  Input,
  KeyValues,
  List,
  ListItem,
  NumberField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Text,
} from '@reach/ui-native';
import {
  Archive,
  ArchiveRestore,
  Building2,
  Clock,
  Ellipsis,
  Hash,
  MoveRight,
  Pencil,
  Plus,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Failed, Loading, Page } from '../../frame';
import { useAct } from '../act';
import { ask, useSigned } from '../api';
import type { PeopleScreen } from '../routes';
import { bandAmount, minorDigits, toMinorDigits } from './minor';

interface Entity {
  readonly id: string;
  readonly name: string;
  readonly country: string;
  readonly timeZone: string;
  readonly archived: boolean;
}
interface Location {
  readonly id: string;
  readonly legalEntityId: string;
  readonly name: string;
  readonly country: string;
  readonly timeZone: string;
  readonly zones: readonly { readonly effectiveFrom: string; readonly timeZone: string }[];
  readonly archived: boolean;
}
interface OrgUnit {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly path: string;
  readonly archived: boolean;
}
interface PayBand {
  readonly id: string;
  readonly grade: string;
  readonly currency: string;
  readonly minimumMinor: string;
  readonly midpointMinor: string;
  readonly maximumMinor: string;
  readonly effectiveFrom: string;
  readonly supersedes: string | null;
}
interface State {
  readonly canManage: boolean;
  readonly settings: {
    readonly defaultTimeZone: string;
    readonly cohortMinimum: number;
    readonly photoAtSignup: string | null;
    readonly slug: string | null;
    readonly displayName: string | null;
  };
  readonly legalEntities: readonly Entity[];
  readonly locations: readonly Location[];
  readonly orgUnits: readonly OrgUnit[];
  readonly numberings: readonly {
    legalEntityId: string;
    prefix: string;
    digits: number;
    nextValue: number;
  }[];
  readonly countries: readonly { code: string; name: string }[];
  readonly timeZones: readonly string[];
  readonly retentionFloors: readonly {
    floor: string;
    months: number;
    status: string;
    reviewedBy: string | null;
    reviewedOn: string | null;
  }[];
  readonly upcomingErasures: readonly {
    personId: string;
    name: string | null;
    dueOn: string;
    floors: readonly string[];
    waitingForReview: readonly string[];
  }[];
  readonly payBands: readonly PayBand[] | null;
}
interface Pack {
  readonly country: string;
  readonly countryName: string;
  readonly fields: number;
  readonly sections: readonly { readonly label: string }[];
}

const PHOTO = [
  ['off', 'Don’t ask'],
  ['optional', 'Ask, and let them skip it'],
  ['required', 'Ask before anything else'],
] as const;
const FLOOR_NAMES: Readonly<Record<string, string>> = {
  'es-labour': 'Spain, labour records',
  'de-labour': 'Germany, labour records',
  'eu-payroll': 'EU, payroll and tax records',
};

/** Today where a zone is: a zone change is in force once its day has begun there. */
const todayIn = (zone: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const numberOf = (prefix: string, digits: number, value: number): string =>
  `${prefix}${String(value).padStart(digits, '0')}`;

type Editing =
  | { kind: 'entity'; entity: Entity | null }
  | { kind: 'location'; location: Location | null }
  | { kind: 'zone'; location: Location }
  | { kind: 'numbering'; entity: Entity }
  | { kind: 'unit'; unit: OrgUnit | null; mode: 'add' | 'rename' | 'move' }
  | { kind: 'band'; band: PayBand | null }
  | { kind: 'archive'; name: string; archived: boolean; run: () => Promise<unknown> };

const TABS = [
  ['entities', 'Entities'],
  ['locations', 'Locations'],
  ['org-units', 'Org units'],
  ['numbering', 'Numbering'],
  ['country-packs', 'Country packs'],
  ['reminders', 'Reminders'],
  ['pay-bands', 'Pay bands'],
] as const;

/**
 * Organisation (design H7): its tabs as pills, its tables as rows with a menu
 * each. Legal entities, locations and their time zones, org units, employee
 * numbering, the country packs, the company's defaults with reminders and
 * retention, and pay bands.
 */
export function Organisation({ navigation }: PeopleScreen<'Organisation'>): React.JSX.Element {
  const signed = useSigned();
  const { act } = useAct();
  const [state, setState] = useState<State | null>(null);
  const [packs, setPacks] = useState<readonly Pack[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [tab, setTab] = useState<string>('entities');
  const [editing, setEditing] = useState<Editing | null>(null);

  const load = async (): Promise<void> => {
    const [org, setup] = await Promise.all([
      ask<State>(signed, 'Organisation'),
      ask<{ packs: Pack[] }>(signed, 'Setup'),
    ]);
    if (!org.ok) {
      setFailed(org.message);
      return;
    }
    setFailed(null);
    setState(org.data);
    setPacks(setup.ok ? setup.data.packs : null);
  };
  useEffect(() => {
    void load();
  }, [signed]);

  const back = { label: 'Settings', onPress: navigation.goBack };
  if (failed !== null) {
    return (
      <Page title="Organisation" back={back}>
        <Failed message={failed} onRetry={() => void load()} />
      </Page>
    );
  }
  if (state === null) {
    return (
      <Page title="Organisation" back={back}>
        <Loading label="Loading the organisation" />
      </Page>
    );
  }
  const reload = (): void => {
    void load();
  };
  const can = state.canManage;
  const entityName = (id: string): string =>
    state.legalEntities.find((e) => e.id === id)?.name ?? '';
  const archiving = (name: string, archived: boolean, operation: string, id: string): Editing => ({
    kind: 'archive',
    name,
    archived,
    run: () =>
      act(
        operation,
        { id, archived: !archived },
        archived ? `${name} restored` : `${name} archived`,
      ),
  });
  const menu = (
    label: string,
    items: { label: string; icon: typeof Pencil; onSelect: () => void }[],
  ) =>
    can ? (
      <DropdownMenu>
        <DropdownMenuTrigger>
          <Button
            size="sm"
            variant="ghost"
            startIcon={<Icon icon={Ellipsis} />}
            accessibilityLabel={`Actions for ${label}`}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent label={`Actions for ${label}`}>
          {items.map((i) => (
            <DropdownMenuItem key={i.label} icon={i.icon} onSelect={i.onSelect}>
              {i.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : undefined;
  const add = (label: string, open: () => void) =>
    can ? (
      <Button variant="primary" startIcon={<Icon icon={Plus} />} onPress={open}>
        {label}
      </Button>
    ) : null;
  const tabs = TABS.filter(
    ([value]) =>
      (value !== 'country-packs' || packs !== null) &&
      (value !== 'pay-bands' || state.payBands !== null),
  );

  return (
    <Page title="Organisation" back={back}>
      <View>
        <ChipGroup
          type="single"
          value={tab}
          onValueChange={setTab}
          accessibilityLabel="Organisation settings"
          scroll
        >
          {tabs.map(([value, label]) => (
            <ChipGroupItem key={value} value={value} variant="view">
              {label}
            </ChipGroupItem>
          ))}
        </ChipGroup>
      </View>
      {can ? null : <Alert tone="info">Only a People administrator changes these.</Alert>}

      {tab === 'entities' ? (
        <>
          {add('Add a legal entity', () => {
            setEditing({ kind: 'entity', entity: null });
          })}
          {state.legalEntities.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No legal entities yet"
              description="Add the company that employs people."
            />
          ) : (
            <List>
              {state.legalEntities.map((e) => {
                const trailing = menu(e.name, [
                  {
                    label: 'Edit',
                    icon: Pencil,
                    onSelect: () => {
                      setEditing({ kind: 'entity', entity: e });
                    },
                  },
                  {
                    label: 'Employee numbers',
                    icon: Hash,
                    onSelect: () => {
                      setEditing({ kind: 'numbering', entity: e });
                    },
                  },
                  {
                    label: e.archived ? 'Restore' : 'Archive',
                    icon: e.archived ? ArchiveRestore : Archive,
                    onSelect: () => {
                      setEditing(archiving(e.name, e.archived, 'UpdateLegalEntity', e.id));
                    },
                  },
                ]);
                return (
                  <ListItem
                    key={e.id}
                    description={`${state.countries.find((c) => c.code === e.country)?.name ?? e.country} · ${e.timeZone}${e.archived ? ' · Archived' : ''}`}
                    {...(trailing === undefined ? {} : { trailing })}
                  >
                    {e.name}
                  </ListItem>
                );
              })}
            </List>
          )}
        </>
      ) : null}

      {tab === 'locations' ? (
        <>
          {state.legalEntities.some((e) => !e.archived)
            ? add('Add a location', () => {
                setEditing({ kind: 'location', location: null });
              })
            : null}
          {state.locations.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No locations yet"
              description="Add where people work."
            />
          ) : (
            <List>
              {state.locations.map((l) => {
                const upcoming = l.zones.find((z) => z.effectiveFrom > todayIn(l.timeZone));
                const trailing = menu(l.name, [
                  {
                    label: 'Rename',
                    icon: Pencil,
                    onSelect: () => {
                      setEditing({ kind: 'location', location: l });
                    },
                  },
                  {
                    label: 'Change time zone',
                    icon: Clock,
                    onSelect: () => {
                      setEditing({ kind: 'zone', location: l });
                    },
                  },
                  {
                    label: l.archived ? 'Restore' : 'Archive',
                    icon: l.archived ? ArchiveRestore : Archive,
                    onSelect: () => {
                      setEditing(archiving(l.name, l.archived, 'UpdateLocation', l.id));
                    },
                  },
                ]);
                return (
                  <ListItem
                    key={l.id}
                    description={[
                      l.archived ? 'Archived' : null,
                      entityName(l.legalEntityId),
                      upcoming === undefined
                        ? l.timeZone
                        : `${upcoming.timeZone} from ${upcoming.effectiveFrom}`,
                    ]
                      .filter((x) => x !== null && x !== '')
                      .join(' · ')}
                    {...(trailing === undefined ? {} : { trailing })}
                  >
                    {l.name}
                  </ListItem>
                );
              })}
            </List>
          )}
        </>
      ) : null}

      {tab === 'org-units' ? (
        <>
          {add('Add an org unit', () => {
            setEditing({ kind: 'unit', unit: null, mode: 'add' });
          })}
          {state.orgUnits.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No org units yet"
              description="Departments and teams, nested as they are."
            />
          ) : (
            <List>
              {state.orgUnits.map((u) => {
                const trailing = menu(u.name, [
                  {
                    label: 'Rename',
                    icon: Pencil,
                    onSelect: () => {
                      setEditing({ kind: 'unit', unit: u, mode: 'rename' });
                    },
                  },
                  {
                    label: 'Move',
                    icon: MoveRight,
                    onSelect: () => {
                      setEditing({ kind: 'unit', unit: u, mode: 'move' });
                    },
                  },
                  {
                    label: u.archived ? 'Restore' : 'Archive',
                    icon: u.archived ? ArchiveRestore : Archive,
                    onSelect: () => {
                      setEditing(archiving(u.name, u.archived, 'UpdateOrgUnit', u.id));
                    },
                  },
                ]);
                return (
                  <ListItem
                    key={u.id}
                    description={`${u.path}${u.archived ? ' · Archived' : ''}`}
                    {...(trailing === undefined ? {} : { trailing })}
                  >
                    {u.name}
                  </ListItem>
                );
              })}
            </List>
          )}
        </>
      ) : null}

      {tab === 'numbering' ? (
        state.legalEntities.length === 0 ? (
          <EmptyState
            icon={Hash}
            title="No legal entities to number"
            description="Add a legal entity first."
          />
        ) : (
          <List>
            {state.legalEntities
              .filter((e) => !e.archived)
              .map((e) => {
                const n = state.numberings.find((x) => x.legalEntityId === e.id);
                return (
                  <ListItem
                    key={e.id}
                    description={
                      n === undefined
                        ? 'Not numbered'
                        : `Next: ${numberOf(n.prefix, n.digits, n.nextValue)}`
                    }
                    {...(can
                      ? {
                          chevron: true,
                          onPress: () => {
                            setEditing({ kind: 'numbering', entity: e });
                          },
                        }
                      : {})}
                  >
                    {e.name}
                  </ListItem>
                );
              })}
          </List>
        )
      ) : null}

      {tab === 'country-packs' && packs !== null ? (
        packs.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No country packs"
            description="Packs arrive with People, one per country it has paperwork rules for."
          />
        ) : (
          <List>
            {packs.map((p) => {
              const used = state.legalEntities.filter(
                (e) => !e.archived && e.country === p.country,
              );
              return (
                <ListItem
                  key={p.country}
                  description={[
                    `${String(p.fields)} fields`,
                    p.sections.map((s) => s.label).join(', '),
                    used.length === 0 ? 'No entity here' : used.map((e) => e.name).join(', '),
                  ]
                    .filter((x) => x !== '')
                    .join(' · ')}
                >
                  {p.countryName}
                </ListItem>
              );
            })}
          </List>
        )
      ) : null}

      {tab === 'reminders' ? <Reminders state={state} onSaved={reload} /> : null}

      {tab === 'pay-bands' && state.payBands !== null ? (
        <>
          <Text tone="muted">
            Compa-ratio is salary divided by the band midpoint for the grade and currency.
          </Text>
          {add('Add pay band', () => {
            setEditing({ kind: 'band', band: null });
          })}
          {state.payBands.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No pay bands yet"
              description="Add one per grade and currency to see compa-ratio."
            />
          ) : (
            <List>
              {state.payBands.map((b) => (
                <ListItem
                  key={b.id}
                  description={`From ${b.effectiveFrom} · ${bandAmount(b.minimumMinor, b.currency)} – ${bandAmount(b.maximumMinor, b.currency)} · mid ${bandAmount(b.midpointMinor, b.currency)}`}
                  {...(can
                    ? {
                        chevron: true,
                        onPress: () => {
                          setEditing({ kind: 'band', band: b });
                        },
                      }
                    : {})}
                >
                  {`${b.grade}${b.supersedes === null ? '' : ' (corrected)'}`}
                </ListItem>
              ))}
            </List>
          )}
        </>
      ) : null}

      {editing === null ? null : editing.kind === 'archive' ? (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{`${editing.archived ? 'Restore' : 'Archive'} ${editing.name}?`}</DialogTitle>
              <DialogDescription>
                {editing.archived
                  ? 'It can be chosen again for new records.'
                  : 'It can no longer be chosen for new records. Nothing is lost: restore it any time.'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                className="flex-1"
                onPress={() => {
                  setEditing(null);
                }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                variant={editing.archived ? 'primary' : 'danger'}
                onPress={() => {
                  const run = editing.run;
                  setEditing(null);
                  void run().then(reload);
                }}
              >
                {editing.archived ? 'Restore' : 'Archive'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : editing.kind === 'band' ? (
        <PayBandDialog
          band={editing.band}
          onClose={() => {
            setEditing(null);
          }}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      ) : editing.kind === 'unit' ? (
        <UnitDialog
          units={state.orgUnits}
          unit={editing.unit}
          mode={editing.mode}
          onClose={() => {
            setEditing(null);
          }}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      ) : (
        <EditDialog
          editing={editing}
          state={state}
          onClose={() => {
            setEditing(null);
          }}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </Page>
  );
}

function ZonePicker({
  state,
  label,
  value,
  onChange,
  invalid = false,
  disabled = false,
  description,
}: {
  state: State;
  label: string;
  value: string;
  onChange: (zone: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  description?: string;
}): React.JSX.Element {
  return (
    <Field invalid={invalid}>
      <FieldLabel>{label}</FieldLabel>
      <Combobox
        label={label}
        size="sm"
        disabled={disabled}
        placeholder="Choose a time zone"
        searchPlaceholder="Search time zones"
        options={state.timeZones.map((z) => ({ value: z, label: z.replaceAll('_', ' ') }))}
        value={value === '' ? null : value}
        onChange={(next) => {
          onChange(typeof next === 'string' ? next : '');
        }}
      />
      {description === undefined ? null : <FieldDescription>{description}</FieldDescription>}
      <FieldError>Choose a time zone.</FieldError>
    </Field>
  );
}

/** Entities, locations, a location's zone and an entity's numbers: one form each, refusals as People words them. */
function EditDialog({
  editing,
  state,
  onClose,
  onSaved,
}: {
  editing: Extract<Editing, { kind: 'entity' | 'location' | 'zone' | 'numbering' }>;
  state: State;
  onClose: () => void;
  onSaved: () => void;
}): React.JSX.Element {
  const { act, busy } = useAct();
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
  const [from, setFrom] = useState<string | null>(null);
  const [prefix, setPrefix] = useState(scheme?.prefix ?? '');
  const [digits, setDigits] = useState<number | null>(scheme?.digits ?? 5);
  const [start, setStart] = useState<number | null>(scheme?.nextValue ?? 1);
  const [shown, setShown] = useState(false);
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
  const submit = (): Promise<unknown> => {
    switch (editing.kind) {
      case 'entity':
        return entity === null
          ? act(
              'CreateLegalEntity',
              { name: name.trim(), country, timeZone: zone },
              'Legal entity added',
            )
          : act(
              'UpdateLegalEntity',
              {
                id: entity.id,
                ...(name.trim() === entity.name ? {} : { name: name.trim() }),
                ...(zone === entity.timeZone ? {} : { timeZone: zone }),
              },
              'Saved',
            );
      case 'location':
        return place === null
          ? act(
              'CreateLocation',
              { legalEntityId, name: name.trim(), country, timeZone: zone, effectiveFrom: from },
              'Location added',
            )
          : act('UpdateLocation', { id: place.id, name: name.trim() }, 'Renamed');
      case 'zone':
        return act(
          'ChangeLocationZone',
          { id: editing.location.id, timeZone: zone, effectiveFrom: effectiveFrom ?? '' },
          'Time zone changed',
        );
      case 'numbering':
        return act(
          'SetEmployeeNumbering',
          { legalEntityId: editing.entity.id, prefix, digits: digits ?? 1, start: start ?? 1 },
          'Numbering saved',
        );
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Kept with who changed it and when.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ScrollView style={{ flexGrow: 0, maxHeight: 440 }} contentContainerClassName="gap-4">
            {editing.kind === 'location' && place === null ? (
              <Field required>
                <FieldLabel>Legal entity</FieldLabel>
                <Select value={legalEntityId} onValueChange={setLegalEntityId}>
                  <SelectTrigger size="sm" accessibilityLabel="Legal entity">
                    <SelectValue />
                  </SelectTrigger>
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
              </Field>
            ) : null}
            {needsName ? (
              <Field required invalid={shown && problems.name}>
                <FieldLabel>Name</FieldLabel>
                <Input value={name} onChange={setName} maxLength={200} size="sm" />
                <FieldError>A name is needed.</FieldError>
              </Field>
            ) : null}
            {needsPlace ? (
              <Field required invalid={shown && problems.country}>
                <FieldLabel>Country</FieldLabel>
                <Combobox
                  label="Country"
                  size="sm"
                  placeholder="Choose a country"
                  searchPlaceholder="Search countries"
                  options={state.countries.map((c) => ({ value: c.code, label: c.name }))}
                  value={country === '' ? null : country}
                  onChange={(next) => {
                    setCountry(typeof next === 'string' ? next : '');
                  }}
                />
                <FieldError>Choose a country.</FieldError>
              </Field>
            ) : null}
            {needsZone ? (
              <ZonePicker
                state={state}
                label={editing.kind === 'zone' ? 'New time zone' : 'Time zone'}
                value={zone}
                onChange={setZone}
                invalid={shown && problems.zone}
              />
            ) : null}
            {editing.kind === 'zone' || (editing.kind === 'location' && place === null) ? (
              <Stack gap={1}>
                <DatePicker
                  label="From"
                  size="sm"
                  value={editing.kind === 'zone' ? effectiveFrom : from}
                  onChange={setFrom}
                />
                <Text variant="footnote" tone="muted">
                  {editing.kind === 'zone'
                    ? 'In force from the start of this day in the new zone. The same day again corrects an earlier change.'
                    : 'Leave empty for today.'}
                </Text>
              </Stack>
            ) : null}
            {editing.kind === 'numbering' ? (
              <>
                <Field invalid={shown && problems.prefix}>
                  <FieldLabel>Prefix</FieldLabel>
                  <Input
                    value={prefix}
                    onChange={setPrefix}
                    maxLength={10}
                    size="sm"
                    autoCapitalize="characters"
                  />
                  <FieldDescription>
                    Up to ten letters, digits or hyphens. May be empty.
                  </FieldDescription>
                  <FieldError>Letters, digits and hyphens only.</FieldError>
                </Field>
                <NumberField
                  label="Digits"
                  size="sm"
                  value={digits}
                  min={1}
                  max={12}
                  invalid={shown && problems.digits}
                  hint="Numbers are zero-padded to this width, and grow past it rather than wrap."
                  onChange={setDigits}
                />
                <NumberField
                  label="Next number"
                  size="sm"
                  value={start}
                  min={scheme?.nextValue ?? 1}
                  invalid={shown && problems.start}
                  hint="Never moves back below a number already handed out."
                  onChange={setStart}
                />
                <Text>{`The next person hired here is ${numberOf(prefix, digits ?? 1, start ?? 1)}.`}</Text>
              </>
            ) : null}
          </ScrollView>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            loading={busy !== null}
            onPress={() => {
              setShown(true);
              if (Object.values(problems).some(Boolean)) return;
              void submit().then((done) => {
                if (done !== null) onSaved();
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

const TOP = '__top';

/** Everything beneath a unit, and the unit: never a place to move it under. */
function subtreeOf(units: readonly OrgUnit[], id: string): Set<string> {
  const found = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const u of units) {
      if (u.parentId !== null && found.has(u.parentId) && !found.has(u.id)) {
        found.add(u.id);
        grew = true;
      }
    }
  }
  return found;
}

function UnitDialog({
  units,
  unit,
  mode,
  onClose,
  onSaved,
}: {
  units: readonly OrgUnit[];
  unit: OrgUnit | null;
  mode: 'add' | 'rename' | 'move';
  onClose: () => void;
  onSaved: () => void;
}): React.JSX.Element {
  const { act, busy } = useAct();
  const [name, setName] = useState(unit?.name ?? '');
  const [parent, setParent] = useState(unit?.parentId ?? TOP);
  const [shown, setShown] = useState(false);
  const invalid = mode !== 'move' && name.trim() === '';
  const excluded = unit === null ? new Set<string>() : subtreeOf(units, unit.id);
  const parents = [
    { value: TOP, label: 'Top level' },
    ...units
      .filter((u) => !u.archived && !excluded.has(u.id))
      .map((u) => ({ value: u.id, label: u.path })),
  ];
  const parentId = parent === TOP ? null : parent;
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {unit === null
              ? 'Add an org unit'
              : mode === 'rename'
                ? `Rename ${unit.name}`
                : `Move ${unit.name}`}
          </DialogTitle>
          <DialogDescription>Kept with who changed it and when.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {mode === 'move' ? null : (
            <Field required invalid={shown && invalid}>
              <FieldLabel>Name</FieldLabel>
              <Input value={name} onChange={setName} maxLength={200} size="sm" />
              <FieldError>A name is needed.</FieldError>
            </Field>
          )}
          {mode === 'rename' ? null : (
            <Field>
              <FieldLabel>Under</FieldLabel>
              <Combobox
                label="Under"
                size="sm"
                placeholder="Top level"
                searchPlaceholder="Search org units"
                options={parents}
                value={parent}
                onChange={(next) => {
                  setParent(typeof next === 'string' ? next : TOP);
                }}
              />
              <FieldDescription>
                {mode === 'move'
                  ? 'Everything under it moves with it.'
                  : 'Leave it at the top level for a department of its own.'}
              </FieldDescription>
            </Field>
          )}
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            loading={busy !== null}
            onPress={() => {
              setShown(true);
              if (invalid) return;
              void (
                unit === null
                  ? act('CreateOrgUnit', { name: name.trim(), parentId }, 'Org unit added')
                  : mode === 'rename'
                    ? act('UpdateOrgUnit', { id: unit.id, name: name.trim() }, 'Renamed')
                    : act('UpdateOrgUnit', { id: unit.id, parentId }, 'Moved')
              ).then((done) => {
                if (done !== null) onSaved();
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

function PayBandDialog({
  band,
  onClose,
  onSaved,
}: {
  band: PayBand | null;
  onClose: () => void;
  onSaved: () => void;
}): React.JSX.Element {
  const { act, busy } = useAct();
  const major = (minor: string | undefined, currency: string): string =>
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
  const [from, setFrom] = useState<string | null>(band?.effectiveFrom ?? null);
  const [shown, setShown] = useState(false);
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
  const amount = (key: 'minimum' | 'midpoint' | 'maximum', label: string) => (
    <Field key={key} required invalid={shown && problems[key]}>
      <FieldLabel>{label}</FieldLabel>
      <Input
        value={amounts[key]}
        size="sm"
        keyboardType="decimal-pad"
        onChange={(value) => {
          setAmounts((a) => ({ ...a, [key]: value }));
        }}
      />
      <FieldError>{`An amount in ${currency === '' ? 'the currency' : currency}, above zero.`}</FieldError>
    </Field>
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
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
          <ScrollView style={{ flexGrow: 0, maxHeight: 440 }} contentContainerClassName="gap-4">
            <Field required invalid={shown && problems.grade}>
              <FieldLabel>Grade</FieldLabel>
              <Input
                value={grade}
                onChange={setGrade}
                maxLength={64}
                size="sm"
                readOnly={band !== null}
              />
              <FieldDescription>As the grade field stores it on a profile.</FieldDescription>
              <FieldError>A grade is needed.</FieldError>
            </Field>
            <Field required invalid={shown && problems.currency}>
              <FieldLabel>Currency</FieldLabel>
              <Input
                value={currency}
                maxLength={3}
                size="sm"
                autoCapitalize="characters"
                readOnly={band !== null}
                onChange={(value) => {
                  setCurrency(value.toUpperCase());
                }}
              />
              <FieldError>A three-letter currency code, such as EUR.</FieldError>
            </Field>
            {amount('minimum', 'Minimum')}
            {amount('midpoint', 'Midpoint')}
            {amount('maximum', 'Maximum')}
            <DatePicker
              label="From"
              size="sm"
              value={from}
              onChange={setFrom}
              invalid={shown && problems.from}
            />
          </ScrollView>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            loading={busy !== null}
            onPress={() => {
              setShown(true);
              if (Object.values(problems).some(Boolean) || from === null) return;
              void act(
                'SetPayBand',
                {
                  grade: grade.trim(),
                  currency,
                  minimumMinor: minor.minimum ?? '',
                  midpointMinor: minor.midpoint ?? '',
                  maximumMinor: minor.maximum ?? '',
                  effectiveFrom: from,
                },
                'Pay band saved',
              ).then((done) => {
                if (done !== null) onSaved();
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

/** The company's defaults, how reminders go, the smallest group reported, and retention. */
function Reminders({ state, onSaved }: { state: State; onSaved: () => void }): React.JSX.Element {
  const { act, busy } = useAct();
  const { settings } = state;
  const photoWas = settings.photoAtSignup ?? 'off';
  const [zone, setZone] = useState(settings.defaultTimeZone);
  const [photo, setPhoto] = useState(photoWas);
  const [minimum, setMinimum] = useState<number | null>(settings.cohortMinimum);
  const lowered = minimum === null || minimum < settings.cohortMinimum;
  const changed =
    zone !== settings.defaultTimeZone ||
    photo !== photoWas ||
    (!lowered && minimum !== settings.cohortMinimum);
  const pending = state.retentionFloors.some((f) => f.status === 'unreviewed');
  return (
    <>
      <Card>
        <Stack gap={3}>
          <CardTitle>Company</CardTitle>
          <Text variant="subhead" tone="muted">
            {settings.slug === null
              ? `${settings.displayName ?? 'Not known yet'}. Named by the back office.`
              : `${settings.displayName ?? settings.slug}, signing in at ${settings.slug}. Named by the back office, and changed there.`}
          </Text>
          <ZonePicker
            state={state}
            label="Default time zone"
            value={zone}
            onChange={setZone}
            disabled={!state.canManage}
            description="The day of anybody with no location or legal entity, and of every figure about the whole company."
          />
          <Field>
            <FieldLabel>A photo when someone signs up</FieldLabel>
            <Select value={photo} disabled={!state.canManage} onValueChange={setPhoto}>
              <SelectTrigger size="sm" accessibilityLabel="A photo when someone signs up">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PHOTO.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </Stack>
      </Card>
      <Card>
        <Stack gap={3}>
          <CardTitle>Reminders and privacy</CardTitle>
          <KeyValues
            layout="stacked"
            items={[
              {
                label: 'Reminders to employees',
                value: 'By email, at most once a week, until their profile is complete',
              },
              { label: 'When', value: 'The day a detail goes missing, then once a week' },
              { label: 'At', value: '09:00 to 18:00, on their own clock' },
            ]}
          />
          <NumberField
            label="Smallest group shown in reports"
            size="sm"
            value={minimum}
            min={settings.cohortMinimum}
            step={1}
            disabled={!state.canManage}
            invalid={lowered}
            hint="Can be raised, never lowered. In a smaller group, people can be picked out from an average."
            onChange={setMinimum}
          />
        </Stack>
      </Card>
      {state.canManage ? (
        <Button
          variant="primary"
          disabled={!changed || lowered}
          loading={busy === 'UpdatePeopleSettings'}
          onPress={() => {
            void act(
              'UpdatePeopleSettings',
              {
                defaultTimeZone: zone === settings.defaultTimeZone ? null : zone,
                photoAtSignup: photo === photoWas ? null : photo,
                cohortMinimum: minimum === settings.cohortMinimum ? null : minimum,
              },
              'Saved',
            ).then((done) => {
              if (done !== null) onSaved();
            });
          }}
        >
          Save
        </Button>
      ) : null}
      {state.retentionFloors.length === 0 ? null : (
        <Card>
          <Stack gap={3}>
            <CardTitle>Statutory retention</CardTitle>
            <Text variant="subhead" tone="muted">
              The minimum time a leaver’s records are kept by law.
            </Text>
            {pending ? (
              <Alert tone="warning" title="Pending legal review">
                Nothing is erased automatically until these are confirmed.
              </Alert>
            ) : null}
            <List>
              {state.retentionFloors.map((f) => (
                <ListItem
                  key={f.floor}
                  description={`${String(f.months)} months after leaving`}
                  trailing={
                    <Badge size="sm" tone={f.status === 'reviewed' ? 'success' : 'warning'}>
                      {f.status === 'reviewed' ? 'Reviewed' : 'Pending review'}
                    </Badge>
                  }
                >
                  {FLOOR_NAMES[f.floor] ?? f.floor}
                </ListItem>
              ))}
            </List>
          </Stack>
        </Card>
      )}
      <Card>
        <Stack gap={3}>
          <CardTitle>Automated erasure</CardTitle>
          <Text variant="subhead" tone="muted">
            Leavers whose data will be erased in the next three months.
          </Text>
          {state.upcomingErasures.length === 0 ? (
            <Text tone="muted">Nobody is due.</Text>
          ) : (
            <List>
              {state.upcomingErasures.map((e) => (
                <ListItem
                  key={e.personId}
                  description={`Due ${e.dueOn} · ${
                    e.floors.length === 0
                      ? 'The company’s policy'
                      : e.floors.map((f) => FLOOR_NAMES[f] ?? f).join('; ')
                  }`}
                  trailing={
                    <Badge size="sm" tone={e.waitingForReview.length > 0 ? 'warning' : 'neutral'}>
                      {e.waitingForReview.length > 0 ? 'Waiting for review' : 'Scheduled'}
                    </Badge>
                  }
                >
                  {e.name ?? 'Name already erased'}
                </ListItem>
              ))}
            </List>
          )}
        </Stack>
      </Card>
    </>
  );
}
