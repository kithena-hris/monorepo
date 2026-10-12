import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Combobox,
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
  DropdownMenuTrigger,
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Input,
  List,
  ListItem,
  PageHeader,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SignaturePad,
  Skeleton,
  Spinner,
  Stepper,
  icons,
} from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';

import { Loaded, type Loadable } from '../load';
import { shortDate, useWrite } from '../shared';
import type {
  Created,
  DocumentData,
  EnvelopeData,
  EnvelopesData,
  FieldKind,
  Mark,
  Outcome,
} from '../types';

/**
 * Signatures on the web (K1–K10): the requests this person follows or must
 * sign, sending one, and one request — signed field by field by its signer,
 * followed step by step by its sender.
 */

const STATUS = {
  waiting: ['Waiting', 'neutral'],
  sent: ['Sent', 'info'],
  opened: ['Opened', 'info'],
  verified: ['Opened', 'info'],
  signed: ['Signed', 'success'],
  declined: ['Declined', 'danger'],
} as const;

const ENVELOPE = {
  sent: ['Waiting for a signature', 'warning'],
  completed: ['Signed and sealed', 'success'],
  declined: ['Declined', 'danger'],
  voided: ['Cancelled', 'neutral'],
} as const;

/* ------------------------------------------------------------- K10 list -- */

export function Envelopes({
  load,
  onNavigate,
}: {
  readonly load: Loadable<EnvelopesData>;
  readonly onNavigate?: ((href: string) => void) | undefined;
}): JSX.Element {
  if (load.status === 'loading')
    return <Skeleton shape="page" label="Loading signature requests" />;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Signatures" description="Every request you sign or follow." />
      <Loaded load={load} what="signature requests">
        {(data) =>
          data.rows.length === 0 ? (
            <EmptyState
              icon={<icons.edit />}
              title="No signature requests"
              description="Send one from a document."
            />
          ) : (
            <List>
              {data.rows.map((r) => (
                <ListItem
                  key={r.id}
                  icon={<icons.edit />}
                  iconTone={r.needsYou ? 'accent' : 'neutral'}
                  description={`${String(r.signed)} of ${String(r.of)} signed${r.waitingOn === null ? '' : ` · waiting for ${r.waitingOn}`}${r.dueOn === null ? '' : ` · due ${shortDate(r.dueOn)}`}`}
                  meta={
                    <Badge tone={r.needsYou ? 'accent' : ENVELOPE[r.status][1]} size="sm" dot>
                      {r.needsYou ? 'Your signature' : ENVELOPE[r.status][0]}
                    </Badge>
                  }
                  chevron
                  asChild
                >
                  <a
                    href={`/documents/envelopes/${r.id}`}
                    onClick={(e) => {
                      if (onNavigate === undefined) return;
                      e.preventDefault();
                      onNavigate(`/documents/envelopes/${r.id}`);
                    }}
                  >
                    {r.title}
                  </a>
                </ListItem>
              ))}
            </List>
          )
        }
      </Loaded>
    </div>
  );
}

/* ------------------------------------------------------- K1–K3 sending -- */

interface DraftSigner {
  readonly key: string;
  readonly personId: string | null;
  readonly email: string;
  readonly name: string;
  readonly allowDelegate: boolean;
  readonly page: number;
  readonly spot: 'left' | 'right';
  readonly initials: boolean;
}

export interface SendProps {
  readonly load: Loadable<DocumentData>;
  readonly onNavigate?: ((href: string) => void) | undefined;
  readonly onSend?:
    | ((
        documentId: string,
        input: {
          signers: readonly {
            personId: string | null;
            email: string | null;
            name: string | null;
            order: number;
            allowDelegate: boolean;
          }[];
          fields: readonly {
            id: string;
            signerId: string;
            kind: FieldKind;
            page: number;
            x: number;
            y: number;
            w: number;
            h: number;
            required: boolean;
            label: string | null;
          }[];
          message: string;
          dueOn: string | null;
        },
      ) => Promise<Created>)
    | undefined;
}

export function SendForSignature(props: SendProps): JSX.Element {
  if (props.load.status === 'loading')
    return <Skeleton shape="page" label="Loading the document" />;
  return (
    <div className="flex flex-col gap-6">
      {props.load.status === 'error' ? <PageHeader title="Send for signature" /> : null}
      <Loaded load={props.load} what="the document">
        {(data) =>
          data.document === null ? (
            <Alert tone="danger">You cannot open this document.</Alert>
          ) : !data.document.pdf ? (
            <Alert tone="warning" title="Only a PDF can be signed">
              Add the document as a PDF, then send it for signature.
            </Alert>
          ) : (
            <SendSteps doc={data.document} {...props} />
          )
        }
      </Loaded>
    </div>
  );
}

/** Kithena's placements, as fractions of the page: a signature and its date. */
const SPOTS = { left: 0.08, right: 0.54 } as const;

function fieldsOf(signers: readonly DraftSigner[], pages: number) {
  return signers.flatMap((s, i) => {
    const signerId = `s${String(i + 1)}`;
    const row = Math.floor(i / 2);
    const x = SPOTS[s.spot];
    const y = 0.78 - row * 0.12;
    return [
      {
        id: `${signerId}-signature`,
        signerId,
        kind: 'signature' as const,
        page: s.page,
        x,
        y,
        w: 0.38,
        h: 0.06,
        required: true,
        label: null,
      },
      {
        id: `${signerId}-date`,
        signerId,
        kind: 'date' as const,
        page: s.page,
        x,
        y: y + 0.065,
        w: 0.2,
        h: 0.03,
        required: true,
        label: null,
      },
      ...(s.initials
        ? Array.from({ length: pages }, (_, p) => p + 1)
            .filter((p) => p !== s.page)
            .map((p) => ({
              id: `${signerId}-initials-${String(p)}`,
              signerId,
              kind: 'initials' as const,
              page: p,
              x: s.spot === 'left' ? 0.08 : 0.82,
              y: 0.93,
              w: 0.1,
              h: 0.035,
              required: true,
              label: null,
            }))
        : []),
    ];
  });
}

function SendSteps({
  doc,
  onNavigate,
  onSend,
}: { readonly doc: NonNullable<DocumentData['document']> } & Omit<SendProps, 'load'>): JSX.Element {
  const pages = doc.current.pages ?? 1;
  const [step, setStep] = useState(0);
  const [signers, setSigners] = useState<readonly DraftSigner[]>(
    doc.row.subject === null
      ? []
      : [
          {
            key: 'a',
            personId: doc.row.subject.personId,
            email: '',
            name: doc.row.subject.name,
            allowDelegate: false,
            page: pages,
            spot: 'left',
            initials: false,
          },
        ],
  );
  const [outside, setOutside] = useState({ email: '', name: '' });
  const [message, setMessage] = useState('');
  const [dueOn, setDueOn] = useState<string | null>(null);
  const write = useWrite();
  const update = (key: string, patch: Partial<DraftSigner>) => {
    setSigners(signers.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  };
  const add = (s: Omit<DraftSigner, 'key' | 'page' | 'spot' | 'initials' | 'allowDelegate'>) => {
    setSigners([
      ...signers,
      {
        ...s,
        key: String(Date.now()),
        page: pages,
        spot: signers.length % 2 === 0 ? 'left' : 'right',
        initials: false,
        allowDelegate: false,
      },
    ]);
  };
  const named = new Set(signers.map((s) => s.personId ?? s.email));
  return (
    <>
      <PageHeader
        title={`Send ${doc.row.title} for signature`}
        description={`Version ${String(doc.current.n)} · ${String(pages)} pages`}
      />
      <Stepper
        label="Sending for signature"
        current={step}
        steps={[
          { id: 'who', label: 'Who signs' },
          { id: 'where', label: 'Where they sign' },
          { id: 'review', label: 'Review and send' },
        ]}
        onStepChange={(i) => {
          setStep(i);
        }}
      />
      {step === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle level={2}>Who signs, in order</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {signers.length === 0 ? <p className="text-sm text-fg-muted">Nobody yet.</p> : null}
            <List>
              {signers.map((s, i) => (
                <ListItem
                  key={s.key}
                  leading={<Avatar name={s.name} size="md" />}
                  description={
                    s.personId === null
                      ? `${s.email} · confirms with a code by email`
                      : 'Signs with their Kithena login'
                  }
                  meta={
                    <Badge size="sm">{`Signs ${String(i + 1)}${i === 0 ? 'st' : i === 1 ? 'nd' : 'th'}`}</Badge>
                  }
                  trailing={
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${s.name}`}
                      startIcon={<icons.close aria-hidden />}
                      onClick={() => {
                        setSigners(signers.filter((x) => x.key !== s.key));
                      }}
                    />
                  }
                >
                  {s.name}
                </ListItem>
              ))}
            </List>
            <Field>
              <FieldLabel>Add a colleague</FieldLabel>
              <FieldControl>
                <Combobox
                  label="Add a colleague"
                  options={doc.people
                    .filter((p) => !named.has(p.personId))
                    .map((p) => ({
                      value: p.personId,
                      label: p.name,
                      ...(p.teamName === null ? {} : { description: p.teamName }),
                    }))}
                  value={null}
                  onChange={(v) => {
                    const p = doc.people.find((x) => x.personId === v);
                    if (p !== undefined) add({ personId: p.personId, email: '', name: p.name });
                  }}
                  placeholder="Find a colleague"
                  searchPlaceholder="Find someone"
                  emptyMessage="Nobody by that name"
                />
              </FieldControl>
            </Field>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <Field>
                <FieldLabel>Somebody outside</FieldLabel>
                <FieldControl>
                  <Input
                    placeholder="Their email"
                    type="email"
                    value={outside.email}
                    onChange={(e) => {
                      setOutside({ ...outside, email: e.target.value });
                    }}
                  />
                </FieldControl>
              </Field>
              <Field>
                <FieldLabel>Their name</FieldLabel>
                <FieldControl>
                  <Input
                    value={outside.name}
                    onChange={(e) => {
                      setOutside({ ...outside, name: e.target.value });
                    }}
                  />
                </FieldControl>
              </Field>
              <Button
                variant="secondary"
                disabled={!outside.email.includes('@') || named.has(outside.email)}
                onClick={() => {
                  add({
                    personId: null,
                    email: outside.email.trim(),
                    name: outside.name.trim() || outside.email.trim(),
                  });
                  setOutside({ email: '', name: '' });
                }}
              >
                Add
              </Button>
            </div>
            <p className="text-sm text-fg-muted">
              People outside confirm it is them with a code we email them.
            </p>
            <Button
              variant="primary"
              className="self-end"
              disabled={signers.length === 0}
              onClick={() => {
                setStep(1);
              }}
            >
              Next
            </Button>
          </CardContent>
        </Card>
      ) : step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle level={2}>Where they sign</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-fg-muted">
              Kithena places a signature and the date for each signer on the last page. Move them,
              or add initials to every page.
            </p>
            {signers.map((s) => (
              <div key={s.key} className="grid gap-3 sm:grid-cols-[1fr_8rem_10rem] sm:items-end">
                <span className="font-semibold">{s.name}</span>
                <Field>
                  <FieldLabel>Page</FieldLabel>
                  <Select
                    value={String(s.page)}
                    onValueChange={(v) => {
                      update(s.key, { page: Number(v) });
                    }}
                  >
                    <FieldControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FieldControl>
                    <SelectContent>
                      {Array.from({ length: pages }, (_, p) => (
                        <SelectItem key={p} value={String(p + 1)}>
                          {`Page ${String(p + 1)}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel>Where</FieldLabel>
                  <SegmentedControl
                    aria-label={`Where ${s.name} signs`}
                    value={s.spot}
                    onValueChange={(v) => {
                      update(s.key, { spot: v === 'right' ? 'right' : 'left' });
                    }}
                  >
                    <SegmentedControlItem value="left">Left</SegmentedControlItem>
                    <SegmentedControlItem value="right">Right</SegmentedControlItem>
                  </SegmentedControl>
                </Field>
                <Field orientation="horizontal" className="sm:col-span-3">
                  <FieldLabel>Initials on every other page</FieldLabel>
                  <FieldControl>
                    <Checkbox
                      checked={s.initials}
                      onCheckedChange={(v) => {
                        update(s.key, { initials: v === true });
                      }}
                    />
                  </FieldControl>
                </Field>
                {s.personId === null ? null : (
                  <Field orientation="horizontal" className="sm:col-span-3">
                    <FieldLabel>May pass it to a colleague</FieldLabel>
                    <FieldControl>
                      <Checkbox
                        checked={s.allowDelegate}
                        onCheckedChange={(v) => {
                          update(s.key, { allowDelegate: v === true });
                        }}
                      />
                    </FieldControl>
                  </Field>
                )}
              </div>
            ))}
            <div className="flex justify-between">
              <Button
                variant="secondary"
                onClick={() => {
                  setStep(0);
                }}
              >
                Back
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setStep(2);
                }}
              >
                Next
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle level={2}>Review and send</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <List>
              {signers.map((s, i) => (
                <ListItem
                  key={s.key}
                  leading={<Avatar name={s.name} size="md" />}
                  description={`Signs ${String(i + 1)} of ${String(signers.length)} · page ${String(s.page)}${s.initials ? ' · initials on every page' : ''}`}
                >
                  {s.name}
                </ListItem>
              ))}
            </List>
            <Field>
              <FieldLabel>Message</FieldLabel>
              <FieldControl>
                <Input
                  value={message}
                  maxLength={2000}
                  placeholder="Please sign by Friday"
                  onChange={(e) => {
                    setMessage(e.target.value);
                  }}
                />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel>Due</FieldLabel>
              <FieldControl>
                <DatePicker label="Due" placeholder="No date" value={dueOn} onChange={setDueOn} />
              </FieldControl>
            </Field>
            {write.error === null ? null : (
              <Alert tone="danger" title="Not sent">
                {write.error}
              </Alert>
            )}
            <div className="flex justify-between">
              <Button
                variant="secondary"
                onClick={() => {
                  setStep(1);
                }}
              >
                Back
              </Button>
              <Button
                variant="primary"
                startIcon={<icons.send aria-hidden />}
                loading={write.pending}
                onClick={() => {
                  write.run(async () => {
                    const sent = await (onSend?.(doc.row.id, {
                      signers: signers.map((s, i) => ({
                        personId: s.personId,
                        email: s.personId === null ? s.email : null,
                        name: s.name,
                        order: i + 1,
                        allowDelegate: s.allowDelegate,
                      })),
                      fields: fieldsOf(signers, pages),
                      message,
                      dueOn,
                    }) ?? Promise.resolve({ ok: false as const, message: 'Not available here' }));
                    if (!sent.ok) return sent;
                    onNavigate?.(`/documents/envelopes/${sent.id}`);
                    return { ok: true };
                  });
                }}
              >
                Send
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

/* ------------------------------------------------- K4–K9 one request -- */

export interface EnvelopeProps {
  readonly load: Loadable<EnvelopeData>;
  readonly onNavigate?: ((href: string) => void) | undefined;
  readonly onFileLink?:
    | ((envelopeId: string) => Promise<{ ok: true; url: string } | { ok: false; message: string }>)
    | undefined;
  readonly onSign?:
    | ((
        envelopeId: string,
        signature: Mark,
        values: Readonly<Record<string, string>>,
      ) => Promise<{ ok: true; completed: boolean } | { ok: false; message: string }>)
    | undefined;
  readonly onDecline?: ((envelopeId: string, reason: string) => Promise<Outcome>) | undefined;
  readonly onAsk?: ((envelopeId: string, question: string) => Promise<Outcome>) | undefined;
  readonly onVoid?: ((envelopeId: string, reason: string) => Promise<Outcome>) | undefined;
  readonly onRemind?: ((envelopeId: string) => Promise<Outcome>) | undefined;
  readonly onReassign?:
    ((envelopeId: string, signerId: string, personId: string) => Promise<Outcome>) | undefined;
  readonly onSeal?: ((envelopeId: string) => Promise<Outcome>) | undefined;
}

export function Envelope(props: EnvelopeProps): JSX.Element {
  if (props.load.status === 'loading') return <Skeleton shape="page" label="Loading the request" />;
  return (
    <div className="flex flex-col gap-6">
      {props.load.status === 'error' ? <PageHeader title="Signature request" /> : null}
      <Loaded load={props.load} what="the request">
        {(env) => <EnvelopePage env={env} {...props} />}
      </Loaded>
    </div>
  );
}

function EnvelopePage({
  env,
  ...props
}: { readonly env: EnvelopeData } & Omit<EnvelopeProps, 'load'>): JSX.Element {
  const [link, setLink] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void props.onFileLink?.(env.id).then((got) => {
      if (live && got.ok) setLink(got.url);
    });
    return () => {
      live = false;
    };
  }, [env.id, env.status, props.onFileLink]);
  const signing = env.me?.turn === true;
  return (
    <>
      <PageHeader
        title={env.title}
        description={`From ${env.sender} · ${shortDate(env.createdAt)}${env.dueOn === null ? '' : ` · due ${shortDate(env.dueOn)}`}`}
        actions={
          env.follows && env.status === 'sent' ? <SenderMenu env={env} {...props} /> : undefined
        }
      />
      <div className="flex flex-wrap gap-2">
        <Badge tone={ENVELOPE[env.status][1]} size="sm" dot>
          {ENVELOPE[env.status][0]}
        </Badge>
      </div>
      {env.message === '' ? null : (
        <Alert tone="info" title={`${env.sender} says`}>
          {env.message}
        </Alert>
      )}
      {env.voidReason === null ? null : (
        <Alert tone="neutral" title="Cancelled">
          {env.voidReason}
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <Card variant="fill" className="overflow-hidden">
          {link === null ? (
            <div className="grid min-h-[36rem] place-items-center">
              <Spinner label="Opening the document" />
            </div>
          ) : (
            <iframe title={env.title} src={link} className="h-[48rem] w-full" />
          )}
        </Card>
        <div className="flex flex-col gap-4">
          {signing ? <SignPanel env={env} {...props} /> : null}
          <Card>
            <CardHeader>
              <CardTitle level={2}>Signers</CardTitle>
            </CardHeader>
            <CardContent>
              <List>
                {env.signers.map((s) => (
                  <ListItem
                    key={s.id}
                    leading={<Avatar name={s.name} size="md" />}
                    description={[
                      s.check === 'login'
                        ? 'Kithena login'
                        : `Code by email${s.email === null ? '' : ` · ${s.email}`}`,
                      s.signedAt === null ? null : shortDate(s.signedAt),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    meta={
                      <Badge tone={STATUS[s.status][1]} size="sm" dot>
                        {STATUS[s.status][0]}
                      </Badge>
                    }
                    trailing={
                      env.follows &&
                      env.status === 'sent' &&
                      s.allowDelegate &&
                      s.status !== 'signed' ? (
                        <Reassign env={env} signerId={s.id} onReassign={props.onReassign} />
                      ) : null
                    }
                  >
                    {s.name}
                  </ListItem>
                ))}
              </List>
            </CardContent>
          </Card>
          {env.status === 'completed' && env.signedVersion === null && env.follows ? (
            <Alert
              tone="warning"
              title="Signed, not sealed yet"
              action={<SealAgain id={env.id} onSeal={props.onSeal} />}
            >
              Everybody has signed; sealing the file did not finish.
            </Alert>
          ) : null}
          {env.status === 'completed' && env.signedVersion !== null ? (
            <Alert tone="success" title="Signed and sealed">
              {`Filed as version ${String(env.signedVersion)}, with a certificate of completion as its last page.`}
              <Button asChild size="sm" variant="secondary" className="mt-2">
                <a href={`/documents/d/${env.documentId}`}>Open the signed document</a>
              </Button>
            </Alert>
          ) : null}
          {env.trail.length === 0 ? null : (
            <Card>
              <CardHeader>
                <CardTitle level={2}>What happened</CardTitle>
              </CardHeader>
              <CardContent>
                <List>
                  {env.trail.map((t, i) => (
                    <ListItem
                      key={`${t.at}-${String(i)}`}
                      description={[shortDate(t.at), t.note].filter(Boolean).join(' · ')}
                    >
                      {`${t.who} · ${t.action.replaceAll('_', ' ')}`}
                    </ListItem>
                  ))}
                </List>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

const LABELS: Record<FieldKind, string> = {
  signature: 'Signature',
  initials: 'Initials',
  date: 'Date signed',
  name: 'Full name',
  title: 'Job title',
  checkbox: 'Tick',
  text: 'Text',
};

/** K4–K7: the signer's own fields, one panel, and everything other than signing. */
export function SignPanel({
  env,
  onSign,
  onDecline,
  onAsk,
  onNavigate,
}: { readonly env: EnvelopeData } & Pick<
  EnvelopeProps,
  'onSign' | 'onDecline' | 'onAsk' | 'onNavigate'
>): JSX.Element {
  const me = env.me?.signerId ?? '';
  const mine = env.fields.filter((f) => f.signerId === me);
  const [values, setValues] = useState<Readonly<Record<string, string>>>({});
  const [adopting, setAdopting] = useState(false);
  const [mark, setMark] = useState<Mark | null>(null);
  const [other, setOther] = useState<'ask' | 'decline' | null>(null);
  const [text, setText] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const write = useWrite();
  if (done !== null)
    return (
      <Alert tone="success" title="Signed">
        {done}
      </Alert>
    );
  const signed = mark !== null;
  const ready =
    signed &&
    mine.every(
      (f) =>
        !f.required ||
        f.kind === 'signature' ||
        f.kind === 'initials' ||
        f.kind === 'date' ||
        f.kind === 'name' ||
        (f.kind === 'checkbox' ? values[f.id] === 'true' : (values[f.id] ?? '').trim() !== ''),
    );
  return (
    <Card variant="assistant">
      <CardHeader>
        <CardTitle level={2}>Your part</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <List>
          {mine.map((f) => (
            <ListItem
              key={f.id}
              icon={
                f.kind === 'signature' || f.kind === 'initials' ? (
                  <icons.edit />
                ) : f.kind === 'date' ? (
                  <icons.calendar />
                ) : (
                  <icons.document />
                )
              }
              description={`Page ${String(f.page)}`}
              trailing={
                f.kind === 'checkbox' ? (
                  <Checkbox
                    aria-label={f.label ?? 'Tick'}
                    checked={values[f.id] === 'true'}
                    onCheckedChange={(v) => {
                      setValues({ ...values, [f.id]: v === true ? 'true' : 'false' });
                    }}
                  />
                ) : f.kind === 'text' || f.kind === 'title' ? (
                  <Input
                    aria-label={f.label ?? LABELS[f.kind]}
                    value={values[f.id] ?? ''}
                    onChange={(e) => {
                      setValues({ ...values, [f.id]: e.target.value });
                    }}
                  />
                ) : f.kind === 'date' ? (
                  <span className="text-sm text-fg-muted">Fills in when you sign</span>
                ) : f.kind === 'name' ? null : (
                  <Badge tone={signed ? 'success' : 'accent'} size="sm">
                    {signed ? 'Ready' : 'Sign here'}
                  </Badge>
                )
              }
            >
              {f.label ?? LABELS[f.kind]}
            </ListItem>
          ))}
        </List>
        <Button
          variant={signed ? 'secondary' : 'primary'}
          startIcon={<icons.edit aria-hidden />}
          onClick={() => {
            setAdopting(true);
          }}
        >
          {signed ? 'Change your signature' : 'Adopt your signature'}
        </Button>
        {write.error === null ? null : (
          <Alert tone="danger" title="Not signed">
            {write.error}
          </Alert>
        )}
        <Button
          variant="primary"
          disabled={!ready}
          loading={write.pending}
          onClick={() => {
            if (mark === null) return;
            write.run(async () => {
              const r = await (onSign?.(env.id, mark, values) ??
                Promise.resolve({ ok: false as const, message: 'Not available here' }));
              if (!r.ok) return r;
              setDone(
                r.completed
                  ? 'Everybody has signed: the document is sealed and filed.'
                  : `${env.sender} and anyone after you sign next. The signed copy lands in your documents.`,
              );
              return { ok: true };
            });
          }}
        >
          Sign
        </Button>
        <p className="text-xs text-fg-muted">
          Signed with your Kithena login. The time and your device are recorded.
        </p>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setOther('ask');
            }}
          >
            Ask a question
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setOther('decline');
            }}
          >
            Decline
          </Button>
        </div>
      </CardContent>
      <AdoptDialog
        open={adopting}
        onOpenChange={setAdopting}
        onAdopt={(m) => {
          setMark(m);
          setAdopting(false);
        }}
      />
      <Dialog
        open={other !== null}
        onOpenChange={(o) => {
          if (!o) setOther(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {other === 'ask' ? `Ask ${env.sender} a question` : 'Decline to sign'}
            </DialogTitle>
            <DialogDescription>
              {other === 'ask' ? 'The request waits for you.' : `${env.sender} is told; say why.`}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field required>
              <FieldLabel>{other === 'ask' ? 'Your question' : 'Why'}</FieldLabel>
              <FieldControl>
                <Input
                  value={text}
                  maxLength={1000}
                  onChange={(e) => {
                    setText(e.target.value);
                  }}
                />
              </FieldControl>
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setOther(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant={other === 'decline' ? 'danger' : 'primary'}
              disabled={text.trim() === ''}
              onClick={() => {
                const what = other;
                write.run(
                  () =>
                    (what === 'ask' ? onAsk?.(env.id, text) : onDecline?.(env.id, text)) ??
                    Promise.resolve({ ok: true }),
                  () => {
                    setOther(null);
                    if (what === 'decline') onNavigate?.('/documents/all');
                    else setDone('Your question was sent. The request waits for you.');
                  },
                );
              }}
            >
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** K5: type or draw, once; every field of yours then fills with it. */
export function AdoptDialog({
  open,
  onOpenChange,
  onAdopt,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onAdopt: (mark: Mark) => void;
}): JSX.Element {
  const [how, setHow] = useState<'type' | 'draw'>('type');
  const [typed, setTyped] = useState('');
  const [path, setPath] = useState('');
  const ready = how === 'type' ? typed.trim() !== '' : path.trim() !== '';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Your signature</DialogTitle>
          <DialogDescription>Type it, or draw it.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <SegmentedControl
            aria-label="How you sign"
            fullWidth
            value={how}
            onValueChange={(v) => {
              setHow(v === 'draw' ? 'draw' : 'type');
            }}
          >
            <SegmentedControlItem value="type">Type</SegmentedControlItem>
            <SegmentedControlItem value="draw">Draw</SegmentedControlItem>
          </SegmentedControl>
          {how === 'type' ? (
            <Field>
              <FieldLabel>Your name</FieldLabel>
              <FieldControl>
                <Input
                  value={typed}
                  maxLength={120}
                  onChange={(e) => {
                    setTyped(e.target.value);
                  }}
                />
              </FieldControl>
              <FieldDescription>Drawn in a handwriting face where you sign.</FieldDescription>
            </Field>
          ) : (
            <SignaturePad label="Draw your signature" value={path} onValueChange={setPath} />
          )}
          <p className="text-xs text-fg-muted">
            By adopting it, you agree this electronic signature is the legal equivalent of your
            handwritten one.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!ready}
            onClick={() => {
              onAdopt(
                how === 'type'
                  ? { kind: 'typed', text: typed.trim() }
                  : { kind: 'drawn', path: path.trim() },
              );
            }}
          >
            Adopt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** K8: what the sender may do while it waits. */
function SenderMenu({
  env,
  onRemind,
  onVoid,
}: { readonly env: EnvelopeData } & Pick<EnvelopeProps, 'onRemind' | 'onVoid'>): JSX.Element {
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const write = useWrite();
  const [reminded, setReminded] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        disabled={reminded || write.pending}
        onClick={() => {
          write.run(
            () => onRemind?.(env.id) ?? Promise.resolve({ ok: true }),
            () => {
              setReminded(true);
            },
          );
        }}
      >
        {reminded ? 'Reminded' : 'Remind'}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" aria-label="More" startIcon={<icons.more aria-hidden />} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              setCancelling(true);
            }}
          >
            Cancel the request
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={cancelling} onOpenChange={setCancelling}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this request</DialogTitle>
            <DialogDescription>Signers can no longer sign it. Say why.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field required>
              <FieldLabel>Why</FieldLabel>
              <FieldControl>
                <Input
                  value={reason}
                  maxLength={1000}
                  onChange={(e) => {
                    setReason(e.target.value);
                  }}
                />
              </FieldControl>
            </Field>
            {write.error === null ? null : <Alert tone="danger">{write.error}</Alert>}
          </DialogBody>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setCancelling(false);
              }}
            >
              Keep it
            </Button>
            <Button
              variant="danger"
              disabled={reason.trim() === ''}
              loading={write.pending}
              onClick={() => {
                write.run(
                  () => onVoid?.(env.id, reason) ?? Promise.resolve({ ok: true }),
                  () => {
                    setCancelling(false);
                  },
                );
              }}
            >
              Cancel the request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Reassign({
  env,
  signerId,
  onReassign,
}: {
  readonly env: EnvelopeData;
  readonly signerId: string;
  readonly onReassign: EnvelopeProps['onReassign'];
}): JSX.Element {
  const write = useWrite();
  return (
    <Combobox
      label="Pass to"
      size="sm"
      options={env.people.map((p) => ({ value: p.personId, label: p.name }))}
      value={null}
      onChange={(v) => {
        if (typeof v !== 'string') return;
        write.run(() => onReassign?.(env.id, signerId, v) ?? Promise.resolve({ ok: true }));
      }}
      placeholder="Pass to…"
      searchPlaceholder="Find a colleague"
      emptyMessage="Nobody by that name"
    />
  );
}

function SealAgain({
  id,
  onSeal,
}: {
  readonly id: string;
  readonly onSeal: EnvelopeProps['onSeal'];
}): JSX.Element {
  const write = useWrite();
  return (
    <Button
      size="sm"
      loading={write.pending}
      onClick={() => {
        write.run(() => onSeal?.(id) ?? Promise.resolve({ ok: true }));
      }}
    >
      Seal it now
    </Button>
  );
}
