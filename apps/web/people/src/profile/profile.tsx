import {
  Alert,
  Avatar,
  Badge,
  Button,
  DatePicker,
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  PageHeader,
  PageSection,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded, type Checked, type Loadable, type Outcome } from '../load';
import { PeopleSearch, type SearchPeople } from '../record/attribute-input';
import { DisplayValue } from '../record/display';
import type { RecordSection, Values } from '../record/model';
import { ReviewNotices, type IdentifierReview } from '../record/review-notices';
import { SectionForm } from '../record/section-form';
import { Employment, type EmploymentState, type LifecycleMove } from './employment';

export interface ProfileSection extends RecordSection {
  /** Reading this section is audited, and the viewer is told so. */
  readonly readsLogged: boolean;
}

export interface ProfileState {
  readonly person: {
    readonly name: string;
    /** "Support Engineer · Barcelona · started 1 Sep 2026", from what the viewer may read. */
    readonly summary: string | null;
    readonly avatarUrl: string | null;
    /** Missing required values, or null when this viewer is not shown completeness. */
    readonly missing: number | null;
  };
  /**
   * Only what this viewer may read, already filtered by the application layer.
   * A withheld field is not here, and a section with none left is not here
   * either.
   */
  readonly sections: readonly ProfileSection[];
  readonly values: Values;
  /** HR's alone: whose day it is for them (PEO-119). Absent or null for anybody else. */
  readonly calendar?: EmploymentState['calendar'] | null;
  /** HR's alone, with the calendar: where they stand and every period (PEO-120). */
  readonly employment?: EmploymentState['employment'];
  /**
   * Where the person sits and where they may go (PEO-123), for HR only;
   * null or absent for everybody else.
   */
  readonly placement?: PlacementState | null;
  /** Their doubted identifiers still open, on fields the viewer reads (PEO-125). */
  readonly reviews?: readonly IdentifierReview[];
}

export interface PlacementState {
  readonly legalEntityId: string | null;
  readonly locationId: string | null;
  readonly entities: readonly { readonly value: string; readonly label: string }[];
  readonly locations: readonly {
    readonly value: string;
    readonly label: string;
    readonly legalEntityId: string;
  }[];
}

export interface PlacementChange {
  readonly legalEntityId?: string | null;
  readonly locationId?: string | null;
  readonly effectiveFrom?: string;
}

export interface ProfileProps {
  readonly load: Loadable<ProfileState>;
  readonly onSave: (sectionKey: string, changed: Values) => Promise<Outcome>;
  /** What our checks would warn about a national identifier, before it is saved (PEO-125). */
  readonly onCheck?: (sectionKey: string, changed: Values) => Promise<Checked>;
  /** A lifecycle move on this person (PEO-120); absent on one's own profile. */
  readonly onMove?: (move: LifecycleMove) => Promise<Outcome>;
  /** Move the person (PEO-123). Absent where the shell offers no move. */
  readonly onPlace?: (placement: PlacementChange) => Promise<Outcome>;
  /** Finds people for a person field, by name, over everybody (PEO-122). */
  readonly searchPeople?: SearchPeople;
}

/**
 * One person's record, for whoever is looking (PRD §6.6, design screen 6).
 *
 * One screen for HR, a manager and the person themselves, differing only by
 * the authorization decision that shaped `load`. A field the viewer cannot
 * read is absent: no label, no padlock, no greyed row, no empty section — each
 * of those would say the field exists, and for a self-ID answer that is the
 * disclosure itself. This component renders what it is given and cannot
 * re-add a key the application layer removed.
 */
export function Profile({
  load,
  onSave,
  onCheck,
  onMove,
  onPlace,
  searchPeople,
}: ProfileProps): JSX.Element {
  return (
    <PeopleSearch.Provider value={searchPeople ?? null}>
      <Loaded load={load} what="this profile">
        {(state) => (
          <Record
            state={state}
            onSave={onSave}
            onCheck={onCheck}
            onMove={onMove}
            onPlace={onPlace}
          />
        )}
      </Loaded>
    </PeopleSearch.Provider>
  );
}

function Record({
  state,
  onSave,
  onCheck,
  onMove,
  onPlace,
}: {
  readonly state: ProfileState;
  readonly onSave: ProfileProps['onSave'];
  readonly onCheck: ProfileProps['onCheck'];
  readonly onMove: ProfileProps['onMove'];
  readonly onPlace: ProfileProps['onPlace'];
}): JSX.Element {
  const [editing, setEditing] = useState<string | null>(null);
  const [values, setValues] = useState<Values>(state.values);
  // Defensive as well as tidy: a section handed over with no fields would
  // still print its heading, and a heading is a disclosure.
  const sections = state.sections.filter((s) => s.fields.length > 0);
  const { person } = state;

  return (
    <Stack gap={6}>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Avatar size="lg" name={person.name} src={person.avatarUrl ?? undefined} />
            {person.name}
          </span>
        }
        description={person.summary ?? undefined}
        actions={
          person.missing === null ? undefined : (
            <Badge tone={person.missing === 0 ? 'success' : 'warning'}>
              {person.missing === 0 ? 'Complete' : `${String(person.missing)} missing`}
            </Badge>
          )
        }
      />
      <ReviewNotices reviews={state.reviews} />
      {state.calendar ? (
        <Employment
          state={{ calendar: state.calendar, employment: state.employment ?? null }}
          onMove={onMove}
        />
      ) : null}
      {/* Where they work, beside their employment (PEO-123). */}
      {state.placement && onPlace ? (
        <PlacementSection placement={state.placement} onPlace={onPlace} />
      ) : null}
      {sections.length === 0 ? (
        <EmptyState title="Nothing else to show" />
      ) : (
        sections.map((section) => {
          const writable = section.fields.some((f) => !f.readOnly);
          return (
            <PageSection
              key={section.key}
              surface
              title={section.label}
              actions={
                <span className="flex items-center gap-2">
                  {section.readsLogged ? <Badge size="sm">Reads are logged</Badge> : null}
                  {writable && editing !== section.key ? (
                    <Button
                      size="sm"
                      aria-label={`Edit ${section.label}`}
                      onClick={() => {
                        setEditing(section.key);
                      }}
                    >
                      Edit
                    </Button>
                  ) : null}
                </span>
              }
            >
              {editing === section.key ? (
                <SectionForm
                  section={section}
                  values={values}
                  {...(onCheck === undefined ? {} : { onCheck })}
                  footer={
                    <Button
                      onClick={() => {
                        setEditing(null);
                      }}
                    >
                      Cancel
                    </Button>
                  }
                  onSave={async (key, changed) => {
                    const outcome = await onSave(key, changed);
                    if (outcome.ok) {
                      setValues((v) => ({ ...v, ...changed }));
                      setEditing(null);
                    }
                    return outcome;
                  }}
                />
              ) : (
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[minmax(10rem,auto)_1fr]">
                  {section.fields.map((field) => (
                    <div key={field.key} className="contents">
                      <dt className="text-sm text-fg-muted">{field.label}</dt>
                      <dd className="text-sm">
                        <DisplayValue field={field} value={values[field.key]} />
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </PageSection>
          );
        })
      )}
    </Stack>
  );
}

/**
 * Move somebody (PEO-123): a location, which names its legal entity, from a
 * date. A different entity is a transfer — People closes one employment
 * period and opens the next — so the screen says so before HR presses it.
 */
function PlacementSection({
  placement,
  onPlace,
}: {
  readonly placement: PlacementState;
  readonly onPlace: (placement: PlacementChange) => Promise<Outcome>;
}): JSX.Element {
  const [entity, setEntity] = useState(placement.legalEntityId ?? '');
  const [location, setLocation] = useState(placement.locationId ?? '');
  const [from, setFrom] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const offices = placement.locations.filter((l) => entity === '' || l.legalEntityId === entity);
  const transfer =
    entity !== '' && placement.legalEntityId !== null && entity !== placement.legalEntityId;
  const unchanged =
    entity === (placement.legalEntityId ?? '') && location === (placement.locationId ?? '');

  return (
    <PageSection surface title="Placement">
      <form
        noValidate
        aria-label="Placement"
        onSubmit={(e) => {
          e.preventDefault();
          setSaving(true);
          setRefused(null);
          void onPlace({
            legalEntityId: entity === '' ? null : entity,
            locationId: location === '' ? null : location,
            ...(from === null ? {} : { effectiveFrom: from }),
          }).then((outcome) => {
            setSaving(false);
            if (!outcome.ok) setRefused(outcome.message);
          });
        }}
      >
        <Stack gap={4}>
          <Field>
            <FieldLabel>Legal entity</FieldLabel>
            <Select
              value={entity}
              onValueChange={(next) => {
                setEntity(next);
                if (
                  !placement.locations.some((l) => l.value === location && l.legalEntityId === next)
                ) {
                  setLocation('');
                }
              }}
            >
              <FieldControl>
                <SelectTrigger>
                  <SelectValue placeholder="Choose" />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                {placement.entities.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>Work location</FieldLabel>
            <Select
              value={location}
              onValueChange={(next) => {
                setLocation(next);
                const office = placement.locations.find((l) => l.value === next);
                if (office) setEntity(office.legalEntityId);
              }}
            >
              <FieldControl>
                <SelectTrigger>
                  <SelectValue placeholder="Choose" />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                {offices.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>Their day is this location’s, from the date below.</FieldDescription>
          </Field>
          <DatePicker label="Effective from" value={from} onChange={setFrom} />
          {transfer ? (
            <Alert tone="info" title="This is a transfer">
              Their employment in the current legal entity ends the day before, and a new one starts
              on this date. Service is continuous.
            </Alert>
          ) : null}
          {refused === null ? null : (
            <Alert tone="danger" title="Not moved">
              {refused}
            </Alert>
          )}
          <div>
            <Button
              type="submit"
              variant="primary"
              disabled={unchanged}
              loading={saving}
              loadingLabel="Moving"
            >
              Move
            </Button>
          </div>
        </Stack>
      </form>
    </PageSection>
  );
}
