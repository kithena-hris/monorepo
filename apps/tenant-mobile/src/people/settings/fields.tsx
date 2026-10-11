import {
  Alert,
  AutoGrid,
  Badge,
  Button,
  Card,
  ChipGroup,
  ChipGroupItem,
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
import { ArrowUpDown, Ellipsis, Eye, Folder, Lock, Pencil, Plus, Send } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Failed, Loading, Page } from '../../frame';
import { useAct } from '../act';
import { ask, useSigned } from '../api';
import type { PeopleScreen } from '../routes';
import { FieldEditor } from './field-editor';
import { FieldSentenceDialog, NewFieldDialog } from './field-sentence';
import { fieldSentence } from './sentences';
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
  const [chip, setChip] = useState<string>('');
  const [saying, setSaying] = useState<RegistryField | null>(null);
  const [describing, setDescribing] = useState<string | null>(null);
  const [editingIn, setEditingIn] = useState<{
    field: RegistryField | null;
    section: Registry['sections'][number];
  } | null>(null);

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

  // Every field, a section at a time (design v3 S3): each reads as one sentence.
  const shownSection = registry.sections.find((s) => s.key === chip) ?? registry.sections[0];
  const listed = registry.fields.filter((f) =>
    needle === '' ? f.sectionKey === shownSection?.key : matches(f),
  );
  const sentenceOf = (f: RegistryField): string => {
    const w = fieldSentence(f);
    return `${f.collectAt === 'hr_only' ? `${w.who} fills it in` : `Asked at ${w.asked}`} · ${w.see === 'Everyone' ? 'everyone sees it' : `${w.see.charAt(0).toLowerCase()}${w.see.slice(1)} see it`}`;
  };
  return (
    <Page
      title={title}
      back={back}
      trailing={
        <View className="flex-row items-center gap-1">
          {registry.unpublishedChanges > 0 ? publish : null}
          <Button
            size="sm"
            variant="primary"
            startIcon={<Icon icon={Plus} tone="on-accent" />}
            accessibilityLabel="Add a field"
            onPress={() => {
              setDescribing('');
            }}
          />
        </View>
      }
    >
      <Card>
        <View className="flex-row items-center gap-3">
          <View className="flex-1 gap-0.5">
            <Text variant="headline">
              {registry.published === null
                ? 'Not published yet'
                : `Version ${String(registry.published.version)} is live`}
            </Text>
            <Text variant="footnote" tone="muted">
              {registry.unpublishedChanges === 0
                ? 'No changes waiting'
                : `${String(registry.unpublishedChanges)} ${registry.unpublishedChanges === 1 ? 'change waits' : 'changes wait'} to be published`}
            </Text>
          </View>
          <Button
            size="sm"
            variant={registry.unpublishedChanges > 0 ? 'primary' : 'secondary'}
            startIcon={<Icon icon={registry.unpublishedChanges > 0 ? Send : Eye} />}
            onPress={() => {
              setPublishing(true);
            }}
          >
            {registry.unpublishedChanges > 0 ? 'Publish' : 'Preview'}
          </Button>
        </View>
      </Card>
      <SearchField
        ask
        value={find}
        onValueChange={setFind}
        onSearch={(text) => {
          if (text.trim().split(/\s+/u).length > 2) {
            setDescribing(text.trim());
            setFind('');
          }
        }}
        placeholder="Find a field, or describe a new one"
        label="Find a field or describe a new one"
      />
      {needle === '' ? (
        <View>
          <ChipGroup
            type="single"
            value={shownSection?.key ?? ''}
            onValueChange={setChip}
            accessibilityLabel="Sections"
            scroll
          >
            {registry.sections.map((s) => (
              <ChipGroupItem key={s.key} value={s.key}>
                {`${s.label} ${String(registry.fields.filter((f) => f.sectionKey === s.key).length)}`}
              </ChipGroupItem>
            ))}
          </ChipGroup>
        </View>
      ) : null}
      {ordering ? (
        <SortableList
          items={registry.sections.map((x) => ({ ...x, id: x.key, locked: x.fixed }))}
          label="Sections"
          itemLabel={(x) => x.label}
          onReorder={(move) => {
            void act('ReorderDraftSections', { order: [...move.order] }).then(reload);
          }}
        >
          {(x) => <SortableRowText title={x.label} />}
        </SortableList>
      ) : listed.length === 0 ? (
        <EmptyState
          icon={Folder}
          title={needle === '' ? 'No fields yet' : 'Nothing matches'}
          description={needle === '' ? 'Describe one above.' : 'Try another name or key.'}
        />
      ) : (
        <List>
          {listed.map((f) => {
            const sec = registry.sections.find((x) => x.key === f.sectionKey);
            return (
              <ListItem
                key={f.key}
                description={sentenceOf(f)}
                wrap
                supporting={
                  <View className="flex-row flex-wrap gap-1.5">
                    {f.origin !== 'tenant' ? (
                      <Badge size="sm" icon={Lock}>
                        Built in
                      </Badge>
                    ) : null}
                    {f.requiredness === 'always' ? (
                      <Badge size="sm" tone="accent">
                        Required
                      </Badge>
                    ) : null}
                    {f.pending === null ? null : (
                      <Badge size="sm" tone={PENDING[f.pending]?.tone ?? 'neutral'}>
                        {PENDING[f.pending]?.label ?? f.pending}
                      </Badge>
                    )}
                  </View>
                }
                chevron={sec?.fixed !== true}
                {...(sec === undefined || sec.fixed
                  ? {}
                  : {
                      onPress: () => {
                        setSaying(f);
                      },
                    })}
              >
                {f.label}
              </ListItem>
            );
          })}
        </List>
      )}
      {needle === '' && shownSection !== undefined ? (
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
            {ordering ? 'Done' : 'Reorder sections'}
          </Button>
        </View>
      ) : null}
      {needle === '' && shownSection !== undefined && !ordering ? (
        <View className="flex-row">
          <Button
            variant="link"
            onPress={() => {
              navigation.push('FieldRegistry', { section: shownSection.key });
            }}
          >
            {`Reorder the fields in ${shownSection.label}`}
          </Button>
        </View>
      ) : null}
      {saying === null
        ? null
        : (() => {
            const sec = registry.sections.find((x) => x.key === saying.sectionKey);
            return sec === undefined ? null : (
              <FieldSentenceDialog
                section={sec}
                field={saying}
                onClose={() => {
                  setSaying(null);
                }}
                onSaved={() => {
                  setSaying(null);
                  reload();
                }}
                onMore={() => {
                  setSaying(null);
                  setEditingIn({ field: saying, section: sec });
                }}
              />
            );
          })()}
      {describing === null ? null : (
        <NewFieldDialog
          registry={registry}
          initial={describing}
          onClose={() => {
            setDescribing(null);
          }}
          onSaved={() => {
            setDescribing(null);
            reload();
          }}
          onChange={(sec) => {
            setDescribing(null);
            setEditingIn({ field: null, section: sec });
          }}
        />
      )}
      {editingIn === null ? null : (
        <FieldEditor
          registry={registry}
          section={editingIn.section}
          field={editingIn.field}
          onClose={() => {
            setEditingIn(null);
          }}
          onSaved={(review) => {
            setEditingIn(null);
            reload();
            if (review !== null)
              navigation.navigate('FieldChange', { key: review.key, to: review.to });
          }}
        />
      )}
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
