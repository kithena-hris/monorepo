'use client';

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Input,
  List,
  ListItem,
  PageHeader,
  PinInput,
  SegmentedControl,
  SegmentedControlItem,
  SignaturePad,
  icons,
} from '@reach/ui';
import { useState, useTransition, type JSX } from 'react';

import { declineLink, requestCode, signLink, verifyCode } from './actions';

/** What a link's request looks like to its signer: Documents' `EnvelopeView`, the parts used here. */
export interface LinkEnvelope {
  readonly id: string;
  readonly title: string;
  readonly status: 'sent' | 'completed' | 'declined' | 'voided';
  readonly message: string;
  readonly sender: string;
  readonly signers: readonly {
    readonly id: string;
    readonly name: string;
    readonly status: string;
  }[];
  readonly fields: readonly {
    readonly id: string;
    readonly signerId: string;
    readonly kind: 'signature' | 'initials' | 'date' | 'name' | 'title' | 'checkbox' | 'text';
    readonly page: number;
    readonly label: string | null;
    readonly required: boolean;
  }[];
  readonly me: {
    readonly signerId: string;
    readonly status: string;
    readonly turn: boolean;
  } | null;
}

/**
 * K6 then K4–K5 for somebody outside: a code by email, then their fields,
 * a signature typed or drawn, and Sign. The document is shown beside it,
 * from a link that lasts minutes.
 */
export function SignByLink({
  token,
  company,
  envelope,
  fileUrl,
}: {
  readonly token: string;
  readonly company: string;
  readonly envelope: LinkEnvelope | null;
  readonly fileUrl: string | null;
}): JSX.Element {
  const [verified, setVerified] = useState(envelope?.me?.status === 'verified');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [how, setHow] = useState<'type' | 'draw'>('type');
  const [typed, setTyped] = useState('');
  const [path, setPath] = useState('');
  const [values, setValues] = useState<Readonly<Record<string, string>>>({});
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');

  if (envelope === null) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
        <EmptyState
          icon={<icons.locked />}
          title="This link does not open anything"
          description="It may have been replaced, cancelled or signed already."
        />
      </main>
    );
  }
  if (envelope.status !== 'sent' || envelope.me?.turn !== true || done !== null) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
        <EmptyState
          icon={<icons.success />}
          title={
            done ??
            (envelope.status === 'completed'
              ? 'Signed'
              : envelope.status === 'sent'
                ? 'Not your turn yet'
                : `This request was ${envelope.status}`)
          }
          description={
            done === null ? `${envelope.sender} at ${company} sent it.` : 'You can close this page.'
          }
        />
      </main>
    );
  }
  const me = envelope.me.signerId;
  const mine = envelope.fields.filter((f) => f.signerId === me);
  const act = (run: () => Promise<void>) => {
    setProblem(null);
    start(run);
  };

  if (!verified) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
        <PageHeader
          title="Check it’s you"
          description={`${company} sent you ${envelope.title} to sign.`}
        />
        {sentTo === null ? (
          <Button
            variant="primary"
            loading={pending}
            onClick={() => {
              act(async () => {
                const r = await requestCode(token);
                if (r.ok) setSentTo(r.data.sentTo);
                else setProblem(r.message);
              });
            }}
          >
            Email me a code
          </Button>
        ) : (
          <>
            <PinInput
              label={`The code we emailed to ${sentTo}`}
              value={code}
              onChange={setCode}
              length={6}
              type="numeric"
              autoFocus
              onComplete={(full) => {
                act(async () => {
                  const r = await verifyCode(token, full);
                  if (!r.ok) setProblem(r.message);
                  else if (r.verified) setVerified(true);
                  else {
                    setProblem('That code is not right. Try again.');
                    setCode('');
                  }
                });
              }}
            />
            <Button
              variant="ghost"
              onClick={() => {
                setSentTo(null);
                setCode('');
              }}
            >
              Send a new code
            </Button>
          </>
        )}
        {problem === null ? null : <Alert tone="danger">{problem}</Alert>}
      </main>
    );
  }

  const ready =
    (how === 'type' ? typed.trim() !== '' : path.trim() !== '') &&
    mine.every((f) => !f.required || f.kind !== 'checkbox' || values[f.id] === 'true') &&
    mine.every(
      (f) =>
        !f.required ||
        (f.kind !== 'text' && f.kind !== 'title') ||
        (values[f.id] ?? '').trim() !== '',
    );

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-8">
      <PageHeader title={envelope.title} description={`From ${envelope.sender} at ${company}`} />
      {envelope.message === '' ? null : (
        <Alert tone="info" title={`${envelope.sender} says`}>
          {envelope.message}
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <Card variant="fill" className="overflow-hidden">
          {fileUrl === null ? (
            <Alert tone="danger">The document could not be opened.</Alert>
          ) : (
            <iframe title={envelope.title} src={fileUrl} className="h-[48rem] w-full" />
          )}
        </Card>
        <Card variant="assistant">
          <CardHeader>
            <CardTitle level={2}>Your part</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <List>
              {mine.map((f) => (
                <ListItem
                  key={f.id}
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
                        aria-label={f.label ?? 'Text'}
                        value={values[f.id] ?? ''}
                        onChange={(e) => {
                          setValues({ ...values, [f.id]: e.target.value });
                        }}
                      />
                    ) : f.kind === 'date' ? (
                      <span className="text-sm text-fg-muted">Fills in when you sign</span>
                    ) : (
                      <Badge tone="accent" size="sm">
                        Sign here
                      </Badge>
                    )
                  }
                >
                  {f.label ??
                    (f.kind === 'signature'
                      ? 'Signature'
                      : f.kind === 'initials'
                        ? 'Initials'
                        : f.kind === 'date'
                          ? 'Date signed'
                          : f.kind === 'name'
                            ? 'Full name'
                            : 'Field')}
                </ListItem>
              ))}
            </List>
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
                <FieldDescription>
                  Adopting it, you agree this electronic signature is the legal equivalent of your
                  handwritten one.
                </FieldDescription>
              </Field>
            ) : (
              <SignaturePad label="Draw your signature" value={path} onValueChange={setPath} />
            )}
            {problem === null ? null : <Alert tone="danger">{problem}</Alert>}
            <Button
              variant="primary"
              disabled={!ready}
              loading={pending}
              onClick={() => {
                act(async () => {
                  const r = await signLink(
                    token,
                    how === 'type'
                      ? { kind: 'typed', text: typed.trim() }
                      : { kind: 'drawn', path: path.trim() },
                    values,
                  );
                  if (!r.ok) setProblem(r.message);
                  else
                    setDone(
                      r.data.completed
                        ? 'Signed. Everybody has signed; the sealed copy is with the sender.'
                        : 'Signed. The others sign next.',
                    );
                });
              }}
            >
              Sign
            </Button>
            {declining ? (
              <>
                <Field required>
                  <FieldLabel>Why you decline</FieldLabel>
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
                <Button
                  variant="danger"
                  disabled={reason.trim() === ''}
                  onClick={() => {
                    act(async () => {
                      const r = await declineLink(token, reason);
                      if (r.ok) setDone('Declined. The sender is told.');
                      else setProblem(r.message);
                    });
                  }}
                >
                  Decline to sign
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => {
                  setDeclining(true);
                }}
              >
                Decline
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
