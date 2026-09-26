import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldControl,
  FieldError,
  FieldLabel,
  Input,
  ListDetail,
  PageHeader,
  SortableList,
  Stack,
  icons,
  type IsoDate,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import type {
  ClassificationAdvice,
  FieldDescription,
  FieldInput,
  PublishPreview,
  RegistryDraft,
  RegistryField,
  RegistrySection,
} from './model';
import { FieldEditor } from './field-editor';
import { PublishDialog } from './publish';
import { DATA_TYPE_LABEL, REQUIREDNESS_LABEL, SCOPE_LABEL, WRITER_LABEL, listed } from './words';

const { add: Plus, locked: Lock } = icons;

export interface FieldRegistryProps {
  readonly load: Loadable<RegistryDraft>;
  /** Today in the tenant's calendar, for the publish dialog's `requiredFrom`. */
  readonly today: IsoDate;
  readonly advise: (field: FieldDescription) => Promise<ClassificationAdvice>;
  readonly onReorderSections: (order: readonly string[]) => Promise<Outcome>;
  readonly onReorderFields: (sectionKey: string, order: readonly string[]) => Promise<Outcome>;
  readonly onAddSection: (label: string) => Promise<Outcome>;
  /** `editing` is the key of the field being changed, or null for a new one. */
  readonly onSaveField: (input: FieldInput, editing: string | null) => Promise<Outcome>;
  readonly preview: (requiredFrom: IsoDate) => Promise<PublishPreview>;
  readonly onPublish: (requiredFrom: IsoDate) => Promise<Outcome>;
}

/**
 * Employee fields: the registry, sections on the left and that section's
 * fields on the right, both reorderable (PRD §9.1, design screen 2).
 *
 * Editing here changes the draft and nothing else. Behaviour changes on
 * publish, which is the only way an integrator gets a stable contract and an
 * admin gets somewhere safe to experiment.
 */
export function FieldRegistry(props: FieldRegistryProps): JSX.Element {
  return (
    <Stack gap={6}>
      <Loaded load={props.load} what="the employee fields">
        {(draft) => <Registry {...props} draft={draft} />}
      </Loaded>
    </Stack>
  );
}

/** Reorders `items` to follow `order`, keeping anything `order` does not name at the end. */
function arranged<T extends { readonly key: string }>(
  items: readonly T[],
  order: readonly string[] | null,
): T[] {
  if (order === null) return [...items];
  const byKey = new Map(items.map((i) => [i.key, i]));
  const named = order.flatMap((k) => byKey.get(k) ?? []);
  return [...named, ...items.filter((i) => !order.includes(i.key))];
}

function Registry({
  draft,
  today,
  advise,
  onReorderSections,
  onReorderFields,
  onAddSection,
  onSaveField,
  preview,
  onPublish,
}: FieldRegistryProps & { readonly draft: RegistryDraft }): JSX.Element {
  // The order as the admin last left it, shown until the shell hands back a
  // draft that agrees — the list does not jump back while the save is in flight.
  const [sectionOrder, setSectionOrder] = useState<readonly string[] | null>(null);
  const [fieldOrder, setFieldOrder] = useState<Readonly<Record<string, readonly string[] | null>>>(
    {},
  );
  const [chosen, setChosen] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ field: RegistryField | null } | null>(null);
  const [adding, setAdding] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const sections = arranged(draft.sections, sectionOrder);
  const section = sections.find((s) => s.key === chosen) ?? sections[0];
  const fields =
    section === undefined
      ? []
      : arranged(
          draft.fields.filter((f) => f.sectionKey === section.key),
          fieldOrder[section.key] ?? null,
        );

  const settle = async (attempt: Promise<Outcome>, undo: () => void): Promise<void> => {
    setFailed(null);
    const outcome = await attempt;
    if (!outcome.ok) {
      undo();
      setFailed(outcome.message);
    }
  };

  const status =
    draft.published === null
      ? 'Nothing published yet'
      : `Version ${String(draft.published.version)} published ${draft.published.publishedAt}`;
  const pending =
    draft.unpublishedChanges === 0
      ? 'no unpublished changes'
      : `${String(draft.unpublishedChanges)} unpublished ${draft.unpublishedChanges === 1 ? 'change' : 'changes'}`;
  const next = (draft.published?.version ?? 0) + 1;

  return (
    <>
      <PageHeader
        title="Employee fields"
        description={`${status} · ${pending}`}
        actions={
          <Button
            variant="primary"
            disabled={draft.unpublishedChanges === 0}
            onClick={() => {
              setPublishing(true);
            }}
          >
            Publish version {next}
          </Button>
        }
      />

      {failed === null ? null : (
        <Alert tone="danger" title="That change was not saved">
          {failed}
        </Alert>
      )}

      {section === undefined ? (
        <EmptyState
          title="No sections yet"
          description="A section groups fields that are seen and filled in by the same people."
          action={
            <Button
              startIcon={<Plus />}
              onClick={() => {
                setAdding(true);
              }}
            >
              Add section
            </Button>
          }
        />
      ) : (
        <Card>
          <ListDetail
            listLabel="Sections"
            detailLabel={section.label}
            selected={chosen !== null}
            onBack={() => {
              setChosen(null);
            }}
            backLabel="All sections"
            list={
              <div className="p-3">
                <h2 className="px-1 pb-2 text-xs font-semibold tracking-wide text-fg-muted uppercase">
                  Sections
                </h2>
                <SortableList
                  label="Sections"
                  items={sections.map((s) => ({ ...s, id: s.key, locked: s.fixed }))}
                  itemLabel={(s) => s.label}
                  onReorder={({ order }) => {
                    const before = sectionOrder;
                    setSectionOrder(order);
                    void settle(onReorderSections(order), () => {
                      setSectionOrder(before);
                    });
                  }}
                >
                  {(s) => (
                    <Button
                      variant="ghost"
                      size="sm"
                      fullWidth
                      className="justify-start"
                      aria-current={s.key === section.key ? 'true' : undefined}
                      endIcon={s.fixed ? <Lock aria-label="Fixed rules" /> : undefined}
                      onClick={() => {
                        setChosen(s.key);
                      }}
                    >
                      {s.label}
                    </Button>
                  )}
                </SortableList>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  startIcon={<Plus />}
                  onClick={() => {
                    setAdding(true);
                  }}
                >
                  Add section
                </Button>
              </div>
            }
            detail={
              <SectionFields
                section={section}
                fields={fields}
                onEdit={(field) => {
                  setEditing({ field });
                }}
                onAdd={() => {
                  setEditing({ field: null });
                }}
                onReorder={(order) => {
                  const key = section.key;
                  const before = fieldOrder[key] ?? null;
                  setFieldOrder((o) => ({ ...o, [key]: order }));
                  void settle(onReorderFields(key, order), () => {
                    setFieldOrder((o) => ({ ...o, [key]: before }));
                  });
                }}
              />
            }
          />
        </Card>
      )}

      {section === undefined ? null : (
        <FieldEditor
          open={editing !== null}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          section={section}
          field={editing?.field ?? null}
          takenKeys={draft.fields.map((f) => f.key)}
          choices={draft.choices}
          fields={draft.fields}
          advise={advise}
          onSave={(input) => onSaveField(input, editing?.field?.key ?? null)}
        />
      )}
      <AddSection open={adding} onOpenChange={setAdding} onAdd={onAddSection} />
      <PublishDialog
        open={publishing}
        onOpenChange={setPublishing}
        today={today}
        preview={preview}
        onPublish={onPublish}
      />
    </>
  );
}

function SectionFields({
  section,
  fields,
  onEdit,
  onAdd,
  onReorder,
}: {
  readonly section: RegistrySection;
  readonly fields: readonly RegistryField[];
  readonly onEdit: (field: RegistryField) => void;
  readonly onAdd: () => void;
  readonly onReorder: (order: readonly string[]) => void;
}): JSX.Element {
  const seenBy = listed(section.visibility.map((s) => SCOPE_LABEL[s]));
  const filledBy = listed(section.ownership.map((w) => WRITER_LABEL[w]));

  return (
    <Stack gap={4} className="p-4">
      <CardHeader className="p-0">
        <CardTitle>{section.label}</CardTitle>
        <p className="text-sm text-fg-muted">
          Seen by {seenBy} · Filled in by {filledBy}
        </p>
      </CardHeader>

      {section.fixed ? (
        <Alert tone="info" title="These rules are fixed">
          Answers here are voluntary and only ever reported in aggregate. The fields can be read;
          they cannot be edited or moved.
        </Alert>
      ) : null}

      <CardContent className="p-0">
        {fields.length === 0 ? (
          <EmptyState
            title="No fields in this section"
            description="Add the first one. Nothing changes for anybody until you publish."
          />
        ) : (
          <SortableList
            label={`Fields in ${section.label}`}
            items={fields.map((f) => ({
              ...f,
              id: f.key,
              locked: section.fixed || f.pending === 'archived',
            }))}
            itemLabel={(f) => f.label}
            onReorder={({ order }) => {
              onReorder(order);
            }}
          >
            {(f) => (
              <FieldRow
                field={f}
                editable={!section.fixed && f.origin !== 'core'}
                onEdit={onEdit}
              />
            )}
          </SortableList>
        )}
      </CardContent>

      {section.fixed ? null : (
        <div>
          <Button startIcon={<Plus />} onClick={onAdd}>
            Add field
          </Button>
        </div>
      )}
    </Stack>
  );
}

const PENDING = {
  added: { tone: 'success', text: '+ Added' },
  changed: { tone: 'warning', text: '~ Changed' },
  archived: { tone: 'neutral', text: '− Archived' },
} as const;

function FieldRow({
  field,
  editable,
  onEdit,
}: {
  readonly field: RegistryField;
  readonly editable: boolean;
  readonly onEdit: (field: RegistryField) => void;
}): JSX.Element {
  const type =
    field.options.length > 0
      ? `${DATA_TYPE_LABEL[field.dataType]} · ${String(field.options.length)} options`
      : DATA_TYPE_LABEL[field.dataType];
  const pending = field.pending === null ? null : PENDING[field.pending];

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {field.label}
          {pending === null ? null : (
            <Badge tone={pending.tone} size="sm" className="ms-2 align-middle">
              {pending.text}
            </Badge>
          )}
          {field.requiresApproval === true ? (
            <Badge tone="sensitive" size="sm" className="ms-2 align-middle">
              Sensitive
            </Badge>
          ) : null}
        </p>
        <p className="truncate font-mono text-xs text-fg-muted">{field.key}</p>
      </div>
      <span className="text-sm text-fg-muted">{type}</span>
      <span className="text-sm text-fg-muted">{REQUIREDNESS_LABEL[field.requiredness]}</span>
      <span className="text-sm text-fg-muted">
        {listed(field.ownership.map((w) => WRITER_LABEL[w]))}
      </span>
      {/*
       * A core field has no edit affordance at all, which is what "core" means
       * here: its requiredness and classification have a floor the tenant
       * cannot lower. The word says so rather than a greyed-out button.
       */}
      {editable ? (
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Edit ${field.label}`}
          onClick={() => {
            onEdit(field);
          }}
        >
          Edit
        </Button>
      ) : (
        <span className="text-xs text-fg-muted">{field.origin === 'core' ? 'Core' : 'Fixed'}</span>
      )}
    </div>
  );
}

function AddSection({
  open,
  onOpenChange,
  onAdd,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onAdd: (label: string) => Promise<Outcome>;
}): JSX.Element {
  const [label, setLabel] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const add = async (): Promise<void> => {
    if (label.trim() === '') {
      setProblem('Give the section a name.');
      return;
    }
    setSaving(true);
    const outcome = await onAdd(label.trim());
    setSaving(false);
    if (outcome.ok) {
      setLabel('');
      setProblem(null);
      onOpenChange(false);
    } else {
      setProblem(outcome.message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <DialogHeader>
            <DialogTitle>Add a section</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <Field required invalid={problem !== null}>
              <FieldLabel>Name</FieldLabel>
              <FieldControl>
                <Input
                  value={label}
                  onChange={(e) => {
                    setLabel(e.target.value);
                  }}
                />
              </FieldControl>
              <FieldError>{problem}</FieldError>
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={saving}
              loadingLabel="Adding the section"
            >
              Add section
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
