import {
  AccessStrip,
  FieldRow as ReachFieldRow,
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
  SearchField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SortableList,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  icons,
  type IsoDate,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { AUDIENCES, TypeIcon, accessOf } from './access';
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
import { SignupPreview } from './signup-preview';
import {
  COLLECT_LABEL,
  DATA_TYPE_LABEL,
  REQUIREDNESS_LABEL,
  SCOPE_LABEL,
  WRITER_LABEL,
  inSentence,
  listed,
} from './words';

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
  /** Share a field with the assistant, or stop (a draft change). */
  readonly onAssistant?: (key: string, share: boolean) => Promise<Outcome>;
  /** Put a field on the sign-up flow, optional or required, or take it off (a draft change). */
  readonly onSignup?: (key: string, ask: 'off' | 'optional' | 'required') => Promise<Outcome>;
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
  onSignup,
  onAssistant,
}: FieldRegistryProps & { readonly draft: RegistryDraft }): JSX.Element {
  const [previewing, setPreviewing] = useState(false);
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
  const [query, setQuery] = useState('');
  const [only, setOnly] = useState<Filter>('all');

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
      : `Version ${String(draft.published.version)} published ${day(draft.published.publishedAt)}`;
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
          <>
            <Legend />
            <Button
              startIcon={<icons.visible aria-hidden />}
              onClick={() => {
                setPreviewing(true);
              }}
            >
              Preview sign-up
            </Button>
            <Button
              variant="primary"
              disabled={draft.unpublishedChanges === 0}
              onClick={() => {
                setPublishing(true);
              }}
            >
              Publish version {next}
            </Button>
          </>
        }
      />
      <SignupPreview fields={draft.fields} open={previewing} onOpenChange={setPreviewing} />

      {draft.unpublishedChanges === 0 ? null : (
        <Alert
          tone="info"
          title={`${String(draft.unpublishedChanges)} ${draft.unpublishedChanges === 1 ? 'change is' : 'changes are'} waiting to be published`}
        >
          Your edits are saved as a draft. Nobody’s forms change until you publish version {next},
          and the publish step shows exactly what changes and who is affected first. Fields marked
          Added, Changed or Archived below are the ones in the draft.
        </Alert>
      )}

      {sections.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <SearchField
            label="Search fields"
            placeholder="Search by name or key"
            value={query}
            onValueChange={setQuery}
            containerClassName="min-w-0 flex-1 basis-60"
          />
          <Select
            value={only}
            onValueChange={(value) => {
              setOnly(value as Filter);
            }}
          >
            <SelectTrigger aria-label="Show" className="w-auto min-w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(FILTERS).map(([value, { label }]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

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
      ) : query.trim() !== '' || only !== 'all' ? (
        <Found
          sections={sections}
          fields={draft.fields.filter(
            (f) => FILTERS[only].keep(f) && matches(f, query.trim().toLowerCase()),
          )}
          onEdit={(field) => {
            setEditing({ field });
          }}
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
                  moveButtons="on-focus"
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
                {...(onSignup === undefined ? {} : { onSignup })}
                {...(onAssistant === undefined ? {} : { onAssistant })}
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
  onSignup,
  onAssistant,
  onAdd,
  onReorder,
}: {
  readonly section: RegistrySection;
  readonly fields: readonly RegistryField[];
  readonly onEdit: (field: RegistryField) => void;
  readonly onSignup?: FieldRegistryProps['onSignup'];
  readonly onAssistant?: FieldRegistryProps['onAssistant'];
  readonly onAdd: () => void;
  readonly onReorder: (order: readonly string[]) => void;
}): JSX.Element {
  const readers = listed(section.visibility.map((s) => inSentence(SCOPE_LABEL[s])));
  const filledBy = listed(section.ownership.map((w) => inSentence(WRITER_LABEL[w])));

  return (
    <Stack gap={4} className="p-4">
      <CardHeader className="p-0">
        <CardTitle>{section.label}</CardTitle>
        <p className="text-sm text-fg-muted">
          Seen by {readers} · Filled in by {filledBy}
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
            moveButtons="on-focus"
            label={`Fields in ${section.label}`}
            items={fields.map((f) => ({
              ...f,
              id: f.key,
              locked:
                section.fixed ||
                f.pending === 'archived' ||
                f.classification === 'special-category',
            }))}
            itemLabel={(f) => f.label}
            onReorder={({ order }) => {
              onReorder(order);
            }}
          >
            {(f) => (
              <FieldRow
                field={f}
                onEdit={onEdit}
                {...(onSignup === undefined ? {} : { onSignup })}
                {...(onAssistant === undefined ? {} : { onAssistant })}
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

type Filter = 'all' | 'required' | 'protected' | 'employee' | 'draft';

/** The list's filters: each a question an HR admin asks of it. */
const FILTERS: Record<Filter, { label: string; keep: (f: RegistryField) => boolean }> = {
  all: { label: 'All fields', keep: () => true },
  required: { label: 'Required', keep: (f) => f.requiredness !== 'never' },
  protected: {
    label: 'Needs approval or confidential',
    keep: (f) =>
      f.requiresApproval === true ||
      f.classification === 'confidential' ||
      f.classification === 'special-category',
  },
  employee: { label: 'Asked of employees', keep: (f) => f.collectAt !== 'hr_only' },
  draft: { label: 'Not yet published', keep: (f) => f.pending !== null },
};

function matches(field: RegistryField, needle: string): boolean {
  return needle === '' || field.label.toLowerCase().includes(needle) || field.key.includes(needle);
}

/** "2026-09-27T00:59:38.203Z" as the day it names; anything else as it came. */
function day(at: string): string {
  return /^\d{4}-\d{2}-\d{2}T/.test(at) ? at.slice(0, 10) : at;
}

/**
 * Search or filter results, every section at once, as one table with a row
 * naming each section above its fields: scanned down a column, not read
 * card by card.
 */
function Found({
  sections,
  fields,
  onEdit,
}: {
  readonly sections: readonly RegistrySection[];
  readonly fields: readonly RegistryField[];
  readonly onEdit: (field: RegistryField) => void;
}): JSX.Element {
  const groups = sections.flatMap((section) => {
    const mine = fields.filter((f) => f.sectionKey === section.key);
    return mine.length === 0 ? [] : [{ section, fields: mine }];
  });
  if (groups.length === 0) {
    return (
      <EmptyState
        title="No fields match"
        description="Clear the search, or show All fields, to see every field."
      />
    );
  }
  return (
    <Table aria-label="Matching fields" className="min-w-3xl">
      <TableHeader>
        <TableRow>
          <TableHead>Field</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>When asked</TableHead>
          <TableHead>Seen by</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      {groups.map(({ section, fields: mine }) => (
        <TableBody key={section.key}>
          <TableRow>
            <TableHead scope="rowgroup" colSpan={6} className="bg-surface-sunken">
              {section.label}
            </TableHead>
          </TableRow>
          {mine.map((f) => (
            <TableRow key={f.key}>
              <TableCell sticky>
                <p className="font-medium">{f.label}</p>
                <p className="font-mono text-xs text-fg-muted">{f.key}</p>
              </TableCell>
              <TableCell>{typeOf(f)}</TableCell>
              <TableCell className="whitespace-nowrap">
                {COLLECT_LABEL[f.collectAt].short}
              </TableCell>
              <TableCell className="first-letter:uppercase">{seenBy(f)}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1.5">
                  <Badges field={f} />
                </div>
              </TableCell>
              <TableCell>
                <EditField field={f} onEdit={onEdit} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      ))}
    </Table>
  );
}

function typeOf(field: RegistryField): string {
  return field.options.length > 0
    ? `${DATA_TYPE_LABEL[field.dataType]} · ${String(field.options.length)} options`
    : DATA_TYPE_LABEL[field.dataType];
}

/** Who reads it, shortest first: the directory makes it everyone's. */
function seenBy(field: RegistryField): string {
  if (field.visibility.includes('directory')) return 'everyone at the company';
  return listed(field.visibility.map((s) => inSentence(SCOPE_LABEL[s]))) || 'nobody by default';
}

/** Draft status, requiredness and protection, each in words as well as tone. */
/** What each label on a field means: a key, one click away. */
const LEGEND: readonly { readonly badge: JSX.Element; readonly means: string }[] = [
  {
    badge: (
      <Badge tone="accent" size="sm">
        Required
      </Badge>
    ),
    means: 'Everyone it applies to must fill it in.',
  },
  {
    badge: (
      <Badge tone="sensitive" size="sm">
        Needs approval
      </Badge>
    ),
    means: 'A change waits for a second person in HR to approve it before it counts.',
  },
  {
    badge: (
      <Badge size="sm">
        <icons.locked aria-hidden className="size-3" />
        Encrypted
      </Badge>
    ),
    means:
      'Stored sealed. Screens show only its last four characters, and it never reaches the assistant, a chat app or a webhook.',
  },
  {
    badge: <Badge size="sm">Confidential</Badge>,
    means: 'Shown only to the people chosen for it, and never to the assistant.',
  },
  {
    badge: (
      <Badge tone="warning" size="sm">
        Special category
      </Badge>
    ),
    means: 'Health, beliefs and the like: the strictest protection, never sent outside Kithena.',
  },
  {
    badge: (
      <Badge tone="warning" size="sm">
        ~ Changed
      </Badge>
    ),
    means: 'Added, changed or archived in the draft: nobody sees it until you publish.',
  },
];

function Legend(): JSX.Element {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" startIcon={<icons.help aria-hidden />}>
          What the labels mean
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)]">
        <dl className="flex flex-col gap-3">
          {LEGEND.map((l) => (
            <div key={l.means} className="grid grid-cols-[8.5rem_1fr] items-start gap-3">
              <dt>{l.badge}</dt>
              <dd className="text-sm text-fg-muted">{l.means}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}

function Badges({ field }: { readonly field: RegistryField }): JSX.Element {
  const pending = field.pending === null ? null : PENDING[field.pending];
  return (
    <>
      {pending === null ? null : (
        <Badge tone={pending.tone} size="sm">
          {pending.text}
        </Badge>
      )}
      {field.requiredness === 'never' ? null : (
        <Badge tone="accent" size="sm">
          {REQUIREDNESS_LABEL[field.requiredness]}
        </Badge>
      )}
      {field.requiresApproval === true ? (
        <Badge tone="sensitive" size="sm">
          Needs approval
        </Badge>
      ) : null}
      {field.encrypted === true ? (
        <Badge size="sm">
          <icons.locked aria-hidden className="size-3" />
          Encrypted
        </Badge>
      ) : null}
      {field.classification === 'confidential' ? (
        <Badge size="sm">Confidential</Badge>
      ) : field.classification === 'special-category' ? (
        <Badge tone="warning" size="sm">
          Special category
        </Badge>
      ) : null}
    </>
  );
}

/*
 * Every field can be edited. A built-in one keeps a floor — its type, and
 * protection that can be tightened but never loosened — which the editor
 * says, and People enforces.
 */
function EditField({
  field,
  onEdit,
}: {
  readonly field: RegistryField;
  readonly onEdit: (field: RegistryField) => void;
}): JSX.Element {
  return (
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
  );
}

/**
 * Whether the assistant may name this field: its label and its options, so a
 * question like "who is in Scranton" can be read. Never a value from a
 * record; People runs the query. Offered on every field, the built-in ones
 * too, and refused where the field is confidential or sealed.
 */
function AssistantShare({
  field,
  onAssistant,
}: {
  readonly field: RegistryField;
  readonly onAssistant: NonNullable<FieldRegistryProps['onAssistant']>;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const shared = field.aiEligible === true;
  const label = shared ? 'Assistant: shared' : 'Assistant: not shared';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          loading={busy}
          loadingLabel="Saving"
          endIcon={<icons.expand aria-hidden />}
          aria-label={`${field.label}: ${label}. Change whether the assistant may use it`}
        >
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>The assistant, in Kithena and in chat apps</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={shared ? 'shared' : 'not'}
          onValueChange={(value) => {
            setBusy(true);
            void onAssistant(field.key, value === 'shared').then(() => {
              setBusy(false);
            });
          }}
        >
          <DropdownMenuRadioItem value="shared" disabled={field.aiShareable !== true && !shared}>
            Shared
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="not">Not shared</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <p className="max-w-64 px-2 py-1.5 text-xs text-fg-muted">
          {field.aiShareable === true || shared
            ? 'Shared, the assistant can answer questions about this field. It learns its name and options, never anybody’s value.'
            : 'Confidential or encrypted: never shared with the assistant.'}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Whether the sign-up flow asks for this field, and whether it must be
 * answered: a menu on the row, a draft change like any other edit.
 */
function SignupAsk({
  field,
  onSignup,
}: {
  readonly field: RegistryField;
  readonly onSignup: NonNullable<FieldRegistryProps['onSignup']>;
}): JSX.Element | null {
  const [busy, setBusy] = useState(false);
  if (field.signupAskable !== true && (field.signup ?? null) === null) return null;
  const now: 'off' | 'optional' | 'required' =
    (field.signup ?? null) === null
      ? 'off'
      : field.requiredness === 'never'
        ? 'optional'
        : 'required';
  const label =
    now === 'off'
      ? 'Not at sign-up'
      : now === 'required'
        ? 'Sign-up: required'
        : 'Sign-up: optional';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          loading={busy}
          loadingLabel="Saving"
          startIcon={<icons.hire aria-hidden />}
          endIcon={<icons.expand aria-hidden />}
          aria-label={`${field.label}: ${label}. Change whether sign-up asks for it`}
        >
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Asked at sign-up</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={now}
          onValueChange={(value) => {
            setBusy(true);
            void onSignup(field.key, value as typeof now).then(() => {
              setBusy(false);
            });
          }}
        >
          <DropdownMenuRadioItem value="off">Not asked</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="optional" disabled={field.signupAskable !== true}>
            Optional
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="required" disabled={field.signupAskable !== true}>
            Required
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {field.signup === 'after' ? (
          <p className="max-w-60 px-2 py-1.5 text-xs text-fg-muted">
            Asked on the first screen after sign-up: the sign-up page never holds a file or
            confidential data.
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One field (S2), as Reach's field row: its type, name and labels, when it is
 * asked and its key, who sees and changes it, and the two quick switches
 * (assistant, sign-up) beside the way into the editor.
 */
function FieldRow({
  field,
  onEdit,
  onSignup,
  onAssistant,
}: {
  readonly field: RegistryField;
  readonly onEdit: (field: RegistryField) => void;
  readonly onSignup?: FieldRegistryProps['onSignup'];
  readonly onAssistant?: FieldRegistryProps['onAssistant'];
}): JSX.Element {
  return (
    <ReachFieldRow
      className="flex-1 shadow-none"
      icon={<TypeIcon dataType={field.dataType} />}
      title={field.label}
      badges={<Badges field={field} />}
      description={`${typeOf(field)} · ${COLLECT_LABEL[field.collectAt].short} · Seen by ${seenBy(field)}`}
      code={field.key}
      changed={field.pending !== null}
      access={
        <AccessStrip audiences={AUDIENCES} value={accessOf(field.visibility, field.ownership)} />
      }
      trailing={
        <>
          {onAssistant === undefined ? null : (
            <AssistantShare field={field} onAssistant={onAssistant} />
          )}
          {onSignup === undefined ? null : <SignupAsk field={field} onSignup={onSignup} />}
          <EditField field={field} onEdit={onEdit} />
        </>
      }
    />
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
