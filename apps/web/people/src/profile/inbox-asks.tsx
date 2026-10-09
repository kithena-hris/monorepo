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
  Input,
  List,
  ListItem,
  RadioCard,
  RadioGroup,
  Switch,
  Textarea,
  icons,
} from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';

import type { Outcome } from '../load';

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
          <DialogTitle>{`Ask ${first} for details`}</DialogTitle>
          <DialogDescription>
            {`${first} gets one task with these fields and fills them in from the Inbox. You get an update when it’s done.`}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field required>
            <FieldLabel>What to ask for</FieldLabel>
            <ChipRow aria-label="Fields">
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
            <FieldLabel>Message</FieldLabel>
            <FieldControl>
              <Textarea
                value={message}
                placeholder={`Why you need it, in your words to ${first}`}
                onChange={(e) => {
                  setMessage(e.target.value);
                }}
              />
            </FieldControl>
          </Field>
          <Field>
            <FieldLabel>Due</FieldLabel>
            <FieldControl>
              <Input
                type="date"
                value={due}
                onChange={(e) => {
                  setDue(e.target.value);
                }}
              />
            </FieldControl>
            <FieldDescription>Reminded the day before, then every two days.</FieldDescription>
          </Field>
          {chosen.length === 0 ? null : (
            <List aria-label={`${first} will see`}>
              <ListItem
                icon={<icons.edit aria-hidden />}
                description={chosen.map((f) => f.label).join(', ')}
                meta="now"
              >
                {chosen.length === 1
                  ? `Add your ${chosen[0]?.label.toLowerCase() ?? ''}`
                  : `Add ${String(chosen.length)} details`}
              </ListItem>
            </List>
          )}
          {refused === null ? null : <Alert tone="danger">{refused}</Alert>}
        </DialogBody>
        <DialogFooter>
          <span className="me-auto text-sm text-fg-subtle">
            Goes to their Inbox, phone and email
          </span>
          <Button onClick={onClose}>Cancel</Button>
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
            {`Send to ${first}`}
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
          <DialogTitle>{`Send a document to ${first}`}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {file === null ? (
            <Dropzone
              label="Choose the document"
              hint="A PDF or a photo of one, up to 25 MB"
              accept=".pdf,application/pdf,image/png,image/jpeg"
              onFiles={(files) => {
                setFile(files[0] ?? null);
              }}
            />
          ) : (
            <List aria-label="Document">
              <ListItem
                icon={<icons.file aria-hidden />}
                description={`${String(Math.max(1, Math.round(file.size / 1024)))} KB`}
                trailing={
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setFile(null);
                    }}
                  >
                    Replace
                  </Button>
                }
              >
                {file.name}
              </ListItem>
            </List>
          )}
          <RadioGroup
            aria-label={`What should ${first} do with it?`}
            value={mode}
            onValueChange={(v) => {
              if (v === 'keep' || v === 'acknowledge' || v === 'sign') setMode(v);
            }}
          >
            <RadioCard
              value="keep"
              description="Filed in their profile. They get an update."
              badge={<Badge size="sm">Update</Badge>}
            >
              Just keep it
            </RadioCard>
            <RadioCard
              value="acknowledge"
              description="They confirm they’ve read it."
              badge={
                <Badge size="sm" tone="accent">
                  Task
                </Badge>
              }
            >
              Read and acknowledge
            </RadioCard>
            <RadioCard
              value="sign"
              description="They sign; then you countersign."
              badge={
                <Badge size="sm" tone="accent">
                  Task
                </Badge>
              }
            >
              Sign it
            </RadioCard>
          </RadioGroup>
          <Field>
            <FieldLabel>Message</FieldLabel>
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
              <FieldLabel>Due</FieldLabel>
              <FieldControl>
                <Input
                  type="date"
                  value={due}
                  onChange={(e) => {
                    setDue(e.target.value);
                  }}
                />
              </FieldControl>
            </Field>
          )}
          {mode === 'sign' ? (
            <Field orientation="horizontal">
              <FieldLabel>I countersign it after them</FieldLabel>
              <FieldControl>
                <Switch checked={countersign} onCheckedChange={setCountersign} />
              </FieldControl>
            </Field>
          ) : null}
          {refused === null ? null : <Alert tone="danger">{refused}</Alert>}
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
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
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STATE: Readonly<Record<string, { label: string; tone: 'success' | 'warning' | 'neutral' }>> =
  {
    open: { label: 'Waiting', tone: 'warning' },
    kept: { label: 'Kept', tone: 'neutral' },
    acknowledged: { label: 'Acknowledged', tone: 'success' },
    signed: { label: 'Signed', tone: 'success' },
    countersigned: { label: 'Signed by both', tone: 'success' },
    declined: { label: 'Sent back', tone: 'neutral' },
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
        <CardTitle level={2}>Documents</CardTitle>
      </CardHeader>
      <CardContent>
        <List aria-label="Documents" className="-mx-2 bg-transparent shadow-none">
          {docs.map((d) => {
            const s = STATE[d.state] ?? { label: d.state, tone: 'neutral' as const };
            return (
              <ListItem
                key={d.id}
                icon={<icons.file aria-hidden />}
                description={[
                  new Date(d.sentAt).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  }),
                  d.signature === null ? null : `signed by ${d.signature.name}`,
                  d.countersignedName === null ? null : `and ${d.countersignedName}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                trailing={
                  <span className="flex items-center gap-2">
                    <Badge size="sm" tone={s.tone}>
                      {s.label}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Download ${d.name}`}
                      startIcon={<icons.download aria-hidden />}
                      onClick={() => {
                        void onOpen(d.id);
                      }}
                    />
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
