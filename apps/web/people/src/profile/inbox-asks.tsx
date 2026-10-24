import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Chip,
  ChipRow,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Dropzone,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  icons,
  List,
  ListItem,
  locale,
  RadioCard,
  RadioGroup,
  Switch,
  Textarea,
} from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';

import type { Outcome } from '../load';
import { t } from '../i18n';

/**
 * What HR starts from a profile that lands in the person's Inbox (H2, H3):
 * asking for details, with the sender's own words and a due date, and sending
 * a document whose sender decides whether it is a task or an update. And the
 * person's Documents, which every document sent is kept under.
 */

export interface AskInput {
  readonly keys: readonly string[];
  readonly message: string | null;
  readonly dueOn: string | null;
}

export type DocumentMode = 'keep' | 'acknowledge' | 'sign';

export interface SendInput {
  readonly mode: DocumentMode;
  readonly message: string | null;
  readonly dueOn: string | null;
  readonly countersign: boolean;
}

export interface ProfileDocument {
  readonly id: string;
  readonly name: string;
  readonly mode: DocumentMode;
  readonly state: string;
  readonly sentAt: string;
  readonly signature: {
    readonly name: string;
    readonly at: string;
    readonly place: string | null;
  } | null;
  readonly countersignedName: string | null;
  /** Kept somewhere with its own viewer: opening it goes there rather than downloading. */
  readonly href?: string;
}

const inDays = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/** H2: ask for details, one task in their Inbox with these fields. */
export function AskDialog({
  name,
  fields,
  onAsk,
  onClose,
}: {
  readonly name: string;
  readonly fields: readonly { readonly key: string; readonly label: string }[];
  readonly onAsk: (input: AskInput) => Promise<Outcome>;
  readonly onClose: () => void;
}): JSX.Element {
  const first = name.split(' ')[0] ?? name;
  const [keys, setKeys] = useState<readonly string[]>(fields.map((f) => f.key));
  const [message, setMessage] = useState('');
  const [due, setDue] = useState(inDays(7));
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const chosen = fields.filter((f) => keys.includes(f.key));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('profile.inbox-asks.ask_for_details', 'Ask {{first}} for details', { first })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'profile.inbox-asks.gets_one_task_with_these_fields',
              '{{first}} gets one task with these fields and fills them in from the Inbox. You get an update when it’s done.',
              { first },
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field required>
            <FieldLabel>{t('profile.inbox-asks.what_to_ask_for', 'What to ask for')}</FieldLabel>
            <ChipRow aria-label={t('profile.inbox-asks.fields', 'Fields')}>
              {fields.map((f) => (
                <Chip
                  key={f.key}
                  selected={keys.includes(f.key)}
                  onClick={() => {
                    setKeys((was) =>
                      was.includes(f.key) ? was.filter((k) => k !== f.key) : [...was, f.key],
                    );
                  }}
                >
                  {f.label}
                </Chip>
              ))}
            </ChipRow>
          </Field>
          <Field>
            <FieldLabel>{t('profile.inbox-asks.message', 'Message')}</FieldLabel>
            <FieldControl>
              <Textarea
                value={message}
                placeholder={t(
                  'profile.inbox-asks.why_you_need_it_in_your',
                  'Why you need it, in your words to {{first}}',
                  { first },
                )}
                onChange={(e) => {
                  setMessage(e.target.value);
                }}
              />
            </FieldControl>
          </Field>
          <Field>
            <FieldLabel>{t('profile.inbox-asks.due', 'Due')}</FieldLabel>
            <FieldControl>
              <DatePicker
                label={t('profile.inbox-asks.due', 'Due')}
                value={due === '' ? null : due}
                onChange={(d) => {
                  setDue(d ?? '');
                }}
              />
            </FieldControl>
            <FieldDescription>
              {t(
                'profile.inbox-asks.reminded_the_day_before_then_every',
                'Reminded the day before, then every two days.',
              )}
            </FieldDescription>
          </Field>
          {chosen.length === 0 ? null : (
            <List aria-label={t('profile.inbox-asks.will_see', '{{first}} will see', { first })}>
              <ListItem
                icon={<icons.edit aria-hidden />}
                description={chosen.map((f) => f.label).join(', ')}
                meta="now"
              >
                {chosen.length === 1
                  ? t('profile.inbox-asks.add_your', 'Add your {{value}}', {
                      value: chosen[0]?.label.toLowerCase() ?? '',
                    })
                  : t('profile.inbox-asks.add_details', 'Add {{length}} details', {
                      length: String(chosen.length),
                    })}
              </ListItem>
            </List>
          )}
          {refused === null ? null : <Alert tone="danger">{refused}</Alert>}
        </DialogBody>
        <DialogFooter>
          <span className="me-auto text-sm text-fg-subtle">
            {t(
              'profile.inbox-asks.goes_to_their_inbox_phone_and',
              'Goes to their Inbox, phone and email',
            )}
          </span>
          <Button onClick={onClose}>{t('profile.inbox-asks.cancel', 'Cancel')}</Button>
          <Button
            variant="primary"
            startIcon={<icons.send aria-hidden />}
            disabled={chosen.length === 0}
            loading={busy}
            onClick={() => {
              setBusy(true);
              void onAsk({
                keys: chosen.map((f) => f.key),
                message: message.trim() === '' ? null : message.trim(),
                dueOn: due === '' ? null : due,
              }).then((done) => {
                setBusy(false);
                if (done.ok) onClose();
                else setRefused(done.message);
              });
            }}
          >
            {t('profile.inbox-asks.send_to', 'Send to {{first}}', { first })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** H3: send a document; the sender decides whether it is a task or an update. */
export function SendDocumentDialog({
  name,
  onSend,
  onClose,
}: {
  readonly name: string;
  readonly onSend: (file: File, input: SendInput) => Promise<Outcome>;
  readonly onClose: () => void;
}): JSX.Element {
  const first = name.split(' ')[0] ?? name;
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<DocumentMode>('sign');
  const [message, setMessage] = useState('');
  const [due, setDue] = useState(inDays(7));
  const [countersign, setCountersign] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('profile.inbox-asks.send_a_document_to', 'Send a document to {{first}}', { first })}
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {file === null ? (
            <Dropzone
              label={t('profile.inbox-asks.choose_the_document', 'Choose the document')}
              hint={t(
                'profile.inbox-asks.a_pdf_or_a_photo_of',
                'A PDF or a photo of one, up to 25 MB',
              )}
              accept=".pdf,application/pdf,image/png,image/jpeg"
              onFiles={(files) => {
                setFile(files[0] ?? null);
              }}
            />
          ) : (
            <List aria-label={t('profile.inbox-asks.document', 'Document')}>
              <ListItem
                icon={<icons.file aria-hidden />}
                description={t('profile.inbox-asks.kb', '{{max}} KB', {
                  max: String(Math.max(1, Math.round(file.size / 1024))),
                })}
                trailing={
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setFile(null);
                    }}
                  >
                    {t('profile.inbox-asks.replace', 'Replace')}
                  </Button>
                }
              >
                {file.name}
              </ListItem>
            </List>
          )}
          <RadioGroup
            aria-label={t(
              'profile.inbox-asks.what_should_do_with_it',
              'What should {{first}} do with it?',
              { first },
            )}
            value={mode}
            onValueChange={(v) => {
              if (v === 'keep' || v === 'acknowledge' || v === 'sign') setMode(v);
            }}
          >
            <RadioCard
              value="keep"
              description={t(
                'profile.inbox-asks.filed_in_their_profile_they_get',
                'Filed in their profile. They get an update.',
              )}
              badge={<Badge size="sm">{t('profile.inbox-asks.update', 'Update')}</Badge>}
            >
              {t('profile.inbox-asks.just_keep_it', 'Just keep it')}
            </RadioCard>
            <RadioCard
              value="acknowledge"
              description={t(
                'profile.inbox-asks.they_confirm_theyve_read_it',
                'They confirm they’ve read it.',
              )}
              badge={
                <Badge size="sm" tone="accent">
                  {t('profile.inbox-asks.task', 'Task')}
                </Badge>
              }
            >
              {t('profile.inbox-asks.read_and_acknowledge', 'Read and acknowledge')}
            </RadioCard>
            <RadioCard
              value="sign"
              description={t(
                'profile.inbox-asks.they_sign_then_you_countersign',
                'They sign; then you countersign.',
              )}
              badge={
                <Badge size="sm" tone="accent">
                  {t('profile.inbox-asks.task', 'Task')}
                </Badge>
              }
            >
              {t('profile.inbox-asks.sign_it', 'Sign it')}
            </RadioCard>
          </RadioGroup>
          <Field>
            <FieldLabel>{t('profile.inbox-asks.message', 'Message')}</FieldLabel>
            <FieldControl>
              <Textarea
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                }}
              />
            </FieldControl>
          </Field>
          {mode === 'keep' ? null : (
            <Field>
              <FieldLabel>{t('profile.inbox-asks.due', 'Due')}</FieldLabel>
              <FieldControl>
                <DatePicker
                  label={t('profile.inbox-asks.due', 'Due')}
                  value={due === '' ? null : due}
                  onChange={(d) => {
                    setDue(d ?? '');
                  }}
                />
              </FieldControl>
            </Field>
          )}
          {mode === 'sign' ? (
            <Field orientation="horizontal">
              <FieldLabel>
                {t('profile.inbox-asks.i_countersign_it_after_them', 'I countersign it after them')}
              </FieldLabel>
              <FieldControl>
                <Switch checked={countersign} onCheckedChange={setCountersign} />
              </FieldControl>
            </Field>
          ) : null}
          {refused === null ? null : <Alert tone="danger">{refused}</Alert>}
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>{t('profile.inbox-asks.cancel', 'Cancel')}</Button>
          <Button
            variant="primary"
            startIcon={<icons.send aria-hidden />}
            disabled={file === null}
            loading={busy}
            onClick={() => {
              if (file === null) return;
              setBusy(true);
              void onSend(file, {
                mode,
                message: message.trim() === '' ? null : message.trim(),
                dueOn: mode === 'keep' || due === '' ? null : due,
                countersign: mode === 'sign' && countersign,
              }).then((done) => {
                setBusy(false);
                if (done.ok) onClose();
                else setRefused(done.message);
              });
            }}
          >
            {t('profile.inbox-asks.send', 'Send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STATE: Readonly<Record<string, { label: string; tone: 'success' | 'warning' | 'neutral' }>> =
  {
    open: { label: t('profile.inbox-asks.waiting', 'Waiting'), tone: 'warning' },
    kept: { label: t('profile.inbox-asks.kept', 'Kept'), tone: 'neutral' },
    acknowledged: { label: t('profile.inbox-asks.acknowledged', 'Acknowledged'), tone: 'success' },
    signed: { label: t('profile.inbox-asks.signed', 'Signed'), tone: 'success' },
    countersigned: {
      label: t('profile.inbox-asks.signed_by_both', 'Signed by both'),
      tone: 'success',
    },
    declined: { label: t('profile.inbox-asks.sent_back', 'Sent back'), tone: 'neutral' },
  };

/** The person's Documents (D2, F1): every document sent to them, kept with their record. */
export function Documents({
  load,
  onOpen,
}: {
  readonly load: () => Promise<readonly ProfileDocument[]>;
  readonly onOpen: (id: string) => Promise<Outcome>;
}): JSX.Element | null {
  const [docs, setDocs] = useState<readonly ProfileDocument[] | null>(null);
  useEffect(() => {
    let live = true;
    void load().then((d) => {
      if (live) setDocs(d);
    });
    return () => {
      live = false;
    };
  }, [load]);
  if (docs === null || docs.length === 0) return null;
  return (
    <Card id="section-documents">
      <CardHeader>
        <CardTitle level={2}>{t('profile.inbox-asks.documents', 'Documents')}</CardTitle>
      </CardHeader>
      <CardContent>
        <List
          aria-label={t('profile.inbox-asks.documents', 'Documents')}
          className="-mx-2 bg-transparent shadow-none"
        >
          {docs.map((d) => {
            const s = STATE[d.state] ?? { label: d.state, tone: 'neutral' as const };
            return (
              <ListItem
                key={d.id}
                icon={<icons.file aria-hidden />}
                description={[
                  new Date(d.sentAt).toLocaleDateString(locale(), {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  }),
                  d.signature === null
                    ? null
                    : t('profile.inbox-asks.signed_by', 'signed by {{name}}', {
                        name: d.signature.name,
                      }),
                  d.countersignedName === null
                    ? null
                    : t('profile.inbox-asks.and', 'and {{countersignedName}}', {
                        countersignedName: d.countersignedName,
                      }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
                trailing={
                  <span className="flex items-center gap-2">
                    <Badge size="sm" tone={s.tone}>
                      {s.label}
                    </Badge>
                    {d.href === undefined ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('profile.inbox-asks.download', 'Download {{name}}', {
                          name: d.name,
                        })}
                        startIcon={<icons.download aria-hidden />}
                        onClick={() => {
                          void onOpen(d.id);
                        }}
                      />
                    ) : (
                      <Button variant="ghost" size="sm" asChild>
                        <a
                          href={d.href}
                          onClick={(e) => {
                            e.preventDefault();
                            void onOpen(d.id);
                          }}
                        >
                          {t('profile.inbox-asks.open', 'Open')}
                        </a>
                      </Button>
                    )}
                  </span>
                }
              >
                {d.name}
              </ListItem>
            );
          })}
        </List>
      </CardContent>
    </Card>
  );
}
