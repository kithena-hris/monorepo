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
  FieldLabel,
  Input,
  List,
  ListItem,
  PageHeader,
  Signature,
  Skeleton,
  Spinner,
  Stepper,
  icons,
  isFilled,
} from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';

import { Loaded, type Loadable } from '../load';
import { WhereTheySign, startingFields, type PlacedField } from './prepare';
import {
  AdoptDialog,
  DocumentToSign,
  SIGNED,
  doneMessage,
  useSigning,
  type Signing,
  type Stamped,
} from './sign-view';
import { shortDate, useWrite } from '../shared';
import type {
  Created,
  DocumentData,
  EnvelopeData,
  EnvelopesData,
  FieldKind,
  FileLink,
  Mark,
  Outcome,
} from '../types';
import { t as tr } from '../i18n';

/**
 * Signatures on the web (K1–K10): the requests this person follows or must
 * sign, sending one, and one request — signed field by field by its signer,
 * followed step by step by its sender.
 */

const STATUS = () =>
  ({
    waiting: [tr('envelopes.envelopes.waiting', 'Waiting'), 'neutral'],
    sent: [tr('envelopes.envelopes.sent', 'Sent'), 'info'],
    opened: [tr('envelopes.envelopes.opened', 'Opened'), 'info'],
    verified: [tr('envelopes.envelopes.opened', 'Opened'), 'info'],
    signed: [tr('envelopes.envelopes.signed', 'Signed'), 'success'],
    declined: [tr('envelopes.envelopes.declined', 'Declined'), 'danger'],
  }) as const;

const ENVELOPE = () =>
  ({
    sent: [tr('envelopes.envelopes.waiting_for_a_signature', 'Waiting for a signature'), 'warning'],
    completed: [tr('envelopes.envelopes.signed_and_sealed', 'Signed and sealed'), 'success'],
    declined: [tr('envelopes.envelopes.declined', 'Declined'), 'danger'],
    voided: [tr('envelopes.envelopes.cancelled', 'Cancelled'), 'neutral'],
  }) as const;

/* ------------------------------------------------------------- K10 list -- */

export function Envelopes({
  load,
  onNavigate,
}: {
  readonly load: Loadable<EnvelopesData>;
  readonly onNavigate?: ((href: string) => void) | undefined;
}): JSX.Element {
  if (load.status === 'loading')
    return (
      <Skeleton
        shape="page"
        label={tr('envelopes.envelopes.loading_signature_requests', 'Loading signature requests')}
      />
    );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tr('envelopes.envelopes.signatures', 'Signatures')}
        description={tr(
          'envelopes.envelopes.every_request_you_sign_or_follow',
          'Every request you sign or follow.',
        )}
      />
      <Loaded load={load} what={tr('envelopes.envelopes.signature_requests', 'signature requests')}>
        {(data) =>
          data.rows.length === 0 ? (
            <EmptyState
              icon={<icons.edit />}
              title={tr('envelopes.envelopes.no_signature_requests', 'No signature requests')}
              description={tr(
                'envelopes.envelopes.send_one_from_a_document',
                'Send one from a document.',
              )}
            />
          ) : (
            <List>
              {data.rows.map((r) => (
                <ListItem
                  key={r.id}
                  icon={<icons.edit />}
                  iconTone={r.needsYou ? 'accent' : 'neutral'}
                  description={[
                    tr('envelopes.envelopes.of_signed', '{{signed}} of {{of}} signed', {
                      signed: r.signed,
                      of: r.of,
                    }),
                    ...(r.waitingOn === null
                      ? []
                      : [
                          tr('envelopes.envelopes.waiting_for', 'waiting for {{who}}', {
                            who: r.waitingOn,
                          }),
                        ]),
                    ...(r.dueOn === null
                      ? []
                      : [
                          tr('envelopes.envelopes.due', 'due {{date}}', {
                            date: shortDate(r.dueOn),
                          }),
                        ]),
                  ].join(' · ')}
                  meta={
                    <Badge tone={r.needsYou ? 'accent' : ENVELOPE()[r.status][1]} size="sm" dot>
                      {r.needsYou
                        ? tr('envelopes.envelopes.your_signature', 'Your signature')
                        : ENVELOPE()[r.status][0]}
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
}

export interface SendProps {
  readonly load: Loadable<DocumentData>;
  /** The document's file, to place boxes on it. */
  readonly onFileLink?: FileLink | undefined;
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
    return (
      <Skeleton
        shape="page"
        label={tr('envelopes.envelopes.loading_the_document', 'Loading the document')}
      />
    );
  return (
    <div className="flex flex-col gap-6">
      {props.load.status === 'error' ? (
        <PageHeader title={tr('envelopes.envelopes.send_for_signature', 'Send for signature')} />
      ) : null}
      <Loaded load={props.load} what={tr('envelopes.envelopes.the_document', 'the document')}>
        {(data) =>
          data.document === null ? (
            <Alert tone="danger">
              {tr(
                'envelopes.envelopes.you_cannot_open_this_document',
                'You cannot open this document.',
              )}
            </Alert>
          ) : !data.document.pdf ? (
            <Alert
              tone="warning"
              title={tr('envelopes.envelopes.only_a_pdf_can_be_signed', 'Only a PDF can be signed')}
            >
              {tr(
                'envelopes.envelopes.add_the_document_as_a_pdf',
                'Add the document as a PDF, then send it for signature.',
              )}
            </Alert>
          ) : (
            <SendSteps doc={data.document} {...props} />
          )
        }
      </Loaded>
    </div>
  );
}

function SendSteps({
  doc,
  onNavigate,
  onSend,
  onFileLink,
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
          },
        ],
  );
  const [fields, setFields] = useState<readonly PlacedField[]>([]);
  /** Each signer starts with a signature and its date; a signer removed takes their boxes. */
  const toPlacing = () => {
    const kept = fields.filter((f) => signers.some((s) => s.key === f.signer));
    setFields([
      ...kept,
      ...signers.flatMap((s, i) =>
        kept.some((f) => f.signer === s.key) ? [] : startingFields(s.key, i, pages),
      ),
    ]);
    setStep(1);
  };
  const unplaced = signers.some(
    (s) => !fields.some((f) => f.signer === s.key && (f.kind === 'signature' || f.kind === 'date')),
  );
  const [outside, setOutside] = useState({ email: '', name: '' });
  const [message, setMessage] = useState('');
  const [dueOn, setDueOn] = useState<string | null>(null);
  const write = useWrite();
  const update = (key: string, patch: Partial<DraftSigner>) => {
    setSigners(signers.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  };
  const add = (s: Omit<DraftSigner, 'key' | 'allowDelegate'>) => {
    setSigners([...signers, { ...s, key: String(Date.now()), allowDelegate: false }]);
  };
  const named = new Set(signers.map((s) => s.personId ?? s.email));
  return (
    <>
      <PageHeader
        title={tr('envelopes.envelopes.send_for_signature_2', 'Send {{title}} for signature', {
          title: doc.row.title,
        })}
        description={tr('envelopes.envelopes.version_pages', 'Version {{n}} · {{pages}} pages', {
          n: String(doc.current.n),
          pages: String(pages),
        })}
      />
      <Stepper
        label={tr('envelopes.envelopes.sending_for_signature', 'Sending for signature')}
        current={step}
        steps={[
          { id: 'who', label: tr('envelopes.envelopes.who_signs', 'Who signs') },
          { id: 'where', label: tr('envelopes.envelopes.where_they_sign', 'Where they sign') },
          { id: 'review', label: tr('envelopes.envelopes.review_and_send', 'Review and send') },
        ]}
        onStepChange={(i) => {
          if (i === 1) toPlacing();
          else if (i < 2 || !unplaced) setStep(i);
        }}
      />
      {step === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle level={2}>
              {tr('envelopes.envelopes.who_signs_in_order', 'Who signs, in order')}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {signers.length === 0 ? (
              <p className="text-sm text-fg-muted">
                {tr('envelopes.envelopes.nobody_yet', 'Nobody yet.')}
              </p>
            ) : null}
            <List>
              {signers.map((s, i) => (
                <ListItem
                  key={s.key}
                  leading={<Avatar name={s.name} size="md" />}
                  description={
                    s.personId === null
                      ? tr(
                          'envelopes.envelopes.confirms_with_a_code_by_email',
                          '{{email}} · confirms with a code by email',
                          { email: s.email },
                        )
                      : tr(
                          'envelopes.envelopes.signs_with_their_kithena_login',
                          'Signs with their Kithena login',
                        )
                  }
                  meta={
                    <Badge size="sm">
                      {i === 0
                        ? tr('envelopes.envelopes.signs_first', 'Signs first')
                        : i === 1
                          ? tr('envelopes.envelopes.signs_second', 'Signs second')
                          : tr('envelopes.envelopes.signs_in_position', 'Signs in position {{n}}', {
                              n: i + 1,
                            })}
                    </Badge>
                  }
                  trailing={
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={tr('envelopes.envelopes.remove', 'Remove {{name}}', {
                        name: s.name,
                      })}
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
              <FieldLabel>
                {tr('envelopes.envelopes.add_a_colleague', 'Add a colleague')}
              </FieldLabel>
              <FieldControl>
                <Combobox
                  label={tr('envelopes.envelopes.add_a_colleague', 'Add a colleague')}
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
                  placeholder={tr('envelopes.envelopes.find_a_colleague', 'Find a colleague')}
                  searchPlaceholder={tr('envelopes.envelopes.find_someone', 'Find someone')}
                  emptyMessage={tr(
                    'envelopes.envelopes.nobody_by_that_name',
                    'Nobody by that name',
                  )}
                />
              </FieldControl>
            </Field>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <Field>
                <FieldLabel>
                  {tr('envelopes.envelopes.somebody_outside', 'Somebody outside')}
                </FieldLabel>
                <FieldControl>
                  <Input
                    placeholder={tr('envelopes.envelopes.their_email', 'Their email')}
                    type="email"
                    value={outside.email}
                    onChange={(e) => {
                      setOutside({ ...outside, email: e.target.value });
                    }}
                  />
                </FieldControl>
              </Field>
              <Field>
                <FieldLabel>{tr('envelopes.envelopes.their_name', 'Their name')}</FieldLabel>
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
                {tr('envelopes.envelopes.add', 'Add')}
              </Button>
            </div>
            <p className="text-sm text-fg-muted">
              {tr(
                'envelopes.envelopes.people_outside_confirm_it_is_them',
                'People outside confirm it is them with a code we email them.',
              )}
            </p>
            <Button
              variant="primary"
              className="self-end"
              disabled={signers.length === 0}
              onClick={toPlacing}
            >
              {tr('envelopes.envelopes.next', 'Next')}
            </Button>
          </CardContent>
        </Card>
      ) : step === 1 ? (
        <div className="flex flex-col gap-4">
          <WhereTheySign
            documentId={doc.row.id}
            title={doc.row.title}
            signers={signers.map((s) => ({ key: s.key, name: s.name }))}
            fields={fields}
            onFields={setFields}
            onFileLink={onFileLink}
          />
          {signers.some((s) => s.personId !== null) ? (
            <Card>
              <CardContent className="flex flex-col gap-2 pt-4">
                {signers.map((s) =>
                  s.personId === null ? null : (
                    <Field key={s.key} orientation="horizontal" className="justify-start">
                      <FieldControl>
                        <Checkbox
                          checked={s.allowDelegate}
                          onCheckedChange={(v) => {
                            update(s.key, { allowDelegate: v === true });
                          }}
                        />
                      </FieldControl>
                      <FieldLabel>
                        {tr(
                          'envelopes.envelopes.may_pass_it_to_a_colleague',
                          '{{name}} may pass it to a colleague',
                          { name: s.name },
                        )}
                      </FieldLabel>
                    </Field>
                  ),
                )}
              </CardContent>
            </Card>
          ) : null}
          <div className="flex justify-between">
            <Button
              variant="secondary"
              onClick={() => {
                setStep(0);
              }}
            >
              {tr('envelopes.envelopes.back', 'Back')}
            </Button>
            <Button
              variant="primary"
              disabled={unplaced}
              onClick={() => {
                setStep(2);
              }}
            >
              {tr('envelopes.envelopes.next', 'Next')}
            </Button>
          </div>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle level={2}>
              {tr('envelopes.envelopes.review_and_send', 'Review and send')}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <List>
              {signers.map((s, i) => (
                <ListItem
                  key={s.key}
                  leading={<Avatar name={s.name} size="md" />}
                  description={tr(
                    'envelopes.envelopes.signs_of_boxes',
                    'Signs {{value}} of {{length}} · {{length2}} boxes',
                    {
                      value: String(i + 1),
                      length: String(signers.length),
                      length2: String(fields.filter((f) => f.signer === s.key).length),
                    },
                  )}
                >
                  {s.name}
                </ListItem>
              ))}
            </List>
            <Field>
              <FieldLabel>{tr('envelopes.envelopes.message', 'Message')}</FieldLabel>
              <FieldControl>
                <Input
                  value={message}
                  maxLength={2000}
                  placeholder={tr(
                    'envelopes.envelopes.please_sign_by_friday',
                    'Please sign by Friday',
                  )}
                  onChange={(e) => {
                    setMessage(e.target.value);
                  }}
                />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel>{tr('envelopes.envelopes.due_2', 'Due')}</FieldLabel>
              <FieldControl>
                <DatePicker
                  label={tr('envelopes.envelopes.due_2', 'Due')}
                  placeholder={tr('envelopes.envelopes.no_date', 'No date')}
                  value={dueOn}
                  onChange={setDueOn}
                />
              </FieldControl>
            </Field>
            {write.error === null ? null : (
              <Alert tone="danger" title={tr('envelopes.envelopes.not_sent', 'Not sent')}>
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
                {tr('envelopes.envelopes.back', 'Back')}
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
                      fields: fields.map((f) => {
                        const n = signers.findIndex((s) => s.key === f.signer) + 1;
                        return {
                          id: f.id,
                          signerId: `s${String(n)}`,
                          kind: f.kind,
                          page: f.page,
                          x: f.x,
                          y: f.y,
                          w: f.w,
                          h: f.h,
                          required: f.required,
                          label: null,
                        };
                      }),
                      message,
                      dueOn,
                    }) ??
                      Promise.resolve({
                        ok: false as const,
                        message: tr('envelopes.envelopes.not_available_here', 'Not available here'),
                      }));
                    if (!sent.ok) return sent;
                    onNavigate?.(`/documents/envelopes/${sent.id}`);
                    return { ok: true };
                  });
                }}
              >
                {tr('envelopes.envelopes.send', 'Send')}
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
        day: string,
        /** The Signature ID shown under each box as it was filled. */
        traceId?: string,
      ) => Promise<
        { ok: true; completed: boolean; next?: readonly string[] } | { ok: false; message: string }
      >)
    | undefined;
  readonly onDecline?: ((envelopeId: string, reason: string) => Promise<Outcome>) | undefined;
  readonly onAsk?: ((envelopeId: string, question: string) => Promise<Outcome>) | undefined;
  readonly onVoid?: ((envelopeId: string, reason: string) => Promise<Outcome>) | undefined;
  readonly onRemind?: ((envelopeId: string) => Promise<Outcome>) | undefined;
  /** Read the request again from the server: who has signed, whose turn it is. */
  readonly onRefresh?: (() => void) | undefined;
  readonly onReassign?:
    ((envelopeId: string, signerId: string, personId: string) => Promise<Outcome>) | undefined;
  readonly onSeal?: ((envelopeId: string) => Promise<Outcome>) | undefined;
  /** Keep a signature adopted while signing on the signer's record, where there is none. */
  readonly onKeepSignature?: ((mark: Mark) => Promise<Outcome>) | undefined;
}

export function Envelope(props: EnvelopeProps): JSX.Element {
  if (props.load.status === 'loading')
    return (
      <Skeleton
        shape="page"
        label={tr('envelopes.envelopes.loading_the_request', 'Loading the request')}
      />
    );
  return (
    <div className="flex flex-col gap-6">
      {props.load.status === 'error' ? (
        <PageHeader title={tr('envelopes.envelopes.signature_request', 'Signature request')} />
      ) : null}
      <Loaded load={props.load} what={tr('envelopes.envelopes.the_request', 'the request')}>
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
  // What was just signed, drawn over the copy on screen until the new copy has loaded.
  const [stamped, setStamped] = useState<Stamped | null>(null);
  useEffect(() => {
    let live = true;
    void props.onFileLink?.(env.id).then((got) => {
      if (live && got.ok) setLink(got.url);
    });
    return () => {
      live = false;
    };
    // Signed, the copy shown is the one with this signature drawn in (K7).
  }, [env.id, env.status, env.me?.status, props.onFileLink]);
  // Kept through the refresh the signing causes, when this signer's part has gone.
  const [done, setDone] = useState<string | null>(null);
  const finish = useWrite();
  const signingNow = env.me?.turn === true && env.status === 'sent' && done === null;
  // A document is signed with the legal name People keeps, never a preferred one.
  const myName = env.legalName ?? env.signers.find((s) => s.id === env.me?.signerId)?.name ?? '';
  const signing = useSigning(env, myName, (mark) => {
    void props.onKeepSignature?.(mark);
  });
  const onFinish = () => {
    finish.run(async () => {
      const signature = signing.mark ?? { kind: 'typed' as const, text: myName };
      const r = await (props.onSign?.(
        env.id,
        signature,
        signing.values,
        signing.day,
        signing.traceId,
      ) ??
        Promise.resolve({
          ok: false as const,
          message: tr('envelopes.envelopes.not_available_here', 'Not available here'),
        }));
      if (!r.ok) return r;
      setDone(doneMessage(r.completed, r.next ?? []));
      // At once: every box of theirs holds their signature, its print under it.
      setStamped({
        signerId: env.me?.signerId ?? '',
        mark: signature,
        filled: signing.filled,
        traceId: signing.traceId,
        at: new Date(),
      });
      // Then the copy Kithena drew, and the request as it stands now.
      void props.onFileLink?.(env.id).then((got) => {
        if (got.ok) setLink(got.url);
      });
      props.onRefresh?.();
      return { ok: true };
    });
  };
  return (
    <>
      <PageHeader
        title={env.title}
        description={
          env.dueOn === null
            ? tr('envelopes.envelopes.from', 'From {{sender}} · {{createdAt}}', {
                sender: env.sender,
                createdAt: shortDate(env.createdAt),
              })
            : tr(
                'envelopes.envelopes.from_due',
                'From {{sender}} · {{createdAt}} · due {{dueOn}}',
                {
                  sender: env.sender,
                  createdAt: shortDate(env.createdAt),
                  dueOn: shortDate(env.dueOn),
                },
              )
        }
        actions={
          env.follows && env.status === 'sent' ? <SenderMenu env={env} {...props} /> : undefined
        }
      />
      <div className="flex flex-wrap gap-2">
        <Badge tone={ENVELOPE()[env.status][1]} size="sm" dot>
          {ENVELOPE()[env.status][0]}
        </Badge>
      </div>
      {env.message === '' ? null : (
        <Alert
          tone="info"
          title={tr('envelopes.envelopes.says', '{{sender}} says', { sender: env.sender })}
        >
          {env.message}
        </Alert>
      )}
      {done === null ? null : (
        <Alert tone="success" title={tr('envelopes.envelopes.signed', 'Signed')}>
          {done}
        </Alert>
      )}
      {env.voidReason === null ? null : (
        <Alert tone="neutral" title={tr('envelopes.envelopes.cancelled', 'Cancelled')}>
          {env.voidReason}
        </Alert>
      )}
      {/* One column, top to bottom: the signer's part, the document, who signs, what happened. */}
      <div className="flex flex-col gap-6">
        {signingNow ? (
          <SignPanel env={env} signing={signing} name={myName} problem={finish.error} {...props} />
        ) : null}
        {/* No overflow clipping: the step bar sticks to the bottom of the page through it. */}
        <Card variant="fill">
          {link === null ? (
            <div className="grid min-h-[36rem] place-items-center">
              <Spinner
                label={tr('envelopes.envelopes.opening_the_document', 'Opening the document')}
              />
            </div>
          ) : (
            <div className="p-3">
              <DocumentToSign
                env={env}
                url={link}
                signing={signingNow ? signing : null}
                name={myName}
                onFinish={onFinish}
                finishing={finish.pending}
                stamped={stamped}
              />
            </div>
          )}
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle level={2}>{tr('envelopes.envelopes.signers', 'Signers')}</CardTitle>
            </CardHeader>
            <CardContent>
              <List>
                {env.signers.map((s) => (
                  <ListItem
                    key={s.id}
                    leading={<Avatar name={s.name} size="md" />}
                    description={[
                      s.check === 'login'
                        ? tr('envelopes.envelopes.kithena_login', 'Kithena login')
                        : tr('envelopes.envelopes.code_by_email', 'Code by email{{value}}', {
                            value: s.email === null ? '' : ` · ${s.email}`,
                          }),
                      s.signedAt === null ? null : shortDate(s.signedAt),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    meta={
                      <Badge tone={STATUS()[s.status][1]} size="sm" dot>
                        {STATUS()[s.status][0]}
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
              title={tr('envelopes.envelopes.signed_not_sealed_yet', 'Signed, not sealed yet')}
              action={<SealAgain id={env.id} onSeal={props.onSeal} />}
            >
              {tr(
                'envelopes.envelopes.everybody_has_signed_sealing_the_file',
                'Everybody has signed; sealing the file did not finish.',
              )}
            </Alert>
          ) : null}
          {env.status === 'completed' && env.signedVersion !== null ? (
            <Alert
              tone="success"
              title={tr('envelopes.envelopes.signed_and_sealed', 'Signed and sealed')}
            >
              {tr(
                'envelopes.envelopes.filed_as_version_with_a_certificate',
                'Filed as version {{signedVersion}}, with a certificate of completion as its last page.',
                { signedVersion: String(env.signedVersion) },
              )}
              <Button asChild size="sm" variant="secondary" className="mt-2">
                <a href={`/documents/d/${env.documentId}`}>
                  {tr('envelopes.envelopes.open_the_signed_document', 'Open the signed document')}
                </a>
              </Button>
            </Alert>
          ) : null}
          {env.trail.length === 0 ? null : (
            <Card>
              <CardHeader>
                <CardTitle level={2}>
                  {tr('envelopes.envelopes.what_happened', 'What happened')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <List>
                  {env.trail.map((t, i) => (
                    <ListItem
                      key={`${t.at}-${String(i)}`}
                      description={[shortDate(t.at), t.note].filter(Boolean).join(' · ')}
                    >
                      {tr('envelopes.envelopes.text', '{{who}} · {{replaceAll}}', {
                        who: t.who,
                        replaceAll: t.action.replaceAll('_', ' '),
                      })}
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

/**
 * K4–K7: the signer's part beside the document: what is left, the signature
 * they sign with, and asking or declining. Finish is on the step bar, under
 * the document, where the boxes are.
 */
export function SignPanel({
  env,
  signing,
  name,
  problem,
  onDecline,
  onAsk,
  onNavigate,
}: {
  readonly env: EnvelopeData;
  readonly signing: Signing;
  readonly name: string;
  /** Why Finish did not sign, from the bar. */
  readonly problem: string | null;
} & Pick<EnvelopeProps, 'onDecline' | 'onAsk' | 'onNavigate'>): JSX.Element {
  const [other, setOther] = useState<'ask' | 'decline' | null>(null);
  const [text, setText] = useState('');
  const [asked, setAsked] = useState(false);
  const write = useWrite();
  const { mine, mark, steps } = signing;
  /** Signed with the one on file: adopted in Settings, never changed here. */
  const onFile = env.signature?.mark != null;
  const needsMark = mine.some((f) => SIGNED.has(f.kind));
  const left = steps.filter((f) => f.required && !isFilled(signing.filled[f.id]));
  return (
    <Card variant="assistant">
      <CardHeader>
        <CardTitle level={2}>{tr('envelopes.envelopes.your_part', 'Your part')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm">
          {left.length === 0
            ? tr(
                'envelopes.envelopes.everything_is_filled_in_finish_under',
                'Everything is filled in. Finish, under the document, signs it.',
              )
            : tr(
                'envelopes.envelopes.to_fill_in_start_under_the',
                {
                  one: '{{count}} place to fill in. Start, under the document, takes you to each one.',
                  other:
                    '{{count}} places to fill in. Start, under the document, takes you to each one.',
                },
                { count: left.length },
              )}
        </p>
        {mark === null ? null : (
          <div className="h-16 rounded-md bg-surface-sunken">
            <Signature
              value={mark}
              label={tr('envelopes.envelopes.s_signature', '{{name}}’s signature', { name })}
            />
          </div>
        )}
        {onFile ? (
          <p className="text-sm text-fg-muted">
            {tr('envelopes.envelopes.your_signature_on_file', 'Your signature on file.')}{' '}
            <a href="/settings/documents/signature" className="text-accent-fg underline">
              {tr('envelopes.envelopes.change_it_in_settings', 'Change it in Settings')}
            </a>
          </p>
        ) : env.signature?.canKeep === true ? (
          <p className="text-xs text-fg-muted">
            {tr(
              'envelopes.envelopes.the_one_you_adopt_is_kept',
              'The one you adopt is kept for next time; change it later in Settings.',
            )}
          </p>
        ) : null}
        {needsMark && !onFile ? (
          <Button
            variant="secondary"
            startIcon={<icons.edit aria-hidden />}
            onClick={() => {
              signing.setAdopting(true);
            }}
          >
            {mark === null
              ? tr('envelopes.envelopes.adopt_your_signature', 'Adopt your signature')
              : tr('envelopes.envelopes.change_your_signature', 'Change your signature')}
          </Button>
        ) : null}
        {problem === null ? null : (
          <Alert tone="danger" title={tr('envelopes.envelopes.not_signed', 'Not signed')}>
            {problem}
          </Alert>
        )}
        {asked ? (
          <Alert tone="success">
            {tr(
              'envelopes.envelopes.your_question_was_sent_the_request',
              'Your question was sent. The request waits for you.',
            )}
          </Alert>
        ) : null}
        <p className="text-xs text-fg-muted">
          {tr(
            'envelopes.envelopes.signed_with_your_kithena_login_the',
            'Signed with your Kithena login. The time and your device are recorded.',
          )}
        </p>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setOther('ask');
            }}
          >
            {tr('envelopes.envelopes.ask_a_question', 'Ask a question')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setOther('decline');
            }}
          >
            {tr('envelopes.envelopes.decline', 'Decline')}
          </Button>
        </div>
      </CardContent>
      <AdoptDialog
        open={signing.adopting}
        name={name}
        onOpenChange={signing.setAdopting}
        onAdopt={signing.adopt}
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
              {other === 'ask'
                ? tr('envelopes.envelopes.ask_a_question_2', 'Ask {{sender}} a question', {
                    sender: env.sender,
                  })
                : tr('envelopes.envelopes.decline_to_sign', 'Decline to sign')}
            </DialogTitle>
            <DialogDescription>
              {other === 'ask'
                ? tr('envelopes.envelopes.the_request_waits_for_you', 'The request waits for you.')
                : tr('envelopes.envelopes.sender_is_told_say_why', '{{sender}} is told; say why.', {
                    sender: env.sender,
                  })}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field required>
              <FieldLabel>
                {other === 'ask'
                  ? tr('envelopes.envelopes.your_question', 'Your question')
                  : tr('envelopes.envelopes.why', 'Why')}
              </FieldLabel>
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
              {tr('envelopes.envelopes.cancel', 'Cancel')}
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
                    else setAsked(true);
                  },
                );
              }}
            >
              {tr('envelopes.envelopes.send', 'Send')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
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
        {reminded
          ? tr('envelopes.envelopes.reminded', 'Reminded')
          : tr('envelopes.envelopes.remind', 'Remind')}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            aria-label={tr('envelopes.envelopes.more', 'More')}
            startIcon={<icons.more aria-hidden />}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              setCancelling(true);
            }}
          >
            {tr('envelopes.envelopes.cancel_the_request', 'Cancel the request')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={cancelling} onOpenChange={setCancelling}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tr('envelopes.envelopes.cancel_this_request', 'Cancel this request')}
            </DialogTitle>
            <DialogDescription>
              {tr(
                'envelopes.envelopes.signers_can_no_longer_sign_it',
                'Signers can no longer sign it. Say why.',
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field required>
              <FieldLabel>{tr('envelopes.envelopes.why', 'Why')}</FieldLabel>
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
              {tr('envelopes.envelopes.keep_it', 'Keep it')}
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
              {tr('envelopes.envelopes.cancel_the_request', 'Cancel the request')}
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
      label={tr('envelopes.envelopes.pass_to', 'Pass to')}
      size="sm"
      options={env.people.map((p) => ({ value: p.personId, label: p.name }))}
      value={null}
      onChange={(v) => {
        if (typeof v !== 'string') return;
        write.run(() => onReassign?.(env.id, signerId, v) ?? Promise.resolve({ ok: true }));
      }}
      placeholder={tr('envelopes.envelopes.pass_to_2', 'Pass to…')}
      searchPlaceholder={tr('envelopes.envelopes.find_a_colleague', 'Find a colleague')}
      emptyMessage={tr('envelopes.envelopes.nobody_by_that_name', 'Nobody by that name')}
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
      {tr('envelopes.envelopes.seal_it_now', 'Seal it now')}
    </Button>
  );
}
