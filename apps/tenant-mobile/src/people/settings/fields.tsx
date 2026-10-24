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
import { t } from '../../i18n';

const PENDING: Readonly<
  Record<string, { label: string; tone: 'success' | 'warning' | 'neutral' }>
> = {
  added: {
    get label(): string {
      return t('people.settings.fields.added', '+ Added');
    },
    tone: 'success',
  },
  changed: {
    get label(): string {
      return t('people.settings.fields.changed', '~ Changed');
    },
    tone: 'warning',
  },
  archived: {
    get label(): string {
      return t('people.settings.fields.archived', '− Archived');
    },
    tone: 'neutral',
  },
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
        {t('people.settings.fields.needs_approval', 'Needs approval')}
      </Badge>
    ) : null,
    field.encrypted === true ? (
      <Badge key="sealed" size="sm" icon={Lock}>
        {t('people.settings.fields.encrypted', 'Encrypted')}
      </Badge>
    ) : null,
    field.classification === 'confidential' ? (
      <Badge key="kind" size="sm" tone="warning">
        {t('people.settings.fields.confidential', 'Confidential')}
      </Badge>
    ) : field.classification === 'special-category' ? (
      <Badge key="kind" size="sm" tone="danger">
        {t('people.settings.fields.special_category', 'Special category')}
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

  const back = {
    label: t('people.settings.fields.settings', 'Settings'),
    onPress: navigation.goBack,
  };
  const title = t('people.settings.fields.employee_fields', 'Employee fields');
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
        <Loading label={t('people.settings.fields.loading_the_fields', 'Loading the fields')} />
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
          accessibilityLabel={t('people.settings.fields.add_field', 'Add field')}
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
                ? t(
                    'people.settings.fields.waiting',
                    { one: '{{count}} change waiting', other: '{{count}} changes waiting' },
                    { count: waiting },
                  )
                : registry.published === null
                  ? t('people.settings.fields.not_published_yet', 'Not published yet')
                  : t('people.settings.fields.version_is_live', 'Version {{String}} is live', {
                      String: String(registry.published.version),
                    })}
            </Text>
            <Text variant="footnote" tone="muted">
              {waiting > 0
                ? t('people.settings.fields.drafts_for_version', 'Drafts for version {{String}}', {
                    String: String(next),
                  })
                : registry.published === null
                  ? t('people.settings.fields.nothing_to_publish', 'Nothing to publish')
                  : t(
                      'people.settings.fields.published_nothing_to_publish',
                      'Published {{slice}} · nothing to publish',
                      { slice: registry.published.publishedAt.slice(0, 10) },
                    )}
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
            {waiting > 0
              ? t('people.settings.fields.publish', 'Publish')
              : t('people.settings.fields.preview', 'Preview')}
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
        placeholder={t(
          'people.settings.fields.search_fields_or_describe_a_new',
          'Search fields, or describe a new one',
        )}
        label={t(
          'people.settings.fields.search_fields_or_describe_a_new',
          'Search fields, or describe a new one',
        )}
      />
      {needle === '' && section !== undefined ? (
        <View className="flex-row items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger>
              <Button
                size="sm"
                startIcon={<Icon icon={Folder} />}
                endIcon={<Icon icon={ChevronDown} />}
                accessibilityLabel={t(
                  'people.settings.fields.section_choose_another',
                  'Section: {{label}}. Choose another',
                  { label: section.label },
                )}
              >
                {section.label}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent label={t('people.settings.fields.sections', 'Sections')}>
              {registry.sections.map((s) => (
                <DropdownMenuItem
                  key={s.key}
                  {...(s.fixed ? { icon: Lock } : {})}
                  description={t(
                    'people.settings.fields.fields',
                    { one: '{{count}} field{{value}}', other: '{{count}} fields{{value}}' },
                    { count: count(s.key), value: s.fixed ? ' · fixed rules' : '' },
                  )}
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
                {t('people.settings.fields.add_section', 'Add section')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <View className="flex-1" />
          <Text variant="footnote" tone="muted">
            {t(
              'people.settings.fields.fields',
              { one: '{{count}} field', other: '{{count}} fields' },
              { count: listed.length },
            )}
          </Text>
        </View>
      ) : null}
      {section?.fixed === true && needle === '' ? (
        <Alert tone="info" icon={Lock}>
          {t(
            'people.settings.fields.its_rules_are_not_yours_to',
            'Its rules are not yours to change; it can be read here.',
          )}
        </Alert>
      ) : null}
      {listed.length === 0 ? (
        <EmptyState
          icon={Folder}
          title={
            needle === ''
              ? t('people.settings.fields.no_fields_yet', 'No fields yet')
              : t('people.settings.fields.nothing_matches', 'Nothing matches')
          }
          description={
            needle === ''
              ? t(
                  'people.settings.fields.add_one_or_describe_it_above',
                  'Add one, or describe it above.',
                )
              : t('people.settings.fields.try_another_name_or_key', 'Try another name or key.')
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
            {t('people.settings.fields.add_field', 'Add field')}
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
          <DialogTitle>{t('people.settings.fields.add_a_section', 'Add a section')}</DialogTitle>
          <DialogDescription>
            {t(
              'people.settings.fields.a_draft_change_published_with_the',
              'A draft change, published with the rest.',
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field required>
            <FieldLabel>{t('people.settings.fields.name', 'Name')}</FieldLabel>
            <Input value={label} onChange={setLabel} maxLength={80} size="sm" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            {t('people.settings.fields.cancel', 'Cancel')}
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            disabled={label.trim() === ''}
            loading={busy === 'AddDraftSection'}
            onPress={() => {
              void act(
                'AddDraftSection',
                { label: label.trim() },
                t('people.settings.fields.section_added', 'Section added'),
              ).then((done) => {
                if (done === null) return;
                onClose();
                onAdded();
              });
            }}
          >
            {t('people.settings.fields.add', 'Add')}
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
          <DialogTitle>
            {t('people.settings.fields.publish_2', 'Publish{{version}}', { version })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'people.settings.fields.takes_effect_immediately_for_everyone_nothing',
              'Takes effect immediately for everyone. Nothing already saved is changed or lost.',
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ScrollView style={{ flexGrow: 0, maxHeight: 420 }} contentContainerClassName="gap-3">
            {preview === null ? (
              <Spinner
                label={t(
                  'people.settings.fields.working_out_what_this_changes',
                  'Working out what this changes',
                )}
              />
            ) : typeof preview === 'string' ? (
              <Alert
                tone="danger"
                title={t(
                  'people.settings.fields.could_not_work_out_what_this',
                  'Could not work out what this changes',
                )}
              >
                {t(
                  'people.settings.fields.nothing_has_been_published',
                  '{{preview}} Nothing has been published.',
                  { preview },
                )}
              </Alert>
            ) : preview.unchanged ? (
              <Alert
                tone="info"
                title={t('people.settings.fields.nothing_to_publish', 'Nothing to publish')}
              >
                {t(
                  'people.settings.fields.the_draft_is_the_same_as',
                  'The draft is the same as the published version.',
                )}
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
                                {t('people.settings.fields.special_category', 'Special category')}
                              </Badge>
                            ),
                          }
                        : {})}
                    >
                      {MARKER[c.kind]?.word ?? c.kind}
                    </ListItem>
                  ))}
                </List>
                <Text weight="semibold">
                  {t('people.settings.fields.impact_on_people', 'Impact on {{String}} people', {
                    String: String(preview.impact.evaluated),
                  })}
                </Text>
                <AutoGrid minItemWidth={130} gap={2}>
                  <Stat
                    label={t('people.settings.fields.become_incomplete', 'Become incomplete')}
                    value={preview.impact.becomingIncomplete}
                  />
                  <Stat
                    label={t('people.settings.fields.for_employees', 'For employees')}
                    value={preview.impact.forEmployees}
                  />
                  <Stat
                    label={t('people.settings.fields.for_you', 'For you')}
                    value={preview.impact.forStaff}
                  />
                  <Stat
                    label={t('people.settings.fields.integrations_told', 'Integrations told')}
                    value={preview.integrationsNotified}
                  />
                </AutoGrid>
                {preview.impact.becomingComplete > 0 ? (
                  <Alert tone="success">
                    {t(
                      'people.settings.fields.people_who_are_incomplete_today_will',
                      '{{String}} people who are incomplete today will be complete.',
                      { String: String(preview.impact.becomingComplete) },
                    )}
                  </Alert>
                ) : null}
                {preview.impact.forEmployees > 0 ? (
                  <Alert tone="info">
                    {t(
                      'people.settings.fields.employees_with_missing_details_get_at',
                      'Employees with missing details get at most one reminder email a week.',
                    )}
                  </Alert>
                ) : null}
              </>
            )}
            <DatePicker
              label={t('people.settings.fields.required_from', 'Required from')}
              size="sm"
              value={requiredFrom}
              min={today}
              onChange={(next) => {
                if (next !== null) setRequiredFrom(next);
              }}
            />
            <Text variant="footnote" tone="muted">
              {t(
                'people.settings.fields.records_completed_before_this_date_are',
                'Records completed before this date are not counted as incomplete.',
              )}
            </Text>
          </ScrollView>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            {t('people.settings.fields.cancel', 'Cancel')}
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            disabled={ready === null || ready.unchanged}
            loading={busy === 'PublishDraft'}
            onPress={() => {
              void act<{ version: number }>('PublishDraft', { requiredFrom }, (d) =>
                t('people.settings.fields.version_published', 'Version {{String}} published', {
                  String: String(d.version),
                }),
              ).then((done) => {
                if (done === null) return;
                onClose();
                onPublished();
              });
            }}
          >
            {t('people.settings.fields.publish_2', 'Publish{{version}}', { version })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
