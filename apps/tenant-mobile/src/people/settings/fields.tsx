import {
  Alert,
  AutoGrid,
  Badge,
  Button,
  Card,
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
  Spinner,
  Stat,
  Text,
} from '@reach/ui-native';
import {
  Calendar,
  ChevronDown,
  Eye,
  Folder,
  Hash,
  List as ListIcon,
  Lock,
  Mail,
  MapPin,
  Paperclip,
  Phone,
  Plus,
  Send,
  ShieldCheck,
  ToggleLeft,
  Type,
  type LucideIcon,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Failed, Loading, Page } from '../../frame';
import { useAct } from '../act';
import { ask, useSigned } from '../api';
import type { PeopleScreen } from '../routes';
import { FieldEditor } from './field-editor';
import { fieldSentence } from './sentences';
import { COLLECT, type Registry, type RegistryField } from './fields-model';

const PENDING: Readonly<
  Record<string, { label: string; tone: 'success' | 'warning' | 'neutral' }>
> = {
  added: { label: '+ Added', tone: 'success' },
  changed: { label: '~ Changed', tone: 'warning' },
  archived: { label: '− Archived', tone: 'neutral' },
};

/** A glyph for the kind of answer a field takes, on the row's tile. */
function typeIcon(dataType: string): LucideIcon {
  if (/date|duration/u.test(dataType)) return Calendar;
  if (dataType === 'email') return Mail;
  if (dataType === 'phone') return Phone;
  if (/address|country|location/u.test(dataType)) return MapPin;
  if (/select|tags/u.test(dataType)) return ListIcon;
  if (/document|image/u.test(dataType)) return Paperclip;
  if (/number|decimal|percentage|money/u.test(dataType)) return Hash;
  if (dataType === 'boolean') return ToggleLeft;
  return Type;
}

/** "At sign-up · required · Everyone": when it is asked, whether it must be, and who sees it (M1). */
function lineOf(f: RegistryField): string {
  const w = fieldSentence(f);
  return [
    COLLECT.find((c) => c.value === f.collectAt)?.label ?? f.collectAt,
    f.requiredness === 'always'
      ? 'required'
      : f.requiredness === 'conditional'
        ? 'required sometimes'
        : 'optional',
    w.see,
  ].join(' · ');
}

/** Only what is unusual about a field, in words. */
function Badges({ field }: { field: RegistryField }): React.JSX.Element | null {
  const badges = [
    field.pending === null ? null : (
      <Badge key="pending" size="sm" tone={PENDING[field.pending]?.tone ?? 'neutral'}>
        {PENDING[field.pending]?.label ?? field.pending}
      </Badge>
    ),
    field.requiresApproval === true ? (
      <Badge key="approval" size="sm" icon={ShieldCheck}>
        Needs approval
      </Badge>
    ) : null,
    field.encrypted === true ? (
      <Badge key="sealed" size="sm" icon={Lock}>
        Encrypted
      </Badge>
    ) : null,
    field.classification === 'confidential' ? (
      <Badge key="kind" size="sm" tone="warning">
        Confidential
      </Badge>
    ) : field.classification === 'special-category' ? (
      <Badge key="kind" size="sm" tone="danger">
        Special category
      </Badge>
    ) : null,
  ].filter((b) => b !== null);
  return badges.length === 0 ? null : <View className="flex-row flex-wrap gap-1.5">{badges}</View>;
}

/**
 * Employee fields (design M1, M2): what is live and what waits to publish,
 * one section at a time from one dropdown, and each field in words — when it
 * is asked, whether it must be, who sees it, and only its unusual labels. A
 * row opens the five-step editor; reordering happens on the web.
 */
export function FieldRegistry({
  navigation,
  route,
}: PeopleScreen<'FieldRegistry'>): React.JSX.Element {
  const signed = useSigned();
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [find, setFind] = useState('');
  const [chosen, setChosen] = useState<string | null>(route.params?.section ?? null);
  const [adding, setAdding] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [editing, setEditing] = useState<{
    field: RegistryField | null;
    section: Registry['sections'][number];
    described?: string;
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

  const back = { label: 'Settings', onPress: navigation.goBack };
  const title = 'Employee fields';
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
  const section = registry.sections.find((s) => s.key === chosen) ?? registry.sections[0];
  const count = (key: string): number => registry.fields.filter((f) => f.sectionKey === key).length;
  const listed = registry.fields.filter((f) =>
    needle === '' ? f.sectionKey === section?.key : matches(f),
  );
  // New fields go to the section on screen, or the first one that takes them.
  const home =
    section !== undefined && !section.fixed ? section : registry.sections.find((s) => !s.fixed);
  const add = (described?: string): void => {
    if (home !== undefined)
      setEditing({ field: null, section: home, ...(described === undefined ? {} : { described }) });
  };
  const next = (registry.published?.version ?? 0) + 1;
  const waiting = registry.unpublishedChanges;

  return (
    <Page
      title={title}
      back={back}
      trailing={
        <Button
          size="sm"
          variant="primary"
          startIcon={<Icon icon={Plus} tone="on-accent" />}
          accessibilityLabel="Add field"
          disabled={home === undefined}
          onPress={() => {
            add();
          }}
        />
      }
    >
      <Card>
        <View className="flex-row items-center gap-3">
          <View className="flex-1 gap-0.5">
            <Text variant="headline">
              {waiting > 0
                ? `${String(waiting)} ${waiting === 1 ? 'change' : 'changes'} waiting`
                : registry.published === null
                  ? 'Not published yet'
                  : `Version ${String(registry.published.version)} is live`}
            </Text>
            <Text variant="footnote" tone="muted">
              {waiting > 0
                ? `Drafts for version ${String(next)}`
                : registry.published === null
                  ? 'Nothing to publish'
                  : `Published ${registry.published.publishedAt.slice(0, 10)} · nothing to publish`}
            </Text>
          </View>
          <Button
            size="sm"
            variant={waiting > 0 ? 'primary' : 'secondary'}
            startIcon={
              <Icon icon={waiting > 0 ? Send : Eye} tone={waiting > 0 ? 'on-accent' : 'default'} />
            }
            onPress={() => {
              setPublishing(true);
            }}
          >
            {waiting > 0 ? 'Publish' : 'Preview'}
          </Button>
        </View>
      </Card>
      <SearchField
        ask
        value={find}
        onValueChange={setFind}
        onSearch={(text) => {
          if (text.trim().split(/\s+/u).length > 2) {
            add(text.trim());
            setFind('');
          }
        }}
        placeholder="Search fields, or describe a new one"
        label="Search fields, or describe a new one"
      />
      {needle === '' && section !== undefined ? (
        <View className="flex-row items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger>
              <Button
                size="sm"
                startIcon={<Icon icon={Folder} />}
                endIcon={<Icon icon={ChevronDown} />}
                accessibilityLabel={`Section: ${section.label}. Choose another`}
              >
                {section.label}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent label="Sections">
              {registry.sections.map((s) => (
                <DropdownMenuItem
                  key={s.key}
                  {...(s.fixed ? { icon: Lock } : {})}
                  description={`${String(count(s.key))} ${count(s.key) === 1 ? 'field' : 'fields'}${s.fixed ? ' · fixed rules' : ''}`}
                  onSelect={() => {
                    setChosen(s.key);
                  }}
                >
                  {s.label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                icon={Plus}
                onSelect={() => {
                  setAdding(true);
                }}
              >
                Add section
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <View className="flex-1" />
          <Text variant="footnote" tone="muted">
            {`${String(listed.length)} ${listed.length === 1 ? 'field' : 'fields'}`}
          </Text>
        </View>
      ) : null}
      {section?.fixed === true && needle === '' ? (
        <Alert tone="info" icon={Lock}>
          Its rules are not yours to change; it can be read here.
        </Alert>
      ) : null}
      {listed.length === 0 ? (
        <EmptyState
          icon={Folder}
          title={needle === '' ? 'No fields yet' : 'Nothing matches'}
          description={
            needle === '' ? 'Add one, or describe it above.' : 'Try another name or key.'
          }
        />
      ) : (
        <List>
          {listed.map((f) => {
            const sec = registry.sections.find((x) => x.key === f.sectionKey);
            return (
              <ListItem
                key={f.key}
                leading={
                  <View className="size-10 items-center justify-center rounded-xl bg-surface-sunken">
                    <Icon icon={typeIcon(f.dataType)} size={18} tone="muted" />
                  </View>
                }
                description={lineOf(f)}
                wrap
                supporting={<Badges field={f} />}
                chevron={sec?.fixed !== true}
                {...(sec === undefined || sec.fixed
                  ? {}
                  : {
                      onPress: () => {
                        setEditing({ field: f, section: sec });
                      },
                    })}
              >
                {f.label}
              </ListItem>
            );
          })}
        </List>
      )}
      {needle === '' && section !== undefined && !section.fixed ? (
        <View className="flex-row justify-center">
          <Button
            size="sm"
            startIcon={<Icon icon={Plus} />}
            onPress={() => {
              add();
            }}
          >
            Add field
          </Button>
        </View>
      ) : null}
      {editing === null ? null : (
        <FieldEditor
          registry={registry}
          section={editing.section}
          field={editing.field}
          {...(editing.described === undefined ? {} : { described: editing.described })}
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
