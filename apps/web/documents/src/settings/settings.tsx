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
  icons,
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
  if (load.status === 'loading') return <Skeleton shape="page" label={`Loading ${title}`} />;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} description={description} />
      <Loaded load={load} what={title.toLowerCase()}>
        {(data) => (
          <div className="flex max-w-3xl flex-col gap-6">
            {data.hr ? null : <Alert tone="info">Only HR can change these.</Alert>}
            {children(data)}
          </div>
        )}
      </Loaded>
    </div>
  );
}

/* ----------------------------------------------------------- types (S2) -- */

const AUDIENCE = { subject: 'the person and HR', everyone: 'everyone', hr: 'HR only' } as const;

/** "Filed to each person. The person and HR see it, Confidential. Signed by them, then HR." */
export function sentence(t: DocumentType & { readonly retentionWords: string }): string {
  return [
    t.filedTo === 'person' ? 'Filed to each person' : 'A company document',
    `${AUDIENCE[t.audience]} ${t.audience === 'everyone' ? 'sees' : 'see'} it${t.confidential ? ', Confidential' : ''}`,
    t.signers.length === 0
      ? null
      : `Signed by ${t.signers.map((s) => (s === 'subject' ? 'them' : 'HR')).join(', then ')}`,
    t.acknowledge ? 'Everyone acknowledges each version' : null,
    t.requiredFor === null
      ? null
      : `Required for ${t.requiredFor === 'new_starters' ? 'new starters, before day one' : 'everyone'}`,
    t.expiryReminders.length === 0
      ? null
      : `Reminders ${t.expiryReminders.join(' and ')} days before it expires`,
    `Kept ${t.retentionWords.charAt(0).toLowerCase()}${t.retentionWords.slice(1)}`,
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
      title="Document types"
      description="Where each kind of document is filed, who sees it, what it needs and how long it is kept."
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
              New document type
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
                          Required
                        </Badge>
                      )}
                      {t.signers.length === 0 ? null : <Badge size="sm">Signature</Badge>}
                      {t.expiryReminders.length === 0 ? null : <Badge size="sm">Expires</Badge>}
                      <Badge size="sm" tone="neutral">
                        {t.used} document{t.used === 1 ? '' : 's'}
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
                        Edit
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
        <FieldLabel>Or describe it, and Kithena drafts the settings</FieldLabel>
        <FieldControl>
          <Input
            value={text}
            maxLength={1000}
            placeholder="Visa letters: filed to the person, HR only, kept a year after they leave"
            onChange={(e) => {
              setText(e.target.value);
            }}
          />
        </FieldControl>
        <FieldDescription>You check every choice before it is saved.</FieldDescription>
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
              return { ok: false, message: 'Kithena could not draft that. Try New document type.' };
            }
            onDraft(r.data.type, r.data.question);
            setText('');
            return { ok: true };
          });
        }}
      >
        Draft it
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
          <DialogTitle>{isNew ? 'New document type' : t.name}</DialogTitle>
          <DialogDescription>
            The whole type is one sentence; each part is a choice.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {question === null ? null : (
            <Alert tone="info" title="Drafted by Kithena" icon={<icons.assistant />}>
              {question}
            </Alert>
          )}
          <Field required>
            <FieldLabel>Name</FieldLabel>
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
            label="Looks like"
            value={t.kind}
            onChange={(v) => {
              set('kind', v as Kind);
            }}
            options={KINDS.map((k) => [k, k])}
          />
          <Choice
            label="Filed to"
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
              ['person', 'Each person'],
              ['company', 'The company'],
            ]}
          />
          <Choice
            label="Who sees it besides HR"
            value={t.audience}
            onChange={(v) => {
              set('audience', v as DocumentType['audience']);
            }}
            options={[
              ['subject', 'The person it is about'],
              ['everyone', 'Everyone'],
              ['hr', 'Nobody else'],
            ]}
          />
          <Field orientation="horizontal">
            <FieldLabel>Confidential</FieldLabel>
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
            <FieldLabel>Medical: HR only, dates read only</FieldLabel>
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
              label="Signed by"
              value={t.signers.join(',') || 'none'}
              onChange={(v) => {
                set('signers', v === 'none' ? [] : (v.split(',') as DocumentType['signers']));
              }}
              options={[
                ['none', 'Nobody'],
                ['subject', 'Them'],
                ['subject,hr', 'Them, then HR'],
                ['hr', 'HR'],
              ]}
            />
          ) : (
            <Field orientation="horizontal">
              <FieldLabel>Everyone acknowledges each version</FieldLabel>
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
              label="Required"
              value={t.requiredFor ?? 'no'}
              onChange={(v) => {
                set('requiredFor', v === 'no' ? null : (v as 'new_starters' | 'everyone'));
              }}
              options={[
                ['no', 'Not required'],
                ['new_starters', 'For new starters, before day one'],
                ['everyone', 'For everyone'],
              ]}
            />
          ) : null}
          <Field orientation="horizontal">
            <FieldLabel>Expires: remind 60 days before</FieldLabel>
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
            label="Kept"
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
              ['after_leaving', 'Years after they leave'],
              ['until_leaving', 'Until they leave, plus years'],
              ['years', 'Years from filing'],
              ['days', 'Days from filing'],
              ['forever', 'Forever'],
            ]}
          />
          {retention.kind === 'forever' ? null : (
            <Field>
              <FieldControl>
                <NumberField
                  label={retention.kind === 'days' ? 'Days' : 'Years'}
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
              <FieldDescription>Nothing is deleted without HR confirming first.</FieldDescription>
            </Field>
          )}
          {write.error === null ? null : (
            <Alert tone="danger" title="Not saved">
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
              Archive
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={write.pending}
            disabled={t.name.trim() === ''}
            onClick={() => {
              save(false);
            }}
          >
            Save
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
      title="Access and sharing"
      description="What new documents start as, how far people can share, and what Confidential enforces."
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
          <CardTitle level={2}>New documents</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm">Every new document starts Private.</p>
          {toggle('askAfterUpload', 'After an upload, ask once whether to share')}
          {toggle('peopleMayTurnOffQuestion', 'People can turn the question off')}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle level={2}>Sharing</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field>
            <FieldLabel>Share with everyone at the company</FieldLabel>
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
                <SelectItem value="hr">HR only</SelectItem>
                <SelectItem value="anyone">Anyone</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {toggle('outsideSharing', 'Share outside the company', 'Not available yet')}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle level={2}>Confidential</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-fg-muted">
            HR, the document’s type, or its owner can mark a document Confidential. Only HR lowers
            what HR or the type set.
          </p>
          {toggle('watermark', 'Watermark with the viewer’s name')}
          {toggle(
            'blockDownload',
            'Block download and print',
            'The person it is about can still download it',
          )}
          {toggle('blockDownload', 'Log every view', 'Always on', true)}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle level={2}>Personal sections</CardTitle>
        </CardHeader>
        <CardContent>
          {toggle('personalSections', 'Everyone can create them', 'Only they see them')}
        </CardContent>
      </Card>
      {write.error === null ? null : (
        <Alert tone="danger" title="Not saved">
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
      title="Retention and legal holds"
      description="One rule per kind of document. Legal holds override them; nothing is deleted without HR confirming."
    >
      {(data) => (
        <>
          <Card>
            <CardHeader>
              <CardTitle level={2}>Rules</CardTitle>
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
              <CardTitle level={2}>Legal holds</CardTitle>
            </CardHeader>
            <CardContent>
              {data.holds.length === 0 ? (
                <p className="text-sm text-fg-muted">
                  No holds. Place one from a document while a case is open.
                </p>
              ) : (
                <List>
                  {data.holds.map((h) => (
                    <ListItem
                      key={h.id}
                      icon={<icons.locked />}
                      iconTone="danger"
                      description={`${h.setBy} · ${shortDate(h.setAt)} · ${String(h.count)} document${h.count === 1 ? '' : 's'}`}
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
            <p className="text-sm">Deleted documents are kept for 30 days, then gone.</p>
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
      Lift
    </Button>
  );
}

/* ------------------------------------------------- Kithena reading (S7) -- */

const FEATURES: readonly { key: AiFeature; label: string; description: string }[] = [
  { key: 'summaries', label: 'Summaries', description: 'On every document a person opens' },
  {
    key: 'questions',
    label: 'Questions about a document',
    description: 'Answered from its pages, citing them',
  },
  {
    key: 'across',
    label: 'Questions across documents',
    description: 'From the search box, only from documents the person can open',
  },
  {
    key: 'sorting',
    label: 'Sort uploads',
    description: 'Type, person and dates, for HR to confirm',
  },
  {
    key: 'fields',
    label: 'Read fields into People',
    description: 'Always reviewed before anything is saved',
  },
  {
    key: 'photos',
    label: 'Read photos and scans',
    description:
      'Off by default: a picture is sent as it is, since names in it cannot be hidden first',
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
      title="Kithena reading"
      description="What Kithena may do with your documents. Medical documents are only ever read for their dates."
    >
      {(data) => (
        <Card>
          <CardHeader>
            <CardTitle level={2}>What Kithena does</CardTitle>
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
              A type can also be kept from Kithena entirely, in its settings. Every answer cites the
              pages it came from, and only somebody who may open a document is ever told about it.
            </p>
          </CardContent>
        </Card>
      )}
    </Page>
  );
}
