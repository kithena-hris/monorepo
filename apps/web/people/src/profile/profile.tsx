import { Avatar, Badge, Button, EmptyState, PageHeader, PageSection, Stack } from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import { DisplayValue } from '../record/display';
import type { RecordSection, Values } from '../record/model';
import { SectionForm } from '../record/section-form';

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
}

export interface ProfileProps {
  readonly load: Loadable<ProfileState>;
  readonly onSave: (sectionKey: string, changed: Values) => Promise<Outcome>;
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
export function Profile({ load, onSave }: ProfileProps): JSX.Element {
  return (
    <Loaded load={load} what="this profile">
      {(state) => <Record state={state} onSave={onSave} />}
    </Loaded>
  );
}

function Record({
  state,
  onSave,
}: {
  readonly state: ProfileState;
  readonly onSave: ProfileProps['onSave'];
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
