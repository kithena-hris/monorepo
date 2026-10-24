import {
  FieldRow as ReachFieldRow,
  Alert,
  Badge,
  Button,
  Card,
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
  icons,
  type IsoDate,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { TypeIcon } from './access';
import { useHeld, useTyped } from '../held';
import { Loaded, type Loadable, type Outcome } from '../load';
import type {
  ClassificationAdvice,
  DataType,
  FieldDescription,
  FieldInput,
  PublishPreview,
  RegistryDraft,
  RegistryField,
  RegistrySection,
  ViewerScope,
  WriterRole,
} from './model';
import { FieldEditor } from './field-editor';
import { PublishDialog } from './publish';
import { SignupPreview } from './signup-preview';
import { COLLECT_LABEL, DATA_TYPE_LABEL, listed } from './words';
import { t } from '../i18n';

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
  /** The search over every field (`?q=`), once typing rests. */
  readonly search?: string;
  readonly onSearchChange?: (search: string) => void;
  /** Which fields the list shows (`?show=required`), held by the host; one it does not know is all. */
  readonly show?: string | null;
  readonly onShowChange?: (show: string) => void;
  /** The section open on the left (`?section=<key>`); null for the first. */
  readonly section?: string | null;
  readonly onSectionChange?: (section: string | null) => void;
  /**
   * The dialog open over the registry, held by the host so a link opens it in
   * the server's HTML: `preview` for the sign-up preview, `section` for adding
   * a section. Any other value is closed.
   */
  readonly open?: string | null;
  readonly onOpenChange?: (open: string | null) => void;
  /**
   * Open the review of a field whose type or format changes
   * (`/settings/people/fields/<key>/change?to=<type>`): every value it holds,
   * checked before it is published.
   */
  readonly onReview?: (key: string, to: DataType) => void;
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
      <Loaded
        load={props.load}
        what={t('settings.field-registry.the_employee_fields', 'the employee fields')}
      >
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
  onReview,
  ...held
}: FieldRegistryProps & { readonly draft: RegistryDraft }): JSX.Element {
  const reviewing = draft.fields.filter((f) => f.review === true);
  const [open, setOpen] = useHeld<string | null>(held.open, held.onOpenChange, null);
  const dialog = (name: string) => ({
    open: open === name,
    onOpenChange: (next: boolean) => {
      setOpen(next ? name : null);
    },
  });
  // The order as the admin last left it, shown until the shell hands back a
  // draft that agrees — the list does not jump back while the save is in flight.
  const [sectionOrder, setSectionOrder] = useState<readonly string[] | null>(null);
  const [fieldOrder, setFieldOrder] = useState<Readonly<Record<string, readonly string[] | null>>>(
    {},
  );
  const [picked, setChosen] = useHeld<string | null>(held.section, held.onSectionChange, null);
  const [editing, setEditing] = useState<{ field: RegistryField | null } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [query, setQuery] = useTyped(held.search ?? '', held.onSearchChange);
  const [shown, setOnly] = useHeld<string>(held.show, held.onShowChange, 'all');
  const only: Filter = Object.hasOwn(FILTERS, shown) ? (shown as Filter) : 'all';

  const sections = arranged(draft.sections, sectionOrder);
  // A section this draft has; a link to one since removed opens the first.
  const chosen = sections.some((s) => s.key === picked) ? picked : null;
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
      ? t('settings.field-registry.nothing_published_yet', 'Nothing published yet')
      : t(
          'settings.field-registry.version_published',
          'Version {{version}} · published {{publishedAt}}',
          {
            version: String(draft.published.version),
            publishedAt: day(draft.published.publishedAt),
          },
        );
  const pending =
    draft.unpublishedChanges === 0
      ? t('settings.field-registry.nothing_to_publish', 'nothing to publish')
      : t(
          'settings.field-registry.unpublished',
          { one: '{{count}} unpublished change', other: '{{count}} unpublished changes' },
          { count: draft.unpublishedChanges },
        );
  const clear = (): void => {
    setQuery('');
    setOnly('all');
  };
  const next = (draft.published?.version ?? 0) + 1;

  return (
    <>
      <PageHeader
        title={t('settings.field-registry.employee_fields', 'Employee fields')}
        description={t('settings.field-registry.text', '{{status}} · {{pending}}', {
          status,
          pending,
        })}
        actions={
          <>
            <Legend />
            <Button
              variant="secondary"
              startIcon={<icons.visible aria-hidden />}
              onClick={() => {
                setOpen('preview');
              }}
            >
              {t('settings.field-registry.preview_sign_up', 'Preview sign-up')}
            </Button>
            <Button
              variant="primary"
              disabled={draft.unpublishedChanges === 0}
              onClick={() => {
                setPublishing(true);
              }}
            >
              {t('settings.field-registry.publish_version', 'Publish version')} {next}
            </Button>
          </>
        }
      />
      <SignupPreview fields={draft.fields} {...dialog('preview')} />

      {/* At a desk the header says it; on a phone, where the header is short, this line does. */}
      {draft.unpublishedChanges === 0 ? null : (
        <Alert
          tone="info"
          className="hidden touch:flex"
          title={t(
            'settings.field-registry.waiting_to_be_published',
            {
              one: '{{count}} change is waiting to be published',
              other: '{{count}} changes are waiting to be published',
            },
            { count: draft.unpublishedChanges },
          )}
        />
      )}

      {reviewing.length === 0 ? null : (
        <Alert
          tone="warning"
          title={
            reviewing.length === 1
              ? t(
                  'settings.field-registry.changes_type_or_format',
                  '{{value}} changes type or format',
                  { value: reviewing[0]?.label ?? '' },
                )
              : t(
                  'settings.field-registry.fields_change_type_or_format',
                  '{{length}} fields change type or format',
                  { length: String(reviewing.length) },
                )
          }
          action={
            onReview === undefined ? undefined : (
              <div className="flex flex-wrap gap-2">
                {reviewing.map((f) => (
                  <Button
                    key={f.key}
                    size="sm"
                    onClick={() => {
                      onReview(f.key, f.dataType);
                    }}
                  >
                    {reviewing.length === 1
                      ? t('settings.field-registry.review_the_values', 'Review the values')
                      : t('settings.field-registry.review', 'Review {{label}}', { label: f.label })}
                  </Button>
                ))}
              </div>
            )
          }
        >
          {t(
            'settings.field-registry.every_value_it_holds_is_checked',
            'Every value it holds is checked against the new format before it’s published, and you decide what happens to any that don’t fit.',
          )}
        </Alert>
      )}

      {sections.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <SearchField
            label={t('settings.field-registry.search_fields', 'Search fields')}
            placeholder={t(
              'settings.field-registry.search_by_name_or_key',
              'Search by name or key',
            )}
            value={query}
            onValueChange={setQuery}
            containerClassName="min-w-0 flex-1 basis-60"
          />
          <Select
            value={only}
            onValueChange={(value) => {
              setOnly(value);
            }}
          >
            <SelectTrigger
              aria-label={t('settings.field-registry.show', 'Show')}
              className="w-auto min-w-48"
            >
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
        <Alert
          tone="danger"
          title={t(
            'settings.field-registry.that_change_was_not_saved',
            'That change was not saved',
          )}
        >
          {failed}
        </Alert>
      )}

      {section === undefined ? (
        <EmptyState
          title={t('settings.field-registry.no_sections_yet', 'No sections yet')}
          description={t(
            'settings.field-registry.a_section_groups_fields_that_are',
            'A section groups fields that are seen and filled in by the same people.',
          )}
          action={
            <Button
              startIcon={<Plus />}
              onClick={() => {
                setOpen('section');
              }}
            >
              {t('settings.field-registry.add_section', 'Add section')}
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
          onClear={clear}
          {...(onSignup === undefined ? {} : { onSignup })}
          {...(onAssistant === undefined ? {} : { onAssistant })}
        />
      ) : (
        <Card>
          <ListDetail
            listLabel={t('settings.field-registry.sections', 'Sections')}
            detailLabel={section.label}
            selected={chosen !== null}
            onBack={() => {
              setChosen(null);
            }}
            backLabel={t('settings.field-registry.all_sections', 'All sections')}
            list={
              <div className="p-3">
                <h2 className="px-1 pb-2 text-sm font-semibold text-fg-muted">
                  {t('settings.field-registry.sections', 'Sections')}
                </h2>
                <SortableList
                  moveButtons="on-focus"
                  label={t('settings.field-registry.sections', 'Sections')}
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
                      endIcon={
                        <span className="flex items-center gap-2 text-fg-subtle">
                          {s.fixed ? (
                            <Lock
                              aria-label={t('settings.field-registry.fixed_rules', 'Fixed rules')}
                            />
                          ) : null}
                          <span className="text-xs tabular-nums">
                            {draft.fields.filter((f) => f.sectionKey === s.key).length}
                          </span>
                        </span>
                      }
                      onClick={() => {
                        setChosen(s.key);
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate text-start">{s.label}</span>
                    </Button>
                  )}
                </SortableList>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  startIcon={<Plus />}
                  onClick={() => {
                    setOpen('section');
                  }}
                >
                  {t('settings.field-registry.add_section', 'Add section')}
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
          sections={draft.sections}
          advise={advise}
          onSave={(input) => onSaveField(input, editing?.field?.key ?? null)}
          {...(onReview === undefined ? {} : { onReview })}
          {...(onAssistant === undefined ? {} : { onAssistant })}
        />
      )}
      <AddSection {...dialog('section')} onAdd={onAddSection} />
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
  const count = t(
    'settings.field-registry.text_2',
    { one: '{{count}} field', other: '{{count}} fields' },
    { count: fields.length },
  );
  return (
    <Stack gap={0}>
      <div className="flex items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-bold">{section.label}</h2>
          <p className="mt-1 text-sm text-fg-muted">
            {section.fixed
              ? t(
                  'settings.field-registry.these_rules_are_fixed',
                  '{{count}} · these rules are fixed',
                  { count },
                )
              : t(
                  'settings.field-registry.drag_a_row_to_reorder_click',
                  '{{count}} · drag a row to reorder · click Asked or Assistant to change it here',
                  { count },
                )}
          </p>
        </div>
        {section.fixed ? null : (
          <Button variant="secondary" size="sm" startIcon={<Plus />} onClick={onAdd}>
            {t('settings.field-registry.add_field', 'Add field')}
          </Button>
        )}
      </div>

      {section.fixed ? (
        <div className="px-4 pb-4">
          <Alert
            tone="info"
            title={t('settings.field-registry.these_rules_are_fixed_2', 'These rules are fixed')}
          >
            {t(
              'settings.field-registry.answers_here_are_voluntary_and_only',
              'Answers here are voluntary and only ever reported in aggregate. The fields can be read; they cannot be edited or moved.',
            )}
          </Alert>
        </div>
      ) : null}

      {fields.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title={t(
              'settings.field-registry.no_fields_in_this_section',
              'No fields in this section',
            )}
            description={t(
              'settings.field-registry.add_the_first_one_nothing_changes',
              'Add the first one. Nothing changes for anybody until you publish.',
            )}
          />
        </div>
      ) : (
        <>
          <Columns />
          <SortableList
            moveButtons="on-focus"
            label={t('settings.field-registry.fields_in', 'Fields in {{label}}', {
              label: section.label,
            })}
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
        </>
      )}
    </Stack>
  );
}

/** The columns' names, over the rows they head (F1). Hidden under a finger, where the row is the sentence. */
function Columns(): JSX.Element {
  return (
    <div
      aria-hidden
      className="flex items-center gap-3 border-y border-border px-4 py-2.5 text-xs font-semibold text-fg-muted touch:hidden"
    >
      <span className="min-w-0 flex-1 ps-11">{t('settings.field-registry.field', 'Field')}</span>
      <span className={COLUMN.asked}>{t('settings.field-registry.asked', 'Asked')}</span>
      <span className={COLUMN.seen}>{t('settings.field-registry.seen_by', 'Seen by')}</span>
      <span className={COLUMN.assistant}>
        {t('settings.field-registry.assistant', 'Assistant')}
      </span>
      <span className="w-4" />
    </div>
  );
}

/** One width per column, shared by the header and every row. */
const COLUMN = {
  asked: 'w-40 shrink-0',
  seen: 'w-44 shrink-0 touch:hidden',
  assistant: 'w-28 shrink-0',
} as const;

const PENDING = {
  added: { tone: 'success', text: t('settings.field-registry.added', '+ Added') },
  changed: { tone: 'warning', text: t('settings.field-registry.changed', '~ Changed') },
  archived: { tone: 'neutral', text: t('settings.field-registry.archived', '− Archived') },
} as const;

type Filter = 'all' | 'required' | 'protected' | 'employee' | 'draft';

/** The list's filters: each a question an HR admin asks of it. */
const FILTERS: Record<Filter, { label: string; keep: (f: RegistryField) => boolean }> = {
  all: { label: t('settings.field-registry.all_fields', 'All fields'), keep: () => true },
  required: {
    label: t('settings.field-registry.required', 'Required'),
    keep: (f) => f.requiredness !== 'never',
  },
  protected: {
    label: t(
      'settings.field-registry.needs_approval_or_confidential',
      'Needs approval or confidential',
    ),
    keep: (f) =>
      f.requiresApproval === true ||
      f.classification === 'confidential' ||
      f.classification === 'special-category',
  },
  employee: {
    label: t('settings.field-registry.asked_of_employees', 'Asked of employees'),
    keep: (f) => f.collectAt !== 'hr_only',
  },
  draft: {
    label: t('settings.field-registry.not_yet_published', 'Not yet published'),
    keep: (f) => f.pending !== null,
  },
};

function matches(field: RegistryField, needle: string): boolean {
  return needle === '' || field.label.toLowerCase().includes(needle) || field.key.includes(needle);
}

/** "2026-09-27T00:59:38.203Z" as the day it names; anything else as it came. */
function day(at: string): string {
  return /^\d{4}-\d{2}-\d{2}T/.test(at) ? at.slice(0, 10) : at;
}

/**
 * Search or filter results (F3): every section at once, one list grouped by
 * section, with the same columns and the same rows as a section's.
 */
function Found({
  sections,
  fields,
  onEdit,
  onClear,
  onSignup,
  onAssistant,
}: {
  readonly sections: readonly RegistrySection[];
  readonly fields: readonly RegistryField[];
  readonly onEdit: (field: RegistryField) => void;
  readonly onClear: () => void;
  readonly onSignup?: FieldRegistryProps['onSignup'];
  readonly onAssistant?: FieldRegistryProps['onAssistant'];
}): JSX.Element {
  const groups = sections.flatMap((section) => {
    const mine = fields.filter((f) => f.sectionKey === section.key);
    return mine.length === 0 ? [] : [{ section, fields: mine }];
  });
  if (groups.length === 0) {
    return (
      <EmptyState
        title={t('settings.field-registry.no_fields_match', 'No fields match')}
        description={t(
          'settings.field-registry.clear_the_search_or_show_all',
          'Clear the search, or show All fields, to see every field.',
        )}
        action={
          <Button onClick={onClear}>
            {t('settings.field-registry.clear_search', 'Clear search')}
          </Button>
        }
      />
    );
  }
  const total = groups.reduce((n, g) => n + g.fields.length, 0);
  return (
    <Card>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <p className="flex-1 text-base font-semibold" aria-live="polite">
          {[
            t(
              'settings.field-registry.count_fields_match',
              { one: '{{count}} field matches', other: '{{count}} fields match' },
              { count: total },
            ),
            t(
              'settings.field-registry.in_count_sections',
              { one: 'in {{count}} section', other: 'in {{count}} sections' },
              { count: groups.length },
            ),
          ].join(', ')}
        </p>
        <Button variant="ghost" size="sm" onClick={onClear}>
          {t('settings.field-registry.clear_search', 'Clear search')}
        </Button>
      </div>
      <Columns />
      {groups.map(({ section, fields: mine }) => (
        <section key={section.key} aria-label={section.label}>
          <h2 className="flex gap-2 border-b border-border bg-surface-sunken px-4 py-2.5 text-xs font-semibold text-fg-muted">
            {section.label}
            <span className="font-medium text-fg-subtle">{mine.length}</span>
          </h2>
          <ul>
            {mine.map((f) => (
              <li key={f.key}>
                <FieldRow
                  field={f}
                  onEdit={onEdit}
                  {...(onSignup === undefined ? {} : { onSignup })}
                  {...(onAssistant === undefined ? {} : { onAssistant })}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Card>
  );
}

function typeOf(field: RegistryField): string {
  return field.options.length > 0
    ? t('settings.field-registry.options', '{{DATA_TYPE_LABEL}} · {{length}} options', {
        DATA_TYPE_LABEL: DATA_TYPE_LABEL[field.dataType],
        length: String(field.options.length),
      })
    : DATA_TYPE_LABEL[field.dataType];
}

/** A group as a column says it, after the first word: "Employee, manager and HR". */
const SHORT_SCOPE: Record<ViewerScope, string> = {
  self: 'employee',
  manager: 'manager',
  manager_chain: t('settings.field-registry.line_managers', 'line managers'),
  hr: 'HR',
  finance: t('settings.field-registry.finance', 'Finance'),
  admin: 'administrators',
  directory: 'everyone',
};
const SHORT_WRITER: Record<WriterRole, string> = {
  employee: 'employee',
  manager: 'manager',
  hr: 'HR',
  finance: t('settings.field-registry.finance', 'Finance'),
  system: t('settings.field-registry.a_connected_system', 'a connected system'),
  external: t('settings.field-registry.an_external_hr_system', 'an external HR system'),
};
const opening = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Who reads it (F1's Seen by): the directory makes it everyone's. */
function seenBy(field: RegistryField): { who: string; changes: string; icon: JSX.Element } {
  const writers = listed(field.ownership.map((w) => SHORT_WRITER[w]));
  const changes =
    writers === ''
      ? t('settings.field-registry.nobody_changes_it', 'Nobody changes it')
      : t('settings.field-registry.change_it', '{{opening}} change it', {
          opening: opening(writers),
        });
  if (field.visibility.includes('directory')) {
    return {
      who: t('settings.field-registry.everyone', 'Everyone'),
      changes,
      icon: <icons.visible aria-hidden />,
    };
  }
  const who = listed(field.visibility.map((s) => SHORT_SCOPE[s]));
  const wide = field.visibility.some((s) => s !== 'self' && s !== 'hr' && s !== 'admin');
  return {
    who:
      who === ''
        ? t('settings.field-registry.nobody_by_default', 'Nobody by default')
        : opening(who),
    changes,
    icon: wide ? <icons.people aria-hidden /> : <icons.locked aria-hidden />,
  };
}

/** What each label on a field means (F10): a key, one press away. */
const LEGEND: readonly { readonly badge: JSX.Element; readonly means: string }[] = [
  {
    badge: (
      <Badge tone="sensitive" size="sm">
        {t('settings.field-registry.needs_approval', 'Needs approval')}
      </Badge>
    ),
    means: t(
      'settings.field-registry.a_second_hr_member_approves_each',
      'A second HR member approves each change.',
    ),
  },
  {
    badge: (
      <Badge tone="warning" size="sm">
        {t('settings.field-registry.confidential', 'Confidential')}
      </Badge>
    ),
    means: t(
      'settings.field-registry.would_harm_someone_if_it_leaked',
      'Would harm someone if it leaked. Never shared with the assistant.',
    ),
  },
  {
    badge: (
      <Badge size="sm">
        <icons.locked aria-hidden className="size-3" />
        {t('settings.field-registry.encrypted', 'Encrypted')}
      </Badge>
    ),
    means: t(
      'settings.field-registry.only_the_last_four_characters_show',
      'Only the last four characters show. Never searchable, sent to chat or webhooks.',
    ),
  },
  {
    badge: (
      <Badge tone="danger" size="sm">
        {t('settings.field-registry.special_category', 'Special category')}
      </Badge>
    ),
    means: t(
      'settings.field-registry.health_beliefs_or_similar_kept_out',
      'Health, beliefs or similar. Kept out of AI, events and exports.',
    ),
  },
  {
    badge: (
      <Badge tone="warning" size="sm">
        {t('settings.field-registry.changed', '~ Changed')}
      </Badge>
    ),
    means: t(
      'settings.field-registry.a_draft_change_applied_when_you',
      'A draft change, applied when you publish. Also + Added and − Archived.',
    ),
  },
];

function Legend(): JSX.Element {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          aria-label={t('settings.field-registry.what_the_labels_mean', 'What the labels mean')}
          startIcon={<icons.help aria-hidden />}
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-86 max-w-[calc(100vw-2rem)]">
        <Stack gap={3}>
          <p className="text-base font-semibold">
            {t('settings.field-registry.what_the_labels_mean', 'What the labels mean')}
          </p>
          <p className="text-sm text-fg-muted">
            <b className="text-fg">{t('settings.field-registry.asked', 'Asked')}</b>{' '}
            {t(
              'settings.field-registry.is_when_someone_is_asked_and',
              'is when someone is asked, and whether it’s required.',
            )}{' '}
            <b className="text-fg">{t('settings.field-registry.seen_by', 'Seen by')}</b>{' '}
            {t('settings.field-registry.is_who_can_see_it', 'is who can see it.')}
          </p>
          <dl className="flex flex-col gap-3">
            {LEGEND.map((l) => (
              <div key={l.means} className="flex flex-col items-start gap-1.5">
                <dt>{l.badge}</dt>
                <dd className="text-sm text-fg-muted">{l.means}</dd>
              </div>
            ))}
          </dl>
        </Stack>
      </PopoverContent>
    </Popover>
  );
}

/** Only what is unusual about a field: draft status and protection, each in words. */
function Badges({ field }: { readonly field: RegistryField }): JSX.Element {
  const pending = field.pending === null ? null : PENDING[field.pending];
  return (
    <>
      {pending === null ? null : (
        <Badge tone={pending.tone} size="sm">
          {pending.text}
        </Badge>
      )}
      {field.review === true ? (
        <Badge tone="warning" size="sm">
          {t('settings.field-registry.values_to_review', 'Values to review')}
        </Badge>
      ) : null}
      {field.requiresApproval === true ? (
        <Badge tone="sensitive" size="sm">
          {t('settings.field-registry.needs_approval', 'Needs approval')}
        </Badge>
      ) : null}
      {field.encrypted === true ? (
        <Badge size="sm">
          <icons.locked aria-hidden className="size-3" />
          {t('settings.field-registry.encrypted', 'Encrypted')}
        </Badge>
      ) : null}
      {field.classification === 'confidential' ? (
        <Badge tone="warning" size="sm">
          {t('settings.field-registry.confidential', 'Confidential')}
        </Badge>
      ) : field.classification === 'special-category' ? (
        <Badge tone="danger" size="sm">
          {t('settings.field-registry.special_category', 'Special category')}
        </Badge>
      ) : null}
    </>
  );
}

/** A cell's two lines: what, and a word under it. */
function Cell({
  main,
  sub,
  icon,
}: {
  readonly main: string;
  readonly sub?: string;
  readonly icon?: JSX.Element;
}): JSX.Element {
  return (
    <span className="flex min-w-0 items-center gap-2 text-start">
      {icon === undefined ? null : (
        <span className="shrink-0 text-fg-subtle [&_svg]:size-[0.9375rem]">{icon}</span>
      )}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-fg">{main}</span>
        {sub === undefined ? null : (
          <span className="truncate text-xs font-normal text-fg-subtle">{sub}</span>
        )}
      </span>
    </span>
  );
}

/**
 * Whether the assistant may name this field (F1's Assistant column): its
 * label and its options, so a question like "who is in Scranton" can be read.
 * Never a value from a record; People runs the query. Offered on every field,
 * the built-in ones too, and refused where the field is confidential or sealed.
 */
function AssistantShare({
  field,
  onAssistant,
}: {
  readonly field: RegistryField;
  readonly onAssistant?: FieldRegistryProps['onAssistant'];
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const shared = field.aiEligible === true;
  const never = !shared && field.aiShareable !== true;
  const cell = shared ? (
    <Cell
      main={t('settings.field-registry.shared', 'Shared')}
      icon={<icons.assistant aria-hidden />}
    />
  ) : never ? (
    <Cell
      main={t('settings.field-registry.never', 'Never')}
      sub={
        field.encrypted === true
          ? t('settings.field-registry.encrypted', 'Encrypted')
          : t('settings.field-registry.confidential', 'Confidential')
      }
      icon={<icons.locked aria-hidden />}
    />
  ) : (
    <Cell
      main={t('settings.field-registry.not_shared', 'Not shared')}
      icon={<icons.hidden aria-hidden />}
    />
  );
  if (onAssistant === undefined) return cell;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          fullWidth
          className="justify-start"
          loading={busy}
          loadingLabel={t('settings.field-registry.saving', 'Saving')}
          aria-label={
            shared
              ? t(
                  'settings.field-registry.assistant_shared',
                  '{{label}}: shared with the assistant. Change whether the assistant may use it',
                  { label: field.label },
                )
              : never
                ? t(
                    'settings.field-registry.assistant_never',
                    '{{label}}: never shared with the assistant. Change whether the assistant may use it',
                    { label: field.label },
                  )
                : t(
                    'settings.field-registry.assistant_not_shared',
                    '{{label}}: not shared with the assistant. Change whether the assistant may use it',
                    { label: field.label },
                  )
          }
        >
          {cell}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          {t(
            'settings.field-registry.the_assistant_in_kithena_and_in',
            'The assistant, in Kithena and in chat apps',
          )}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={shared ? 'shared' : 'not'}
          onValueChange={(value) => {
            setBusy(true);
            void onAssistant(field.key, value === 'shared').then(() => {
              setBusy(false);
            });
          }}
        >
          <DropdownMenuRadioItem value="shared" disabled={never}>
            {t('settings.field-registry.shared', 'Shared')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="not">
            {t('settings.field-registry.not_shared', 'Not shared')}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <p className="max-w-64 px-2 py-1.5 text-xs text-fg-muted">
          {never
            ? t(
                'settings.field-registry.confidential_or_encrypted_never_shared_with',
                'Confidential or encrypted: never shared with the assistant.',
              )
            : t(
                'settings.field-registry.shared_the_assistant_can_answer_questions',
                'Shared, the assistant can answer questions about this field. It learns its name and options, never anybody’s value.',
              )}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * When a field is asked and whether it must be answered (F1's Asked column,
 * F2): sign-up's three answers change in place, a draft change like any
 * other edit; every other timing is the editor's.
 */
function Asked({
  field,
  onSignup,
  onEdit,
}: {
  readonly field: RegistryField;
  readonly onSignup?: FieldRegistryProps['onSignup'];
  readonly onEdit: (field: RegistryField) => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const atSignup = (field.signup ?? null) !== null;
  const cell = (
    <Cell
      main={
        atSignup
          ? t('settings.field-registry.at_sign_up', 'At sign-up')
          : COLLECT_LABEL[field.collectAt].short
      }
      sub={
        field.requiredness === 'always'
          ? t('settings.field-registry.required', 'Required')
          : field.requiredness === 'conditional'
            ? t('settings.field-registry.required_sometimes', 'Required sometimes')
            : t('settings.field-registry.optional', 'Optional')
      }
    />
  );
  if (onSignup === undefined || (field.signupAskable !== true && !atSignup)) return cell;
  const now: 'off' | 'optional' | 'required' = !atSignup
    ? 'off'
    : field.requiredness === 'never'
      ? 'optional'
      : 'required';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          fullWidth
          className="justify-start"
          loading={busy}
          loadingLabel={t('settings.field-registry.saving', 'Saving')}
          endIcon={<icons.expand aria-hidden />}
          aria-label={
            atSignup
              ? t(
                  'settings.field-registry.asked_at_sign_up',
                  '{{label}}: asked at sign-up. Change whether sign-up asks for it',
                  { label: field.label },
                )
              : t(
                  'settings.field-registry.asked_change_whether_sign_up_asks',
                  '{{label}}: asked {{value}}. Change whether sign-up asks for it',
                  { label: field.label, value: COLLECT_LABEL[field.collectAt].short.toLowerCase() },
                )
          }
        >
          {cell}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          {t('settings.field-registry.asked_at_sign_up_2', 'Asked at sign-up')}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={now}
          onValueChange={(value) => {
            setBusy(true);
            void onSignup(field.key, value as typeof now).then(() => {
              setBusy(false);
            });
          }}
        >
          <DropdownMenuRadioItem value="off">
            {t('settings.field-registry.not_asked', 'Not asked')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="optional" disabled={field.signupAskable !== true}>
            {t('settings.field-registry.optional', 'Optional')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="required" disabled={field.signupAskable !== true}>
            {t('settings.field-registry.required', 'Required')}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {field.signup === 'after' ? (
          <p className="max-w-60 px-2 py-1.5 text-xs text-fg-muted">
            {t(
              'settings.field-registry.asked_on_the_first_screen_after',
              'Asked on the first screen after sign-up: the sign-up page never holds a file or confidential data.',
            )}
          </p>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            onEdit(field);
          }}
        >
          {t('settings.field-registry.other_timings_in_the_editor', 'Other timings in the editor')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One field (F1), as Reach's field row: its type, name and only the unusual
 * labels, its type and key, then when it is asked, who sees it and whether
 * the assistant may use it, in words. The whole row opens the editor; Asked
 * and Assistant open their quick menus in place.
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
  const seen = seenBy(field);
  return (
    <ReachFieldRow
      className="flex-1 rounded-none shadow-none touch:rounded-none"
      icon={<TypeIcon dataType={field.dataType} />}
      title={field.label}
      badges={<Badges field={field} />}
      description={typeOf(field)}
      code={field.key}
      changed={field.pending !== null}
      onOpen={() => {
        onEdit(field);
      }}
      trailing={
        <>
          <span className={COLUMN.asked}>
            <Asked
              field={field}
              onEdit={onEdit}
              {...(onSignup === undefined ? {} : { onSignup })}
            />
          </span>
          <span className={COLUMN.seen}>
            <Cell main={seen.who} sub={seen.changes} icon={seen.icon} />
          </span>
          <span className={COLUMN.assistant}>
            <AssistantShare field={field} {...(onAssistant === undefined ? {} : { onAssistant })} />
          </span>
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
      setProblem(t('settings.field-registry.give_the_section_a_name', 'Give the section a name.'));
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
            <DialogTitle>{t('settings.field-registry.add_a_section', 'Add a section')}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <Field required invalid={problem !== null}>
              <FieldLabel>{t('settings.field-registry.name', 'Name')}</FieldLabel>
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
              {t('settings.field-registry.cancel', 'Cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={saving}
              loadingLabel={t('settings.field-registry.adding_the_section', 'Adding the section')}
            >
              {t('settings.field-registry.add_section', 'Add section')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
