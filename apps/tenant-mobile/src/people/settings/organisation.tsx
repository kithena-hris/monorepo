import {
  Alert,
  Badge,
  Button,
  Card,
  CardTitle,
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
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';

import { Failed, Heading, Loading, Page } from '../../frame';
import { useAct } from '../act';
import { ask, useSigned } from '../api';
import type { PeopleScreen } from '../routes';
import { bandAmount, minorDigits, toMinorDigits } from './minor';
import { t } from '../../i18n';

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

const PHOTO = () =>
  [
    ['off', t('people.settings.organisation.dont_ask', 'Don’t ask')],
    [
      'optional',
      t('people.settings.organisation.ask_and_let_them_skip_it', 'Ask, and let them skip it'),
    ],
    [
      'required',
      t('people.settings.organisation.ask_before_anything_else', 'Ask before anything else'),
    ],
  ] as const;
const FLOOR_NAMES = (): Readonly<Record<string, string>> => ({
  'es-labour': t('people.settings.organisation.spain_labour_records', 'Spain, labour records'),
  'de-labour': t('people.settings.organisation.germany_labour_records', 'Germany, labour records'),
  'eu-payroll': t(
    'people.settings.organisation.eu_payroll_and_tax_records',
    'EU, payroll and tax records',
  ),
});

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

const TABS = () =>
  [
    ['entities', t('people.settings.organisation.entities', 'Entities')],
    ['locations', t('people.settings.organisation.locations', 'Locations')],
    ['org-units', t('people.settings.organisation.org_units', 'Org units')],
    ['numbering', t('people.settings.organisation.numbering', 'Numbering')],
    ['country-packs', t('people.settings.organisation.country_packs', 'Country packs')],
    ['reminders', t('people.settings.organisation.reminders', 'Reminders')],
    ['pay-bands', t('people.settings.organisation.pay_bands', 'Pay bands')],
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

  const back = {
    label: t('people.settings.organisation.settings', 'Settings'),
    onPress: navigation.goBack,
  };
  if (failed !== null) {
    return (
      <Page title={t('people.settings.organisation.organisation', 'Organisation')} back={back}>
        <Failed message={failed} onRetry={() => void load()} />
      </Page>
    );
  }
  if (state === null) {
    return (
      <Page title={t('people.settings.organisation.organisation', 'Organisation')} back={back}>
        <Loading
          label={t(
            'people.settings.organisation.loading_the_organisation',
            'Loading the organisation',
          )}
        />
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
            accessibilityLabel={t(
              'people.settings.organisation.actions_for',
              'Actions for {{label}}',
              { label },
            )}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          label={t('people.settings.organisation.actions_for', 'Actions for {{label}}', { label })}
        >
          {items.map((i) => (
            <DropdownMenuItem key={i.label} icon={i.icon} onSelect={i.onSelect}>
              {i.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : undefined;
  // One page of headed sections (v3 S7): each its title, and Add where it can be added to.
  const add = (title: string, open?: () => void) => (
    <Heading
      title={title}
      {...(can && open !== undefined
        ? { action: t('people.settings.organisation.add', 'Add'), onAction: open }
        : {})}
    />
  );
  const tabs = TABS().filter(
    ([value]) =>
      (value !== 'country-packs' || packs !== null) &&
      (value !== 'pay-bands' || state.payBands !== null),
  );
  const shown = (value: string): boolean => tabs.some(([v]) => v === value);

  return (
    <Page title={t('people.settings.organisation.organisation', 'Organisation')} back={back}>
      {can ? null : (
        <Alert tone="info">
          {t(
            'people.settings.organisation.only_a_people_administrator_changes_these',
            'Only a People administrator changes these.',
          )}
        </Alert>
      )}

      {shown('entities') ? (
        <>
          {add(t('people.settings.organisation.legal_entities', 'Legal entities'), () => {
            setEditing({ kind: 'entity', entity: null });
          })}
          {state.legalEntities.length === 0 ? (
            <EmptyState
              icon={Building2}
              title={t(
                'people.settings.organisation.no_legal_entities_yet',
                'No legal entities yet',
              )}
              description={t(
                'people.settings.organisation.add_the_company_that_employs_people',
                'Add the company that employs people.',
              )}
            />
          ) : (
            <List>
              {state.legalEntities.map((e) => {
                const trailing = menu(e.name, [
                  {
                    label: t('people.settings.organisation.edit', 'Edit'),
                    icon: Pencil,
                    onSelect: () => {
                      setEditing({ kind: 'entity', entity: e });
                    },
                  },
                  {
                    label: t('people.settings.organisation.employee_numbers', 'Employee numbers'),
                    icon: Hash,
                    onSelect: () => {
                      setEditing({ kind: 'numbering', entity: e });
                    },
                  },
                  {
                    label: e.archived
                      ? t('people.settings.organisation.restore', 'Restore')
                      : t('people.settings.organisation.archive', 'Archive'),
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

      {shown('locations') ? (
        <>
          {add(
            'Locations',
            state.legalEntities.some((e) => !e.archived)
              ? () => {
                  setEditing({ kind: 'location', location: null });
                }
              : undefined,
          )}
          {state.locations.length === 0 ? (
            <EmptyState
              icon={Building2}
              title={t('people.settings.organisation.no_locations_yet', 'No locations yet')}
              description={t(
                'people.settings.organisation.add_where_people_work',
                'Add where people work.',
              )}
            />
          ) : (
            <List>
              {state.locations.map((l) => {
                const upcoming = l.zones.find((z) => z.effectiveFrom > todayIn(l.timeZone));
                const trailing = menu(l.name, [
                  {
                    label: t('people.settings.organisation.rename', 'Rename'),
                    icon: Pencil,
                    onSelect: () => {
                      setEditing({ kind: 'location', location: l });
                    },
                  },
                  {
                    label: t('people.settings.organisation.change_time_zone', 'Change time zone'),
                    icon: Clock,
                    onSelect: () => {
                      setEditing({ kind: 'zone', location: l });
                    },
                  },
                  {
                    label: l.archived
                      ? t('people.settings.organisation.restore', 'Restore')
                      : t('people.settings.organisation.archive', 'Archive'),
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

      {shown('org-units') ? (
        <>
          {add(t('people.settings.organisation.org_units', 'Org units'), () => {
            setEditing({ kind: 'unit', unit: null, mode: 'add' });
          })}
          {state.orgUnits.length === 0 ? (
            <EmptyState
              icon={Building2}
              title={t('people.settings.organisation.no_org_units_yet', 'No org units yet')}
              description={t(
                'people.settings.organisation.departments_and_teams_nested_as_they',
                'Departments and teams, nested as they are.',
              )}
            />
          ) : (
            <List>
              {state.orgUnits.map((u) => {
                const trailing = menu(u.name, [
                  {
                    label: t('people.settings.organisation.rename', 'Rename'),
                    icon: Pencil,
                    onSelect: () => {
                      setEditing({ kind: 'unit', unit: u, mode: 'rename' });
                    },
                  },
                  {
                    label: t('people.settings.organisation.move', 'Move'),
                    icon: MoveRight,
                    onSelect: () => {
                      setEditing({ kind: 'unit', unit: u, mode: 'move' });
                    },
                  },
                  {
                    label: u.archived
                      ? t('people.settings.organisation.restore', 'Restore')
                      : t('people.settings.organisation.archive', 'Archive'),
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

      {shown('numbering')
        ? add(t('people.settings.organisation.employee_numbers', 'Employee numbers'))
        : null}
      {shown('numbering') ? (
        state.legalEntities.length === 0 ? (
          <EmptyState
            icon={Hash}
            title={t(
              'people.settings.organisation.no_legal_entities_to_number',
              'No legal entities to number',
            )}
            description={t(
              'people.settings.organisation.add_a_legal_entity_first',
              'Add a legal entity first.',
            )}
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
                        ? t('people.settings.organisation.not_numbered', 'Not numbered')
                        : t('people.settings.organisation.next', 'Next: {{numberOf}}', {
                            numberOf: numberOf(n.prefix, n.digits, n.nextValue),
                          })
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

      {shown('country-packs') && packs !== null
        ? add(t('people.settings.organisation.country_packs', 'Country packs'))
        : null}
      {shown('country-packs') && packs !== null ? (
        packs.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={t('people.settings.organisation.no_country_packs', 'No country packs')}
            description={t(
              'people.settings.organisation.packs_arrive_with_people_one_per',
              'Packs arrive with People, one per country it has paperwork rules for.',
            )}
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

      {shown('reminders') ? add('Reminders') : null}
      {shown('reminders') ? <Reminders state={state} onSaved={reload} /> : null}

      {shown('pay-bands') && state.payBands !== null ? (
        <>
          <Text tone="muted">
            {t(
              'people.settings.organisation.compa_ratio_is_salary_divided_by',
              'Compa-ratio is salary divided by the band midpoint for the grade and currency.',
            )}
          </Text>
          {add(t('people.settings.organisation.pay_bands', 'Pay bands'), () => {
            setEditing({ kind: 'band', band: null });
          })}
          {state.payBands.length === 0 ? (
            <EmptyState
              icon={Building2}
              title={t('people.settings.organisation.no_pay_bands_yet', 'No pay bands yet')}
              description={t(
                'people.settings.organisation.add_one_per_grade_and_currency',
                'Add one per grade and currency to see compa-ratio.',
              )}
            />
          ) : (
            <List>
              {state.payBands.map((b) => (
                <ListItem
                  key={b.id}
                  description={t(
                    'people.settings.organisation.from_mid',
                    'From {{effectiveFrom}} · {{bandAmount}} – {{bandAmount2}} · mid {{bandAmount3}}',
                    {
                      effectiveFrom: b.effectiveFrom,
                      bandAmount: bandAmount(b.minimumMinor, b.currency),
                      bandAmount2: bandAmount(b.maximumMinor, b.currency),
                      bandAmount3: bandAmount(b.midpointMinor, b.currency),
                    },
                  )}
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
                  ? t(
                      'people.settings.organisation.it_can_be_chosen_again_for',
                      'It can be chosen again for new records.',
                    )
                  : t(
                      'people.settings.organisation.it_can_no_longer_be_chosen',
                      'It can no longer be chosen for new records. Nothing is lost: restore it any time.',
                    )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                className="flex-1"
                onPress={() => {
                  setEditing(null);
                }}
              >
                {t('people.settings.organisation.cancel', 'Cancel')}
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
                {editing.archived
                  ? t('people.settings.organisation.restore', 'Restore')
                  : t('people.settings.organisation.archive', 'Archive')}
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
        placeholder={t('people.settings.organisation.choose_a_time_zone', 'Choose a time zone')}
        searchPlaceholder={t('people.settings.organisation.search_time_zones', 'Search time zones')}
        options={state.timeZones.map((z) => ({ value: z, label: z.replaceAll('_', ' ') }))}
        value={value === '' ? null : value}
        onChange={(next) => {
          onChange(typeof next === 'string' ? next : '');
        }}
      />
      {description === undefined ? null : <FieldDescription>{description}</FieldDescription>}
      <FieldError>
        {t('people.settings.organisation.choose_a_time_zone_2', 'Choose a time zone.')}
      </FieldError>
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
        ? t('people.settings.organisation.add_a_legal_entity', 'Add a legal entity')
        : `Edit ${entity.name}`
      : editing.kind === 'location'
        ? place === null
          ? t('people.settings.organisation.add_a_location', 'Add a location')
          : `Rename ${place.name}`
        : editing.kind === 'zone'
          ? t(
              'people.settings.organisation.change_the_time_zone_of',
              'Change the time zone of {{name}}',
              { name: editing.location.name },
            )
          : t('people.settings.organisation.employee_numbers_in', 'Employee numbers in {{name}}', {
              name: editing.entity.name,
            });
  const submit = (): Promise<unknown> => {
    switch (editing.kind) {
      case 'entity':
        return entity === null
          ? act(
              'CreateLegalEntity',
              { name: name.trim(), country, timeZone: zone },
              t('people.settings.organisation.legal_entity_added', 'Legal entity added'),
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
              t('people.settings.organisation.location_added', 'Location added'),
            )
          : act('UpdateLocation', { id: place.id, name: name.trim() }, 'Renamed');
      case 'zone':
        return act(
          'ChangeLocationZone',
          { id: editing.location.id, timeZone: zone, effectiveFrom: effectiveFrom ?? '' },
          t('people.settings.organisation.time_zone_changed', 'Time zone changed'),
        );
      case 'numbering':
        return act(
          'SetEmployeeNumbering',
          { legalEntityId: editing.entity.id, prefix, digits: digits ?? 1, start: start ?? 1 },
          t('people.settings.organisation.numbering_saved', 'Numbering saved'),
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
          <DialogDescription>
            {t(
              'people.settings.organisation.kept_with_who_changed_it_and',
              'Kept with who changed it and when.',
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ScrollView style={{ flexGrow: 0, maxHeight: 440 }} contentContainerClassName="gap-4">
            {editing.kind === 'location' && place === null ? (
              <Field required>
                <FieldLabel>
                  {t('people.settings.organisation.legal_entity', 'Legal entity')}
                </FieldLabel>
                <Select value={legalEntityId} onValueChange={setLegalEntityId}>
                  <SelectTrigger
                    size="sm"
                    accessibilityLabel={t(
                      'people.settings.organisation.legal_entity',
                      'Legal entity',
                    )}
                  >
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
                <FieldLabel>{t('people.settings.organisation.name', 'Name')}</FieldLabel>
                <Input value={name} onChange={setName} maxLength={200} size="sm" />
                <FieldError>
                  {t('people.settings.organisation.a_name_is_needed', 'A name is needed.')}
                </FieldError>
              </Field>
            ) : null}
            {needsPlace ? (
              <Field required invalid={shown && problems.country}>
                <FieldLabel>{t('people.settings.organisation.country', 'Country')}</FieldLabel>
                <Combobox
                  label={t('people.settings.organisation.country', 'Country')}
                  size="sm"
                  placeholder={t(
                    'people.settings.organisation.choose_a_country',
                    'Choose a country',
                  )}
                  searchPlaceholder={t(
                    'people.settings.organisation.search_countries',
                    'Search countries',
                  )}
                  options={state.countries.map((c) => ({ value: c.code, label: c.name }))}
                  value={country === '' ? null : country}
                  onChange={(next) => {
                    setCountry(typeof next === 'string' ? next : '');
                  }}
                />
                <FieldError>
                  {t('people.settings.organisation.choose_a_country_2', 'Choose a country.')}
                </FieldError>
              </Field>
            ) : null}
            {needsZone ? (
              <ZonePicker
                state={state}
                label={
                  editing.kind === 'zone'
                    ? t('people.settings.organisation.new_time_zone', 'New time zone')
                    : t('people.settings.organisation.time_zone', 'Time zone')
                }
                value={zone}
                onChange={setZone}
                invalid={shown && problems.zone}
              />
            ) : null}
            {editing.kind === 'zone' || (editing.kind === 'location' && place === null) ? (
              <Stack gap={1}>
                <DatePicker
                  label={t('people.settings.organisation.from', 'From')}
                  size="sm"
                  value={editing.kind === 'zone' ? effectiveFrom : from}
                  onChange={setFrom}
                />
                <Text variant="footnote" tone="muted">
                  {editing.kind === 'zone'
                    ? t(
                        'people.settings.organisation.in_force_from_the_start_of',
                        'In force from the start of this day in the new zone. The same day again corrects an earlier change.',
                      )
                    : t(
                        'people.settings.organisation.leave_empty_for_today',
                        'Leave empty for today.',
                      )}
                </Text>
              </Stack>
            ) : null}
            {editing.kind === 'numbering' ? (
              <>
                <Field invalid={shown && problems.prefix}>
                  <FieldLabel>{t('people.settings.organisation.prefix', 'Prefix')}</FieldLabel>
                  <Input
                    value={prefix}
                    onChange={setPrefix}
                    maxLength={10}
                    size="sm"
                    autoCapitalize="characters"
                  />
                  <FieldDescription>
                    {t(
                      'people.settings.organisation.up_to_ten_letters_digits_or',
                      'Up to ten letters, digits or hyphens. May be empty.',
                    )}
                  </FieldDescription>
                  <FieldError>
                    {t(
                      'people.settings.organisation.letters_digits_and_hyphens_only',
                      'Letters, digits and hyphens only.',
                    )}
                  </FieldError>
                </Field>
                <NumberField
                  label={t('people.settings.organisation.digits', 'Digits')}
                  size="sm"
                  value={digits}
                  min={1}
                  max={12}
                  invalid={shown && problems.digits}
                  hint={t(
                    'people.settings.organisation.numbers_are_zero_padded_to_this',
                    'Numbers are zero-padded to this width, and grow past it rather than wrap.',
                  )}
                  onChange={setDigits}
                />
                <NumberField
                  label={t('people.settings.organisation.next_number', 'Next number')}
                  size="sm"
                  value={start}
                  min={scheme?.nextValue ?? 1}
                  invalid={shown && problems.start}
                  hint={t(
                    'people.settings.organisation.never_moves_back_below_a_number',
                    'Never moves back below a number already handed out.',
                  )}
                  onChange={setStart}
                />
                <Text>
                  {t(
                    'people.settings.organisation.the_next_person_hired_here_is',
                    'The next person hired here is {{numberOf}}.',
                    { numberOf: numberOf(prefix, digits ?? 1, start ?? 1) },
                  )}
                </Text>
              </>
            ) : null}
          </ScrollView>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            {t('people.settings.organisation.cancel', 'Cancel')}
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
            {t('people.settings.organisation.save', 'Save')}
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
    { value: TOP, label: t('people.settings.organisation.top_level', 'Top level') },
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
              ? t('people.settings.organisation.add_an_org_unit', 'Add an org unit')
              : mode === 'rename'
                ? t('people.settings.organisation.rename_2', 'Rename {{name}}', { name: unit.name })
                : t('people.settings.organisation.move_2', 'Move {{name}}', { name: unit.name })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'people.settings.organisation.kept_with_who_changed_it_and',
              'Kept with who changed it and when.',
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {mode === 'move' ? null : (
            <Field required invalid={shown && invalid}>
              <FieldLabel>{t('people.settings.organisation.name', 'Name')}</FieldLabel>
              <Input value={name} onChange={setName} maxLength={200} size="sm" />
              <FieldError>
                {t('people.settings.organisation.a_name_is_needed', 'A name is needed.')}
              </FieldError>
            </Field>
          )}
          {mode === 'rename' ? null : (
            <Field>
              <FieldLabel>{t('people.settings.organisation.under', 'Under')}</FieldLabel>
              <Combobox
                label={t('people.settings.organisation.under', 'Under')}
                size="sm"
                placeholder={t('people.settings.organisation.top_level', 'Top level')}
                searchPlaceholder={t(
                  'people.settings.organisation.search_org_units',
                  'Search org units',
                )}
                options={parents}
                value={parent}
                onChange={(next) => {
                  setParent(typeof next === 'string' ? next : TOP);
                }}
              />
              <FieldDescription>
                {mode === 'move'
                  ? t(
                      'people.settings.organisation.everything_under_it_moves_with_it',
                      'Everything under it moves with it.',
                    )
                  : t(
                      'people.settings.organisation.leave_it_at_the_top_level',
                      'Leave it at the top level for a department of its own.',
                    )}
              </FieldDescription>
            </Field>
          )}
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            {t('people.settings.organisation.cancel', 'Cancel')}
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
                  ? act(
                      'CreateOrgUnit',
                      { name: name.trim(), parentId },
                      t('people.settings.organisation.org_unit_added', 'Org unit added'),
                    )
                  : mode === 'rename'
                    ? act('UpdateOrgUnit', { id: unit.id, name: name.trim() }, 'Renamed')
                    : act('UpdateOrgUnit', { id: unit.id, parentId }, 'Moved')
              ).then((done) => {
                if (done !== null) onSaved();
              });
            }}
          >
            {t('people.settings.organisation.save', 'Save')}
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
      <FieldError>
        {t(
          'people.settings.organisation.an_amount_in_above_zero',
          'An amount in {{value}}, above zero.',
          { value: currency === '' ? 'the currency' : currency },
        )}
      </FieldError>
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
            {band === null
              ? t('people.settings.organisation.add_a_pay_band', 'Add a pay band')
              : t('people.settings.organisation.correct', 'Correct {{grade}}, {{currency}}', {
                  grade: band.grade,
                  currency: band.currency,
                })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'people.settings.organisation.kept_with_who_changed_it_and_2',
              'Kept with who changed it and when. The same grade, currency and day again corrects it.',
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ScrollView style={{ flexGrow: 0, maxHeight: 440 }} contentContainerClassName="gap-4">
            <Field required invalid={shown && problems.grade}>
              <FieldLabel>{t('people.settings.organisation.grade', 'Grade')}</FieldLabel>
              <Input
                value={grade}
                onChange={setGrade}
                maxLength={64}
                size="sm"
                readOnly={band !== null}
              />
              <FieldDescription>
                {t(
                  'people.settings.organisation.as_the_grade_field_stores_it',
                  'As the grade field stores it on a profile.',
                )}
              </FieldDescription>
              <FieldError>
                {t('people.settings.organisation.a_grade_is_needed', 'A grade is needed.')}
              </FieldError>
            </Field>
            <Field required invalid={shown && problems.currency}>
              <FieldLabel>{t('people.settings.organisation.currency', 'Currency')}</FieldLabel>
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
              <FieldError>
                {t(
                  'people.settings.organisation.a_three_letter_currency_code_such',
                  'A three-letter currency code, such as EUR.',
                )}
              </FieldError>
            </Field>
            {amount('minimum', 'Minimum')}
            {amount('midpoint', 'Midpoint')}
            {amount('maximum', 'Maximum')}
            <DatePicker
              label={t('people.settings.organisation.from', 'From')}
              size="sm"
              value={from}
              onChange={setFrom}
              invalid={shown && problems.from}
            />
          </ScrollView>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            {t('people.settings.organisation.cancel', 'Cancel')}
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
                t('people.settings.organisation.pay_band_saved', 'Pay band saved'),
              ).then((done) => {
                if (done !== null) onSaved();
              });
            }}
          >
            {t('people.settings.organisation.save', 'Save')}
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
          <CardTitle>{t('people.settings.organisation.company', 'Company')}</CardTitle>
          <Text variant="subhead" tone="muted">
            {settings.slug === null
              ? t(
                  'people.settings.organisation.named_by_the_back_office',
                  '{{value}}. Named by the back office.',
                  { value: settings.displayName ?? 'Not known yet' },
                )
              : t(
                  'people.settings.organisation.signing_in_at_named_by_the',
                  '{{value}}, signing in at {{slug}}. Named by the back office, and changed there.',
                  { value: settings.displayName ?? settings.slug, slug: settings.slug },
                )}
          </Text>
          <ZonePicker
            state={state}
            label={t('people.settings.organisation.default_time_zone', 'Default time zone')}
            value={zone}
            onChange={setZone}
            disabled={!state.canManage}
            description={t(
              'people.settings.organisation.the_day_of_anybody_with_no',
              'The day of anybody with no location or legal entity, and of every figure about the whole company.',
            )}
          />
          <Field>
            <FieldLabel>
              {t(
                'people.settings.organisation.a_photo_when_someone_signs_up',
                'A photo when someone signs up',
              )}
            </FieldLabel>
            <Select value={photo} disabled={!state.canManage} onValueChange={setPhoto}>
              <SelectTrigger
                size="sm"
                accessibilityLabel={t(
                  'people.settings.organisation.a_photo_when_someone_signs_up',
                  'A photo when someone signs up',
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PHOTO().map(([value, label]) => (
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
          <CardTitle>
            {t('people.settings.organisation.reminders_and_privacy', 'Reminders and privacy')}
          </CardTitle>
          <KeyValues
            layout="stacked"
            items={[
              {
                label: t(
                  'people.settings.organisation.reminders_to_employees',
                  'Reminders to employees',
                ),
                value: 'By email, at most once a week, until their profile is complete',
              },
              {
                label: t('people.settings.organisation.when', 'When'),
                value: 'The day a detail goes missing, then once a week',
              },
              {
                label: t('people.settings.organisation.at', 'At'),
                value: '09:00 to 18:00, on their own clock',
              },
            ]}
          />
          <NumberField
            label={t(
              'people.settings.organisation.smallest_group_shown_in_reports',
              'Smallest group shown in reports',
            )}
            size="sm"
            value={minimum}
            min={settings.cohortMinimum}
            step={1}
            disabled={!state.canManage}
            invalid={lowered}
            hint={t(
              'people.settings.organisation.can_be_raised_never_lowered_in',
              'Can be raised, never lowered. In a smaller group, people can be picked out from an average.',
            )}
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
          {t('people.settings.organisation.save', 'Save')}
        </Button>
      ) : null}
      {state.retentionFloors.length === 0 ? null : (
        <Card>
          <Stack gap={3}>
            <CardTitle>
              {t('people.settings.organisation.statutory_retention', 'Statutory retention')}
            </CardTitle>
            <Text variant="subhead" tone="muted">
              {t(
                'people.settings.organisation.the_minimum_time_a_leavers_records',
                'The minimum time a leaver’s records are kept by law.',
              )}
            </Text>
            {pending ? (
              <Alert
                tone="warning"
                title={t(
                  'people.settings.organisation.pending_legal_review',
                  'Pending legal review',
                )}
              >
                {t(
                  'people.settings.organisation.nothing_is_erased_automatically_until_these',
                  'Nothing is erased automatically until these are confirmed.',
                )}
              </Alert>
            ) : null}
            <List>
              {state.retentionFloors.map((f) => (
                <ListItem
                  key={f.floor}
                  description={t(
                    'people.settings.organisation.months_after_leaving',
                    '{{String}} months after leaving',
                    { String: String(f.months) },
                  )}
                  trailing={
                    <Badge size="sm" tone={f.status === 'reviewed' ? 'success' : 'warning'}>
                      {f.status === 'reviewed'
                        ? t('people.settings.organisation.reviewed', 'Reviewed')
                        : t('people.settings.organisation.pending_review', 'Pending review')}
                    </Badge>
                  }
                >
                  {FLOOR_NAMES()[f.floor] ?? f.floor}
                </ListItem>
              ))}
            </List>
          </Stack>
        </Card>
      )}
      <Card>
        <Stack gap={3}>
          <CardTitle>
            {t('people.settings.organisation.automated_erasure', 'Automated erasure')}
          </CardTitle>
          <Text variant="subhead" tone="muted">
            {t(
              'people.settings.organisation.leavers_whose_data_will_be_erased',
              'Leavers whose data will be erased in the next three months.',
            )}
          </Text>
          {state.upcomingErasures.length === 0 ? (
            <Text tone="muted">
              {t('people.settings.organisation.nobody_is_due', 'Nobody is due.')}
            </Text>
          ) : (
            <List>
              {state.upcomingErasures.map((e) => (
                <ListItem
                  key={e.personId}
                  description={t('people.settings.organisation.due', 'Due {{dueOn}} · {{value}}', {
                    dueOn: e.dueOn,
                    value:
                      e.floors.length === 0
                        ? 'The company’s policy'
                        : e.floors.map((f) => FLOOR_NAMES()[f] ?? f).join('; '),
                  })}
                  trailing={
                    <Badge size="sm" tone={e.waitingForReview.length > 0 ? 'warning' : 'neutral'}>
                      {e.waitingForReview.length > 0
                        ? t('people.settings.organisation.waiting_for_review', 'Waiting for review')
                        : t('people.settings.organisation.scheduled', 'Scheduled')}
                    </Badge>
                  }
                >
                  {e.name ??
                    t('people.settings.organisation.name_already_erased', 'Name already erased')}
                </ListItem>
              ))}
            </List>
          )}
        </Stack>
      </Card>
    </>
  );
}
