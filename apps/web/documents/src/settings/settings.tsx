import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  formatList,
  formatNumber,
  icons,
  Input,
  List,
  ListItem,
  NumberField,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded, type Loadable } from '../load';
import { DocIcon, shortDate, useWrite } from '../shared';
import type {
  AiFeature,
  DocumentType,
  Kind,
  Outcome,
  Read,
  Retention,
  SettingsData,
  TypeDraft,
} from '../types';
import { t as tr } from '../i18n';

/**
 * Settings › Documents (S1–S3, S5, S6; MS1–MS3, MS5, MS6): document types as
 * one plain line each, access and sharing defaults, retention rules and the
 * legal holds that override them. Anyone reads them; HR changes them.
 */

function Page({
  load,
  title,
  description,
  children,
}: {
  readonly load: Loadable<SettingsData>;
  readonly title: string;
  readonly description: string;
  readonly children: (data: SettingsData) => JSX.Element;
}): JSX.Element {
  if (load.status === 'loading')
    return (
      <Skeleton
        shape="page"
        label={tr('settings.settings.loading', 'Loading {{title}}', { title })}
      />
    );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} description={description} />
      <Loaded load={load} what={title.toLowerCase()}>
        {(data) => (
          <div className="flex max-w-3xl flex-col gap-6">
            {data.hr ? null : (
              <Alert tone="info">
                {tr('settings.settings.only_hr_can_change_these', 'Only HR can change these.')}
              </Alert>
            )}
            {children(data)}
          </div>
        )}
      </Loaded>
    </div>
  );
}

/* ----------------------------------------------------------- types (S2) -- */

const AUDIENCE = {
  subject: tr('settings.settings.the_person_and_hr', 'the person and HR'),
  everyone: 'everyone',
  hr: tr('settings.settings.hr_only', 'HR only'),
} as const;

/** "Filed to each person. The person and HR see it, Confidential. Signed by them, then HR." */
export function sentence(t: DocumentType & { readonly retentionWords: string }): string {
  return [
    t.filedTo === 'person'
      ? tr('settings.settings.filed_to_each_person', 'Filed to each person')
      : tr('settings.settings.a_company_document', 'A company document'),
    t.audience === 'everyone'
      ? t.confidential
        ? tr('settings.settings.everyone_sees_it_confidential', 'Everyone sees it, Confidential')
        : tr('settings.settings.everyone_sees_it', 'Everyone sees it')
      : t.confidential
        ? tr(
            'settings.settings.audience_see_it_confidential',
            '{{AUDIENCE}} see it, Confidential',
            {
              AUDIENCE: AUDIENCE[t.audience],
            },
          )
        : tr('settings.settings.it', '{{AUDIENCE}} see it', { AUDIENCE: AUDIENCE[t.audience] }),
    t.signers.length === 0
      ? null
      : tr('settings.settings.signed_by', 'Signed by {{join}}', {
          join: t.signers
            .map((s) =>
              s === 'subject'
                ? tr('settings.settings.signer_them', 'them')
                : tr('settings.settings.signer_hr', 'HR'),
            )
            .join(tr('settings.settings.then_separator', ', then ')),
        }),
    t.acknowledge
      ? tr(
          'settings.settings.everyone_acknowledges_each_version',
          'Everyone acknowledges each version',
        )
      : null,
    t.requiredFor === null
      ? null
      : t.requiredFor === 'new_starters'
        ? tr(
            'settings.settings.required_for_new_starters',
            'Required for new starters, before day one',
          )
        : tr('settings.settings.required_for_everyone', 'Required for everyone'),
    t.expiryReminders.length === 0
      ? null
      : tr(
          'settings.settings.reminders_days_before_it_expires',
          {
            one: 'Reminders {{join}} day before it expires',
            other: 'Reminders {{join}} days before it expires',
          },
          {
            count: t.expiryReminders.at(-1) ?? 0,
            join: formatList(t.expiryReminders.map((d) => formatNumber(d))),
          },
        ),
    tr('settings.settings.kept', 'Kept {{charAt}}{{slice}}', {
      charAt: t.retentionWords.charAt(0).toLowerCase(),
      slice: t.retentionWords.slice(1),
    }),
  ]
    .filter(Boolean)
    .join('. ')
    .concat('.');
}

export function DocumentTypes({
  load,
  onSave,
  onDescribe,
}: {
  readonly load: Loadable<SettingsData>;
  readonly onSave?:
    ((type: Record<string, unknown>, archived: boolean) => Promise<Outcome>) | undefined;
  /** S4: a type described in words, drafted for HR to check and save. */
  readonly onDescribe?: ((text: string) => Promise<Read<TypeDraft>>) | undefined;
}): JSX.Element {
  const [editing, setEditing] = useState<DocumentType | null>(null);
  const [drafted, setDrafted] = useState<string | null>(null);
  return (
    <Page
      load={load}
      title={tr('settings.settings.document_types', 'Document types')}
      description={tr(
        'settings.settings.where_each_kind_of_document_is',
        'Where each kind of document is filed, who sees it, what it needs and how long it is kept.',
      )}
    >
      {(data) => (
        <>
          {data.hr ? (
            <Button
              variant="primary"
              className="self-start"
              startIcon={<icons.add aria-hidden />}
              onClick={() => {
                setEditing(BLANK);
              }}
            >
              {tr('settings.settings.new_document_type', 'New document type')}
            </Button>
          ) : null}
          {data.hr && data.ai.sorting && onDescribe !== undefined ? (
            <Describe
              onDescribe={onDescribe}
              onDraft={(type, question) => {
                setDrafted(question);
                setEditing(type);
              }}
            />
          ) : null}
          <List>
            {data.types
              .filter((t) => !t.archived)
              .map((t) => (
                <ListItem
                  key={t.key}
                  leading={<DocIcon kind={t.kind} />}
                  description={sentence(t)}
                  meta={
                    <span className="flex flex-wrap gap-1.5">
                      {t.requiredFor === null ? null : (
                        <Badge tone="accent" size="sm">
                          {tr('settings.settings.required', 'Required')}
                        </Badge>
                      )}
                      {t.signers.length === 0 ? null : (
                        <Badge size="sm">{tr('settings.settings.signature', 'Signature')}</Badge>
                      )}
                      {t.expiryReminders.length === 0 ? null : (
                        <Badge size="sm">{tr('settings.settings.expires', 'Expires')}</Badge>
                      )}
                      <Badge size="sm" tone="neutral">
                        {tr(
                          'settings.settings.document',
                          { one: '{{count}} document', other: '{{count}} documents' },
                          { count: t.used },
                        )}
                      </Badge>
                    </span>
                  }
                  trailing={
                    data.hr ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setEditing(t);
                        }}
                      >
                        {tr('settings.settings.edit', 'Edit')}
                      </Button>
                    ) : null
                  }
                >
                  {t.name}
                </ListItem>
              ))}
          </List>
          {editing === null ? null : (
            <TypeDialog
              type={editing}
              isNew={editing === BLANK || !data.types.some((t) => t.key === editing.key)}
              question={drafted}
              onClose={() => {
                setEditing(null);
                setDrafted(null);
              }}
              onSave={onSave}
            />
          )}
        </>
      )}
    </Page>
  );
}

const BLANK: DocumentType = {
  key: '',
  name: '',
  kind: 'Form',
  filedTo: 'person',
  audience: 'subject',
  confidential: true,
  medical: false,
  signers: [],
  acknowledge: false,
  requiredFor: null,
  requiredBy: 0,
  expiryReminders: [],
  retention: { kind: 'after_leaving', years: 4 },
  aiReads: [],
  aiEnabled: true,
};

/** S4: "Visa letters, filed to the person, HR only, kept a year after they leave." */
function Describe({
  onDescribe,
  onDraft,
}: {
  readonly onDescribe: (text: string) => Promise<Read<TypeDraft>>;
  readonly onDraft: (type: DocumentType, question: string | null) => void;
}): JSX.Element {
  const [text, setText] = useState('');
  const write = useWrite();
  return (
    <Card variant="assistant" padded className="flex flex-col gap-3">
      <Field>
        <FieldLabel>
          {tr(
            'settings.settings.or_describe_it_and_kithena_drafts',
            'Or describe it, and Kithena drafts the settings',
          )}
        </FieldLabel>
        <FieldControl>
          <Input
            value={text}
            maxLength={1000}
            placeholder={tr(
              'settings.settings.visa_letters_filed_to_the_person',
              'Visa letters: filed to the person, HR only, kept a year after they leave',
            )}
            onChange={(e) => {
              setText(e.target.value);
            }}
          />
        </FieldControl>
        <FieldDescription>
          {tr(
            'settings.settings.you_check_every_choice_before_it',
            'You check every choice before it is saved.',
          )}
        </FieldDescription>
      </Field>
      {write.error === null ? null : <Alert tone="danger">{write.error}</Alert>}
      <Button
        variant="secondary"
        className="self-start"
        startIcon={<icons.assistant aria-hidden />}
        loading={write.pending}
        disabled={text.trim() === ''}
        onClick={() => {
          write.run(async () => {
            const r = await onDescribe(text.trim());
            if (!r.ok) return r;
            if (!r.data.available || r.data.type === null) {
              return {
                ok: false,
                message: tr(
                  'settings.settings.kithena_could_not_draft_that_try_new',
                  'Kithena could not draft that. Try New document type.',
                ),
              };
            }
            onDraft(r.data.type, r.data.question);
            setText('');
            return { ok: true };
          });
        }}
      >
        {tr('settings.settings.draft_it', 'Draft it')}
      </Button>
    </Card>
  );
}

const KINDS: readonly Kind[] = [
  'Contract',
  'Policy',
  'Payslip',
  'Letter',
  'ID',
  'Medical',
  'Sheet',
  'Template',
  'Permit',
  'Form',
];

/** A kind as the reader's language names it; the kind itself stays the stored value. */
const kindLabel = (kind: Kind): string =>
  (
    ({
      Contract: tr('settings.settings.contract', 'Contract'),
      Policy: tr('settings.settings.policy', 'Policy'),
      Payslip: tr('settings.settings.payslip', 'Payslip'),
      Letter: tr('settings.settings.letter', 'Letter'),
      ID: tr('settings.settings.id', 'ID'),
      Medical: tr('settings.settings.medical', 'Medical'),
      Sheet: tr('settings.settings.sheet', 'Sheet'),
      Template: tr('settings.settings.template', 'Template'),
      Permit: tr('settings.settings.permit', 'Permit'),
      Form: tr('settings.settings.form', 'Form'),
    }) as Readonly<Record<string, string>>
  )[kind] ?? kind;

const keyOf = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .slice(0, 60);

/** Editing a type (S3): each part of its sentence is one choice. */
function TypeDialog({
  type,
  isNew,
  question = null,
  onClose,
  onSave,
}: {
  readonly type: DocumentType;
  readonly isNew: boolean;
  /** What Kithena's draft left open, when it drafted this. */
  readonly question?: string | null;
  readonly onClose: () => void;
  readonly onSave:
    ((type: Record<string, unknown>, archived: boolean) => Promise<Outcome>) | undefined;
}): JSX.Element {
  const [t, setT] = useState<DocumentType>(type);
  const write = useWrite();
  const set = <K extends keyof DocumentType>(k: K, v: DocumentType[K]): void => {
    setT({ ...t, [k]: v });
  };
  const save = (archived: boolean): void => {
    const key = isNew ? keyOf(t.name) : t.key;
    write.run(() => onSave?.({ ...t, key }, archived) ?? Promise.resolve({ ok: true }), onClose);
  };
  const retention = t.retention;
  const years =
    'years' in retention
      ? retention.years
      : 'plusYears' in retention
        ? retention.plusYears
        : 'days' in retention
          ? retention.days
          : 0;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent sheetOnTouch>
        <DialogHeader>
          <DialogTitle>
            {isNew ? tr('settings.settings.new_document_type', 'New document type') : t.name}
          </DialogTitle>
          <DialogDescription>
            {tr(
              'settings.settings.the_whole_type_is_one_sentence',
              'The whole type is one sentence; each part is a choice.',
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {question === null ? null : (
            <Alert
              tone="info"
              title={tr('settings.settings.drafted_by_kithena', 'Drafted by Kithena')}
              icon={<icons.assistant />}
            >
              {question}
            </Alert>
          )}
          <Field required>
            <FieldLabel>{tr('settings.settings.name', 'Name')}</FieldLabel>
            <FieldControl>
              <Input
                value={t.name}
                maxLength={80}
                onChange={(e) => {
                  set('name', e.target.value);
                }}
              />
            </FieldControl>
          </Field>
          <Choice
            label={tr('settings.settings.looks_like', 'Looks like')}
            value={t.kind}
            onChange={(v) => {
              set('kind', v as Kind);
            }}
            options={KINDS.map((k) => [k, kindLabel(k)])}
          />
          <Choice
            label={tr('settings.settings.filed_to', 'Filed to')}
            value={t.filedTo}
            onChange={(v) => {
              setT({
                ...t,
                filedTo: v === 'company' ? 'company' : 'person',
                ...(v === 'company'
                  ? { requiredFor: null, signers: t.signers.filter((s) => s === 'hr') }
                  : {}),
              });
            }}
            options={[
              ['person', tr('settings.settings.each_person', 'Each person')],
              ['company', tr('settings.settings.the_company', 'The company')],
            ]}
          />
          <Choice
            label={tr('settings.settings.who_sees_it_besides_hr', 'Who sees it besides HR')}
            value={t.audience}
            onChange={(v) => {
              set('audience', v as DocumentType['audience']);
            }}
            options={[
              ['subject', tr('settings.settings.the_person_it_is_about', 'The person it is about')],
              ['everyone', tr('settings.settings.everyone', 'Everyone')],
              ['hr', tr('settings.settings.nobody_else', 'Nobody else')],
            ]}
          />
          <Field orientation="horizontal">
            <FieldLabel>{tr('settings.settings.confidential', 'Confidential')}</FieldLabel>
            <FieldControl>
              <Switch
                checked={t.confidential}
                onCheckedChange={(v) => {
                  set('confidential', v);
                }}
              />
            </FieldControl>
          </Field>
          <Field orientation="horizontal">
            <FieldLabel>
              {tr(
                'settings.settings.medical_hr_only_dates_read_only',
                'Medical: HR only, dates read only',
              )}
            </FieldLabel>
            <FieldControl>
              <Switch
                checked={t.medical}
                onCheckedChange={(v) => {
                  setT({
                    ...t,
                    medical: v,
                    ...(v ? { confidential: true, audience: 'hr', aiReads: [] } : {}),
                  });
                }}
              />
            </FieldControl>
          </Field>
          {t.filedTo === 'person' ? (
            <Choice
              label={tr('settings.settings.signed_by_2', 'Signed by')}
              value={t.signers.join(',') || 'none'}
              onChange={(v) => {
                set('signers', v === 'none' ? [] : (v.split(',') as DocumentType['signers']));
              }}
              options={[
                ['none', tr('settings.settings.nobody', 'Nobody')],
                ['subject', tr('settings.settings.them', 'Them')],
                [
                  tr('settings.settings.subject_hr', 'subject,hr'),
                  tr('settings.settings.them_then_hr', 'Them, then HR'),
                ],
                ['hr', 'HR'],
              ]}
            />
          ) : (
            <Field orientation="horizontal">
              <FieldLabel>
                {tr(
                  'settings.settings.everyone_acknowledges_each_version',
                  'Everyone acknowledges each version',
                )}
              </FieldLabel>
              <FieldControl>
                <Checkbox
                  checked={t.acknowledge}
                  onCheckedChange={(v) => {
                    set('acknowledge', v === true);
                  }}
                />
              </FieldControl>
            </Field>
          )}
          {t.filedTo === 'person' ? (
            <Choice
              label={tr('settings.settings.required', 'Required')}
              value={t.requiredFor ?? 'no'}
              onChange={(v) => {
                set('requiredFor', v === 'no' ? null : (v as 'new_starters' | 'everyone'));
              }}
              options={[
                ['no', tr('settings.settings.not_required', 'Not required')],
                [
                  'new_starters',
                  tr(
                    'settings.settings.for_new_starters_before_day_one',
                    'For new starters, before day one',
                  ),
                ],
                ['everyone', tr('settings.settings.for_everyone', 'For everyone')],
              ]}
            />
          ) : null}
          <Field orientation="horizontal">
            <FieldLabel>
              {tr(
                'settings.settings.expires_remind_60_days_before',
                'Expires: remind 60 days before',
              )}
            </FieldLabel>
            <FieldControl>
              <Switch
                checked={t.expiryReminders.length > 0}
                onCheckedChange={(v) => {
                  set('expiryReminders', v ? [60, 14] : []);
                }}
              />
            </FieldControl>
          </Field>
          <Choice
            label={tr('settings.settings.kept_2', 'Kept')}
            value={retention.kind}
            onChange={(v) => {
              const n = Math.max(1, years);
              const next: Retention =
                v === 'forever'
                  ? { kind: 'forever' }
                  : v === 'until_leaving'
                    ? { kind: 'until_leaving', plusYears: n }
                    : v === 'days'
                      ? { kind: 'days', days: 90 }
                      : v === 'years'
                        ? { kind: 'years', years: n }
                        : { kind: 'after_leaving', years: n };
              set('retention', next);
            }}
            options={[
              [
                'after_leaving',
                tr('settings.settings.years_after_they_leave', 'Years after they leave'),
              ],
              [
                'until_leaving',
                tr('settings.settings.until_they_leave_plus_years', 'Until they leave, plus years'),
              ],
              ['years', tr('settings.settings.years_from_filing', 'Years from filing')],
              ['days', tr('settings.settings.days_from_filing', 'Days from filing')],
              ['forever', tr('settings.settings.forever', 'Forever')],
            ]}
          />
          {retention.kind === 'forever' ? null : (
            <Field>
              <FieldControl>
                <NumberField
                  label={
                    retention.kind === 'days'
                      ? tr('settings.settings.days', 'Days')
                      : tr('settings.settings.years', 'Years')
                  }
                  value={years}
                  min={retention.kind === 'until_leaving' ? 0 : 1}
                  max={retention.kind === 'days' ? 3650 : 50}
                  onChange={(n: number | null) => {
                    const v = n ?? 1;
                    set(
                      'retention',
                      retention.kind === 'until_leaving'
                        ? { kind: 'until_leaving', plusYears: v }
                        : retention.kind === 'days'
                          ? { kind: 'days', days: v }
                          : { kind: retention.kind, years: v },
                    );
                  }}
                />
              </FieldControl>
              <FieldDescription>
                {tr(
                  'settings.settings.nothing_is_deleted_without_hr_confirming',
                  'Nothing is deleted without HR confirming first.',
                )}
              </FieldDescription>
            </Field>
          )}
          {write.error === null ? null : (
            <Alert tone="danger" title={tr('settings.settings.not_saved', 'Not saved')}>
              {write.error}
            </Alert>
          )}
        </DialogBody>
        <DialogFooter>
          {isNew ? null : (
            <Button
              variant="ghost"
              disabled={write.pending}
              onClick={() => {
                save(true);
              }}
            >
              {tr('settings.settings.archive', 'Archive')}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {tr('settings.settings.cancel', 'Cancel')}
          </Button>
          <Button
            variant="primary"
            loading={write.pending}
            disabled={t.name.trim() === ''}
            onClick={() => {
              save(false);
            }}
          >
            {tr('settings.settings.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Choice({
  label,
  value,
  onChange,
  options,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly (readonly [string, string])[];
}): JSX.Element {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Select value={value} onValueChange={onChange}>
        <FieldControl>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
        </FieldControl>
        <SelectContent>
          {options.map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/* ---------------------------------------------------------- access (S5) -- */

type Access = SettingsData['access'];

export function AccessSettings({
  load,
  onSave,
}: {
  readonly load: Loadable<SettingsData>;
  readonly onSave?: ((input: Record<string, unknown>) => Promise<Outcome>) | undefined;
}): JSX.Element {
  return (
    <Page
      load={load}
      title={tr('settings.settings.access_and_sharing', 'Access and sharing')}
      description={tr(
        'settings.settings.what_new_documents_start_as_how',
        'What new documents start as, how far people can share, and what Confidential enforces.',
      )}
    >
      {(data) => <AccessForm access={data.access} hr={data.hr} onSave={onSave} />}
    </Page>
  );
}

function AccessForm({
  access,
  hr,
  onSave,
}: {
  readonly access: Access;
  readonly hr: boolean;
  readonly onSave: ((input: Record<string, unknown>) => Promise<Outcome>) | undefined;
}): JSX.Element {
  const write = useWrite();
  const toggle = (
    key: keyof Access,
    label: string,
    description?: string,
    locked?: boolean,
  ): JSX.Element => (
    <Field orientation="horizontal" key={key}>
      <FieldLabel>{label}</FieldLabel>
      <FieldControl>
        <Switch
          checked={locked === true ? true : access[key] === true}
          disabled={!hr || locked === true || write.pending}
          onCheckedChange={(v) => {
            write.run(() => onSave?.({ [key]: v }) ?? Promise.resolve({ ok: true }));
          }}
        />
      </FieldControl>
      {description === undefined ? null : <FieldDescription>{description}</FieldDescription>}
    </Field>
  );
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle level={2}>{tr('settings.settings.new_documents', 'New documents')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm">
            {tr(
              'settings.settings.every_new_document_starts_private',
              'Every new document starts Private.',
            )}
          </p>
          {toggle(
            'askAfterUpload',
            tr(
              'settings.settings.after_an_upload_ask_once_whether_to',
              'After an upload, ask once whether to share',
            ),
          )}
          {toggle(
            'peopleMayTurnOffQuestion',
            tr(
              'settings.settings.people_can_turn_the_question_off',
              'People can turn the question off',
            ),
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle level={2}>{tr('settings.settings.sharing', 'Sharing')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field>
            <FieldLabel>
              {tr(
                'settings.settings.share_with_everyone_at_the_company',
                'Share with everyone at the company',
              )}
            </FieldLabel>
            <Select
              value={access.everyoneShare}
              disabled={!hr}
              onValueChange={(v) => {
                write.run(() => onSave?.({ everyoneShare: v }) ?? Promise.resolve({ ok: true }));
              }}
            >
              <FieldControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                <SelectItem value="hr">{tr('settings.settings.hr_only', 'HR only')}</SelectItem>
                <SelectItem value="anyone">{tr('settings.settings.anyone', 'Anyone')}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {toggle(
            'outsideSharing',
            tr('settings.settings.share_outside_the_company', 'Share outside the company'),
            tr('settings.settings.not_available_yet', 'Not available yet'),
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle level={2}>{tr('settings.settings.confidential', 'Confidential')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-fg-muted">
            {tr(
              'settings.settings.hr_the_documents_type_or_its',
              'HR, the document’s type, or its owner can mark a document Confidential. Only HR lowers what HR or the type set.',
            )}
          </p>
          {toggle(
            'watermark',
            tr(
              'settings.settings.watermark_with_the_viewers_name',
              'Watermark with the viewer’s name',
            ),
          )}
          {toggle(
            'blockDownload',
            tr('settings.settings.block_download_and_print', 'Block download and print'),
            tr(
              'settings.settings.the_person_it_is_about_can_still',
              'The person it is about can still download it',
            ),
          )}
          {toggle(
            'blockDownload',
            tr('settings.settings.log_every_view', 'Log every view'),
            tr('settings.settings.always_on', 'Always on'),
            true,
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle level={2}>
            {tr('settings.settings.personal_sections', 'Personal sections')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {toggle(
            'personalSections',
            tr('settings.settings.everyone_can_create_them', 'Everyone can create them'),
            tr('settings.settings.only_they_see_them', 'Only they see them'),
          )}
        </CardContent>
      </Card>
      {write.error === null ? null : (
        <Alert tone="danger" title={tr('settings.settings.not_saved', 'Not saved')}>
          {write.error}
        </Alert>
      )}
    </>
  );
}

/* ------------------------------------------------------- retention (S6) -- */

export function RetentionSettings({
  load,
  onLift,
}: {
  readonly load: Loadable<SettingsData>;
  readonly onLift?: ((holdId: string) => Promise<Outcome>) | undefined;
}): JSX.Element {
  return (
    <Page
      load={load}
      title={tr('settings.settings.retention_and_legal_holds', 'Retention and legal holds')}
      description={tr(
        'settings.settings.one_rule_per_kind_of_document',
        'One rule per kind of document. Legal holds override them; nothing is deleted without HR confirming.',
      )}
    >
      {(data) => (
        <>
          <Card>
            <CardHeader>
              <CardTitle level={2}>{tr('settings.settings.rules', 'Rules')}</CardTitle>
            </CardHeader>
            <CardContent>
              <List>
                {data.types
                  .filter((t) => !t.archived)
                  .map((t) => (
                    <ListItem
                      key={t.key}
                      leading={<DocIcon kind={t.kind} size="md" />}
                      meta={t.retentionWords}
                    >
                      {t.name}
                    </ListItem>
                  ))}
              </List>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle level={2}>{tr('settings.settings.legal_holds', 'Legal holds')}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.holds.length === 0 ? (
                <p className="text-sm text-fg-muted">
                  {tr(
                    'settings.settings.no_holds_place_one_from_a',
                    'No holds. Place one from a document while a case is open.',
                  )}
                </p>
              ) : (
                <List>
                  {data.holds.map((h) => (
                    <ListItem
                      key={h.id}
                      icon={<icons.locked />}
                      iconTone="danger"
                      description={tr(
                        'settings.settings.document_2',
                        {
                          one: '{{setBy}} · {{setAt}} · {{count}} document',
                          other: '{{setBy}} · {{setAt}} · {{count}} documents',
                        },
                        { count: h.count, setBy: h.setBy, setAt: shortDate(h.setAt) },
                      )}
                      trailing={data.hr ? <Lift id={h.id} onLift={onLift} /> : null}
                    >
                      {h.name}
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
          <Card padded>
            <p className="text-sm">
              {tr(
                'settings.settings.deleted_documents_are_kept_for_30',
                'Deleted documents are kept for 30 days, then gone.',
              )}
            </p>
          </Card>
        </>
      )}
    </Page>
  );
}

function Lift({
  id,
  onLift,
}: {
  readonly id: string;
  readonly onLift: ((id: string) => Promise<Outcome>) | undefined;
}): JSX.Element {
  const write = useWrite();
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={write.pending}
      onClick={() => {
        write.run(() => onLift?.(id) ?? Promise.resolve({ ok: true }));
      }}
    >
      {tr('settings.settings.lift', 'Lift')}
    </Button>
  );
}

/* ------------------------------------------------- Kithena reading (S7) -- */

const FEATURES: readonly { key: AiFeature; label: string; description: string }[] = [
  {
    key: 'summaries',
    label: tr('settings.settings.summaries', 'Summaries'),
    description: tr(
      'settings.settings.on_every_document_a_person_opens',
      'On every document a person opens',
    ),
  },
  {
    key: 'questions',
    label: tr('settings.settings.questions_about_a_document', 'Questions about a document'),
    description: tr(
      'settings.settings.answered_from_its_pages_citing_them',
      'Answered from its pages, citing them',
    ),
  },
  {
    key: 'across',
    label: tr('settings.settings.questions_across_documents', 'Questions across documents'),
    description: tr(
      'settings.settings.from_the_search_box_only_from',
      'From the search box, only from documents the person can open',
    ),
  },
  {
    key: 'sorting',
    label: tr('settings.settings.sort_uploads', 'Sort uploads'),
    description: tr(
      'settings.settings.type_person_and_dates_for_hr',
      'Type, person and dates, for HR to confirm',
    ),
  },
  {
    key: 'fields',
    label: tr('settings.settings.read_fields_into_people', 'Read fields into People'),
    description: tr(
      'settings.settings.always_reviewed_before_anything_is_saved',
      'Always reviewed before anything is saved',
    ),
  },
  {
    key: 'photos',
    label: tr('settings.settings.read_photos_and_scans', 'Read photos and scans'),
    description: tr(
      'settings.settings.off_by_default_a_picture_is',
      'Off by default: a picture is sent as it is, since names in it cannot be hidden first',
    ),
  },
];

export function AiSettings({
  load,
  onSave,
}: {
  readonly load: Loadable<SettingsData>;
  readonly onSave?: ((input: Partial<Record<AiFeature, boolean>>) => Promise<Outcome>) | undefined;
}): JSX.Element {
  const write = useWrite();
  return (
    <Page
      load={load}
      title={tr('settings.settings.kithena_reading', 'Kithena reading')}
      description={tr(
        'settings.settings.what_kithena_may_do_with_your',
        'What Kithena may do with your documents. Medical documents are only ever read for their dates.',
      )}
    >
      {(data) => (
        <Card>
          <CardHeader>
            <CardTitle level={2}>
              {tr('settings.settings.what_kithena_does', 'What Kithena does')}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {FEATURES.map((f) => (
              <Field orientation="horizontal" key={f.key}>
                <FieldLabel>{f.label}</FieldLabel>
                <FieldControl>
                  <Switch
                    checked={data.ai[f.key]}
                    disabled={!data.hr || write.pending}
                    onCheckedChange={(v) => {
                      write.run(() => onSave?.({ [f.key]: v }) ?? Promise.resolve({ ok: true }));
                    }}
                  />
                </FieldControl>
                <FieldDescription>{f.description}</FieldDescription>
              </Field>
            ))}
            {write.error === null ? null : <Alert tone="danger">{write.error}</Alert>}
            <p className="text-sm text-fg-muted">
              {tr(
                'settings.settings.a_type_can_also_be_kept',
                'A type can also be kept from Kithena entirely, in its settings. Every answer cites the pages it came from, and only somebody who may open a document is ever told about it.',
              )}
            </p>
          </CardContent>
        </Card>
      )}
    </Page>
  );
}
