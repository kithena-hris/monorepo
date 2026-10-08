import {
  Alert,
  AutoGrid,
  Badge,
  Button,
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
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  FieldLabel,
  Icon,
  Input,
  List,
  ListItem,
  SearchField,
  SortableList,
  SortableRowText,
  Spinner,
  Stat,
  Text,
} from '@reach/ui-native';
import { ArrowUpDown, Ellipsis, Folder, Lock, Pencil, Plus, Send } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Failed, Loading, Page } from '../../frame';
import { useAct } from '../act';
import { ask, useSigned } from '../api';
import type { PeopleScreen } from '../routes';
import { FieldEditor } from './field-editor';
import { COLLECT, DATA_TYPE_LABEL, type Registry, type RegistryField } from './fields-model';

const PENDING: Readonly<
  Record<string, { label: string; tone: 'success' | 'warning' | 'neutral' }>
> = {
  added: { label: '+ Added', tone: 'success' },
  changed: { label: '~ Changed', tone: 'warning' },
  archived: { label: '− Archived', tone: 'neutral' },
};

/** "Date · onboarding · self, HR": one field's line, as the design writes it. */
function lineOf(f: RegistryField): string {
  return [
    DATA_TYPE_LABEL[f.dataType] ?? f.dataType,
    f.encrypted === true ? 'Encrypted' : null,
    f.requiresApproval === true ? 'needs approval' : null,
    COLLECT.find((c) => c.value === f.collectAt)?.label.toLowerCase() ?? null,
    f.requiredness === 'always'
      ? 'required'
      : f.requiredness === 'conditional'
        ? 'required sometimes'
        : null,
  ]
    .filter((x) => x !== null)
    .join(' · ');
}

/**
 * Employee fields (design H2): sections first, then a section's fields under
 * "All sections"; Publish is the icon at the top right. A field opens its
 * editor; its menu also says whether the assistant may name it and whether
 * sign-up asks for it. Sections and fields reorder by dragging.
 */
export function FieldRegistry({
  navigation,
  route,
}: PeopleScreen<'FieldRegistry'>): React.JSX.Element {
  const signed = useSigned();
  const { act } = useAct();
  const sectionKey = route.params?.section ?? null;
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [find, setFind] = useState('');
  const [editing, setEditing] = useState<RegistryField | 'new' | null>(null);
  const [adding, setAdding] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [ordering, setOrdering] = useState(false);

  const load = async (): Promise<void> => {
    const answer = await ask<Registry>(signed, 'Registry');
    if (!answer.ok) {
      setFailed(answer.message);
      return;
    }
    setFailed(null);
    setRegistry(answer.data);
  };
  useEffect(() => {
    void load();
    return navigation.addListener('focus', () => {
      void load();
    });
  }, [navigation, signed]);

  const section = registry?.sections.find((s) => s.key === sectionKey) ?? null;
  const back = {
    label: sectionKey === null ? 'Settings' : 'All sections',
    onPress: navigation.goBack,
  };
  const title = section?.label ?? 'Employee fields';
  if (failed !== null) {
    return (
      <Page title={title} back={back}>
        <Failed message={failed} onRetry={() => void load()} />
      </Page>
    );
  }
  if (registry === null) {
    return (
      <Page title={title} back={back}>
        <Loading label="Loading the fields" />
      </Page>
    );
  }
  const reload = (): void => {
    void load();
  };
  const needle = find.trim().toLowerCase();
  const matches = (f: RegistryField): boolean =>
    needle === '' || f.label.toLowerCase().includes(needle) || f.key.includes(needle);
  const publish = (
    <Button
      size="sm"
      variant={registry.unpublishedChanges > 0 ? 'primary' : 'ghost'}
      startIcon={<Icon icon={Send} />}
      accessibilityLabel="Publish"
      onPress={() => {
        setPublishing(true);
      }}
    />
  );

  // A section's fields.
  if (section !== null) {
    const fields = registry.fields.filter((f) => f.sectionKey === section.key);
    return (
      <Page title={title} back={back} trailing={publish}>
        {section.fixed ? (
          <Alert tone="info" icon={Lock}>
            Its rules are not yours to change; it can be read here.
          </Alert>
        ) : null}
        <SearchField
          value={find}
          onValueChange={setFind}
          placeholder="Search by name or key"
          label="Search fields"
        />
        {ordering ? (
          <SortableList
            items={fields.map((f) => ({ ...f, id: f.key }))}
            label={`Fields in ${section.label}`}
            itemLabel={(f) => f.label}
            onReorder={(move) => {
              void act('ReorderDraftFields', {
                sectionKey: section.key,
                order: [...move.order],
              }).then(reload);
            }}
          >
            {(f) => (
              <SortableRowText
                title={f.label}
                description={DATA_TYPE_LABEL[f.dataType] ?? f.dataType}
              />
            )}
          </SortableList>
        ) : fields.filter(matches).length === 0 ? (
          <EmptyState
            icon={Folder}
            title={needle === '' ? 'No fields yet' : 'Nothing matches'}
            description="Add one for what you need to keep."
          />
        ) : (
          <List>
            {fields.filter(matches).map((f) => (
              <ListItem
                key={f.key}
                description={lineOf(f)}
                {...(section.fixed
                  ? {}
                  : {
                      onPress: () => {
                        setEditing(f);
                      },
                    })}
                trailing={
                  <View className="flex-row items-center gap-1">
                    {f.pending === null ? null : (
                      <Badge size="sm" tone={PENDING[f.pending]?.tone ?? 'neutral'}>
                        {PENDING[f.pending]?.label ?? f.pending}
                      </Badge>
                    )}
                    {section.fixed ? null : (
                      <FieldMenu
                        field={f}
                        onEdit={() => {
                          setEditing(f);
                        }}
                        onChanged={reload}
                      />
                    )}
                  </View>
                }
              >
                {f.label}
              </ListItem>
            ))}
          </List>
        )}
        {section.fixed ? null : (
          <View className="flex-row gap-2">
            <Button
              className="flex-1"
              variant="primary"
              startIcon={<Icon icon={Plus} />}
              onPress={() => {
                setEditing('new');
              }}
            >
              Add a field
            </Button>
            {fields.length > 1 ? (
              <Button
                className="flex-1"
                startIcon={<Icon icon={ArrowUpDown} />}
                onPress={() => {
                  setOrdering((o) => !o);
                }}
              >
                {ordering ? 'Done' : 'Reorder'}
              </Button>
            ) : null}
          </View>
        )}
        {editing === null ? null : (
          <FieldEditor
            registry={registry}
            section={section}
            field={editing === 'new' ? null : editing}
            onClose={() => {
              setEditing(null);
            }}
            onSaved={(review) => {
              setEditing(null);
              reload();
              if (review !== null)
                navigation.navigate('FieldChange', { key: review.key, to: review.to });
            }}
          />
        )}
        {publishing ? (
          <PublishDialog
            onClose={() => {
              setPublishing(false);
            }}
            onPublished={reload}
          />
        ) : null}
      </Page>
    );
  }

  // Every section.
  const found = needle === '' ? [] : registry.fields.filter(matches);
  return (
    <Page title={title} back={back} trailing={publish}>
      <SearchField
        value={find}
        onValueChange={setFind}
        placeholder="Search by name or key"
        label="Search fields"
      />
      {registry.unpublishedChanges === 0 ? null : (
        <Alert
          tone="info"
          title={`${String(registry.unpublishedChanges)} ${registry.unpublishedChanges === 1 ? 'change waits' : 'changes wait'} to be published`}
        >
          <Button
            size="sm"
            variant="primary"
            onPress={() => {
              setPublishing(true);
            }}
          >
            Review and publish
          </Button>
        </Alert>
      )}
      {needle !== '' ? (
        found.length === 0 ? (
          <EmptyState
            icon={Folder}
            title="Nothing matches"
            description="Try another name or key."
          />
        ) : (
          <List>
            {found.map((f) => (
              <ListItem
                key={f.key}
                description={`${registry.sections.find((s) => s.key === f.sectionKey)?.label ?? ''} · ${lineOf(f)}`}
                chevron
                onPress={() => {
                  navigation.push('FieldRegistry', { section: f.sectionKey });
                }}
              >
                {f.label}
              </ListItem>
            ))}
          </List>
        )
      ) : ordering ? (
        <SortableList
          items={registry.sections.map((s) => ({ ...s, id: s.key, locked: s.fixed }))}
          label="Sections"
          itemLabel={(s) => s.label}
          onReorder={(move) => {
            void act('ReorderDraftSections', { order: [...move.order] }).then(reload);
          }}
        >
          {(s) => <SortableRowText title={s.label} />}
        </SortableList>
      ) : (
        <List>
          {registry.sections.map((s) => {
            const n = registry.fields.filter((f) => f.sectionKey === s.key).length;
            return (
              <ListItem
                key={s.key}
                icon={s.fixed ? Lock : Folder}
                description={`${String(n)} ${n === 1 ? 'field' : 'fields'}`}
                chevron
                onPress={() => {
                  navigation.push('FieldRegistry', { section: s.key });
                }}
              >
                {s.label}
              </ListItem>
            );
          })}
        </List>
      )}
      {needle === '' ? (
        <View className="flex-row gap-2">
          <Button
            className="flex-1"
            startIcon={<Icon icon={Plus} />}
            onPress={() => {
              setAdding(true);
            }}
          >
            Add a section
          </Button>
          <Button
            className="flex-1"
            startIcon={<Icon icon={ArrowUpDown} />}
            onPress={() => {
              setOrdering((o) => !o);
            }}
          >
            {ordering ? 'Done' : 'Reorder'}
          </Button>
        </View>
      ) : null}
      {adding ? (
        <AddSection
          onClose={() => {
            setAdding(false);
          }}
          onAdded={reload}
        />
      ) : null}
      {publishing ? (
        <PublishDialog
          onClose={() => {
            setPublishing(false);
          }}
          onPublished={reload}
        />
      ) : null}
    </Page>
  );
}

/** A field's menu: edit it, whether the assistant may name it, whether sign-up asks for it. */
function FieldMenu({
  field,
  onEdit,
  onChanged,
}: {
  field: RegistryField;
  onEdit: () => void;
  onChanged: () => void;
}): React.JSX.Element {
  const { act } = useAct();
  const shared = field.aiEligible === true;
  const signupNow =
    field.signup === null ? 'off' : field.requiredness === 'never' ? 'optional' : 'required';
  const askable = field.signupAskable === true || field.signup !== null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Button
          size="sm"
          variant="ghost"
          startIcon={<Icon icon={Ellipsis} />}
          accessibilityLabel={`Actions for ${field.label}`}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent label={`Actions for ${field.label}`}>
        <DropdownMenuItem icon={Pencil} onSelect={onEdit}>
          Edit
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>The assistant, in Kithena and in chat apps</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={shared ? 'shared' : 'not'}
          onValueChange={(value: string) => {
            void act(
              'SetFieldAssistant',
              { field: field.key, share: value === 'shared' },
              'Saved to the draft',
            ).then(onChanged);
          }}
        >
          <DropdownMenuRadioItem value="shared" disabled={field.aiShareable !== true && !shared}>
            Shared
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="not">Not shared</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {askable ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Asked at sign-up</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={signupNow}
              onValueChange={(value: string) => {
                void act(
                  'SetFieldSignup',
                  { field: field.key, ask: value },
                  'Saved to the draft',
                ).then(onChanged);
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
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AddSection({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: () => void;
}): React.JSX.Element {
  const { act, busy } = useAct();
  const [label, setLabel] = useState('');
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a section</DialogTitle>
          <DialogDescription>A draft change, published with the rest.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field required>
            <FieldLabel>Name</FieldLabel>
            <Input value={label} onChange={setLabel} maxLength={80} size="sm" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            disabled={label.trim() === ''}
            loading={busy === 'AddDraftSection'}
            onPress={() => {
              void act('AddDraftSection', { label: label.trim() }, 'Section added').then((done) => {
                if (done === null) return;
                onClose();
                onAdded();
              });
            }}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface Preview {
  readonly nextVersion: number;
  readonly unchanged: boolean;
  readonly changes: readonly {
    kind: string;
    key: string;
    summary: string;
    specialCategory: boolean;
  }[];
  readonly impact: {
    evaluated: number;
    becomingIncomplete: number;
    becomingComplete: number;
    forEmployees: number;
    forStaff: number;
  };
  readonly integrationsNotified: number;
}

const MARKER: Readonly<
  Record<string, { word: string; tone: 'success' | 'warning' | 'info' | 'neutral' }>
> = {
  added: { word: '+ Added', tone: 'success' },
  tightened: { word: '~ Tightened', tone: 'warning' },
  loosened: { word: '~ Loosened', tone: 'info' },
  changed: { word: '~ Changed', tone: 'warning' },
  archived: { word: '− Archived', tone: 'neutral' },
};

const todayHere = (): string =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  );

/** Publishing, after seeing what it does: the changes, and who they make incomplete, from a day. */
function PublishDialog({
  onClose,
  onPublished,
}: {
  onClose: () => void;
  onPublished: () => void;
}): React.JSX.Element {
  const signed = useSigned();
  const { act, busy } = useAct();
  const today = todayHere();
  const [requiredFrom, setRequiredFrom] = useState(today);
  const [preview, setPreview] = useState<Preview | string | null>(null);

  useEffect(() => {
    let live = true;
    setPreview(null);
    void ask<Preview>(signed, 'PublishPreview', { requiredFrom }).then((answer) => {
      if (live) setPreview(answer.ok ? answer.data : answer.message);
    });
    return () => {
      live = false;
    };
  }, [signed, requiredFrom]);

  const ready = preview !== null && typeof preview !== 'string' ? preview : null;
  const version = ready === null ? '' : ` version ${String(ready.nextVersion)}`;
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Publish${version}`}</DialogTitle>
          <DialogDescription>
            Takes effect immediately for everyone. Nothing already saved is changed or lost.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ScrollView style={{ flexGrow: 0, maxHeight: 420 }} contentContainerClassName="gap-3">
            {preview === null ? (
              <Spinner label="Working out what this changes" />
            ) : typeof preview === 'string' ? (
              <Alert tone="danger" title="Could not work out what this changes">
                {`${preview} Nothing has been published.`}
              </Alert>
            ) : preview.unchanged ? (
              <Alert tone="info" title="Nothing to publish">
                The draft is the same as the published version.
              </Alert>
            ) : (
              <>
                <List>
                  {preview.changes.map((c) => (
                    <ListItem
                      key={`${c.kind}:${c.key}`}
                      description={c.summary}
                      {...(c.specialCategory
                        ? {
                            trailing: (
                              <Badge size="sm" tone="danger">
                                Special category
                              </Badge>
                            ),
                          }
                        : {})}
                    >
                      {MARKER[c.kind]?.word ?? c.kind}
                    </ListItem>
                  ))}
                </List>
                <Text weight="semibold">{`Impact on ${String(preview.impact.evaluated)} people`}</Text>
                <AutoGrid minItemWidth={130} gap={2}>
                  <Stat label="Become incomplete" value={preview.impact.becomingIncomplete} />
                  <Stat label="For employees" value={preview.impact.forEmployees} />
                  <Stat label="For you" value={preview.impact.forStaff} />
                  <Stat label="Integrations told" value={preview.integrationsNotified} />
                </AutoGrid>
                {preview.impact.becomingComplete > 0 ? (
                  <Alert tone="success">{`${String(preview.impact.becomingComplete)} people who are incomplete today will be complete.`}</Alert>
                ) : null}
                {preview.impact.forEmployees > 0 ? (
                  <Alert tone="info">
                    Employees with missing details get at most one reminder email a week.
                  </Alert>
                ) : null}
              </>
            )}
            <DatePicker
              label="Required from"
              size="sm"
              value={requiredFrom}
              min={today}
              onChange={(next) => {
                if (next !== null) setRequiredFrom(next);
              }}
            />
            <Text variant="footnote" tone="muted">
              Records completed before this date are not counted as incomplete.
            </Text>
          </ScrollView>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            disabled={ready === null || ready.unchanged}
            loading={busy === 'PublishDraft'}
            onPress={() => {
              void act<{ version: number }>(
                'PublishDraft',
                { requiredFrom },
                (d) => `Version ${String(d.version)} published`,
              ).then((done) => {
                if (done === null) return;
                onClose();
                onPublished();
              });
            }}
          >
            {`Publish${version}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
